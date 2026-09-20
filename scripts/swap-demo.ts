/**
 * Runs a real round trip against the market deployed on devnet: 1 DEMO9 into
 * the pool (A→B), the DEMO6 that comes out straight back in (B→A), and then
 * checks that nothing was created out of thin air.
 *
 * 🇪🇸 NOTA: no es idempotente en el sentido de seed-market.ts — cada corrida
 * manda dos transacciones nuevas. Lo que sí hace es acuñarse el token A que le
 * falte, así que se puede ejecutar tantas veces como haga falta.
 *
 *   npx ts-node scripts/swap-demo.ts
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
const FAUCET_KEYPAIR_PATH =
  process.env.FAUCET_KEYPAIR ??
  path.join(os.homedir(), ".solana-keys/faucet.json");
const MANIFEST_PATH = path.join(__dirname, "..", "devnet.json");

const PRICE_DECIMALS = 6;

// 🇪🇸 NOTA: la entrada del demo es 1 token A en unidades de DISPLAY. Cuánto
// vale eso en unidades base lo decide el mint, no esta constante.
const AMOUNT_IN_A = 1;

const ZERO = new anchor.BN(0);
const pow10 = (n: number) => new anchor.BN(10).pow(new anchor.BN(n));

function loadKeypair(file: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(file, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

/**
 * The faucet keypair, which holds the mint authority of both mints.
 *
 * 🔴 NOTA: mint authority y nada más. Los swaps de este script los sigue
 * firmando `payer` (`id.json`), que es quien tiene los tokens y las ATAs. Pasar
 * el faucet como `user` de un swap no daría un error de permisos: movería los
 * tokens de otra cuenta, o fallaría con `InvalidMint` al no tener ATAs.
 *
 * 🇪🇸 NOTA: se carga solo si falta saldo. Una corrida con token A suficiente no
 * necesita acuñar, y no debe exigir un fichero que solo tiene quien despliega.
 */
function loadMintAuthority(manifest: any): Keypair {
  if (!fs.existsSync(FAUCET_KEYPAIR_PATH)) {
    throw new Error(
      `Minting needs the faucet keypair: it holds the mint authority of both mints ` +
        `since phase 8, and ${KEYPAIR_PATH} no longer does. ` +
        `${FAUCET_KEYPAIR_PATH} does not exist — point FAUCET_KEYPAIR at the file.`
    );
  }
  const faucet = loadKeypair(FAUCET_KEYPAIR_PATH);
  const expected = manifest.faucet?.pubkey;
  if (expected && faucet.publicKey.toBase58() !== expected) {
    throw new Error(
      `devnet.json records the faucet as ${expected}, but ${FAUCET_KEYPAIR_PATH} holds ` +
        `${faucet.publicKey.toBase58()}. Refusing to sign with the wrong key.`
    );
  }
  return faucet;
}

/** Misma aritmética que el programa: todas las multiplicaciones antes de las divisiones. */
const expectedB = (
  amountA: anchor.BN,
  price: anchor.BN,
  decA: number,
  decB: number
) =>
  amountA
    .mul(price)
    .mul(pow10(decB))
    .div(pow10(PRICE_DECIMALS).mul(pow10(decA)));

const expectedA = (
  amountB: anchor.BN,
  price: anchor.BN,
  decA: number,
  decB: number
) =>
  amountB
    .mul(pow10(PRICE_DECIMALS))
    .mul(pow10(decA))
    .div(price.mul(pow10(decB)));

const display = (base: anchor.BN | bigint, decimals: number) =>
  (Number(base.toString()) / 10 ** decimals).toFixed(decimals);

