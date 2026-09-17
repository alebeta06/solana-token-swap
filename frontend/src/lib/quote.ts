/**
 * The same arithmetic the program does, in `bigint`, so the UI can show the
 * expected output before sending the transaction.
 *
 *   A→B:  amount_b = (amount_a × price × 10^dec_b) / (10^PRICE_DECIMALS × 10^dec_a)
 *   B→A:  amount_a = (amount_b × 10^PRICE_DECIMALS × 10^dec_a) / (price × 10^dec_b)
 *
 * 🇪🇸 NOTA: `price` y `10^PRICE_DECIMALS` cambian de lado, igual que `dec_a` y
 * `dec_b`. Es un reflejo exacto.
 *
 * ⚠️ TODAS las multiplicaciones antes de TODAS las divisiones, como en el
 * programa. Una división anidada trunca y su denominador puede colapsar a cero.
 *
 * ⚠️ Esto es una ESTIMACIÓN, no la verdad. La verdad la calcula el programa con
 * el precio que haya on-chain cuando llegue la transacción. Por eso existe
 * `min_amount_out`, y por eso este módulo no decide nada: solo informa.
 */
import { PRICE_DECIMALS } from "./manifest";
import type { SwapDirection } from "./market";
import { pow10 } from "./units";

export interface QuoteParams {
  direction: SwapDirection;
  amountIn: bigint;
  /** Scaled by 10^PRICE_DECIMALS, read from the market account. */
  price: bigint;
  /** Read from the market account, which read them from the mints. */
  decimalsA: number;
  decimalsB: number;
}

export class QuoteError extends Error {}

export function quote({ direction, amountIn, price, decimalsA, decimalsB }: QuoteParams): bigint {
  if (amountIn <= 0n) throw new QuoteError("Amount must be greater than zero");
  // 🇪🇸 NOTA: en B→A el precio está en el denominador. Sin esto saldría una
  // división por cero aquí y un MathOverflow engañoso en el programa.
  if (price <= 0n) throw new QuoteError("The market price has not been set");

  const scale = pow10(PRICE_DECIMALS);

  if (direction === "aToB") {
    const numerator = amountIn * price * pow10(decimalsB);
    const denominator = scale * pow10(decimalsA);
    return numerator / denominator;
  }

  const numerator = amountIn * scale * pow10(decimalsA);
  const denominator = price * pow10(decimalsB);
  return numerator / denominator;
}

/**
 * Applies the slippage tolerance to a quote to get `min_amount_out`.
 *
 * Rounds DOWN, which loosens the floor: redondear hacia arriba pondría un
 * mínimo por encima de lo tolerado y haría fallar swaps que el usuario aceptó.
 */
export function minAmountOut(expectedOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new QuoteError("Slippage must be between 0% and 100%");
  }
  return (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** How many B the market says one whole A is worth, as a display string. */
export function priceAsDisplay(price: bigint): string {
  const scale = pow10(PRICE_DECIMALS);
  const whole = price / scale;
  const fraction = (price % scale).toString().padStart(PRICE_DECIMALS, "0").replace(/0+$/, "");
  return fraction === "" ? `${whole}` : `${whole}.${fraction}`;
}
