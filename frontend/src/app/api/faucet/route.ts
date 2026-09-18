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
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { manifest } from "@/lib/manifest";
import { rpcEndpoint } from "@/lib/rpc";
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

/** Reads the faucet keypair, and refuses to sign with a key we did not expect. */
function loadFaucetKeypair(): Keypair {
  const raw = process.env.FAUCET_KEYPAIR;
  if (!raw) {
    throw new Error(
      "FAUCET_KEYPAIR is not set. Put the contents of the faucet keypair file " +
        "(the JSON array of 64 numbers) in frontend/.env.local. Never name it " +
        "NEXT_PUBLIC_FAUCET_KEYPAIR: that would ship it to the browser."
    );
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  } catch {
    // 🇪🇸 NOTA: el error original NO se propaga. Un JSON.parse fallido incluye
    // un trozo del texto que intentó parsear — es decir, de la clave.
    throw new Error(
      "FAUCET_KEYPAIR is not a JSON array of 64 numbers, as written by solana-keygen."
    );
  }

  const expected = manifest.faucet?.pubkey;
  if (expected && keypair.publicKey.toBase58() !== expected) {
    throw new Error(
      `FAUCET_KEYPAIR holds ${keypair.publicKey.toBase58()}, but the manifest records the ` +
        `faucet as ${expected}. The mint authority was handed to the latter, so this key ` +
        `could not mint anyway.`
    );
  }
  return keypair;
}

/** Current balance of `ata`, or 0 when the account does not exist yet. */
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
    // Server misconfiguration: the visitor can do nothing about it, and the
    // detail stays in the server log.
    console.error("[faucet] configuration:", err);
    return NextResponse.json(
      { error: "The faucet is not configured on this deployment." },
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

    const signature = await sendAndConfirmTransaction(connection, transaction, [faucet], {
      commitment: "confirmed",
    });

    // ── 4. Comprobar el resultado, no darlo por hecho ───────────────────────
    // 🇪🇸 NOTA: que la llamada vuelva sin excepción NO es que los tokens estén
    // ahí. Se releen los saldos y se exige el delta exacto; si no cuadra, esto
    // no es un 200. Ya nos pasó en el paso 1 de esta fase con un curl que no
    // miraba su propio status.
    const after = await Promise.all(atas.map((ata) => balanceOf(connection, ata)));
    const shortfall = drops.filter(
      (drop: Drop, index: number) => after[index] - held[index] !== drop.base
    );
    if (shortfall.length > 0) {
      console.error(
        `[faucet] ${signature} confirmed but balances did not move as promised`,
        drops.map((drop, index) => ({
          symbol: drop.symbol,
          expected: drop.base.toString(),
          actual: (after[index] - held[index]).toString(),
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
      amounts: drops.map((drop, index) => ({
        symbol: drop.symbol,
        mint: drop.mint,
        decimals: drop.decimals,
        baseUnits: drop.base.toString(),
        balance: after[index].toString(),
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
