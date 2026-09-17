"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { CLUSTER } from "@/lib/manifest";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_RPC_URL ||
      clusterApiUrl(CLUSTER as Parameters<typeof clusterApiUrl>[0]),
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      {/*
        🇪🇸 NOTA: `wallets={[]}` no significa "ninguna wallet". Phantom, Solflare
        y Backpack implementan el Wallet Standard y se anuncian solas al
        navegador; el adapter las recoge. Instalar @solana/wallet-adapter-wallets
        para listarlas a mano sería encender una dependencia "por si acaso".
      */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
