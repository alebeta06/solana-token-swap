/**
 * POST /api/faucet — mints the demo tokens to a wallet that has none.
 *
 * 🔴 Este es el ÚNICO sitio del proyecto donde vive una clave privada en un
 * servidor. Reglas que no se negocian:
 *
 *   - La variable se llama `FAUCET_KEYPAIR`, SIN el prefijo `NEXT_PUBLIC_`.
 *     Con ese prefijo Next la sustituye literalmente dentro del JavaScript que
 *     descarga el navegador, y la clave quedaría publicada en cuanto alguien
 *     abriera la web. Next solo expone al cliente lo que lleva el prefijo, así
 *     que lo que protege la clave es el NOMBRE de la variable.
 *   - Solo se lee desde aquí. Ningún componente, ningún hook, ningún módulo que
 *     pueda acabar importado desde un `"use client"`.
 *   - Se lee dentro del handler, no al importar el módulo: así el proceso de
 *     build nunca la tiene en memoria.
 *
 * La política (a quién servir y cuándo apagarse) está en `@/lib/faucet`, que no
 * toca la red y sí tiene tests. Aquí solo queda la conversación con la cadena.
 */
import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  SolanaJSONRPCError,
  Transaction,
} from "@solana/web3.js";
import {
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddress,
  unpackAccount,
} from "@solana/spl-token";
import { manifest } from "@/lib/manifest";
import { rpcEndpoint } from "@/lib/rpc";
import { awaitLanding } from "@/lib/confirm";
import {
  FaucetInputError,
  decideDrop,
  dropAmounts,
  parseRecipient,
  type Drop,
} from "@/lib/faucet";

// 🇪🇸 NOTA: explícitos los dos. En el runtime Edge no existe el módulo de
// crypto que usan estas librerías, y una ruta que Next decidiera cachear
// serviría la firma de otro visitante.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Room for confirmation + verification. Vercel caps this per plan; see the README. */
export const maxDuration = 30;

/** How long to wait for the transaction to confirm, and then for a read of it. */
const CONFIRM_TIMEOUT_MS = 10_000;
const VERIFY_TIMEOUT_MS = 5_000;
const POLL_MS = 400;

/** JSON-RPC code for "this node has not reached the slot you asked for". */
const SLOT_NOT_REACHED = -32016;

type ConfigFault = "missing" | "malformed" | "mismatch";

/**
 * A faucet that cannot sign. Carries WHICH of the three faults it is, because
 * each one needs a different thing from whoever deployed this.
 */
class FaucetConfigError extends Error {
  constructor(
    readonly reason: ConfigFault,
    message: string
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads the faucet keypair, and refuses to sign with a key we did not expect. */
function loadFaucetKeypair(): Keypair {
  const raw = process.env.FAUCET_KEYPAIR;
  if (!raw) {
    throw new FaucetConfigError(
      "missing",
      "No faucet key is configured on this deployment: the FAUCET_KEYPAIR environment " +
        "variable is not set. It holds the JSON array of 64 numbers that solana-keygen " +
        "writes. It must NOT be named NEXT_PUBLIC_FAUCET_KEYPAIR: that would ship the " +
        "key to the browser."
    );
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  } catch {
    // 🇪🇸 NOTA: el error original NO se propaga. Un JSON.parse fallido incluye
    // un trozo del texto que intentó parsear — es decir, de la clave.
    throw new FaucetConfigError(
      "malformed",
      "FAUCET_KEYPAIR is set but is not the JSON array of 64 numbers that solana-keygen " +
        "writes. Check that the whole array was pasted, on one line and without quotes."
    );
  }

  const expected = manifest.faucet?.pubkey;
  if (expected && keypair.publicKey.toBase58() !== expected) {
    throw new FaucetConfigError(
      "mismatch",
      `FAUCET_KEYPAIR holds ${keypair.publicKey.toBase58()}, but the manifest records the ` +
        `faucet as ${expected}. The mint authority was handed to the latter, so this key ` +
        `could not mint anyway.`
    );
  }
  return keypair;
}

/**
 * Current balance of `ata`, or 0 when the account does not exist yet.
 *
 * 🔴 Solo vale para la lectura PREVIA. Una ATA que no existe es, legítimamente,
 * saldo cero. Después de acuñar significa lo contrario —la cuenta acaba de
 * crearse y el nodo que responde no la ve todavía— y por eso la comprobación
 * posterior NO usa esta función. Ver `balancesAtSlot`.
 */
async function balanceOf(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, ata)).amount;
  } catch (err) {
    if (
      err instanceof TokenAccountNotFoundError ||
      err instanceof TokenInvalidAccountOwnerError
    ) {
      return 0n;
    }
    throw err;
  }
}

