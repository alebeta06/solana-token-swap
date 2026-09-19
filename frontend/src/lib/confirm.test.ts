import { describe, it, expect } from "vitest";
import { TransactionUnconfirmedError, awaitLanding, type SignatureReader } from "./confirm";

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
