/**
 * How long each kind of banner stays on screen.
 *
 * 🔴 LA REGLA: los éxitos se van, los errores se quedan.
 *
 * Un "Confirmed" que no caduca deja de querer decir nada: a los pocos minutos
 * nadie sabe si ese banner es de la operación que acaba de hacer o de una
 * anterior, y el enlace al explorer manda a una firma vieja. Ocho segundos dan
 * para leerlo y pulsar el enlace.
 *
 * Un error, en cambio, es la ÚNICA explicación de lo que pasó. Si se borra
 * solo, quien estuviera mirando su wallet en ese momento vuelve a una pantalla
 * limpia sin saber por qué no hay tokens. Se queda hasta que el usuario hace
 * otra cosa — y ahí lo limpia el arranque de la operación siguiente, no un
 * temporizador.
 *
 * 🇪🇸 NOTA: el `notice` del faucet (el 429 "ya tienes tokens", el 503 "está
 * vacío") cuenta como los errores y NO se va solo. No son fallos, pero son
 * exactamente igual de explicativos: son la respuesta a "¿por qué no ha pasado
 * nada?".
 */

export type BannerKind = "success" | "notice" | "error";

/** Long enough to read it and click through to the explorer. */
export const SUCCESS_DISMISS_MS = 8_000;

/** Milliseconds until this banner should disappear, or null if it should not. */
export function dismissDelay(kind: BannerKind | null): number | null {
  return kind === "success" ? SUCCESS_DISMISS_MS : null;
}

/**
 * The slice of the timer API this needs, so tests can drive it.
 *
 * 🇪🇸 NOTA: inyectable a propósito. Así el comportamiento —que el éxito se
 * oculta y el error no— se prueba sin DOM y sin esperar ocho segundos.
 */
export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: never): void;
}

/**
 * Arms the dismissal for a banner. Returns the function that cancels it, which
 * is what an effect has to give back for cleanup.
 */
export function startDismissTimer(
  kind: BannerKind | null,
  dismiss: () => void,
  timers: Timers = globalThis as unknown as Timers
): () => void {
  const delay = dismissDelay(kind);
  if (delay === null) return () => {};

  const id = timers.setTimeout(dismiss, delay);
  return () => timers.clearTimeout(id as never);
}
