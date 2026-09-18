/**
 * The deployment manifest, as copied from the repo root by `yarn sync:onchain`.
 *
 * 🇪🇸 NOTA: ninguna dirección se escribe a mano en el frontend. Todas salen de
 * aquí, y aquí salen de `devnet.json`, que lo escribe scripts/seed-market.ts.
 */
import idlJson from "@/idl/solana_token_swap.json";
import manifestJson from "@/config/devnet.json";

export interface MintEntry {
  address: string;
  decimals: number;
}

export interface DevnetManifest {
  cluster: string;
  programId: string;
  authority: string;
  mints: Record<string, MintEntry>;
  market: {
    mintA: string;
    mintB: string;
    /** Symbol that ended up as token A. Decided by pubkey order, nothing else. */
    mintAIs: string;
    mintBIs: string;
    address: string;
    vaultA: string;
    vaultB: string;
    price: string;
  };
  createdAt: string;
  seededAt: string;
  /** Written by scripts/transfer-mint-authority.ts. The pubkey, never the key. */
  faucet?: {
    pubkey: string;
    fundedSol: number;
    authorityTransferredAt: string;
  };
}

export const manifest = manifestJson as DevnetManifest;

/**
 * 🇪🇸 NOTA: copiar el IDL y el manifest crea una forma nueva de fallar — que la
 * copia se quede vieja y el frontend hable con un programa que ya no existe,
 * mostrando datos plausibles y equivocados. Esta comprobación corre al importar
 * el módulo, así que revienta en el arranque (y en `next build`), no en el
 * primer swap. Es deliberado que sea un throw y no un warning.
 */
if (idlJson.address !== manifest.programId) {
  throw new Error(
    `Stale on-chain artefacts: the IDL declares program ${idlJson.address} but ` +
      `devnet.json declares ${manifest.programId}. Run \`yarn sync:onchain\` ` +
      `from frontend/ and commit the result.`
  );
}

export const PROGRAM_ID = manifest.programId;
export const CLUSTER = manifest.cluster;

/** Price is stored scaled by 10^PRICE_DECIMALS. Mirrors the constant in the program. */
export const PRICE_DECIMALS = 6;
