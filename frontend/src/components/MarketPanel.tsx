"use client";

import type { MarketState } from "@/hooks/useMarketState";
import { market } from "@/lib/market";
import { manifest } from "@/lib/manifest";
import { priceAsDisplay } from "@/lib/quote";
import { formatAmount } from "@/lib/units";
import { addressUrl, shorten } from "@/lib/explorer";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm text-text">{children}</span>
    </div>
  );
}

export function MarketPanel({
  state,
  loading,
  error,
}: {
  state: MarketState | null;
  loading: boolean;
  error: string | null;
}) {
  const [tokenA, tokenB] = market.tokens;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Market</h2>
        <a
          className="font-mono text-xs text-muted underline decoration-line underline-offset-2 hover:text-text"
          href={addressUrl(manifest.market.address)}
          target="_blank"
          rel="noreferrer"
          data-testid="market-link"
        >
          {shorten(manifest.market.address, 4)}
        </a>
      </div>

      {error && (
        <p className="mt-3 text-sm text-sol-red" data-testid="market-error">
          Could not read the market: {error}
        </p>
      )}

      <div className="mt-2 divide-y divide-line">
        <Row label="Price">
          <span data-testid="market-price">
            {loading || !state ? (
              "…"
            ) : state.price === 0n ? (
              <span className="text-sol-amber">not set</span>
            ) : (
              <>
                1 {tokenA.symbol} ={" "}
                <span className="text-sol-green">{priceAsDisplay(state.price)}</span>{" "}
                {tokenB.symbol}
              </>
            )}
          </span>
        </Row>

        {/*
          🇪🇸 NOTA: los decimales que se muestran son los de la CUENTA del
          mercado, que el programa leyó de los mints. No los del manifest.
        */}
        <Row label={`Vault A · ${tokenA.symbol}`}>
          <span className="font-mono" data-testid="vault-a-balance">
            {loading || !state ? "…" : formatAmount(state.vaultA, state.decimalsA, 4)}
          </span>
        </Row>
        <Row label={`Vault B · ${tokenB.symbol}`}>
          <span className="font-mono" data-testid="vault-b-balance">
            {loading || !state ? "…" : formatAmount(state.vaultB, state.decimalsB, 4)}
          </span>
        </Row>
        <Row label="Decimals (on-chain)">
          <span className="font-mono" data-testid="market-decimals">
            {loading || !state
              ? "…"
              : `${tokenA.symbol} ${state.decimalsA} · ${tokenB.symbol} ${state.decimalsB}`}
          </span>
        </Row>
      </div>

      <p className="mt-3 text-xs text-muted">
        Read with <code className="font-mono">getAccountInfo</code>, not from events — there
        is no <code className="font-mono">eth_getLogs</code> on Solana.
      </p>
    </section>
  );
}
