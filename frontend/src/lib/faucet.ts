/**
 * Faucet policy: everything the faucet decides BEFORE it signs anything, kept
 * out of the route handler so it can be tested without a network.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 Qué se está protegiendo, y con qué
 *
 * El activo NO son los tokens. DEMO6 y DEMO9 los acuña este faucet a voluntad
 * y no valen nada. **El activo es el SOL del faucet**: cada ATA nueva cuesta
 * ~0,002 SOL de rent que paga él, y con 0,5 SOL eso son ~250 direcciones.
 * Regalar tokens es gratis; crearle a alguien una cuenta donde guardarlos, no.
 *
 * Hay DOS límites, y hacen cosas distintas:
 *
 *   1. LÍMITE DE SALDO (`alreadyHolds`) — 429.
 *      Si la dirección ya tiene saldo de DEMO6 o DEMO9, no se le acuña más.
 *      Frena la REPETICIÓN HONESTA: el clic repetido por impaciencia, que es
 *      el caso real y el que más SOL consume sin querer.
 *
 *   2. UMBRAL DE SOL (`MIN_FAUCET_LAMPORTS`) — 503.
 *      Por debajo de 0,05 SOL el faucet se apaga solo. Frena el DRENAJE: deja
 *      de operar mientras todavía le queda saldo, en vez de morir a mitad de
 *      una transacción y dejar ATAs a medias.
 *
 * 🔴 Ninguno de los dos frena a un atacante con direcciones nuevas. Un bucle de
 * pubkeys distintas pasa los dos límites, porque cada una es legítimamente un
 * visitante que nunca ha pedido nada. **Eso es una decisión, no un descuido:**
 * lo que acota ese caso es el saldo del faucet — 0,5 SOL, elegidos como tope de
 * daño en el paso 2 de la fase. El peor caso es quedarse sin faucet hasta que
 * alguien lo recargue; no hay nada más que perder.
 *
 * 🇪🇸 NOTA: por qué el límite mira el SALDO y no si la ATA existe. Crear la ATA
 * de otro es algo que puede hacer CUALQUIERA: la instrucción no exige la firma
 * del dueño, solo que alguien pague la renta. Con "¿tiene ATA?" como criterio,
 * un atacante creaba las ATAs de las direcciones que quisiera y las dejaba
 * excluidas del faucet para siempre — el límite se convertía en un vector de
 * bloqueo. El saldo no tiene ese problema: para bloquear a alguien habría que
 * MANDARLE tokens, y quien tiene tokens es justo a quien el faucet no necesita
 * servir.
 *
 * 🇪🇸 NOTA: tampoco hay límite por IP ni contador en memoria. En Vercel cada
 * instancia tiene su propia memoria y no se hablan entre sí, así que un
 * contador local solo limita a quien tenga la mala suerte de caer dos veces en
 * la misma instancia; y una IP se rota. Daría sensación de protección sin
 * darla. Lo que de verdad acota el gasto es el umbral de SOL.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { PublicKey } from "@solana/web3.js";
import type { DevnetManifest } from "./manifest";
import { pow10 } from "./units";

export class FaucetInputError extends Error {}

/** Below this the faucet refuses to operate. ~25 ATAs of headroom. */
export const MIN_FAUCET_LAMPORTS = 50_000_000; // 0.05 SOL

/** What one request hands out, in display units. ~5 swaps at a price of 2.0. */
export const DROP_SIZES: Record<string, number> = { DEMO9: 10, DEMO6: 20 };

export interface Drop {
  symbol: string;
  mint: string;
  decimals: number;
  /** The amount in base units, scaled by the decimals the manifest records. */
  base: bigint;
}

export type Decision =
  | { ok: true }
  | { ok: false; status: 429 | 503; error: string };

/**
 * Validates what the caller sent us into a pubkey we are willing to mint to.
 *
 * 🇪🇸 NOTA: esto corre ANTES de tocar la cadena. Una pubkey inválida es un 400
 * inmediato, no un error del RPC: no gastamos una llamada de red en algo que ya
 * sabemos que está mal, y el mensaje que ve el usuario dice qué pasa.
 */
export function parseRecipient(input: unknown): PublicKey {
  if (typeof input !== "string") {
    throw new FaucetInputError("Expected an address as a string");
  }
  const text = input.trim();
  if (text === "") throw new FaucetInputError("Address is required");

  let key: PublicKey;
  try {
    key = new PublicKey(text);
  } catch {
    throw new FaucetInputError(`Not a valid Solana address: ${text}`);
  }

  // 🇪🇸 NOTA: una PDA es una dirección válida que NADIE puede firmar. Acuñarle
  // tokens sería quemar la renta de una ATA que nunca podrá moverlos. Las
  // wallets están siempre sobre la curva ed25519.
  if (!PublicKey.isOnCurve(key.toBytes())) {
    throw new FaucetInputError(
      `${text} is a program address, not a wallet: nothing could ever sign for it`
    );
  }
  return key;
}

/**
 * What to hand out, read from the manifest.
 *
 * 🇪🇸 NOTA: los decimales salen del manifest, nunca de una constante local.
 * DEMO6 y DEMO9 se llaman así por sus decimales, pero es el manifest —y detrás
 * el propio mint— quien lo dice.
 */
export function dropAmounts(source: DevnetManifest): Drop[] {
  return Object.entries(DROP_SIZES).map(([symbol, display]) => {
    const entry = source.mints[symbol];
    if (!entry) {
      throw new Error(`Manifest has no mint called ${symbol}`);
    }
    return {
      symbol,
      mint: entry.address,
      decimals: entry.decimals,
      base: BigInt(display) * pow10(entry.decimals),
    };
  });
}

/**
 * The two limits, in the order that matters.
 *
 * 🇪🇸 NOTA: el umbral de SOL se comprueba PRIMERO. Si el faucet no tiene
 * fondos, esa es la razón real por la que no va a acuñar, y decir "ya has
 * recibido" a alguien que nunca recibió nada manda a diagnosticar el problema
 * equivocado.
 */
export function decideDrop(state: {
  faucetLamports: number;
  /** Balance of each drop mint already held by the recipient, in base units. */
  held: bigint[];
}): Decision {
  if (state.faucetLamports < MIN_FAUCET_LAMPORTS) {
    return {
      ok: false,
      status: 503,
      error:
        "The faucet is out of funds: its SOL balance is below the minimum it needs " +
        "to pay for account rent and fees. It will work again once it is topped up.",
    };
  }
  if (state.held.some((amount) => amount > 0n)) {
    return {
      ok: false,
      status: 429,
      error:
        "This address already holds faucet tokens. The faucet only serves wallets " +
        "with an empty balance of both demo tokens.",
    };
  }
  return { ok: true };
}
