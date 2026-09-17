/**
 * The mapping between "the token the user picked" and the A/B the program
 * talks about.
 *
 * 🔴 Es el punto donde un error produce un swap CORRECTO en la dirección
 * EQUIVOCADA: la transacción se confirma, el usuario pierde el token que quería
 * conservar y no hay nada roto que mirar.
 *
 * Cuál de los dos tokens es A lo decide `mint_a.key() < mint_b.key()`, la
 * comparación de pubkeys. NO lo decide el nombre, ni los decimales, ni el
 * valor. En este despliegue DEMO9 es el token A, pero eso es una propiedad DEL
 * DESPLIEGUE, no de DEMO9: acuñar otra vez las mints puede darle la vuelta.
 *
 * Por eso el lado se LEE de `mintAIs` / `mintBIs` en el manifest y no se deduce
 * en ningún sitio. Esta es la única traducción símbolo → A/B del frontend.
 */
import { manifest, type DevnetManifest } from "./manifest";

export type Side = "A" | "B";

/** The two instructions the program exposes. There is no direction flag. */
export type SwapDirection = "aToB" | "bToA";

export interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
  side: Side;
}

export interface MarketMap {
  /** Always [token A, token B], in the program's canonical order. */
  tokens: [TokenInfo, TokenInfo];
  bySymbol(symbol: string): TokenInfo;
  bySide(side: Side): TokenInfo;
  counterpart(symbol: string): TokenInfo;
  /** Which instruction sells `fromSymbol`. */
  swapDirection(fromSymbol: string): SwapDirection;
}

export function buildMarketMap(source: DevnetManifest): MarketMap {
  const { mintAIs, mintBIs, mintA, mintB } = source.market;

  const build = (symbol: string, expectedMint: string, side: Side): TokenInfo => {
    const entry = source.mints[symbol];
    if (!entry) {
      throw new Error(`Manifest names ${symbol} as token ${side} but has no such mint`);
    }
    // 🇪🇸 NOTA: si `mints[mintAIs].address` no es `market.mintA`, el manifest se
    // contradice a sí mismo y cualquier swap iría al revés. Mejor no arrancar.
    if (entry.address !== expectedMint) {
      throw new Error(
        `Manifest is inconsistent: token ${side} is ${symbol} (${entry.address}) ` +
          `but market.mint${side} is ${expectedMint}`
      );
    }
    return { symbol, mint: entry.address, decimals: entry.decimals, side };
  };

  if (mintAIs === mintBIs) {
    throw new Error(`Manifest names ${mintAIs} as both token A and token B`);
  }

  const tokens: [TokenInfo, TokenInfo] = [
    build(mintAIs, mintA, "A"),
    build(mintBIs, mintB, "B"),
  ];

  const bySymbol = (symbol: string): TokenInfo => {
    const found = tokens.find((t) => t.symbol === symbol);
    if (!found) throw new Error(`${symbol} is not a token of this market`);
    return found;
  };

  return {
    tokens,
    bySymbol,
    bySide: (side) => (side === "A" ? tokens[0] : tokens[1]),
    counterpart: (symbol) => (bySymbol(symbol).side === "A" ? tokens[1] : tokens[0]),
    swapDirection: (fromSymbol) => (bySymbol(fromSymbol).side === "A" ? "aToB" : "bToA"),
  };
}

export const market = buildMarketMap(manifest);
