"use client";

import { useCallback } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { FaucetPanel } from "@/components/FaucetPanel";
import { MarketPanel } from "@/components/MarketPanel";
import { SwapCard } from "@/components/SwapCard";
import { useMarketState } from "@/hooks/useMarketState";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useSolBalance } from "@/hooks/useSolBalance";

export default function Home() {
  const { market: state, loading, error, refresh: refreshMarket } = useMarketState();
  const { balances, refresh: refreshBalances } = useTokenBalances();
  const { refresh: refreshSol } = useSolBalance();

  const refreshAll = useCallback(() => {
    void refreshMarket();
    void refreshBalances();
    void refreshSol();
  }, [refreshMarket, refreshBalances, refreshSol]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Header />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-6">
          <MarketPanel state={state} loading={loading} error={error} />
        </div>

        <div className="flex flex-col gap-4">
          {/* El faucet va antes del swap, no después de que falle. */}
          <FaucetPanel onFunded={(slot) => void refreshBalances({ minContextSlot: slot })} />
          <SwapCard state={state} balances={balances} onDone={refreshAll} />
        </div>
      </div>

      <Footer />
    </main>
  );
}