/** True when the RPC refused because the node it hit is behind `minContextSlot`. */
function isBehind(err: unknown): boolean {
  return err instanceof SolanaJSONRPCError && err.code === SLOT_NOT_REACHED;
}

/**
 * Balances read from a node that has AT LEAST reached `minContextSlot`.
 *
 * 🔴 La segunda carrera del paso 4 (la primera era la confirmación por
 * WebSocket — ver `awaitLanding`). La confirmación llega de un nodo concreto,
 * pero la lectura siguiente es una petición HTTP nueva, y el endpoint público
 * de devnet es un balanceador:
 * medido, sus backends van hasta 3 slots (~1,2 s) desfasados entre sí. Si la
 * lectura caía en un nodo atrasado, la ATA recién creada "no existía", el saldo
 * salía 0 y el faucet devolvía 502 después de haber acuñado de verdad.
 *
 * `minContextSlot` es el mecanismo exacto para esto: el RPC prefiere fallar con
 * -32016 antes que contestar con datos anteriores a ese slot. Un nodo atrasado
 * deja de ser un cero silencioso y pasa a ser un "todavía no" que se reintenta.
 */
async function balancesAtSlot(
  connection: Connection,
  atas: PublicKey[],
  minContextSlot: number
): Promise<(bigint | null)[]> {
  const infos = await connection.getMultipleAccountsInfo(atas, {
    commitment: "confirmed",
    minContextSlot,
  });
  return infos.map((info, index) => (info ? unpackAccount(atas[index], info).amount : null));
}

