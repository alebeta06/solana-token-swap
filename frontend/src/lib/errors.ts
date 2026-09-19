/**
 * Turns whatever the RPC or Anchor throws into one sentence a person can act on.
 *
 * 🇪🇸 NOTA: los códigos salen del fichero generado por Anchor, no de una lista
 * copiada a mano que se quedaría vieja en silencio.
 */
import { SolanaTokenSwapErrorCode } from "@/idl/solana_token_swap_errors";

const MESSAGES: Record<string, string> = {
  ZeroAmount: "The amount must be greater than zero.",
  PriceNotSet: "This market has no price yet, so it cannot trade.",
  InsufficientLiquidity: "The vault does not hold enough of the token you are buying.",
  MathOverflow: "That amount is too large for the market to handle.",
  ZeroOutput: "That amount is too small — it rounds down to zero of the other token.",
  SlippageExceeded: "The output fell below your minimum. Raise the slippage or try again.",
  MintOrder: "The mints were passed in a non-canonical order.",
  Unauthorized: "Only the market authority can do that.",
  InvalidMint: "That token account does not belong to this market.",
};

const byCode = new Map<number, string>(
  Object.entries(SolanaTokenSwapErrorCode).map(([name, code]) => [code as number, name])
);

/**
 * Anchor's own error codes start here; the RPC reports them in hex.
 *
 * 🇪🇸 NOTA: desde que el swap manda la transacción a mano —para no depender de
 * `signatureSubscribe`, ver `confirm.ts`— el error que llega ya no es un
 * `AnchorError` traducido, sino el crudo del RPC: `custom program error:
 * 0x1773`. El código sigue siendo el mismo número, en hexadecimal. Sin esto,
 * el usuario leería ese texto en vez de "The output fell below your minimum".
 */
const CUSTOM_ERROR = /custom program error: 0x([0-9a-fA-F]+)/;

function fromCustomProgramError(haystack: string): string | undefined {
  const match = CUSTOM_ERROR.exec(haystack);
  if (!match) return undefined;
  const resolved = byCode.get(parseInt(match[1], 16));
  return resolved ? MESSAGES[resolved] : undefined;
}

export function describeError(err: unknown): string {
  if (err === null || err === undefined) return "Something went wrong.";

  const anyErr = err as {
    error?: { errorCode?: { code?: string; number?: number }; errorMessage?: string };
    message?: string;
    logs?: unknown;
  };

  const name = anyErr.error?.errorCode?.code;
  if (name && MESSAGES[name]) return MESSAGES[name];

  const number = anyErr.error?.errorCode?.number;
  if (typeof number === "number") {
    const resolved = byCode.get(number);
    if (resolved && MESSAGES[resolved]) return MESSAGES[resolved];
  }

  const message = anyErr.error?.errorMessage ?? anyErr.message;
  if (typeof message === "string" && message.length > 0) {
    if (/User rejected|rejected the request/i.test(message)) {
      return "You rejected the transaction in your wallet.";
    }
    const fromMessage = fromCustomProgramError(message);
    if (fromMessage) return fromMessage;
  }

  // El preflight devuelve los logs del programa aparte del mensaje.
  if (Array.isArray(anyErr.logs)) {
    const fromLogs = fromCustomProgramError(anyErr.logs.join("\n"));
    if (fromLogs) return fromLogs;
  }

  if (typeof message === "string" && message.length > 0) return message;

  return String(err);
}
