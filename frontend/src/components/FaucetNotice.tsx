import { manifest } from "@/lib/manifest";
import { addressUrl, shorten } from "@/lib/explorer";
import { market } from "@/lib/market";

/**
 * 🇪🇸 NOTA: va ENCIMA de la tarjeta de swap y siempre visible, no como error
 * después de un intento fallido. Quien llega sin tokens tiene que saber por qué
 * antes de teclear una cantidad.
 */
export function FaucetNotice() {
  const [tokenA, tokenB] = market.tokens;

  return (
    <div
      data-testid="faucet-notice"
      className="rounded-2xl border border-sol-amber/40 bg-sol-amber/10 p-4 text-sm"
    >
      <p className="font-semibold text-sol-amber">No faucet in this phase</p>
      <p className="mt-2 text-text/90">
        {tokenA.symbol} and {tokenB.symbol} are test mints whose mint authority is the
        deployer wallet{" "}
        <a
          className="font-mono underline decoration-line underline-offset-2 hover:text-text"
          href={addressUrl(manifest.authority)}
          target="_blank"
          rel="noreferrer"
          data-testid="authority-link"
        >
          {shorten(manifest.authority, 4)}
        </a>
        . Only that wallet can mint them, so another wallet cannot get test tokens here —
        connecting a fresh wallet will show a balance of zero and the swap button will stay
        disabled. A faucet is phase 8.
      </p>
      <p className="mt-2 text-muted">
        You still need devnet SOL for fees:{" "}
        <code className="font-mono text-text/80">solana airdrop 1 --url devnet</code>
      </p>
    </div>
  );
}
