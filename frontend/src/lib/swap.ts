/**
 * Sends a swap. The only place that calls `swapAToB` / `swapBToA`.
 *
 * 🔴 NO se usa `.rpc()` de Anchor. Construye, firma, manda y confirma — y
 * confirma con `connection.confirmTransaction`, que se suscribe por WebSocket
 * con `signatureSubscribe`. Los RPC que no exponen esa suscripción (el de
 * Alchemy de este proyecto, sin ir más lejos) hacen que la espera caduque y
 * lance **después de que el swap se haya ejecutado**: la transacción entra, el
 * usuario ve un error y cree que no hizo nada. Es el mismo fallo que tuvo el
 * faucet. Aquí se manda igual, pero se confirma sondeando por HTTP con
 * `awaitLanding`, que funciona con cualquier proveedor.
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import type { SwapDirection } from "./market";
import { getProgram, swapAccounts, type AnchorWalletLike } from "./program";
import { TransactionUnconfirmedError, awaitLanding } from "./confirm";

export interface SwapRequest {
  connection: Connection;
  wallet: AnchorWalletLike;
  direction: SwapDirection;
  amountIn: bigint;
  minAmountOut: bigint;
  /** The user's ATA for token A and token B, existing or not. */
  userTokenA: PublicKey;
  userTokenB: PublicKey;
  /** Mint + ATA of accounts that have to be created first, if any. */
  missingAtas: { ata: PublicKey; mint: PublicKey }[];
}

export async function executeSwap(request: SwapRequest): Promise<string> {
  const { connection, wallet, direction, amountIn, minAmountOut } = request;
  const program = getProgram(connection, wallet);

  const accounts = swapAccounts(request.userTokenA, request.userTokenB, wallet.publicKey);

  // 🇪🇸 NOTA: las ATAs que falten se crean DESDE EL CLIENTE, en la misma
  // transacción. El programa no lleva `init-if-needed`: esa feature deja que
  // una cuenta ya existente pase la constraint sin error, y sin una
  // comprobación explícita permite re-inicializar y resetear estado.
  const preInstructions = request.missingAtas.map(({ ata, mint }) =>
    createAssociatedTokenAccountInstruction(wallet.publicKey, ata, wallet.publicKey, mint)
  );

  const args: [BN, BN] = [new BN(amountIn.toString()), new BN(minAmountOut.toString())];

  const method =
    direction === "aToB"
      ? program.methods.swapAToB(...args)
      : program.methods.swapBToA(...args);

  const transaction = await method
    .accounts(accounts)
    .preInstructions(preInstructions)
    .transaction();

  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = latest.blockhash;

  const signed = await wallet.signTransaction(transaction);
  // 🇪🇸 NOTA: con preflight. Un swap que va a fallar (slippage, liquidez) falla
  // ANTES de gastar la comisión, y el error trae los logs del programa, que es
  // de donde `describeError` saca el código de Anchor.
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    preflightCommitment: "confirmed",
  });

  const landing = await awaitLanding(connection, signature, latest.lastValidBlockHeight);

  if (landing.status === "failed") {
    throw new Error(`The swap did not go through: ${landing.detail}`);
  }
  if (landing.status === "unconfirmed") {
    // 🔴 Puede haber entrado. Quien lo muestre no debe decir que no pasó nada.
    throw new TransactionUnconfirmedError(signature);
  }
  return signature;
}
