/**
 * Initialises the market on devnet, sets a price and seeds both vaults.
 *
 * 🇪🇸 NOTA: es idempotente. Si el mercado ya existe, no falla: lee su estado,
 * ajusta el precio si hace falta y rellena solo el déficit de liquidez.
 * Mismo criterio que ensureMarketReady() en los tests.
 *
 *   npx ts-node scripts/seed-market.ts
 */
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { SolanaTokenSwap } from "../target/types/solana_token_swap";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/id.json");
const MANIFEST_PATH = path.join(__dirname, "..", "devnet.json");

// 🇪🇸 NOTA: price = 2_000_000 con PRICE_DECIMALS = 6 significa "1 A vale 2 B".
// Como mint_a resultó ser DEMO9, aquí eso es: 1 DEMO9 vale 2 DEMO6.
const PRICE = new anchor.BN(2_000_000);

const LIQUIDITY_A = 1_000; // en unidades de display, no base
const LIQUIDITY_B = 2_000;

function loadKeypair(file: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(file, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

const baseUnits = (amount: number, decimals: number) =>
  new anchor.BN(amount).mul(new anchor.BN(10).pow(new anchor.BN(decimals)));

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const payer = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "target/idl/solana_token_swap.json"),
      "utf-8"
    )
  );
  const program = new Program(idl, provider) as Program<SolanaTokenSwap>;

  // 🇪🇸 NOTA: el orden canónico ya está resuelto en devnet.json. No se recalcula
  // aquí — una sola fuente de verdad evita que dos sitios lo deduzcan distinto.
  const mintA = new PublicKey(manifest.market.mintA);
  const mintB = new PublicKey(manifest.market.mintB);
  const decimalsA = manifest.mints[manifest.market.mintAIs].decimals;
  const decimalsB = manifest.mints[manifest.market.mintBIs].decimals;

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), mintA.toBuffer(), mintB.toBuffer()],
    program.programId
  );
  const [vaultAPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_a"), marketPda.toBuffer()],
    program.programId
  );
  const [vaultBPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_b"), marketPda.toBuffer()],
    program.programId
  );

  console.log(`Payer:   ${payer.publicKey.toBase58()}`);
  console.log(`Market:  ${marketPda.toBase58()}`);
  console.log(`Vault A: ${vaultAPda.toBase58()} (${manifest.market.mintAIs})`);
  console.log(
    `Vault B: ${vaultBPda.toBase58()} (${manifest.market.mintBIs})\n`
  );

  // ── 1. Mercado ────────────────────────────────────────────────────────────
  // 🇪🇸 NOTA: aquí Anchor SÍ puede derivar el PDA del mercado, porque sus seeds
  // salen de tokenMintA y tokenMintB, que son cuentas que le pasamos nosotros.
  // Por eso este .accounts() no lleva `market` ni las bóvedas ni los programas.
  const existing = await connection.getAccountInfo(marketPda);
  if (existing) {
    console.log("Market already exists, skipping initialize_market");
  } else {
    console.log("Initialising market...");
    const sig = await program.methods
      .initializeMarket()
      .accounts({
        tokenMintA: mintA,
        tokenMintB: mintB,
        authority: payer.publicKey,
      })
      .rpc();
    console.log(`  ${sig}`);
  }

  // ── 2. Precio ─────────────────────────────────────────────────────────────
  // 🇪🇸 NOTA: aquí NO puede. Las seeds de `market` en SetPrice se derivan de
  // market.token_mint_a y market.token_mint_b — campos de la PROPIA cuenta que
  // hay que resolver. Anchor lo llama "self-referencing PDA": necesitaría leer
  // la cuenta para saber su dirección y saber su dirección para leerla.
  //
  // El `as any` es necesario porque el tipo generado excluye `market` (el IDL lo
  // marca como PDA) pero el resolver en runtime no puede derivarlo. Los tipos y
  // el resolver discrepan; es una limitación de Anchor, no del programa.
  //
  // Es el coste de una decisión deliberada: usar market.token_mint_a en las
  // seeds en vez de pasar los mints como cuentas hace el programa más seguro
  // (el campo guardado es lo que valida `has_one`, no depende del caller) a
  // cambio de que el cliente tenga que derivar el PDA a mano.
  let market = await program.account.marketAccount.fetch(marketPda);
  if (market.price.eq(PRICE)) {
    console.log(`Price already set to ${PRICE.toString()}`);
  } else {
    console.log(`Setting price to ${PRICE.toString()}...`);
    const setPriceAccounts: any = {
      market: marketPda,
      authority: payer.publicKey,
    };
    const sig = await program.methods
      .setPrice(PRICE)
      .accounts(setPriceAccounts)
      .rpc();
    console.log(`  ${sig}`);
  }

  // ── 3. Liquidez ───────────────────────────────────────────────────────────
  const targetA = baseUnits(LIQUIDITY_A, decimalsA);
  const targetB = baseUnits(LIQUIDITY_B, decimalsB);

  const vaultA = await getAccount(connection, vaultAPda);
  const vaultB = await getAccount(connection, vaultBPda);

  const deficitA = targetA.sub(new anchor.BN(vaultA.amount.toString()));
  const deficitB = targetB.sub(new anchor.BN(vaultB.amount.toString()));

  const needsA = deficitA.gt(new anchor.BN(0));
  const needsB = deficitB.gt(new anchor.BN(0));

  if (!needsA && !needsB) {
    console.log("Vaults already funded, nothing to top up");
  } else {
    // 🇪🇸 NOTA: acuñamos a nuestra propia ATA primero. La mint authority es
    // este mismo payer, que es lo que hará falta para el faucet en la fase 8.
    const ataA = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintA,
      payer.publicKey
    );
    const ataB = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mintB,
      payer.publicKey
    );

    if (needsA) {
      console.log(
        `Minting ${deficitA.toString()} base units of ${
          manifest.market.mintAIs
        }...`
      );
      await mintTo(
        connection,
        payer,
        mintA,
        ataA.address,
        payer,
        BigInt(deficitA.toString())
      );
    }
    if (needsB) {
      console.log(
        `Minting ${deficitB.toString()} base units of ${
          manifest.market.mintBIs
        }...`
      );
      await mintTo(
        connection,
        payer,
        mintB,
        ataB.address,
        payer,
        BigInt(deficitB.toString())
      );
    }

    // 🇪🇸 NOTA: mismo caso que set_price. Como `market` no se resuelve, las
    // bóvedas que dependen de market.key() tampoco, así que van las tres a mano.
    console.log("Adding liquidity...");
    const liquidityAccounts: any = {
      market: marketPda,
      vaultA: vaultAPda,
      vaultB: vaultBPda,
      depositorTokenA: ataA.address,
      depositorTokenB: ataB.address,
      depositor: payer.publicKey,
    };
    const sig = await program.methods
      .addLiquidity(
        needsA ? deficitA : new anchor.BN(0),
        needsB ? deficitB : new anchor.BN(0)
      )
      .accounts(liquidityAccounts)
      .rpc();
    console.log(`  ${sig}`);
  }

  // ── 4. Estado final ───────────────────────────────────────────────────────
  market = await program.account.marketAccount.fetch(marketPda);
  const finalA = await getAccount(connection, vaultAPda);
  const finalB = await getAccount(connection, vaultBPda);

  console.log("\n─── Market state ───");
  console.log(`price:      ${market.price.toString()}`);
  console.log(`decimals_a: ${market.decimalsA}`);
  console.log(`decimals_b: ${market.decimalsB}`);
  console.log(`vault_a:    ${finalA.amount} base units`);
  console.log(`vault_b:    ${finalB.amount} base units`);

  manifest.market.address = marketPda.toBase58();
  manifest.market.vaultA = vaultAPda.toBase58();
  manifest.market.vaultB = vaultBPda.toBase58();
  manifest.market.price = market.price.toString();
  manifest.seededAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nManifest updated: ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