export async function POST(request: Request) {
  // ── 1. Entrada: se valida antes de tocar la cadena ────────────────────────
  let recipient: PublicKey;
  try {
    const body = await request.json().catch(() => {
      throw new FaucetInputError("Expected a JSON body of the form { address }");
    });
    recipient = parseRecipient((body as { address?: unknown })?.address);
  } catch (err) {
    if (err instanceof FaucetInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let faucet: Keypair;
  try {
    faucet = loadFaucetKeypair();
  } catch (err) {
    // 🇪🇸 NOTA: este mensaje SÍ sale al cliente. No es un secreto —nombra una
    // variable de entorno, nada más— y quien despliega necesita leerlo donde
    // está mirando. Dejarlo solo en el log obligaba a abrir los Runtime Logs
    // de Vercel para enterarse de que faltaba una variable del panel.
    const fault = err instanceof FaucetConfigError ? err : null;
    console.error("[faucet] configuration:", err);
    return NextResponse.json(
      {
        error: fault?.message ?? "The faucet is not configured on this deployment.",
        reason: fault?.reason ?? "unknown",
      },
      { status: 500 }
    );
  }

  const connection = new Connection(rpcEndpoint(), "confirmed");
  const drops = dropAmounts(manifest);

  try {
    // ── 2. Estado: saldo del faucet y lo que ya tiene el destinatario ───────
    const atas = await Promise.all(
      drops.map((drop) =>
        getAssociatedTokenAddress(new PublicKey(drop.mint), recipient)
      )
    );
    const [faucetLamports, ...held] = await Promise.all([
      connection.getBalance(faucet.publicKey),
      ...atas.map((ata) => balanceOf(connection, ata)),
    ]);

    const decision = decideDrop({ faucetLamports, held: held as bigint[] });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    // ── 3. Una sola transacción: las ATAs que falten, y los dos mints ───────
    const transaction = new Transaction();
    for (const [index, drop] of drops.entries()) {
      const mint = new PublicKey(drop.mint);
      // 🇪🇸 NOTA: la ATA se crea desde aquí, explícitamente. `init-if-needed`
      // es el footgun que este proyecto no usa en ningún sitio.
      if (!(await connection.getAccountInfo(atas[index]))) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            faucet.publicKey, // paga la renta — el SOL que hay que proteger
            atas[index],
            recipient,
            mint
          )
        );
      }
      transaction.add(
        createMintToInstruction(mint, atas[index], faucet.publicKey, drop.base)
      );
    }

    // 🇪🇸 NOTA: send + confirm por separado, en vez de
    // `sendAndConfirmTransaction`, por una sola razón: así tenemos el SLOT de
    // la confirmación, que es lo que hace verificable la lectura siguiente.
    const latest = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = latest.blockhash;
    transaction.feePayer = faucet.publicKey;
    transaction.sign(faucet);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: "confirmed",
    });
    const landing = await awaitLanding(connection, signature, latest.lastValidBlockHeight, {
      timeoutMs: CONFIRM_TIMEOUT_MS,
      pollMs: POLL_MS,
    });

    if (landing.status === "failed") {
      console.error(`[faucet] ${signature} failed on chain: ${landing.detail}`);
      return NextResponse.json(
        {
          error: "The mint did not go through. No tokens were sent, so you can ask again.",
          signature,
        },
        { status: 502 }
      );
    }
    if (landing.status === "unconfirmed") {
      // 🔴 Este caso NO es "el mint falló". La transacción puede estar todavía
      // en vuelo, y decirle a alguien que no se acuñó nada cuando quizá sí es
      // el error que este endpoint ya cometió una vez.
      console.error(`[faucet] ${signature} not confirmed within ${CONFIRM_TIMEOUT_MS}ms`);
      return NextResponse.json(
        {
          error:
            "The mint was sent but could not be confirmed in time. It may still land — " +
            "check the signature before asking again.",
          signature,
        },
        { status: 504 }
      );
    }
    const minContextSlot = landing.slot;

    // ── 4. Comprobar el resultado, no darlo por hecho ───────────────────────
    // 🇪🇸 NOTA: que la llamada vuelva sin excepción NO es que los tokens estén
    // ahí. Se releen los saldos y se exige el delta exacto. Lo que cambió tras
    // el bug del paso 4 es de DÓNDE se leen: de un nodo que haya alcanzado el
    // slot de la confirmación, reintentando mientras no lo haya.
    const deadline = Date.now() + VERIFY_TIMEOUT_MS;
    let after: (bigint | null)[] = atas.map(() => null);
    let attempts = 0;
    let settled = false;

    for (;;) {
      attempts++;
      try {
        after = await balancesAtSlot(connection, atas, minContextSlot);
        settled = drops.every(
          (drop: Drop, index: number) =>
            after[index] !== null && after[index]! - held[index] === drop.base
        );
        if (settled) break;
      } catch (err) {
        // Un nodo por detrás del slot no es un fallo: es "todavía no".
        if (!isBehind(err)) throw err;
      }
      if (Date.now() >= deadline) break;
      await sleep(POLL_MS);
    }

    if (!settled) {
      console.error(
        `[faucet] ${signature} confirmed at slot ${minContextSlot} but balances did not ` +
          `move as promised after ${attempts} reads`,
        drops.map((drop, index) => ({
          symbol: drop.symbol,
          expected: drop.base.toString(),
          actual: after[index] === null ? "account not visible" : (after[index]! - held[index]).toString(),
        }))
      );
      return NextResponse.json(
        {
          error:
            "The mint transaction was sent but the balances did not change as expected. " +
            "Check the signature before retrying.",
          signature,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      signature,
      recipient: recipient.toBase58(),
      // 🇪🇸 NOTA: el slot viaja al cliente para que el refresco de saldos del
      // navegador pueda exigir el mismo mínimo. Sin él, el frontend repetiría
      // la carrera que este handler acaba de ganar.
      slot: minContextSlot,
      amounts: drops.map((drop, index) => ({
        symbol: drop.symbol,
        mint: drop.mint,
        decimals: drop.decimals,
        baseUnits: drop.base.toString(),
        balance: after[index]!.toString(),
      })),
    });
  } catch (err) {
    // 🇪🇸 NOTA: el error crudo del RPC se queda en el log del servidor. Puede
    // llevar la pubkey del faucet, los logs del programa y detalle interno que
    // no le sirve de nada a quien pidió tokens.
    console.error("[faucet] mint failed:", err);
    return NextResponse.json(
      { error: "The faucet could not mint right now. Try again in a moment." },
      { status: 502 }
    );
  }
}
