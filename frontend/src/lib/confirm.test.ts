import { describe, it, expect } from "vitest";
import {
  BlockhashRejectedError,
  TransactionUnconfirmedError,
  awaitLanding,
  isBlockhashNotFound,
  sendWithFreshBlockhash,
  type BlockhashSender,
  type SignatureReader,
} from "./confirm";

const SIG = "3ob27XJdkVcvZDqDJidRjNbo7iKKRGYjUVpALfMqNp8Z";

/**
 * A stand-in for `Connection` that replays a scripted sequence of answers.
 *
 * 🇪🇸 NOTA: sin red y sin mockear la librería — `awaitLanding` solo pide dos
 * métodos, así que el doble es un objeto literal. El reloj y la espera se
 * inyectan para que los tests no tarden lo que tardaría el sondeo real.
 */
function reader(
  statuses: (null | { slot: number; err: unknown; confirmationStatus?: string | null })[],
  blockHeight = 0
): SignatureReader & { calls: number } {
  const stub = {
    calls: 0,
    async getSignatureStatuses() {
      const value = statuses[Math.min(stub.calls, statuses.length - 1)];
      stub.calls++;
      return { value: [value] };
    },
    async getBlockHeight() {
      return blockHeight;
    },
  };
  return stub;
}

/** A clock that jumps by `step` every time it is read. */
function clock(step: number) {
  let t = 0;
  return () => (t += step);
}

const noSleep = async () => {};

describe("awaitLanding", () => {
  it("reports the slot the transaction confirmed at", async () => {
    const landing = await awaitLanding(
      reader([{ slot: 500_545_959, err: null, confirmationStatus: "confirmed" }]),
      SIG,
      999_999,
      { sleep: noSleep }
    );
    expect(landing).toEqual({ status: "confirmed", slot: 500_545_959 });
  });

  it("accepts finalized as confirmed, since it is strictly stronger", async () => {
    const landing = await awaitLanding(
      reader([{ slot: 7, err: null, confirmationStatus: "finalized" }]),
      SIG,
      999_999,
      { sleep: noSleep }
    );
    expect(landing).toMatchObject({ status: "confirmed" });
  });

  it("🔴 does not accept 'processed', which the chain can still discard", async () => {
    // La decisión está escrita en confirm.ts: esperar de más puede acuñar dos
    // veces unos tokens de prueba; dar por bueno lo procesado puede enseñar un
    // estado que nunca existió.
    const landing = await awaitLanding(
      reader([{ slot: 7, err: null, confirmationStatus: "processed" }]),
      SIG,
      999_999,
      { sleep: noSleep, now: clock(4_000), timeoutMs: 10_000 }
    );
    expect(landing).toEqual({ status: "unconfirmed" });
  });

  it("keeps polling until the status shows up", async () => {
    const stub = reader([
      null,
      null,
      { slot: 42, err: null, confirmationStatus: "confirmed" },
    ]);
    const landing = await awaitLanding(stub, SIG, 999_999, { sleep: noSleep });
    expect(landing).toMatchObject({ status: "confirmed", slot: 42 });
    expect(stub.calls).toBe(3);
  });

  it("reports a transaction that landed with an error as failed", async () => {
    const landing = await awaitLanding(
      reader([{ slot: 9, err: { InstructionError: [0, { Custom: 6005 }] }, confirmationStatus: "confirmed" }]),
      SIG,
      999_999,
      { sleep: noSleep }
    );
    expect(landing).toMatchObject({ status: "failed" });
    if (landing.status !== "failed") throw new Error("unreachable");
    expect(landing.detail).toContain("6005");
  });

  it("stops waiting once the blockhash can no longer be included", async () => {
    // Altura ya pasada y ninguna firma a la vista: no puede entrar nunca.
    const landing = await awaitLanding(reader([null], 1_000), SIG, 999, { sleep: noSleep });
    expect(landing).toMatchObject({ status: "failed" });
    if (landing.status !== "failed") throw new Error("unreachable");
    expect(landing.detail).toMatch(/expired/i);
  });

  it("🔴 says 'unconfirmed', not 'failed', when it simply ran out of time", async () => {
    // La transacción puede seguir en vuelo: el blockhash aún vale. Llamarlo
    // fallo manda a repetir un envío que quizá ya entró.
    const landing = await awaitLanding(reader([null], 0), SIG, 999_999, {
      sleep: noSleep,
      now: clock(6_000),
      timeoutMs: 10_000,
    });
    expect(landing).toEqual({ status: "unconfirmed" });
  });
});

