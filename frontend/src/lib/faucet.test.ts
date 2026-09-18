import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { manifest, type DevnetManifest } from "./manifest";
import {
  FaucetInputError,
  MIN_FAUCET_LAMPORTS,
  decideDrop,
  dropAmounts,
  parseRecipient,
} from "./faucet";

const WALLET = "9aaPGTS7DikpFQugaPZVzVTaQ7dagUk1GpUwBDo15Y4y";

describe("parseRecipient", () => {
  it("accepts a wallet address and returns it unchanged", () => {
    expect(parseRecipient(WALLET).toBase58()).toBe(WALLET);
    expect(parseRecipient(`  ${WALLET}  `).toBase58()).toBe(WALLET);
  });

  it("rejects malformed input before anything reaches the network", () => {
    expect(() => parseRecipient("")).toThrow(FaucetInputError);
    expect(() => parseRecipient("   ")).toThrow(FaucetInputError);
    expect(() => parseRecipient("not-an-address")).toThrow(FaucetInputError);
    // Valid base58, wrong length — the shape that a naive regex lets through.
    expect(() => parseRecipient("9aaPGTS7Dikp")).toThrow(FaucetInputError);
    // Base58 has no 0, O, I or l: a transcribed address can land here.
    expect(() => parseRecipient(WALLET.replace("9aa", "0aa"))).toThrow(FaucetInputError);
  });

  it("rejects anything that is not a string instead of coercing it", () => {
    expect(() => parseRecipient(undefined)).toThrow(FaucetInputError);
    expect(() => parseRecipient(null)).toThrow(FaucetInputError);
    expect(() => parseRecipient(42)).toThrow(FaucetInputError);
    expect(() => parseRecipient({ address: WALLET })).toThrow(FaucetInputError);
  });

  it("rejects a program address nobody could ever sign for", () => {
    // The market PDA of this very deployment: a valid address, off the curve.
    expect(() => parseRecipient(manifest.market.address)).toThrow(FaucetInputError);
    expect(() => parseRecipient(manifest.market.vaultA)).toThrow(FaucetInputError);
    expect(PublicKey.isOnCurve(new PublicKey(WALLET).toBytes())).toBe(true);
  });
});

describe("dropAmounts", () => {
  it("scales each drop by the decimals the manifest records, not a fixed factor", () => {
    const drops = dropAmounts(manifest);
    const demo9 = drops.find((drop) => drop.symbol === "DEMO9")!;
    const demo6 = drops.find((drop) => drop.symbol === "DEMO6")!;

    expect(demo9.base).toBe(10_000_000_000n); // 10 × 10^9
    expect(demo6.base).toBe(20_000_000n); //     20 × 10^6
  });

  it("follows the manifest if the decimals of a mint ever change", () => {
    // 🇪🇸 NOTA: el faucet no puede tener los decimales escritos a mano. Si se
    // reacuñan las mints con otra escala, la cantidad tiene que seguirlas.
    const rescaled = {
      ...manifest,
      mints: {
        ...manifest.mints,
        DEMO6: { ...manifest.mints.DEMO6, decimals: 2 },
      },
    } as DevnetManifest;

    const demo6 = dropAmounts(rescaled).find((drop) => drop.symbol === "DEMO6")!;
    expect(demo6.base).toBe(2_000n); // 20 × 10^2
    expect(demo6.decimals).toBe(2);
  });

  it("carries the mint address from the manifest, never from a constant", () => {
    for (const drop of dropAmounts(manifest)) {
      expect(drop.mint).toBe(manifest.mints[drop.symbol].address);
    }
  });

  it("refuses to hand out a token the manifest does not know", () => {
    const missing = {
      ...manifest,
      mints: { DEMO6: manifest.mints.DEMO6 },
    } as DevnetManifest;
    expect(() => dropAmounts(missing)).toThrow(/DEMO9/);
  });
});

describe("decideDrop", () => {
  const FUNDED = MIN_FAUCET_LAMPORTS * 4;

  it("serves a wallet holding none of either token", () => {
    expect(decideDrop({ faucetLamports: FUNDED, held: [0n, 0n] })).toEqual({ ok: true });
  });

  it("turns away a wallet that already holds either token", () => {
    // 🇪🇸 NOTA: cualquiera de los dos basta. El límite es "ya tiene con qué
    // probar el swap", no "tiene los dos".
    expect(decideDrop({ faucetLamports: FUNDED, held: [1n, 0n] })).toMatchObject({
      ok: false,
      status: 429,
    });
    expect(decideDrop({ faucetLamports: FUNDED, held: [0n, 1n] })).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("stops before running out of SOL, not after", () => {
    expect(
      decideDrop({ faucetLamports: MIN_FAUCET_LAMPORTS - 1, held: [0n, 0n] })
    ).toMatchObject({ ok: false, status: 503 });
    expect(
      decideDrop({ faucetLamports: MIN_FAUCET_LAMPORTS, held: [0n, 0n] })
    ).toEqual({ ok: true });
  });

  it("says it is out of funds rather than a generic failure", () => {
    const decision = decideDrop({ faucetLamports: 0, held: [0n, 0n] });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error("unreachable");
    expect(decision.error).toMatch(/out of funds/i);
  });

  it("blames the empty faucet, not the visitor, when both limits would fire", () => {
    // 🇪🇸 NOTA: el orden importa. Decirle "ya has recibido" a quien nunca
    // recibió nada manda a diagnosticar el problema equivocado.
    expect(decideDrop({ faucetLamports: 0, held: [5n, 5n] })).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});
