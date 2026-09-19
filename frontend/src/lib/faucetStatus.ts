/**
 * What each faucet response MEANS to the visitor.
 *
 * 🇪🇸 NOTA: el handler del paso 3 devuelve seis códigos, y tres de ellos NO son
 * un fallo de quien pulsa el botón. Traducirlos todos a "error" convierte "ya
 * tienes tokens" en "esto está roto", que es la lectura contraria a la
 * verdadera. Por eso la traducción vive aquí, sin red y con tests, y el
 * componente solo pinta lo que este módulo decide.
 *
 *   200 → éxito           verde   — acaba de pasar algo on-chain
 *   400 → falta la wallet ámbar   — le falta un paso al usuario
 *   429 → ya tiene saldo  ámbar   — 🔴 NO es un error: ya tiene lo que pedía
 *   503 → faucet vacío    ámbar   — no es culpa suya, y hay que decírselo
 *   500 → mal configurado rojo    — el despliegue está roto
 *   502 → el mint falló   rojo    — no se acuñó nada, se puede reintentar
 *   504 → sin confirmar   rojo    — 🔴 puede haberse acuñado: NO decir que falló
 *
 * 🇪🇸 NOTA: el verde se reserva a "acaba de confirmarse una transacción", que
 * es lo que significa en `TxResult`. El 429 es un estado bueno, pero no acaba
 * de pasar nada en la cadena; en verde parecería que sí ha acuñado.
 */
import { toDisplay } from "./units";

export type FaucetTone = "success" | "notice" | "error";

export interface FaucetOutcome {
  tone: FaucetTone;
  title: string;
  message: string;
  /** Present when there is a transaction worth linking to the explorer. */
  signature?: string;
  /**
   * The slot the mint confirmed at.
   *
   * 🇪🇸 NOTA: viaja hasta el hook de saldos para que su lectura exija ese
   * mínimo. Sin él, el navegador repite la carrera contra el RPC que el
   * handler acaba de ganar, y el panel enseña 0 justo después de recibir.
   */
  slot?: number;
}

interface AmountPayload {
  symbol?: unknown;
  decimals?: unknown;
  baseUnits?: unknown;
}

/** "10 DEMO9 and 20 DEMO6", or null when the payload is not what we expect. */
function describeAmounts(payload: unknown): string | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const parts: string[] = [];
  for (const item of payload as AmountPayload[]) {
    if (
      typeof item?.symbol !== "string" ||
      typeof item?.decimals !== "number" ||
      typeof item?.baseUnits !== "string"
    ) {
      return null;
    }
    try {
      parts.push(`${toDisplay(BigInt(item.baseUnits), item.decimals)} ${item.symbol}`);
    } catch {
      return null;
    }
  }
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function readString(body: unknown, key: string): string | undefined {
  const value = (body as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(body: unknown, key: string): number | undefined {
  const value = (body as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Each configuration fault needs a different thing from whoever deployed this. */
const CONFIG_TITLES: Record<string, string> = {
  missing: "No faucet key configured",
  malformed: "The faucet key is malformed",
  mismatch: "The faucet key does not match this deployment",
};

export function describeFaucetResponse(status: number, body: unknown): FaucetOutcome {
  const signature = readString(body, "signature");

  if (status === 200) {
    const amounts = describeAmounts((body as { amounts?: unknown })?.amounts);
    return {
      tone: "success",
      title: "Tokens sent",
      message: amounts
        ? `${amounts} are now in your wallet. You can swap them below.`
        : "The demo tokens are now in your wallet. You can swap them below.",
      signature,
      slot: readNumber(body, "slot"),
    };
  }

  if (status === 429) {
    return {
      tone: "notice",
      title: "You already have tokens",
      // 🔴 En positivo y sin la palabra "error": esta wallet ya tiene lo que
      // venía a pedir. El faucet solo sirve a quien tiene los dos saldos a cero.
      message:
        "Your wallet already holds demo tokens, so the faucet did not mint more. " +
        "You can swap what you have right now.",
    };
  }

  if (status === 503) {
    return {
      tone: "notice",
      title: "The faucet is empty",
      message:
        "It ran out of the SOL it needs to pay for account rent, so it stopped before " +
        "leaving anything half done. Nothing you did — try again once it is topped up.",
    };
  }

  if (status === 400) {
    return {
      tone: "notice",
      title: "Connect your wallet first",
      message:
        readString(body, "error") ??
        "The faucet needs the address it should mint to, and no wallet is connected.",
    };
  }

  if (status === 500) {
    // 🇪🇸 NOTA: el motivo lo manda el servidor y se muestra tal cual. No es un
    // secreto —nombra una variable de entorno— y es lo único accionable que hay
    // en toda la respuesta. Quien despliega lo lee donde está mirando, en vez
    // de tener que abrir los Runtime Logs de Vercel.
    const reason = readString(body, "reason");
    return {
      tone: "error",
      title: (reason && CONFIG_TITLES[reason]) ?? "The faucet is not available here",
      message:
        readString(body, "error") ??
        "This deployment has no faucet key configured, so nobody can request tokens. " +
          "That is a server-side problem, not something you can fix.",
    };
  }

  if (status === 502) {
    return {
      tone: "error",
      title: "The mint did not go through",
      message:
        readString(body, "error") ??
        "The faucet could not complete the mint. Try again in a moment.",
      signature,
    };
  }

  if (status === 504) {
    // 🔴 La distinción que costó un bug: "no pude confirmarlo" NO es "falló".
    // Los tokens pueden estar ya en la wallet. Decir que no se acuñó nada
    // manda a pedir otra vez a quien quizá ya ha recibido — y entonces se
    // encuentra un 429 que le contradice.
    return {
      tone: "error",
      title: "Could not confirm the mint",
      message:
        readString(body, "error") ??
        "The mint was sent but could not be confirmed in time. It may still land — check " +
          "the signature before asking again.",
      signature,
    };
  }

  return {
    tone: "error",
    title: "Unexpected response",
    message:
      readString(body, "error") ??
      `The faucet answered with status ${status}, which this page does not know how to read.`,
  };
}

/** The request never got an answer: no status to read, so it gets its own text. */
export function describeFaucetFailure(): FaucetOutcome {
  return {
    tone: "error",
    title: "Could not reach the faucet",
    message: "The request did not get through. Check your connection and try again.",
  };
}
