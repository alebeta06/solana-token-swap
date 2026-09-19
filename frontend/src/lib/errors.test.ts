import { describe, it, expect } from "vitest";
import { SolanaTokenSwapErrorCode } from "@/idl/solana_token_swap_errors";
import { describeError } from "./errors";

describe("describeError", () => {
  it("turns an Anchor error code into the sentence for it", () => {
    expect(describeError({ error: { errorCode: { code: "SlippageExceeded" } } })).toMatch(
      /below your minimum/i
    );
  });

  it("🔴 still resolves the code when the RPC reports it raw, in hex", () => {
    // Desde que el swap manda la transacción a mano —para no depender de
    // signatureSubscribe— el error ya no viene traducido por Anchor. Sin este
    // camino, el usuario leería "custom program error: 0x1775".
    const hex = `0x${SolanaTokenSwapErrorCode.SlippageExceeded.toString(16)}`;
    expect(
      describeError({ message: `Transaction simulation failed: … custom program error: ${hex}` })
    ).toMatch(/below your minimum/i);
  });

  it("reads the code out of the preflight logs when the message lacks it", () => {
    const hex = `0x${SolanaTokenSwapErrorCode.InsufficientLiquidity.toString(16)}`;
    expect(
      describeError({
        message: "Transaction simulation failed",
        logs: ["Program log: AnchorError occurred.", `Program failed: custom program error: ${hex}`],
      })
    ).toMatch(/does not hold enough/i);
  });

  it("does not invent a message for a code that is not ours", () => {
    const raw = "custom program error: 0x2" as const;
    expect(describeError({ message: raw })).toBe(raw);
  });

  it("names a wallet rejection as such, not as a program failure", () => {
    expect(describeError({ message: "User rejected the request." })).toMatch(
      /rejected the transaction/i
    );
  });

  it("falls back to the raw message rather than swallowing it", () => {
    expect(describeError({ message: "Blockhash not found" })).toBe("Blockhash not found");
    expect(describeError(null)).toBe("Something went wrong.");
  });
});
