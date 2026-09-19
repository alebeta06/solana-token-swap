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

/** True when the node that simulated the transaction did not know the blockhash. */
export function isBlockhashNotFound(err: unknown): boolean {
  const message = (err as { message?: unknown })?.message;
  return typeof message === "string" && /blockhash not found/i.test(message);
}

/**
 * The node that simulated the transaction did not recognise its blockhash.
 *
 * 🔴 No es culpa de quien pulsó el botón, y **no se envió nada**: el fallo
 * ocurre en la simulación previa, antes de que la transacción exista. Quien lo
 * muestre tiene que decir las dos cosas, o el visitante se queda sin saber si
 * le han cobrado.
 */
export class BlockhashRejectedError extends Error {
  constructor() {
    super(
      "The network did not accept the transaction's blockhash. Nothing was sent and " +
        "nothing was charged — try again."
    );
    this.name = "BlockhashRejectedError";
  }
}

export interface LatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface BlockhashSender {
  getLatestBlockhash(commitment: "confirmed" | "finalized"): Promise<LatestBlockhash>;
  sendRawTransaction(raw: Uint8Array | Buffer, options?: unknown): Promise<string>;
}

/**
 * Asks for a blockhash, hands it to `sign`, and sends what comes back.
 *
 * 🔴 Por qué `finalized` y no `confirmed`. El blockhash lo pide UNA petición
 * HTTP y la simulación la hace OTRA, y con un proveedor multinodo no tienen por
 * qué caer en el mismo backend: si el segundo va por detrás, su banco no conoce
 * ese blockhash y el preflight falla con `Blockhash not found` — de forma
 * intermitente, que es la peor manera de fallar.
 *
 * Un blockhash `finalized` tiene ya ~31 slots (~12 s) de antigüedad, así que un
 * backend tendría que ir 31 slots por detrás para no conocerlo, cuando lo
 * medido en este proyecto son 3. **El coste es real y acotado:** la ventana de
 * validez pasa de ~146 a ~115 bloques, de ~59 s a ~46 s para firmar y entrar.
 * En el swap hay una persona leyendo el popup de la wallet y 46 s le sobran;
 * en el faucet no hay humano y no se nota.
 *
 * `attempts` es 1 donde reintentar cuesta una segunda firma del usuario (el
 * swap: cambiar el blockhash invalida la firma que ya dio) y 2 donde el
 * reintento es silencioso porque firma una clave nuestra (el faucet).
 */
export async function sendWithFreshBlockhash(
  connection: BlockhashSender,
  sign: (latest: LatestBlockhash) => Promise<Uint8Array | Buffer>,
  options: { attempts?: number } = {}
): Promise<{ signature: string; lastValidBlockHeight: number }> {
  const attempts = options.attempts ?? 1;

  for (let attempt = 1; ; attempt++) {
    const latest = await connection.getLatestBlockhash("finalized");
    const raw = await sign(latest);
    try {
      const signature = await connection.sendRawTransaction(raw, {
        preflightCommitment: "confirmed",
      });
      return { signature, lastValidBlockHeight: latest.lastValidBlockHeight };
    } catch (err) {
      // Solo este error se reintenta. Cualquier otro —slippage, liquidez, saldo—
      // volvería a fallar igual y reintentarlo solo retrasa el mensaje bueno.
      if (!isBlockhashNotFound(err) || attempt >= attempts) {
        if (isBlockhashNotFound(err)) throw new BlockhashRejectedError();
        throw err;
      }
    }
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
