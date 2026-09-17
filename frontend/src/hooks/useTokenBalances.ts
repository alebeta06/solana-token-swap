"use client";

/**
 * The user's balance of each of the two market tokens.
 *
 * 🇪🇸 NOTA: una ATA que no existe NO es un error. Es lo normal en una wallet
 * que nunca ha tocado el token: la cuenta se crea la primera vez que recibe
 * algo. Aquí se muestra 0 y ya; la ATA que falte la creará el swap, desde el
 * cliente, nunca con init-if-needed en el programa.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { market } from "@/lib/market";

export interface TokenBalance {
  symbol: string;
  decimals: number;
  ata: PublicKey;
  /** Zero both when the ATA holds nothing and when it does not exist yet. */
  amount: bigint;
  exists: boolean;
}

export function useTokenBalances() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balances, setBalances] = useState<Record<string, TokenBalance> | null>(null);

  const atas = useMemo(() => {
    if (!publicKey) return null;
    return market.tokens.map((token) => ({
      token,
      ata: getAssociatedTokenAddressSync(new PublicKey(token.mint), publicKey),
    }));
  }, [publicKey]);

  const refresh = useCallback(async () => {
    if (!atas) {
      setBalances(null);
      return;
    }
    const infos = await connection.getMultipleAccountsInfo(atas.map((a) => a.ata));
    const next: Record<string, TokenBalance> = {};
    atas.forEach(({ token, ata }, index) => {
      const info = infos[index];
      next[token.symbol] = {
        symbol: token.symbol,
        decimals: token.decimals,
        ata,
        amount: info ? unpackAccount(ata, info).amount : 0n,
        exists: info !== null,
      };
    });
    setBalances(next);
  }, [atas, connection]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balances, refresh };
}
