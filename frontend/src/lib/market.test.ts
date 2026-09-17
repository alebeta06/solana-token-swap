import { describe, it, expect } from "vitest";
import { buildMarketMap, market } from "./market";
import { manifest, type DevnetManifest } from "./manifest";

/**
 * Builds a manifest with the A/B assignment and the decimals given, so the
 * tests can separate "which token is A" from "which token has more decimals".
 */
function synthetic(opts: {
  aIs: "DEMO6" | "DEMO9";
  decimals: Record<"DEMO6" | "DEMO9", number>;
}): DevnetManifest {
  const bIs = opts.aIs === "DEMO6" ? "DEMO9" : "DEMO6";
  const address = { DEMO6: "AAAA_demo6", DEMO9: "BBBB_demo9" };
  return {
    ...manifest,
    mints: {
      DEMO6: { address: address.DEMO6, decimals: opts.decimals.DEMO6 },
      DEMO9: { address: address.DEMO9, decimals: opts.decimals.DEMO9 },
    },
    market: {
      ...manifest.market,
      mintA: address[opts.aIs],
      mintB: address[bIs],
      mintAIs: opts.aIs,
      mintBIs: bIs,
    },
  };
}

describe("the A/B mapping of the live deployment", () => {
  it("makes DEMO9 token A, as devnet.json says", () => {
    expect(market.bySymbol("DEMO9").side).toBe("A");
    expect(market.bySymbol("DEMO6").side).toBe("B");
    expect(market.bySide("A").symbol).toBe(manifest.market.mintAIs);
    expect(market.bySide("B").symbol).toBe(manifest.market.mintBIs);
  });

  it("sells DEMO9 with swap_a_to_b and DEMO6 with swap_b_to_a", () => {
    expect(market.swapDirection("DEMO9")).toBe("aToB");
    expect(market.swapDirection("DEMO6")).toBe("bToA");
  });

  it("carries the decimals of each mint, not of its side", () => {
    expect(market.bySymbol("DEMO6").decimals).toBe(6);
    expect(market.bySymbol("DEMO9").decimals).toBe(9);
  });

  it("pairs each token with the other one", () => {
    expect(market.counterpart("DEMO9").symbol).toBe("DEMO6");
    expect(market.counterpart("DEMO6").symbol).toBe("DEMO9");
  });

  it("refuses a token that is not in this market", () => {
    expect(() => market.swapDirection("USDC")).toThrow();
  });
});

describe("the mapping follows the manifest", () => {
  it("flips with it, so nothing is baked into the symbol name", () => {
    const flipped = buildMarketMap(
      synthetic({ aIs: "DEMO6", decimals: { DEMO6: 6, DEMO9: 9 } })
    );
    // Mismos símbolos y mismos decimales que el despliegue real; solo cambia
    // qué pubkey salió menor. La dirección de cada swap se da la vuelta.
    expect(flipped.bySymbol("DEMO6").side).toBe("A");
    expect(flipped.swapDirection("DEMO6")).toBe("aToB");
    expect(flipped.swapDirection("DEMO9")).toBe("bToA");
  });

  /**
   * 🔴 El test que de verdad importa. Reproduce el fallo de la fase 4: asumir
   * que "token A" es el de menos decimales. Aquí el token A tiene 9 decimales
   * en un caso y 6 en el otro, con la MISMA asignación A/B — y la dirección del
   * swap no se mueve. Si alguien vuelve a derivar el lado de los decimales,
   * este test es el que se pone rojo.
   */
  it("ignores the decimals when deciding the direction", () => {
    const nineIsA = buildMarketMap(
      synthetic({ aIs: "DEMO9", decimals: { DEMO6: 6, DEMO9: 9 } })
    );
    const sixIsA = buildMarketMap(
      synthetic({ aIs: "DEMO9", decimals: { DEMO6: 9, DEMO9: 6 } })
    );

    expect(nineIsA.bySymbol("DEMO9").decimals).toBe(9);
    expect(sixIsA.bySymbol("DEMO9").decimals).toBe(6);

    for (const map of [nineIsA, sixIsA]) {
      expect(map.swapDirection("DEMO9")).toBe("aToB");
      expect(map.swapDirection("DEMO6")).toBe("bToA");
    }
  });

  it("refuses a manifest that contradicts itself", () => {
    const broken = synthetic({ aIs: "DEMO9", decimals: { DEMO6: 6, DEMO9: 9 } });
    broken.market.mintA = "a-pubkey-that-belongs-to-neither";
    expect(() => buildMarketMap(broken)).toThrow(/inconsistent/);
  });
});
