/**
 * Uploads the logo and the off-chain metadata JSON of DEMO6 and DEMO9 to IPFS
 * through Pinata, and records the resulting URIs in devnet.json.
 *
 * 🇪🇸 NOTA: este script NO toca la cadena. Sube ficheros y escribe devnet.json;
 * quien firma on-chain es create-token-metadata.ts, que se ejecuta después y
 * lee de aquí el `uri`. Están separados a propósito: subir a IPFS y firmar una
 * transacción fallan de formas distintas y conviene poder repetir una sin la
 * otra.
 *
 * 🇪🇸 NOTA: IPFS no borra. Cada subida produce un CID nuevo y el anterior se
 * queda pinado en la cuenta. Por eso, si un fichero ya está subido con el mismo
 * nombre, el script REUTILIZA su CID y avisa, en vez de acumular pins
 * huérfanos. Para forzar una subida nueva (porque el fichero local cambió):
 *
 *   npx ts-node scripts/upload-metadata.ts --force
 *
 * Necesita, en un .env de la raíz que NO se commitea:
 *   PINATA_JWT=eyJ...           (obligatorio)
 *   PINATA_GATEWAY=...          (OPCIONAL; si falta se deriva del JWT)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..");
const DEVNET_PATH = path.join(ROOT, "devnet.json");
const ASSETS_DIR = path.join(__dirname, "assets");

const UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const LIST_URL = "https://api.pinata.cloud/v3/files/public";
const GATEWAYS_URL = "https://api.pinata.cloud/v3/ipfs/gateways";

/** Prefix so these files are recognisable among other modules' pins. */
const PIN_PREFIX = "solana-token-swap-";

type TokenSpec = {
  key: "DEMO6" | "DEMO9";
  name: string;
  symbol: string;
  description: string;
  image: string;
};

const TOKENS: TokenSpec[] = [
  {
    key: "DEMO6",
    name: "Demo Six",
    symbol: "DEMO6",
    description:
      "Demo SPL token with 6 decimals, used by the fixed-price token swap of " +
      "CodeCrypto module 15. Devnet only, no value.",
    image: "demo6.png",
  },
  {
    key: "DEMO9",
    name: "Demo Nine",
    symbol: "DEMO9",
    description:
      "Demo SPL token with 9 decimals, used by the fixed-price token swap of " +
      "CodeCrypto module 15. Devnet only, no value.",
    image: "demo9.png",
  },
];

/**
 * Minimal .env reader. A dependency just to split on "=" would not earn its
 * place, and the values here never leave this process.
 */
function loadEnv(): void {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value)
    throw new Error(`Missing ${key}. Put it in a .env at the repo root.`);
  return value;
}

type PinnedFile = { cid: string; created_at?: string };

/** Returns the already-pinned file with this exact name, or null. */
async function findPinnedByName(
  jwt: string,
  name: string
): Promise<PinnedFile | null> {
  const res = await fetch(`${LIST_URL}?name=${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok)
    throw new Error(`Pinata list failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as {
    data?: { files?: (PinnedFile & { name: string })[] };
  };
  const files = body.data?.files ?? [];
  return files.find((f) => f.name === name) ?? null;
}

async function pinataUpload(
  jwt: string,
  name: string,
  content: Buffer | string,
  mimeType: string
): Promise<string> {
  const blob = new Blob([content], { type: mimeType });
  const form = new FormData();
  form.append("file", new File([blob], name, { type: mimeType }));
  form.append("network", "public");
  form.append("name", name);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok)
    throw new Error(
      `Pinata upload failed (${res.status}): ${await res.text()}`
    );
  const body = (await res.json()) as { data?: { cid?: string } };
  const cid = body.data?.cid;
  if (!cid)
    throw new Error(`Pinata upload returned no cid: ${JSON.stringify(body)}`);
  return cid;
}

/**
 * Uploads unless an identically named pin already exists, in which case its CID
 * is reused and the caller is told. See the note at the top about IPFS never
 * deleting anything.
 */
async function uploadOnce(
  jwt: string,
  name: string,
  content: Buffer | string,
  mimeType: string,
  force: boolean,
  gatewayUrl?: (cid: string) => string
): Promise<string> {
  if (!force) {
    const existing = await findPinnedByName(jwt, name);
    if (existing) {
      console.log(
        `  ${name}: already pinned (${existing.created_at ?? "unknown date"})`
      );

      // 🇪🇸 NOTA: reutilizar por NOMBRE no basta cuando el contenido se genera.
      // El JSON incorpora la URL del gateway, así que un pin con el nombre
      // correcto puede llevar dentro un gateway viejo — pasó la primera vez que
      // se corrió esto. Para contenido de texto se compara lo que sirve el
      // gateway con lo que íbamos a subir, y solo se resube si difiere.
      //
      // ⚠️ Y la comparación NO puede degradar en silencio. Si el gateway
      // responde 500 o 429, "no he podido comparar" NO es "es igual": dar por
      // bueno el pin existente sería asumir éxito por ausencia de excepción,
      // que es justo el fallo que no se ve hasta que es tarde.
      if (typeof content === "string" && gatewayUrl) {
        const served = await fetch(gatewayUrl(existing.cid));
        if (!served.ok) {
          throw new Error(
            `Cannot verify the pinned copy of ${name}: gateway returned ` +
              `${served.status} for ${gatewayUrl(existing.cid)}. ` +
              `Refusing to reuse a CID whose contents could not be checked.`
          );
        }
        const pinned = await served.text();
        if (pinned.trim() !== content.trim()) {
          console.log(`    contents differ from what we would upload`);
          console.log(
            `    ⚠ the stale pin stays in the account: ${existing.cid}`
          );
          const fresh = await pinataUpload(jwt, name, content, mimeType);
          console.log(`    re-uploaded → ${fresh}`);
          return fresh;
        }
      }

      console.log(`    reusing ${existing.cid}`);
      console.log(`    → if the local file changed, re-run with --force`);
      return existing.cid;
    }
  }
  const cid = await pinataUpload(jwt, name, content, mimeType);
  console.log(`  ${name}: uploaded → ${cid}`);
  return cid;
}

