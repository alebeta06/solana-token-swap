/**
 * Waiting for a transaction to land, WITHOUT a WebSocket subscription.
 *
 * 🔴 Por qué existe este módulo. `connection.confirmTransaction` de web3.js
 * confirma suscribiéndose con `signatureSubscribe`, y **no todos los RPC lo
 * exponen**: el de Alchemy de este proyecto responde
 * `-32601 Method 'signatureSubscribe' not found`. La librería reintenta, agota
 * el plazo y lanza `TransactionExpiredBlockheightExceededError` — pero la
 * transacción YA se había ejecutado. En el faucet eso se veía como tokens que
 * llegaban a la wallet y un 502 veintisiete segundos después.
 *
 * `getSignatureStatuses` es HTTP y lo sirve cualquier proveedor. Este módulo lo
 * sondea, y lo usan **los dos** caminos que mandan transacciones: el faucet en
 * el servidor y el swap en el navegador. Una sola implementación, una sola
 * decisión sobre el nivel de compromiso.
 *
 * 🔴 DECISIÓN: se confirma a `confirmed`, no a `processed`.
 *
 * `processed` respondería antes, pero devuelve estado que la cadena todavía
 * puede descartar: un bloque no confirmado puede quedar fuera de la cadena
 * final, y entonces habríamos dado por buena una transacción que no ocurrió y
 * leído saldos fantasma. Lo que se gana con `processed` es acotar el doble
 * clic — y eso ya lo acota la UI, que deshabilita el botón mientras la petición
 * está en vuelo. El peor caso de esperar de más es acuñar dos veces unos tokens
 * de prueba que no valen nada; el peor caso de `processed` es enseñar un estado
 * que nunca existió. No es un olvido: es el cambio que NO se hace.
 */

/** What happened to a transaction we sent. */
export type Landing =
  | { status: "confirmed"; slot: number }
  | { status: "failed"; detail: string }
  | { status: "unconfirmed" };

interface SignatureStatusLike {
  slot: number;
  err: unknown;
  confirmationStatus?: string | null;
}

/**
 * The slice of `Connection` this needs.
 *
 * 🇪🇸 NOTA: estructural a propósito. Un `Connection` real encaja, y un doble de
 * test también — así el sondeo se prueba sin red y sin mockear la librería.
 */
export interface SignatureReader {
  getSignatureStatuses(signatures: string[]): Promise<{
    value: (SignatureStatusLike | null)[];
  }>;
  getBlockHeight(commitment?: "processed" | "confirmed" | "finalized"): Promise<number>;
}

export interface AwaitLandingOptions {
  timeoutMs?: number;
  pollMs?: number;
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 400;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function awaitLanding(
  connection: SignatureReader,
  signature: string,
  lastValidBlockHeight: number,
  options: AwaitLandingOptions = {}
): Promise<Landing> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;

  const deadline = now() + timeoutMs;

  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status) {
      if (status.err) {
        return { status: "failed", detail: JSON.stringify(status.err) };
      }
      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        return { status: "confirmed", slot: status.slot };
      }
      // Visto pero solo `processed`: todavía no. Ver la decisión de arriba.
    }

    if (now() >= deadline) return { status: "unconfirmed" };

    // 🇪🇸 NOTA: si la altura de bloque pasa de `lastValidBlockHeight` sin que la
    // firma haya aparecido, la transacción ya no puede incluirse. Eso sí es un
    // fallo definitivo, y esperar más solo alarga el error.
    if (!status && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      return { status: "failed", detail: "blockhash expired before the transaction landed" };
    }

    await sleep(pollMs);
  }
}

/**
 * A transaction that was sent but could not be confirmed in time.
 *
 * 🔴 No es un fallo. Puede haber entrado, así que quien lo muestre NO debe
 * decir que no pasó nada: mandaría a reintentar a alguien que ya lo consiguió.
 */
export class TransactionUnconfirmedError extends Error {
  constructor(readonly signature: string) {
    super(
      "The transaction was sent but could not be confirmed in time. It may still land — " +
        "check the signature on the explorer before trying again."
    );
    this.name = "TransactionUnconfirmedError";
  }
}
