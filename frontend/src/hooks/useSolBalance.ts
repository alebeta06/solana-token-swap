"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export function useSolBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setSol(null);
      return;
    }
    const lamports = await connection.getBalance(publicKey);
    setSol(lamports / LAMPORTS_PER_SOL);
  }, [connection, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sol, refresh };
}