/**
 * 🇪🇸 NOTA: comprobar que el URI resuelve ANTES de escribirlo on-chain. Si el
 * gateway no sirve el JSON, la wallet enseña el nombre (que va on-chain) pero
 * no el logo (que va en el JSON), y el fallo se descubriría tarde y en frío.
 */
async function assertResolves(url: string, label: string): Promise<Response> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok)
    throw new Error(`${label} does not resolve (${res.status}): ${url}`);
  return res;
}

/** True if the host answers at all; any HTTP status proves it exists. */
async function reachable(gateway: string): Promise<boolean> {
  try {
    await fetch(`https://${gateway}/`, { method: "HEAD" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 🇪🇸 NOTA: el gateway se DERIVA del JWT, no se copia a mano.
 *
 * La primera vez que se corrió este script, PINATA_GATEWAY tenía todavía el
 * valor de ejemplo de la documentación: los dos ficheros de DEMO6 se subieron
 * igualmente y el fallo solo apareció al verificar, dejando un pin inútil en la
 * cuenta. Con IPFS, que no borra, un error de configuración detectado tarde
 * cuesta basura permanente.
 *
 * El arreglo no es avisar mejor, es quitar el dato de en medio: la misma
 * credencial que autoriza la subida sabe cuál es el gateway. PINATA_GATEWAY
 * pasa a ser opcional y solo sirve para forzar uno concreto.
 */
async function resolveGateway(
  jwt: string,
  configured?: string
): Promise<string> {
  if (configured && (await reachable(configured))) return configured;

  if (configured) {
    console.log(
      `PINATA_GATEWAY "${configured}" does not resolve — ignoring it`
    );
  }

  const res = await fetch(GATEWAYS_URL, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(
      `Cannot list gateways (${res.status}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as { data?: { rows?: { domain: string }[] } };
  const domain = body.data?.rows?.[0]?.domain;
  if (!domain) {
    throw new Error(
      `This Pinata account has no gateway. Create one at app.pinata.cloud, ` +
        `or set PINATA_GATEWAY in .env.`
    );
  }

  const discovered = `${domain}.mypinata.cloud`;
  if (!(await reachable(discovered))) {
    throw new Error(
      `Discovered gateway ${discovered} does not resolve either.`
    );
  }
  return discovered;
}

async function main() {
  loadEnv();
  const jwt = requireEnv("PINATA_JWT");
  // PINATA_GATEWAY es OPCIONAL: si falta o no resuelve, se descubre con el JWT.
  const configured = process.env.PINATA_GATEWAY?.replace(
    /^https?:\/\//,
    ""
  ).replace(/\/$/, "");
  const gateway = await resolveGateway(jwt, configured);
  const force = process.argv.includes("--force");

  const devnet = JSON.parse(fs.readFileSync(DEVNET_PATH, "utf-8"));
  const gatewayUrl = (cid: string) => `https://${gateway}/ipfs/${cid}`;

  console.log(`Gateway: ${gateway}\n`);

  if (force) console.log("--force: every file will be uploaded again\n");

  for (const token of TOKENS) {
    console.log(`${token.key}`);

    const imagePath = path.join(ASSETS_DIR, token.image);
    const imageCid = await uploadOnce(
      jwt,
      `${PIN_PREFIX}${token.image}`,
      fs.readFileSync(imagePath),
      "image/png",
      force
    );
    const imageUri = gatewayUrl(imageCid);

    // Metaplex fungible off-chain schema. `image` must already be a resolvable
    // URL here, which is why the logo goes up first.
    const json = {
      name: token.name,
      symbol: token.symbol,
      description: token.description,
      image: imageUri,
      properties: {
        files: [{ uri: imageUri, type: "image/png" }],
        category: "image",
      },
    };

    const jsonCid = await uploadOnce(
      jwt,
      `${PIN_PREFIX}${token.key.toLowerCase()}.json`,
      JSON.stringify(json, null, 2),
      "application/json",
      force,
      gatewayUrl
    );
    const uri = gatewayUrl(jsonCid);

    if (uri.length > 200) {
      throw new Error(
        `uri is ${uri.length} chars; Metaplex caps it at 200: ${uri}`
      );
    }

    console.log("  verifying both URIs resolve through the gateway...");
    const fetched = await assertResolves(uri, `${token.key} metadata JSON`);
    const parsed = (await fetched.json()) as { image?: string };
    if (parsed.image !== imageUri) {
      throw new Error(
        `${token.key}: served JSON points at ${parsed.image}, expected ${imageUri}`
      );
    }
    await assertResolves(imageUri, `${token.key} image`);
    console.log(`  ok — uri ${uri}\n`);

    devnet.mints[token.key].metadata = {
      ...(devnet.mints[token.key].metadata ?? {}),
      name: token.name,
      symbol: token.symbol,
      imageCid,
      imageUri,
      jsonCid,
      uri,
    };
  }

  devnet.metadataUploadedAt = new Date().toISOString();
  fs.writeFileSync(DEVNET_PATH, JSON.stringify(devnet, null, 2) + "\n");
  console.log(`Written to ${DEVNET_PATH}`);
  console.log("Next: npx ts-node scripts/create-token-metadata.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
