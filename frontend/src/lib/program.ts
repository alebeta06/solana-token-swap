/**
 * Anchor client: the program handle and the three PDAs of the market.
 */
import { AnchorProvider, Program, type Idl } from "@anchor-lang/core";
import type { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import idlJson from "@/idl/solana_token_swap.json";
import type { SolanaTokenSwap } from "@/idl/solana_token_swap";
import { manifest } from "./manifest";

export const programId = new PublicKey(manifest.programId);

export const mintA = new PublicKey(manifest.market.mintA);
export const mintB = new PublicKey(manifest.market.mintB);

function pda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

const encoder = new TextEncoder();
const seed = (text: string) => encoder.encode(text);

/**
 * 🇪🇸 NOTA: las direcciones se DERIVAN aquí, con las mismas seeds que el
 * programa, y se comparan con las que el manifest dice. Si no coinciden, el
 * manifest describe otro despliegue y no se arranca.
 */
export const marketPda = pda([seed("market"), mintA.toBuffer(), mintB.toBuffer()]);
export const vaultAPda = pda([seed("vault_a"), marketPda.toBuffer()]);
export const vaultBPda = pda([seed("vault_b"), marketPda.toBuffer()]);

for (const [label, derived, declared] of [
  ["market", marketPda, manifest.market.address],
  ["vault_a", vaultAPda, manifest.market.vaultA],
  ["vault_b", vaultBPda, manifest.market.vaultB],
] as const) {
  if (derived.toBase58() !== declared) {
    throw new Error(
      `Stale on-chain artefacts: ${label} derives to ${derived.toBase58()} but ` +
        `devnet.json says ${declared}. Run \`yarn sync:onchain\` from frontend/.`
    );
  }
}

/**
 * The wallet shape Anchor needs to sign. Matches what `useAnchorWallet()`
 * returns, so the hook's value can be passed straight in.
 */
export interface AnchorWalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export function getProgram(
  connection: Connection,
  wallet: AnchorWalletLike
): Program<SolanaTokenSwap> {
  const provider = new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });
  return new Program(idlJson as Idl, provider) as unknown as Program<SolanaTokenSwap>;
}

/**
 * The six accounts every swap takes.
 *
 * 🇪🇸 NOTA: `market` es un self-referencing PDA — sus seeds salen de
 * market.token_mint_a, un campo de la propia cuenta que hay que resolver. El
 * resolver de Anchor no puede derivarlo, así que van a mano el mercado y, con
 * él, las dos bóvedas, que dependen de market.key().
 *
 * ⚠️ El objeto va en una variable declarada `any`: el cast en línea
 * `{ ... } as any` NO sirve, porque TypeScript valida el literal antes de
 * aplicar el cast. Mismo patrón que scripts/swap-demo.ts.
 *
 * ⚠️ `tokenProgram` NO se pasa. Anchor lo resuelve por su dirección fija del
 * IDL y rechaza que se le pase. Son seis cuentas, no siete.
 */
export function swapAccounts(userTokenA: PublicKey, userTokenB: PublicKey, user: PublicKey) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts: any = {
    market: marketPda,
    vaultA: vaultAPda,
    vaultB: vaultBPda,
    userTokenA,
    userTokenB,
    user,
  };
  return accounts;
}