const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

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

  // 🇪🇸 NOTA: el manifest es la única fuente de verdad del orden canónico. En
  // este despliegue mint_a es DEMO9 (9 decimales), pero el script no lo asume:
  // lee mintAIs. Suponer que "A es el de menos decimales" ya falló en la fase 4.
  const mintA = new PublicKey(manifest.market.mintA);
  const mintB = new PublicKey(manifest.market.mintB);
  const nameA: string = manifest.market.mintAIs;
  const nameB: string = manifest.market.mintBIs;
  const decimalsA: number = manifest.mints[nameA].decimals;
  const decimalsB: number = manifest.mints[nameB].decimals;

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

  const market = await program.account.marketAccount.fetch(marketPda);
  if (market.price.isZero()) {
    throw new Error("Market price is unset — run scripts/seed-market.ts first");
  }

  console.log(`Payer:   ${payer.publicKey.toBase58()}`);
  console.log(`Market:  ${marketPda.toBase58()}`);
  console.log(`Token A: ${nameA} (${decimalsA} decimals) ${mintA.toBase58()}`);
  console.log(`Token B: ${nameB} (${decimalsB} decimals) ${mintB.toBase58()}`);
  console.log(
    `Price:   ${market.price.toString()} (1 ${nameA} = ${
      Number(market.price.toString()) / 10 ** PRICE_DECIMALS
    } ${nameB})\n`
  );

  // 🇪🇸 NOTA: las ATAs del usuario pueden no existir. Se crean desde el
  // cliente, nunca con init-if-needed en el programa.
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

  const amountInA = new anchor.BN(AMOUNT_IN_A).mul(pow10(decimalsA));

  // 🇪🇸 NOTA: si falta token A para el demo nos lo acuñamos en vez de abortar,
  // pero la mint authority YA NO es este payer: la tiene el faucet desde la
  // fase 8. El fee payer sigue siendo `payer`; lo único que cambia de manos es
  // la firma de la autoridad.
  if (new anchor.BN(ataA.amount.toString()).lt(amountInA)) {
    const shortfall = amountInA.sub(new anchor.BN(ataA.amount.toString()));
    console.log(
      `Minting ${display(shortfall, decimalsA)} ${nameA} to cover the demo...`
    );
    await mintTo(
      connection,
      payer, // fee payer
      mintA,
      ataA.address,
      loadMintAuthority(manifest), // mint authority
      BigInt(shortfall.toString())
    );
  }

  // 🇪🇸 NOTA: `market` en los contextos de swap es un self-referencing PDA (sus
  // seeds salen de market.token_mint_a), así que Anchor 1.2.0 no puede
  // resolverlo y hay que pasarlo a mano — y con él las bóvedas, que dependen de
  // market.key(). El objeto va en una variable declarada `any`: el cast en línea
  // `{...} as any` no sirve porque TypeScript valida el literal antes de
  // aplicarlo. tokenProgram NO se pasa: Anchor lo resuelve por su dirección fija
  // del IDL y rechaza que se le pase.
  const swapAccounts: any = {
    market: marketPda,
    vaultA: vaultAPda,
    vaultB: vaultBPda,
    userTokenA: ataA.address,
    userTokenB: ataB.address,
    user: payer.publicKey,
  };

  const balances = async () => ({
    userA: (await getAccount(connection, ataA.address)).amount,
    userB: (await getAccount(connection, ataB.address)).amount,
    vaultA: (await getAccount(connection, vaultAPda)).amount,
    vaultB: (await getAccount(connection, vaultBPda)).amount,
  });

  const report = (label: string, b: Awaited<ReturnType<typeof balances>>) => {
    console.log(`${label}`);
    console.log(
      `  user  ${nameA}: ${display(b.userA, decimalsA)}   ${nameB}: ${display(
        b.userB,
        decimalsB
      )}`
    );
    console.log(
      `  vault ${nameA}: ${display(b.vaultA, decimalsA)}   ${nameB}: ${display(
        b.vaultB,
        decimalsB
      )}`
    );
  };

  // ── Swap A→B ──────────────────────────────────────────────────────────────
  const before = await balances();
  report("Before A→B", before);

  const minOutB = expectedB(amountInA, market.price, decimalsA, decimalsB);
  console.log(
    `\nSwapping ${display(amountInA, decimalsA)} ${nameA} → expecting ${display(
      minOutB,
      decimalsB
    )} ${nameB}...`
  );

  const sigAtoB = await program.methods
    .swapAToB(amountInA, minOutB)
    .accounts(swapAccounts)
    .rpc();
  console.log(`  ${sigAtoB}`);

  const mid = await balances();
  report("\nAfter A→B", mid);

  const receivedB = new anchor.BN((mid.userB - before.userB).toString());
  console.log(`  → received ${display(receivedB, decimalsB)} ${nameB}`);

  // ── Swap B→A ──────────────────────────────────────────────────────────────
  // 🇪🇸 NOTA: se devuelve exactamente lo que salió del primer swap, que es la
  // única forma de que la invariante A→B→A signifique algo.
  const minOutA = expectedA(receivedB, market.price, decimalsA, decimalsB);
  console.log(
    `\nSwapping ${display(
      receivedB,
      decimalsB
    )} ${nameB} back → expecting ${display(minOutA, decimalsA)} ${nameA}...`
  );

  const sigBtoA = await program.methods
    .swapBToA(receivedB, minOutA)
    .accounts(swapAccounts)
    .rpc();
  console.log(`  ${sigBtoA}`);

  const after = await balances();
  report("\nAfter B→A", after);

  const returnedA = new anchor.BN((after.userA - mid.userA).toString());
  console.log(`  → received ${display(returnedA, decimalsA)} ${nameA}`);

  // ── Invariante ────────────────────────────────────────────────────────────
  // 🇪🇸 NOTA: el truncamiento solo puede REDUCIR la salida, así que la
  // desigualdad está garantizada por construcción. Esto lo comprueba en vivo.
  const loss = amountInA.sub(returnedA);
  console.log(`\n─── Round trip invariant ───`);
  console.log(`in:       ${display(amountInA, decimalsA)} ${nameA}`);
  console.log(`out:      ${display(returnedA, decimalsA)} ${nameA}`);
  console.log(
    `retained: ${loss.toString()} base units (truncation, in favour of the pool)`
  );

  if (returnedA.gt(amountInA)) {
    throw new Error(
      `INVARIANT VIOLATED: the round trip returned ${returnedA.toString()} ` +
        `base units for an input of ${amountInA.toString()}`
    );
  }
  if (loss.lt(ZERO)) {
    throw new Error("INVARIANT VIOLATED: negative retention");
  }
  console.log("OK — the round trip never returns more than went in");

  console.log(`\n─── Transactions ───`);
  console.log(`A→B (${nameA}→${nameB}): ${sigAtoB}`);
  console.log(`  ${explorer(sigAtoB)}`);
  console.log(`B→A (${nameB}→${nameA}): ${sigBtoA}`);
  console.log(`  ${explorer(sigBtoA)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
