/**
 * Hands the mint authority of DEMO6 and DEMO9 to the dedicated faucet keypair,
 * funds that keypair with SOL, and proves the privilege MOVED instead of being
 * duplicated.
 *
 *   npx ts-node scripts/transfer-mint-authority.ts             # dry run
 *   npx ts-node scripts/transfer-mint-authority.ts --execute   # signs on devnet
 *
 * 🇪🇸 NOTA: por qué una keypair aparte. La authority actual (9aaPGTS7…) es
 * también el upgrade authority del programa desplegado y el authority del
 * mercado. El faucet de la fase 8 vive en un servidor, y la clave que vive en
 * un servidor hay que suponerla comprometida: lo único que puede hacer la del
 * faucet es acuñar DEMO6 y DEMO9, que no valen nada.
 *
 * 🇪🇸 NOTA: este script NUNCA lee la clave privada del faucet. Solo necesita su
 * pubkey — el faucet no firma nada aquí, solo recibe. `setAuthority` lo firma
 * la authority saliente.
 *
 * 🇪🇸 NOTA: la prueba negativa del paso 5. Que `spl-token display` muestre la
 * authority nueva demuestra que el faucet la tiene; NO demuestra que la
 * anterior la haya perdido. Por eso, tras el traspaso, se intenta acuñar con
 * 9aaPGTS7… y se exige que falle con `owner does not match`. Cuesta la comisión
 * de una transacción fallida y es la única comprobación que distingue "movido"
 * de "duplicado".
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMint,
  setAuthority,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import { safeFetchMetadata } from "@metaplex-foundation/mpl-token-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/id.json");
const FAUCET_KEYPAIR_PATH =
  process.env.FAUCET_KEYPAIR_PATH ??
  path.join(os.homedir(), ".solana-keys/faucet.json");
const MANIFEST_PATH = path.join(__dirname, "..", "devnet.json");
const RPC_URL = clusterApiUrl("devnet");

/** ~250 ATAs a ~0,002 SOL cada una. Es también el tope de daño si alguien abusa. */
const TARGET_SOL = 0.5;
const LAMPORTS_PER_SOL = 1e9;

const EXECUTE = process.argv.includes("--execute");
const MINTS = ["DEMO6", "DEMO9"] as const;

function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(file, "utf-8")))
  );
}

/** Solo la pubkey: la privada del faucet no hace falta para recibir. */
function faucetPubkey(file: string): PublicKey {
  if (!fs.existsSync(file)) {
    throw new Error(
      `No faucet keypair at ${file}. Generate it yourself with ` +
        `\`solana-keygen new -o ${file}\` and write down the seed phrase: a Solana ` +
        `keypair file is 64 raw bytes and does NOT contain the mnemonic.`
    );
  }
  return loadKeypair(file).publicKey;
}

