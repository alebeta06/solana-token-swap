"use client";

/**
 * Market state, read straight from the accounts.
 *
 * 🇪🇸 NOTA: en Solana no hay `eth_getLogs`. Los `emit!` del programa existen
 * para que un indexador los siga, pero NO son la fuente de estado: el estado es
 * lo que hay en las cuentas ahora mismo. Por eso esto lee la cuenta del mercado
 * y las dos bóvedas, y nada aquí escucha eventos.
 */
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { unpackAccount } from "@solana/spl-token";
import { Program, type Idl, type Provider } from "@anchor-lang/core";
import idlJson from "@/idl/solana_token_swap.json";
import type { SolanaTokenSwap } from "@/idl/solana_token_swap";
import { marketPda, vaultAPda, vaultBPda } from "@/lib/program";

export interface MarketState {
  authority: string;
  /** Scaled by 10^PRICE_DECIMALS. `0n` means the market is not trading yet. */
  price: bigint;
  /** Read by the program from the mints themselves, never from a caller. */
  decimalsA: number;
  decimalsB: number;
  vaultA: bigint;
  vaultB: bigint;
}

export function useMarketState() {
  const { connection } = useConnection();
  const [state, setState] = useState<MarketState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // 🇪🇸 NOTA: leer no necesita wallet. Un provider con solo `connection`
      // basta para decodificar cuentas; firmar es otra cosa.
      const program = new Program(idlJson as Idl, { connection } as Provider) as unknown as
        Program<SolanaTokenSwap>;

      const [market, vaults] = await Promise.all([
        program.account.marketAccount.fetch(marketPda),
        connection.getMultipleAccountsInfo([vaultAPda, vaultBPda]),
      ]);

      const amountOf = (index: number, pubkey: typeof vaultAPda): bigint => {
        const info = vaults[index];
        if (!info) return 0n;
        return unpackAccount(pubkey, info).amount;
      };

      setState({
        authority: market.authority.toBase58(),
        price: BigInt(market.price.toString()),
        decimalsA: market.decimalsA,
        decimalsB: market.decimalsB,
        vaultA: amountOf(0, vaultAPda),
        vaultB: amountOf(1, vaultBPda),
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { market: state, loading, error, refresh };
}