describe("TransactionUnconfirmedError", () => {
  it("carries the signature and never claims the transaction failed", () => {
    const err = new TransactionUnconfirmedError(SIG);
    expect(err.signature).toBe(SIG);
    expect(err.message).toMatch(/may still land/i);
    expect(err.message).not.toMatch(/failed|did not go through/i);
  });
});

/**
 * A sender whose `sendRawTransaction` fails with the given errors in order.
 *
 * 🇪🇸 NOTA: el camino del reintento NO se puede provocar contra un RPC real —
 * depende de que la petición caiga en un backend atrasado, que es justo lo que
 * no se controla. Esto no prueba el comportamiento contra Alchemy; prueba que
 * la lógica existe, se dispara con ESE error y no con otros, y que el mensaje
 * es el que queremos. Es más de lo que había.
 */
function sender(failures: (Error | null)[]) {
  const stub = {
    blockhashes: [] as string[],
    signed: 0,
    sends: 0,
    async getLatestBlockhash(commitment: "confirmed" | "finalized") {
      stub.blockhashes.push(commitment);
      return { blockhash: `hash-${stub.blockhashes.length}`, lastValidBlockHeight: 1_000 };
    },
    async sendRawTransaction() {
      const failure = failures[stub.sends];
      stub.sends++;
      if (failure) throw failure;
      return `signature-${stub.sends}`;
    },
  };
  return stub satisfies BlockhashSender & Record<string, unknown>;
}

const notFound = () => new Error("failed to send transaction: Blockhash not found");

describe("sendWithFreshBlockhash", () => {
  it("asks for a finalized blockhash, which every backend already knows", async () => {
    const stub = sender([null]);
    await sendWithFreshBlockhash(stub, async () => new Uint8Array());
    expect(stub.blockhashes).toEqual(["finalized"]);
  });

  it("retries once with a NEW blockhash when the node did not know the old one", async () => {
    const stub = sender([notFound(), null]);
    const sign = async (latest: { blockhash: string }) => {
      signedWith.push(latest.blockhash);
      return new Uint8Array();
    };
    const signedWith: string[] = [];

    const result = await sendWithFreshBlockhash(stub, sign, { attempts: 2 });

    expect(result.signature).toBe("signature-2");
    expect(signedWith).toEqual(["hash-1", "hash-2"]); // blockhash nuevo, no el mismo
    expect(stub.sends).toBe(2);
  });

  it("🔴 never asks for a second signature when retrying is not allowed", async () => {
    // En el swap, reintentar significa abrir la wallet otra vez. `attempts: 1`
    // existe para que eso NO pase a espaldas del usuario.
    const stub = sender([notFound(), null]);
    let signatures = 0;

    await expect(
      sendWithFreshBlockhash(
        stub,
        async () => {
          signatures++;
          return new Uint8Array();
        },
        { attempts: 1 }
      )
    ).rejects.toBeInstanceOf(BlockhashRejectedError);

    expect(signatures).toBe(1);
    expect(stub.sends).toBe(1);
  });

  it("gives up with a message that blames the network and clears the user", async () => {
    const stub = sender([notFound(), notFound()]);
    const error = await sendWithFreshBlockhash(stub, async () => new Uint8Array(), {
      attempts: 2,
    }).catch((err) => err);

    expect(error).toBeInstanceOf(BlockhashRejectedError);
    expect(error.message).toMatch(/nothing was sent/i);
    expect(error.message).toMatch(/nothing was charged/i);
    expect(error.message).not.toMatch(/you |your fault|invalid/i);
    expect(stub.sends).toBe(2);
  });

  it("does not retry an error that would fail the same way twice", async () => {
    // Slippage, liquidez, saldo: reintentar solo retrasa el mensaje bueno.
    const slippage = new Error("custom program error: 0x1775");
    const stub = sender([slippage, null]);

    await expect(
      sendWithFreshBlockhash(stub, async () => new Uint8Array(), { attempts: 2 })
    ).rejects.toBe(slippage);
    expect(stub.sends).toBe(1);
  });
});

describe("isBlockhashNotFound", () => {
  it("recognises the error however the RPC wraps it, and nothing else", () => {
    expect(isBlockhashNotFound(new Error("Transaction simulation failed: Blockhash not found"))).toBe(true);
    expect(isBlockhashNotFound({ message: "blockhash not found" })).toBe(true);
    expect(isBlockhashNotFound(new Error("Blockhash expired"))).toBe(false);
    expect(isBlockhashNotFound(null)).toBe(false);
    expect(isBlockhashNotFound("Blockhash not found")).toBe(false);
  });
});
