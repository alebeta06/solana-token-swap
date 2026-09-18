"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { rpcEndpoint } from "@/lib/rpc";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  // El faucet (servidor) resuelve el endpoint con esta misma función.
  const endpoint = useMemo(() => rpcEndpoint(), []);

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
