/**
 * Base units ↔ display units. The ONLY place in the frontend where a token
 * amount changes scale.
 *
 * 🇪🇸 NOTA: todo en `bigint`. Un `number` de JavaScript tiene 53 bits de
 * mantisa y el programa trabaja en u64: 1 DEMO9 son 1_000_000_000 unidades base
 * y un saldo grande se sale del rango exacto. Además `0.1 + 0.2 !== 0.3`, y
 * aquí un error de redondeo es dinero.
 *
 * Con dos tokens de 6 y 9 decimales, cada conversión suelta por ahí es un
 * factor 1000 esperando. Por eso están todas aquí y con tests.
 */

export class AmountError extends Error {}

const DIGITS = /^\d+$/;

export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/**
 * Parses what the user typed into base units.
 *
 * Rejects rather than truncates when there are more decimal places than the
 * mint supports: callar y truncar convierte "me equivoqué al teclear" en
 * "he mandado otra cantidad".
 */
export function toBaseUnits(input: string, decimals: number): bigint {
  const text = input.trim();
  if (text === "") throw new AmountError("Enter an amount");

  const [whole, fraction = "", ...rest] = text.split(".");
  if (rest.length > 0) throw new AmountError(`Not a number: ${input}`);
  if (whole !== "" && !DIGITS.test(whole)) throw new AmountError(`Not a number: ${input}`);
  if (fraction !== "" && !DIGITS.test(fraction)) throw new AmountError(`Not a number: ${input}`);
  if (whole === "" && fraction === "") throw new AmountError(`Not a number: ${input}`);
  if (fraction.length > decimals) {
    throw new AmountError(`At most ${decimals} decimal places`);
  }

  const padded = fraction.padEnd(decimals, "0");
  return BigInt((whole === "" ? "0" : whole) + padded);
}

/** Exact rendering of base units, trailing zeros trimmed. Never lossy. */
export function toDisplay(base: bigint, decimals: number): string {
  const negative = base < 0n;
  const abs = negative ? -base : base;
  const divisor = pow10(decimals);
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * Rendering for a balance in a fixed-width slot: truncates (never rounds up) to
 * `maxFractionDigits` so the UI can't claim the user holds more than they do.
 */
export function formatAmount(base: bigint, decimals: number, maxFractionDigits = 6): string {
  if (maxFractionDigits >= decimals) return toDisplay(base, decimals);
  const dropped = pow10(decimals - maxFractionDigits);
  const truncated = (base / dropped) * dropped;
  return toDisplay(truncated, decimals);
}
