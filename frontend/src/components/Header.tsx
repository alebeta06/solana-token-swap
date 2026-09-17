"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSolBalance } from "@/hooks/useSolBalance";
import { CLUSTER, manifest } from "@/lib/manifest";
import { addressUrl, shorten } from "@/lib/explorer";

// 🇪🇸 NOTA: el botón de wallet mira a `window` al montarse, así que se carga
// solo en cliente. Con SSR el HTML del servidor y el del cliente no coinciden.
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export function Header() {
  const { publicKey } = useWallet();
  const { sol } = useSolBalance();

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
      <div>
        <h1 className="bg-gradient-to-r from-sol-purple to-sol-green bg-clip-text text-2xl font-bold text-transparent">
          Solana Token Swap
        </h1>
        <p className="mt-1 text-sm text-muted">
          Fixed price · {CLUSTER} ·{" "}
          <a
            className="underline decoration-line underline-offset-2 hover:text-text"
            href={addressUrl(manifest.programId)}
            target="_blank"
            rel="noreferrer"
            data-testid="program-link"
          >
            {shorten(manifest.programId, 6)}
          </a>
        </p>
      </div>

      <div className="flex items-center gap-4">
        {publicKey && (
          <div className="text-right text-sm">
            <div className="font-mono text-text" data-testid="wallet-address">
              {shorten(publicKey.toBase58(), 4)}
            </div>
            <div className="text-muted" data-testid="sol-balance">
              {sol === null ? "…" : `${sol.toFixed(4)} SOL`}
            </div>
          </div>
        )}
        <div data-testid="connect-wallet">
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
