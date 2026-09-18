/**
 * Attaches Metaplex Token Metadata to the DEMO6 and DEMO9 mints on devnet, so
 * wallets show a name and a logo instead of a base58 address.
 *
 *   npx ts-node scripts/create-token-metadata.ts
 *
 * Run scripts/upload-metadata.ts first: this one reads the `uri` it left in
 * devnet.json and never uploads anything itself.
 *
 * 🇪🇸 NOTA: por qué este paso va ANTES de traspasar la mint authority al
 * faucet. `CreateMetadataAccountV3` exige que la MINT AUTHORITY firme — así es
 * como el programa de Metaplex comprueba que el mint es tuyo. Si primero
 * traspasáramos la autoridad, la metadata tendría que crearla la keypair del
 * faucet.
 *
 * 🇪🇸 NOTA: y por qué la update authority se queda donde está. En esta
 * instrucción `updateAuthority` NO es una cuenta firmante, es un dato: se fija
 * a la keypair actual y ahí se queda. Tras el paso 2, el faucet podrá acuñar
 * pero no podrá cambiar el nombre ni el logo. Separación de privilegios dentro
 * de la separación.
 *
 * 🇪🇸 NOTA sobre la elección de instrucción: se usa `createMetadataAccountV3`
 * (la "legacy") y no `createV1`. `createV1` está pensada para crear el mint y
 * su metadata a la vez, y arrastra master edition y token standard; sobre un
 * mint que ya existe pide más cuentas para el mismo resultado. Y sobre todo,
 * en createV1 la autoridad es una sola cuenta firmante, mientras que aquí
 * mint authority (firma) y update authority (dato) están separadas — que es
 * justo la distinción que este paso necesita conservar.
 */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  keypairIdentity,
  none,
  publicKey,
  type PublicKey,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import {
  createMetadataAccountV3,
  findMetadataPda,
  safeFetchMetadata,
  updateMetadataAccountV2,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  Connection,
  PublicKey as Web3PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/id.json");
const DEVNET_PATH = path.join(__dirname, "..", "devnet.json");
const RPC_URL = clusterApiUrl("devnet");

/** Metaplex caps these; going over is a runtime error deep inside the program. */
const MAX_NAME = 32;
const MAX_SYMBOL = 10;
const MAX_URI = 200;

type MintEntry = {
  address: string;
  decimals: number;
  metadata?: { name: string; symbol: string; uri: string; pda?: string };
};

/** umi entrega la firma como bytes; en base58 es lo que busca el explorer. */
function sig(signature: Uint8Array): string {
  return base58.deserialize(signature)[0];
}

function assertFits(value: string, max: number, field: string) {
  if (value.length > max) {
    throw new Error(
      `${field} is ${value.length} chars, Metaplex caps it at ${max}: "${value}"`
    );
  }
}

async function main() {
  const devnet = JSON.parse(fs.readFileSync(DEVNET_PATH, "utf-8"));
  const secret = new Uint8Array(
    JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"))
  );

  // 🇪🇸 NOTA: el cluster se fija aquí en código, igual que en create-mints.ts.
  // La red que tenga configurada la CLI de Solana es irrelevante para este
  // script; de ~/.config/solana/id.json solo sale la keypair.
  const umi = createUmi(RPC_URL);
  const keypair = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(createSignerFromKeypair(umi, keypair)));

  const signer = umi.identity;
  console.log(`Cluster:  devnet`);
  console.log(`Signer:   ${signer.publicKey}`);

  if (signer.publicKey !== devnet.authority) {
    throw new Error(
      `Loaded keypair is ${signer.publicKey}, but devnet.json records the authority as ` +
        `${devnet.authority}. Refusing to sign with the wrong key.`
    );
  }

  const balance = await umi.rpc.getBalance(signer.publicKey);
  console.log(
    `Balance:  ${(Number(balance.basisPoints) / 1e9).toFixed(4)} SOL\n`
  );

  const connection = new Connection(RPC_URL, "confirmed");

  for (const key of ["DEMO6", "DEMO9"] as const) {
    const entry: MintEntry = devnet.mints[key];
    console.log(key);

    if (!entry.metadata?.uri) {
      throw new Error(
        `devnet.json has no metadata.uri for ${key}. ` +
          `Run scripts/upload-metadata.ts first.`
      );
    }
    const { name, symbol, uri } = entry.metadata;
    assertFits(name, MAX_NAME, `${key} name`);
    assertFits(symbol, MAX_SYMBOL, `${key} symbol`);
    assertFits(uri, MAX_URI, `${key} uri`);

    const mint = publicKey(entry.address) as PublicKey;

    // 🇪🇸 NOTA: comprobación explícita de la mint authority antes de firmar. Si
    // el paso 2 (traspaso al faucet) ya se hubiera ejecutado, la transacción
    // fallaría igual, pero con un error del programa de Metaplex que no
    // explica nada. Este mensaje sí.
    const mintAccount = await getMint(
      connection,
      new Web3PublicKey(entry.address)
    );
    if (mintAccount.mintAuthority?.toBase58() !== signer.publicKey) {
      throw new Error(
        `${key}: mint authority is ${
          mintAccount.mintAuthority?.toBase58() ?? "null"
        }, ` +
          `not the signer. CreateMetadataAccountV3 requires the mint authority to sign, ` +
          `so this step must run BEFORE handing the mint authority to the faucet.`
      );
    }

    const metadataPda = findMetadataPda(umi, { mint });
    const pda = metadataPda[0];
    console.log(`  metadata PDA: ${pda}`);

    const existing = await safeFetchMetadata(umi, metadataPda);

    if (!existing) {
      console.log(`  creating...`);
      const result = await createMetadataAccountV3(umi, {
        mint,
        mintAuthority: signer,
        payer: signer,
        // Not a signer: a plain address that stays put. See the note above.
        updateAuthority: signer.publicKey,
        data: {
          name,
          symbol,
          uri,
          sellerFeeBasisPoints: 0,
          creators: none(),
          collection: none(),
          uses: none(),
        },
        // Mutable on purpose: otherwise the update authority we are carefully
        // keeping would be able to do nothing with it.
        isMutable: true,
        collectionDetails: none(),
      }).sendAndConfirm(umi);
      console.log(`  created — ${sig(result.signature)}`);
    } else if (
      existing.name === name &&
      existing.symbol === symbol &&
      existing.uri === uri
    ) {
      console.log(`  already up to date, nothing to do`);
    } else {
      console.log(`  exists but differs:`);
      console.log(`    name   ${existing.name} → ${name}`);
      console.log(`    symbol ${existing.symbol} → ${symbol}`);
      console.log(`    uri    ${existing.uri} → ${uri}`);
      if (existing.updateAuthority !== signer.publicKey) {
        throw new Error(
          `${key}: update authority is ${existing.updateAuthority}, not the signer. Cannot update.`
        );
      }
      const result = await updateMetadataAccountV2(umi, {
        metadata: pda,
        updateAuthority: signer,
        data: {
          name,
          symbol,
          uri,
          sellerFeeBasisPoints: existing.sellerFeeBasisPoints,
          creators: existing.creators,
          collection: existing.collection,
          uses: existing.uses,
        },
      }).sendAndConfirm(umi);
      console.log(`  updated — ${sig(result.signature)}`);
    }

    entry.metadata.pda = pda.toString();
    console.log();
  }

  devnet.metadataCreatedAt = new Date().toISOString();
  fs.writeFileSync(DEVNET_PATH, JSON.stringify(devnet, null, 2) + "\n");
  console.log(`Written to ${DEVNET_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
