import { describe, it, expect } from "vitest";
import { toBaseUnits, toDisplay, formatAmount, AmountError } from "./units";

describe("toBaseUnits", () => {
  it("scales by the decimals of the mint, not by a fixed factor", () => {
    expect(toBaseUnits("1", 6)).toBe(1_000_000n);
    expect(toBaseUnits("1", 9)).toBe(1_000_000_000n);
  });

  it("pads a short fraction instead of misreading it as base units", () => {
    expect(toBaseUnits("1.5", 6)).toBe(1_500_000n);
    expect(toBaseUnits("1.5", 9)).toBe(1_500_000_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
  });

  it("accepts forms with an implicit zero on either side of the dot", () => {
    expect(toBaseUnits(".5", 6)).toBe(500_000n);
    expect(toBaseUnits("5.", 6)).toBe(5_000_000n);
    expect(toBaseUnits(" 2 ", 6)).toBe(2_000_000n);
  });

  it("keeps amounts that overflow a JavaScript number exact", () => {
    expect(toBaseUnits("9007199254.740993", 9)).toBe(9_007_199_254_740_993_000n);
  });

  it("rejects more decimal places than the mint has instead of truncating", () => {
    expect(() => toBaseUnits("1.1234567", 6)).toThrow(AmountError);
    expect(toBaseUnits("1.1234567", 9)).toBe(1_123_456_700n);
  });

  it("rejects anything that is not a plain decimal number", () => {
    for (const bad of ["", "abc", "1.2.3", "-1", "1e9", "1,5", "0x10"]) {
      expect(() => toBaseUnits(bad, 6), bad).toThrow(AmountError);
    }
  });
});

describe("toDisplay", () => {
  it("is the exact inverse of toBaseUnits", () => {
    for (const [text, decimals] of [
      ["1", 6], ["1.5", 9], ["0.000001", 6], ["1234.56789", 9],
    ] as const) {
      expect(toDisplay(toBaseUnits(text, decimals), decimals)).toBe(text);
    }
  });

  it("trims trailing zeros without dropping significant ones", () => {
    expect(toDisplay(1_500_000n, 6)).toBe("1.5");
    expect(toDisplay(1_000_000n, 6)).toBe("1");
    expect(toDisplay(1_000_000_005n, 9)).toBe("1.000000005");
    expect(toDisplay(0n, 9)).toBe("0");
  });

  it("does not confuse the scales of the two mints", () => {
    // 🇪🇸 NOTA: el mismo número de unidades base significa cosas distintas.
    expect(toDisplay(1_000_000_000n, 6)).toBe("1000");
    expect(toDisplay(1_000_000_000n, 9)).toBe("1");
  });
});

describe("formatAmount", () => {
  it("truncates towards zero so the UI never overstates a balance", () => {
    expect(formatAmount(1_999_999_999n, 9, 2)).toBe("1.99");
    expect(formatAmount(1_999_999n, 6, 2)).toBe("1.99");
  });

  it("shows everything when the mint has fewer decimals than the limit", () => {
    expect(formatAmount(1_234_567n, 6, 9)).toBe("1.234567");
  });
});
