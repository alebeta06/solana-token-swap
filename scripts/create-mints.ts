/**
 * Creates the two demo mints for the swap on devnet.
 *
 * 🇪🇸 NOTA: se llaman DEMO6 y DEMO9 por sus DECIMALES, no por la posición A/B
 * del mercado. Cuál acaba siendo token_mint_a lo decide la comparación de
 * pubkeys, así que un mint llamado "TokenA" mentiría la mitad de las veces.
 *
 *   npx ts-node scripts/create-mints.ts
 */
import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/id.json");
const OUTPUT_PATH = path.join(__dirname, "..", "devnet.json");

function loadKeypair(file: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(file, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const payer = loadKeypair(KEYPAIR_PATH);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer:   ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  if (balance < 0.1e9) {
    throw new Error("Not enough SOL to create the mints");
  }

  // 🇪🇸 NOTA: freeze authority a null, a propósito. Circle SÍ la conserva en
  // sus mints de USDC y EURC, lo que significa que puede congelar cualquier
  // token account de esos tokens — incluida una bóveda de este programa.
  // Dejarla en null elimina ese riesgo de contraparte.
  const FREEZE_AUTHORITY = null;

  console.log("Creating DEMO6 (6 decimals)...");
  const demo6 = await createMint(
    connection,
    payer,
    payer.publicKey,      // mint authority — hace falta para el faucet
    FREEZE_AUTHORITY,
    6
  );
  console.log(`  ${demo6.toBase58()}\n`);

  console.log("Creating DEMO9 (9 decimals)...");
  const demo9 = await createMint(
    connection,
    payer,
    payer.publicKey,
    FREEZE_AUTHORITY,
    9
  );
  console.log(`  ${demo9.toBase58()}\n`);

  // 🇪🇸 NOTA: el orden canónico del mercado lo decide la comparación de los
  // 32 bytes de cada pubkey. Se calcula aquí una vez y se guarda, para que el
  // script de seed y el frontend no tengan que deducirlo cada uno por su lado.
  const demo6IsLower = demo6.toBuffer().compare(demo9.toBuffer()) < 0;
  const mintA = demo6IsLower ? demo6 : demo9;
  const mintB = demo6IsLower ? demo9 : demo6;

  console.log("Canonical order (mint_a < mint_b):");
  console.log(`  mint_a = ${mintA.toBase58()} (${demo6IsLower ? "DEMO6" : "DEMO9"})`);
  console.log(`  mint_b = ${mintB.toBase58()} (${demo6IsLower ? "DEMO9" : "DEMO6"})`);

  const out = {
    cluster: "devnet",
    programId: "BJ7GHy1zRe1VKuKUZU2ac2q1VQmtukmHzCpbo98m21qp",
    authority: payer.publicKey.toBase58(),
    mints: {
      DEMO6: { address: demo6.toBase58(), decimals: 6 },
      DEMO9: { address: demo9.toBase58(), decimals: 9 },
    },
    market: {
      mintA: mintA.toBase58(),
      mintB: mintB.toBase58(),
      mintAIs: demo6IsLower ? "DEMO6" : "DEMO9",
      mintBIs: demo6IsLower ? "DEMO9" : "DEMO6",
    },
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWritten to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});