function sol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const connection = new Connection(RPC_URL, "confirmed");
  const authority = loadKeypair(KEYPAIR_PATH);
  const faucet = faucetPubkey(FAUCET_KEYPAIR_PATH);

  console.log(
    `Mode:      ${EXECUTE ? "EXECUTE (signs on devnet)" : "dry run"}`
  );
  console.log(`Cluster:   devnet`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Faucet:    ${faucet.toBase58()}\n`);

  if (authority.publicKey.toBase58() !== manifest.authority) {
    throw new Error(
      `Loaded keypair is ${authority.publicKey.toBase58()}, but devnet.json records the ` +
        `authority as ${manifest.authority}. Refusing to sign with the wrong key.`
    );
  }
  if (manifest.faucet?.pubkey && manifest.faucet.pubkey !== faucet.toBase58()) {
    throw new Error(
      `devnet.json records the faucet as ${manifest.faucet.pubkey}, but ` +
        `${FAUCET_KEYPAIR_PATH} holds ${faucet.toBase58()}.`
    );
  }

  // ── 1. Traspaso de la mint authority ──────────────────────────────────────
  for (const key of MINTS) {
    const mint = new PublicKey(manifest.mints[key].address);
    const before = await getMint(connection, mint);
    const current = before.mintAuthority?.toBase58() ?? "null";
    console.log(`${key} (${mint.toBase58()})`);
    console.log(`  mint authority: ${current}`);

    if (current === faucet.toBase58()) {
      console.log(`  already the faucet, nothing to do`);
    } else if (current !== authority.publicKey.toBase58()) {
      throw new Error(
        `${key}: mint authority is ${current} — neither the signer nor the faucet. ` +
          `Refusing to guess.`
      );
    } else if (!EXECUTE) {
      console.log(`  would transfer to ${faucet.toBase58()}`);
    } else {
      const sig = await setAuthority(
        connection,
        authority,
        mint,
        authority,
        AuthorityType.MintTokens,
        faucet
      );
      console.log(`  transferred — ${sig}`);
    }
    console.log();
  }

  // ── 2. Financiación del faucet ────────────────────────────────────────────
  const target = Math.round(TARGET_SOL * LAMPORTS_PER_SOL);
  const balance = await connection.getBalance(faucet);
  const deficit = target - balance;
  console.log(`Faucet balance: ${sol(balance)} SOL (target ${TARGET_SOL})`);

  if (deficit <= 0) {
    console.log(`  already funded, nothing to send\n`);
  } else if (!EXECUTE) {
    console.log(`  would send ${sol(deficit)} SOL\n`);
  } else {
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: faucet,
          lamports: deficit,
        })
      ),
      [authority]
    );
    console.log(`  sent ${sol(deficit)} SOL — ${sig}`);
    console.log(
      `  faucet now at ${sol(await connection.getBalance(faucet))} SOL\n`
    );
  }

  if (!EXECUTE) {
    console.log("Dry run: nothing was signed. Re-run with --execute.");
    return;
  }

  // ── 3. Verificación positiva ──────────────────────────────────────────────
  console.log("─── Verification ───");
  for (const key of MINTS) {
    const mint = new PublicKey(manifest.mints[key].address);
    const after = await getMint(connection, mint);
    const now = after.mintAuthority?.toBase58() ?? "null";
    console.log(`${key} mint authority: ${now}`);
    if (now !== faucet.toBase58()) {
      throw new Error(`${key}: mint authority is ${now}, expected the faucet.`);
    }
  }

  // ── 4. Verificación negativa: la authority saliente ya no puede acuñar ────
  for (const key of MINTS) {
    const mint = new PublicKey(manifest.mints[key].address);
    const ata = await getAssociatedTokenAddress(mint, authority.publicKey);
    if (!(await connection.getAccountInfo(ata))) {
      throw new Error(
        `${key}: no ATA at ${ata.toBase58()} for the old authority, so a failed mint ` +
          `would not prove anything. Create it before running this check.`
      );
    }

    let failed = false;
    let detail = "";
    try {
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          createMintToInstruction(mint, ata, authority.publicKey, 1)
        ),
        [authority]
      );
    } catch (err: any) {
      failed = true;
      detail = JSON.stringify(err?.logs ?? err?.message ?? err);
    }

    if (!failed) {
      throw new Error(
        `${key}: the OLD authority still minted. The privilege was duplicated, not moved.`
      );
    }
    if (!detail.includes("owner does not match")) {
      throw new Error(
        `${key}: the old authority failed, but not with an authority error: ${detail}`
      );
    }
    console.log(
      `${key}: old authority can no longer mint ✔ (owner does not match)`
    );
  }

  // ── 5. La update authority de la metadata NO cambió ───────────────────────
  const umi = createUmi(RPC_URL);
  for (const key of MINTS) {
    const entry = manifest.mints[key];
    const metadata = await safeFetchMetadata(
      umi,
      publicKey(entry.metadata.pda)
    );
    if (!metadata) {
      throw new Error(`${key}: no metadata account at ${entry.metadata.pda}`);
    }
    const updateAuthority = metadata.updateAuthority.toString();
    console.log(`${key} metadata update authority: ${updateAuthority}`);
    if (updateAuthority !== manifest.authority) {
      throw new Error(
        `${key}: update authority is ${updateAuthority}, expected ${manifest.authority}. ` +
          `The faucet must be able to mint, never to rename the token.`
      );
    }
  }

  // ── 6. Manifest — la pubkey, nunca la privada ─────────────────────────────
  manifest.faucet = {
    pubkey: faucet.toBase58(),
    fundedSol: TARGET_SOL,
    authorityTransferredAt: new Date().toISOString(),
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nManifest updated: ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
