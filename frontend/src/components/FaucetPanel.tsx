"use client";

/**
 * The faucet button and its status area.
 *
 * 🇪🇸 NOTA: va ENCIMA de la tarjeta de swap y siempre visible, igual que el
 * aviso al que sustituye. Quien llega sin tokens tiene que ver de dónde salen
 * antes de teclear una cantidad, no después de que el botón de swap aparezca
 * deshabilitado.
 *
 * Este componente NO decide qué significa cada respuesta: eso está en
 * `@/lib/faucetStatus`, que no toca la red y tiene tests. Aquí solo se pinta.
 */
import { useCallback, useState } from "react";
import { useAutoDismiss } from "@/hooks/useAutoDismiss";
import { useWallet } from "@solana/wallet-adapter-react";
import { txUrl, shorten } from "@/lib/explorer";
import {
  describeFaucetFailure,
  describeFaucetResponse,
  type FaucetOutcome,
  type FaucetTone,
} from "@/lib/faucetStatus";

/** Paleta cerrada: verde confirma, ámbar avisa, rojo es lo único roto. */
const TONE_CLASSES: Record<FaucetTone, { box: string; title: string }> = {
  success: { box: "border-sol-green/40 bg-sol-green/10", title: "text-sol-green" },
  notice: { box: "border-sol-amber/40 bg-sol-amber/10", title: "text-sol-amber" },
  error: { box: "border-sol-red/40 bg-sol-red/10", title: "text-sol-red" },
};

export function FaucetPanel({
  onFunded,
}: {
  /** Called with the slot the mint confirmed at, so the refresh can demand it. */
  onFunded: (minContextSlot?: number) => void;
}) {
  const { publicKey } = useWallet();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<FaucetOutcome | null>(null);

  const request = useCallback(async () => {
    if (!publicKey) return;
    setPending(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: publicKey.toBase58() }),
      });
      // 🇪🇸 NOTA: el cuerpo puede no ser JSON (un 502 de un proxy, por ejemplo).
      // El status manda; el cuerpo es lo accesorio.
      const body = await response.json().catch(() => null);
      const next = describeFaucetResponse(response.status, body);
      setOutcome(next);
      if (next.tone === "success") onFunded(next.slot);
    } catch {
      setOutcome(describeFaucetFailure());
    } finally {
      setPending(false);
    }
  }, [publicKey, onFunded]);

  // 🔴 Solo el éxito se va solo. El 429 y el 503 explican por qué no ha pasado
  // nada, así que se quedan hasta la siguiente operación. Ver `lib/banner.ts`.
  useAutoDismiss(
    outcome === null ? null : (outcome.signature ?? outcome.title),
    outcome?.tone ?? null,
    () => setOutcome(null)
  );

  const disabled = !publicKey || pending;
  const label = !publicKey
    ? "Connect a wallet to use the faucet"
    : pending
      ? "Minting…"
      : "Get demo tokens";

  return (
    <div
      data-testid="faucet-panel"
      className="rounded-2xl border border-line bg-surface p-4 text-sm"
    >
      <p className="font-semibold text-text">Need tokens to try the swap?</p>
      <p className="mt-1 text-muted">
        The faucet mints demo tokens to your wallet, once per wallet.
      </p>

      <button
        type="button"
        data-testid="faucet-submit"
        disabled={disabled}
        onClick={() => void request()}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-sol-purple to-sol-green px-4 py-3 font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:from-surface-2 disabled:to-surface-2 disabled:text-muted"
      >
        {pending && (
          <span
            aria-hidden
            className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-bg align-middle"
          />
        )}
        {label}
      </button>

      {outcome && (
        <div
          data-testid="faucet-status"
          data-tone={outcome.tone}
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-xl border p-3 ${TONE_CLASSES[outcome.tone].box}`}
        >
          <p className={`font-semibold ${TONE_CLASSES[outcome.tone].title}`}>
            {outcome.title}
          </p>
          <p className="mt-1 text-text/90">{outcome.message}</p>
          {outcome.signature && (
            <a
              className="mt-2 inline-block font-mono underline decoration-line underline-offset-2 hover:text-text"
              href={txUrl(outcome.signature)}
              target="_blank"
              rel="noreferrer"
              data-testid="faucet-tx-link"
            >
              {shorten(outcome.signature, 8)} ↗
            </a>
          )}
        </div>
      )}

      {/*
        🇪🇸 NOTA: SIEMPRE visible, no solo tras acuñar. El faucet da tokens, no
        SOL, y sin SOL el swap falla al firmar. Enseñárselo después del 200 es
        tarde: para entonces ya ha pulsado Swap y ha visto un error que no
        entiende.
      */}
      <p className="mt-3 text-xs text-muted" data-testid="faucet-sol-notice">
        The faucet gives tokens, not SOL. You still need devnet SOL to pay the fees of a
        swap:{" "}
        <a
          className="underline decoration-line underline-offset-2 hover:text-text"
          href="https://faucet.solana.com"
          target="_blank"
          rel="noreferrer"
          data-testid="sol-faucet-link"
        >
          faucet.solana.com
        </a>{" "}
        or <code className="font-mono text-text/80">solana airdrop 1 --url devnet</code>
      </p>
    </div>
  );
}
