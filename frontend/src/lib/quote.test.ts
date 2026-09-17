import { describe, it, expect } from "vitest";
import { quote, minAmountOut, priceAsDisplay, QuoteError } from "./quote";
import { toBaseUnits, toDisplay } from "./units";

// El despliegue real: A = DEMO9 (9 decimales), B = DEMO6 (6), precio 2.000000.
const DEC_A = 9;
const DEC_B = 6;
const PRICE = 2_000_000n;

describe("quote", () => {
  it("converts at the market price, honouring both token scales", () => {
    // 1 DEMO9 a 2.000000 son 2 DEMO6 — ni 2000 ni 0.002.
    const out = quote({
      direction: "aToB",
      amountIn: toBaseUnits("1", DEC_A),
      price: PRICE,
      decimalsA: DEC_A,
      decimalsB: DEC_B,
    });
    expect(toDisplay(out, DEC_B)).toBe("2");
  });

  it("applies the inverse of the price in the other direction", () => {
    const out = quote({
      direction: "bToA",
      amountIn: toBaseUnits("2", DEC_B),
      price: PRICE,
      decimalsA: DEC_A,
      decimalsB: DEC_B,
    });
    expect(toDisplay(out, DEC_A)).toBe("1");
  });

  it("never returns more than went in on a round trip A→B→A", () => {
    // 🇪🇸 NOTA: la misma invariante que el test de Anchor. El truncamiento solo
    // puede REDUCIR la salida, así que la desigualdad es por construcción.
    // 🇪🇸 NOTA: entradas que SÍ producen una salida. Una tan pequeña que la
    // ida trunca a cero no tiene vuelta — ese caso es el test de abajo.
    for (const text of ["1", "0.5", "3.333333333", "12345.6789", "0.000001"]) {
      const amountIn = toBaseUnits(text, DEC_A);
      const b = quote({ direction: "aToB", amountIn, price: PRICE, decimalsA: DEC_A, decimalsB: DEC_B });
      expect(b > 0n, `${text} quoted to nothing`).toBe(true);
      const back = quote({ direction: "bToA", amountIn: b, price: PRICE, decimalsA: DEC_A, decimalsB: DEC_B });
      expect(back <= amountIn, `${text}: ${back} > ${amountIn}`).toBe(true);
    }
  });

  it("truncates to zero for an input too small to buy one base unit", () => {
    // 1 unidad base de DEMO9 (1e-9) a precio 2 son 2e-9 DEMO6, y DEMO6 no
    // tiene tanta resolución. El programa devuelve ZeroOutput; aquí, 0.
    const amountIn = toBaseUnits("0.000000001", DEC_A);
    const out = quote({ direction: "aToB", amountIn, price: PRICE, decimalsA: DEC_A, decimalsB: DEC_B });
    expect(out).toBe(0n);
    // Y por eso no hay vuelta que dar: la entrada del segundo tramo sería cero.
    expect(() =>
      quote({ direction: "bToA", amountIn: out, price: PRICE, decimalsA: DEC_A, decimalsB: DEC_B })
    ).toThrow(QuoteError);
  });

  it("stays exact well past the range of a JavaScript number", () => {
    // 1e12 DEMO9 en unidades base son 1e21, muy por encima de 2^53.
    const amountIn = toBaseUnits("1000000000000", DEC_A);
    const out = quote({ direction: "aToB", amountIn, price: PRICE, decimalsA: DEC_A, decimalsB: DEC_B });
    expect(out).toBe(2_000_000_000_000_000_000n);
  });

  it("does not assume token A is the one with fewer decimals", () => {
    // Mismo cálculo con los decimales al revés: 1 A (6 dec) → 2 B (9 dec).
    const out = quote({
      direction: "aToB",
      amountIn: toBaseUnits("1", 6),
      price: PRICE,
      decimalsA: 6,
      decimalsB: 9,
    });
    expect(toDisplay(out, 9)).toBe("2");
  });

  it("refuses to quote a market whose price was never set", () => {
    expect(() =>
      quote({ direction: "bToA", amountIn: 1_000_000n, price: 0n, decimalsA: DEC_A, decimalsB: DEC_B })
    ).toThrow(QuoteError);
  });

  it("refuses a zero input", () => {
    expect(() =>
      quote({ direction: "aToB", amountIn: 0n, price: PRICE, decimalsA: DEC_A, decimalsB: DEC_B })
    ).toThrow(QuoteError);
  });
});

describe("minAmountOut", () => {
  it("lowers the floor by the tolerance", () => {
    expect(minAmountOut(2_000_000n, 50)).toBe(1_990_000n); // 0.5%
    expect(minAmountOut(2_000_000n, 0)).toBe(2_000_000n);
  });

  it("rounds down, so it never demands more than the user accepted", () => {
    expect(minAmountOut(999n, 50)).toBe(994n); // 994.005 → 994
  });

  it("rejects a tolerance outside 0–100%", () => {
    for (const bps of [-1, 10_001, 1.5]) {
      expect(() => minAmountOut(1_000n, bps)).toThrow(QuoteError);
    }
  });
});

describe("priceAsDisplay", () => {
  it("undoes the 6-decimal scaling of the stored price", () => {
    expect(priceAsDisplay(2_000_000n)).toBe("2");
    expect(priceAsDisplay(1_500_000n)).toBe("1.5");
    expect(priceAsDisplay(1n)).toBe("0.000001");
    expect(priceAsDisplay(0n)).toBe("0");
  });
});
