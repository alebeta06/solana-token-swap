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
 *   502 → no confirmó     rojo    — lo único que de verdad deja algo a medias
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
    return {
      tone: "error",
      title: "The faucet is not available here",
      message:
        "This deployment has no faucet key configured, so nobody can request tokens. " +
        "That is a server-side problem, not something you can fix.",
    };
  }

  if (status === 502) {
    return {
      tone: "error",
      title: "The mint was not confirmed",
      // 🇪🇸 NOTA: con firma, enlazarla es lo importante: es un caso donde puede
      // haberse mandado algo y hay que poder mirarlo antes de reintentar.
      message: signature
        ? "The transaction was sent but did not land as expected. Check it on the explorer " +
          "before asking again."
        : "The faucet could not complete the mint. Try again in a moment.",
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
