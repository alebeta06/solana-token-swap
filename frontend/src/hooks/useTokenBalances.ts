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
import { Connection, PublicKey, SolanaJSONRPCError } from "@solana/web3.js";
import { market } from "@/lib/market";

/** JSON-RPC code for "this node has not reached the slot you asked for". */
const SLOT_NOT_REACHED = -32016;
const POLL_MS = 400;
const TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface TokenBalance {
  symbol: string;
  decimals: number;
  ata: PublicKey;
  /** Zero both when the ATA holds nothing and when it does not exist yet. */
  amount: bigint;
  exists: boolean;
}

/**
 * Reads the accounts, retrying while the node that answers is behind
 * `minContextSlot`. Without a slot it is a plain read, like it always was.
 */
async function readAccounts(
  connection: Connection,
  addresses: PublicKey[],
  minContextSlot?: number
) {
  if (minContextSlot === undefined) {
    return connection.getMultipleAccountsInfo(addresses);
  }
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      return await connection.getMultipleAccountsInfo(addresses, {
        commitment: "confirmed",
        minContextSlot,
      });
    } catch (err) {
      const behind =
        err instanceof SolanaJSONRPCError && err.code === SLOT_NOT_REACHED;
      if (!behind || Date.now() >= deadline) throw err;
      await sleep(POLL_MS);
    }
  }
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

  /**
   * Re-reads both balances.
   *
   * 🔴 `minContextSlot` no es opcional por comodidad: tras acuñar, el endpoint
   * devuelve el slot en que confirmó, y sin exigirlo aquí el navegador repite
   * la misma carrera que el faucet acaba de ganar. El RPC público de devnet es
   * un balanceador cuyos backends van hasta ~1,2 s desfasados: una lectura que
   * caiga en un nodo atrasado devuelve la ATA como inexistente y el panel
   * enseña 0 justo después de recibir tokens. Con el slot, el RPC prefiere
   * fallar con -32016 —y aquí se reintenta— antes que mentir.
   */
  const refresh = useCallback(async (options?: { minContextSlot?: number }) => {
    if (!atas) {
      setBalances(null);
      return;
    }
    const infos = await readAccounts(connection, atas.map((a) => a.ata), options?.minContextSlot);
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
