"use client";

import { useMemo, useState } from "react";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { MarketState } from "@/hooks/useMarketState";
import type { TokenBalance } from "@/hooks/useTokenBalances";
import { market } from "@/lib/market";
import { AmountError, formatAmount, toBaseUnits, toDisplay } from "@/lib/units";
import { minAmountOut as applySlippage, quote } from "@/lib/quote";
import { executeSwap } from "@/lib/swap";
import { describeError } from "@/lib/errors";
import { TxResult } from "./TxResult";

const SLIPPAGE_PRESETS = [10, 50, 100]; // basis points: 0.1%, 0.5%, 1%

export function SwapCard({
  state,
  balances,
  onDone,
}: {
  state: MarketState | null;
  balances: Record<string, TokenBalance> | null;
  onDone: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  const [fromSymbol, setFromSymbol] = useState(market.tokens[0].symbol);
  const [amountText, setAmountText] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [sending, setSending] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = market.bySymbol(fromSymbol);
  const to = market.counterpart(fromSymbol);

  // 🔴 La ÚNICA traducción de "lo que el usuario eligió" a la instrucción del
  // programa. Sale de market.ts, que lo lee del manifest. Aquí no se deduce.
  const direction = market.swapDirection(fromSymbol);

  const amountIn = useMemo(() => {
    if (amountText.trim() === "") return { value: null as bigint | null, error: null as string | null };
    try {
      return { value: toBaseUnits(amountText, from.decimals), error: null };
    } catch (err) {
      return { value: null, error: err instanceof AmountError ? err.message : String(err) };
    }
  }, [amountText, from.decimals]);

  const expectedOut = useMemo(() => {
    if (!state || amountIn.value === null || amountIn.value === 0n) return null;
    try {
      return quote({
        direction,
        amountIn: amountIn.value,
        price: state.price,
        decimalsA: state.decimalsA,
        decimalsB: state.decimalsB,
      });
    } catch {
      return null;
    }
  }, [state, amountIn.value, direction]);

  const minOut = expectedOut === null ? null : applySlippage(expectedOut, slippageBps);

  const fromBalance = balances?.[from.symbol]?.amount ?? 0n;
  const vaultOut = state ? (to.side === "A" ? state.vaultA : state.vaultB) : 0n;

  const blocker = (() => {
    if (!publicKey) return "Connect a wallet to swap";
    if (!state) return "Loading the market…";
    if (state.price === 0n) return "This market has no price yet";
    if (amountIn.error) return amountIn.error;
    if (amountIn.value === null) return "Enter an amount";
    if (amountIn.value === 0n) return "The amount must be greater than zero";
    if (amountIn.value > fromBalance) return `Not enough ${from.symbol}`;
    if (expectedOut === null) return "Cannot price that amount";
    if (expectedOut === 0n) return `Too small — it rounds down to 0 ${to.symbol}`;
    if (expectedOut > vaultOut) return `The vault holds only ${formatAmount(vaultOut, to.decimals, 4)} ${to.symbol}`;
    return null;
  })();

  async function submit() {
    if (!anchorWallet || !state || amountIn.value === null || minOut === null) return;
    setSending(true);
    setError(null);
    setSignature(null);
    try {
      const tokenA = market.bySide("A");
      const tokenB = market.bySide("B");
      const balanceA = balances?.[tokenA.symbol];
      const balanceB = balances?.[tokenB.symbol];
      if (!balanceA || !balanceB) throw new Error("Balances are still loading");

      // 🇪🇸 NOTA: el contexto pide SIEMPRE las dos cuentas del usuario, en las
      // dos direcciones. La que reciba puede no existir todavía: se crea en la
      // misma transacción, desde el cliente.
      const missingAtas = [
        { balance: balanceA, token: tokenA },
        { balance: balanceB, token: tokenB },
      ]
        .filter(({ balance }) => !balance.exists)
        .map(({ balance, token }) => ({ ata: balance.ata, mint: new PublicKey(token.mint) }));

      const sig = await executeSwap({
        connection,
        wallet: anchorWallet,
        direction,
        amountIn: amountIn.value,
        minAmountOut: minOut,
        userTokenA: balanceA.ata,
        userTokenB: balanceB.ata,
        missingAtas,
      });

      setSignature(sig);
      setAmountText("");
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Swap</h2>

      {/* ── From ─────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>You pay</span>
          <span data-testid={`balance-${from.symbol}`}>
            balance {balances ? formatAmount(fromBalance, from.decimals, 4) : "…"}{" "}
            {from.symbol}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            data-testid="swap-amount-input"
            inputMode="decimal"
            placeholder="0.0"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            className="w-full bg-transparent text-2xl outline-none placeholder:text-muted/50"
          />
          <select
            data-testid="swap-from-select"
            value={fromSymbol}
            onChange={(event) => {
              setFromSymbol(event.target.value);
              setSignature(null);
              setError(null);
            }}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            {market.tokens.map((token) => (
              <option key={token.symbol} value={token.symbol}>
                {token.symbol}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="my-2 flex justify-center">
        <button
          type="button"
          data-testid="swap-flip"
          aria-label="Swap direction"
          onClick={() => {
            setFromSymbol(to.symbol);
            setSignature(null);
            setError(null);
          }}
          className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm text-muted transition-colors hover:border-sol-purple hover:text-text"
        >
          ↓↑
        </button>
      </div>

      {/* ── To ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>You receive (estimated)</span>
          <span data-testid={`balance-${to.symbol}`}>
            balance{" "}
            {balances ? formatAmount(balances[to.symbol]?.amount ?? 0n, to.decimals, 4) : "…"}{" "}
            {to.symbol}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-2xl" data-testid="swap-expected-out">
            {expectedOut === null ? "0.0" : toDisplay(expectedOut, to.decimals)}
          </span>
          <span
            data-testid="swap-to-token"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            {to.symbol}
          </span>
        </div>
      </div>

      {/* ── Slippage / min_amount_out ────────────────────────────────── */}
      <div className="mt-4 rounded-xl border border-line p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted">Max slippage</span>
          <div className="flex items-center gap-2">
            {SLIPPAGE_PRESETS.map((bps) => (
              <button
                key={bps}
                type="button"
                data-testid={`slippage-preset-${bps}`}
                onClick={() => setSlippageBps(bps)}
                className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                  slippageBps === bps
                    ? "border-sol-purple text-text"
                    : "border-line text-muted hover:text-text"
                }`}
              >
                {bps / 100}%
              </button>
            ))}
            <input
              data-testid="slippage-input"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={slippageBps / 100}
              onChange={(event) => {
                const percent = Number(event.target.value);
                if (Number.isFinite(percent)) {
                  setSlippageBps(Math.min(10_000, Math.max(0, Math.round(percent * 100))));
                }
              }}
              className="w-20 rounded-lg border border-line bg-surface-2 px-2 py-1 text-right"
            />
          </div>
        </div>
        {/*
          🇪🇸 NOTA: esto es lo que va como `min_amount_out` en la instrucción.
          Si el precio cambia entre que se firma y que se ejecuta, el programa
          aborta con SlippageExceeded en vez de dar menos de lo aceptado.
        */}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted">
            Minimum received (<code className="font-mono">min_amount_out</code>)
          </span>
          <span className="font-mono" data-testid="min-out">
            {minOut === null ? "—" : `${toDisplay(minOut, to.decimals)} ${to.symbol}`}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-muted">
          <span>Instruction</span>
          <code className="font-mono" data-testid="swap-instruction">
            {direction === "aToB" ? "swap_a_to_b" : "swap_b_to_a"}
          </code>
        </div>
      </div>

      <button
        type="button"
        data-testid="swap-submit"
        disabled={blocker !== null || sending}
        onClick={submit}
        className="mt-4 w-full rounded-xl bg-gradient-to-r from-sol-purple to-sol-green px-4 py-3 font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:from-surface-2 disabled:to-surface-2 disabled:text-muted"
      >
        {sending ? "Confirming…" : (blocker ?? `Swap ${from.symbol} → ${to.symbol}`)}
      </button>

      {error && (
        <p className="mt-3 text-sm text-sol-red" data-testid="error-message">
          {error}
        </p>
      )}
      {signature && (
        <div className="mt-3">
          <TxResult signature={signature} />
        </div>
      )}
    </section>
  );
}
