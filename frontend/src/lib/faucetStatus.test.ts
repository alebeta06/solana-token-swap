import { describe, it, expect } from "vitest";
import { describeFaucetFailure, describeFaucetResponse } from "./faucetStatus";

const MINTED = {
  slot: 500545959,
  signature: "5Xk9".padEnd(88, "a"),
  recipient: "9aaPGTS7DikpFQugaPZVzVTaQ7dagUk1GpUwBDo15Y4y",
  amounts: [
    { symbol: "DEMO9", mint: "Bzrx", decimals: 9, baseUnits: "10000000000", balance: "10000000000" },
    { symbol: "DEMO6", mint: "EUbs", decimals: 6, baseUnits: "20000000", balance: "20000000" },
  ],
};

describe("describeFaucetResponse", () => {
  it("says how much arrived, in display units, and links the transaction", () => {
    const outcome = describeFaucetResponse(200, MINTED);
    expect(outcome.tone).toBe("success");
    expect(outcome.message).toContain("10 DEMO9");
    expect(outcome.message).toContain("20 DEMO6");
    expect(outcome.signature).toBe(MINTED.signature);
  });

  it("carries the confirmation slot so the balance refresh can demand it", () => {
    // 🔴 Sin el slot, el navegador repite la carrera contra el RPC que el
    // handler acaba de ganar y pinta 0 justo después de recibir tokens.
    expect(describeFaucetResponse(200, MINTED).slot).toBe(500545959);
  });

  it("does not invent a slot when the body has none or it is not a number", () => {
    expect(describeFaucetResponse(200, { signature: "s" }).slot).toBeUndefined();
    expect(describeFaucetResponse(200, { signature: "s", slot: "500" }).slot).toBeUndefined();
    expect(describeFaucetResponse(200, { signature: "s", slot: NaN }).slot).toBeUndefined();
  });

  it("scales each amount by its own decimals, never by a shared factor", () => {
    // 🇪🇸 NOTA: 10^9 y 10^6 en la misma respuesta. Un factor compartido
    // convertiría 20 DEMO6 en 0.02 y nadie miraría dos veces.
    expect(describeFaucetResponse(200, MINTED).message).not.toContain("0.02");
  });

  it("still reports success when the amounts are missing or malformed", () => {
    for (const body of [
      { signature: "sig" },
      { signature: "sig", amounts: [] },
      { signature: "sig", amounts: [{ symbol: "DEMO9" }] },
      { signature: "sig", amounts: [{ symbol: "DEMO9", decimals: 9, baseUnits: "ten" }] },
      { signature: "sig", amounts: "10 DEMO9" },
    ]) {
      const outcome = describeFaucetResponse(200, body);
      expect(outcome.tone).toBe("success");
      expect(outcome.message).toMatch(/in your wallet/);
    }
  });

  it("🔴 never shows 'already has tokens' as an error", () => {
    const outcome = describeFaucetResponse(429, { error: "This address already holds..." });
    expect(outcome.tone).toBe("notice");
    expect(outcome.tone).not.toBe("error");
    expect(outcome.title).toMatch(/already have tokens/i);
    expect(`${outcome.title} ${outcome.message}`).not.toMatch(/error|failed|rejected/i);
  });

  it("tells the visitor the empty faucet is not their fault", () => {
    const outcome = describeFaucetResponse(503, { error: "The faucet is out of funds" });
    expect(outcome.tone).toBe("notice");
    expect(outcome.message).toMatch(/nothing you did/i);
  });

  it("turns a rejected address into the step the visitor is missing", () => {
    const outcome = describeFaucetResponse(400, { error: "Address is required" });
    expect(outcome.tone).toBe("notice");
    expect(outcome.title).toMatch(/connect your wallet/i);
  });

  it("marks only a broken deployment and an unconfirmed mint as errors", () => {
    expect(describeFaucetResponse(500, {}).tone).toBe("error");
    expect(describeFaucetResponse(502, {}).tone).toBe("error");
  });

  it("names which configuration fault it is, not just 'unavailable'", () => {
    // 🔴 Esto es lo que se ve al olvidar la variable en el panel de Vercel. El
    // detalle vive en el servidor y tiene que LLEGAR, no quedarse en el log.
    const missing = describeFaucetResponse(500, {
      reason: "missing",
      error: "No faucet key is configured on this deployment: the FAUCET_KEYPAIR …",
    });
    expect(missing.title).toBe("No faucet key configured");
    expect(missing.message).toMatch(/FAUCET_KEYPAIR/);

    expect(describeFaucetResponse(500, { reason: "malformed", error: "x" }).title).toMatch(
      /malformed/i
    );
    expect(describeFaucetResponse(500, { reason: "mismatch", error: "x" }).title).toMatch(
      /does not match/i
    );
  });

  it("falls back to a general message when the server sends no reason", () => {
    const outcome = describeFaucetResponse(500, {});
    expect(outcome.title).toBe("The faucet is not available here");
    expect(outcome.message).toMatch(/no faucet key configured/i);
  });

  it("ignores a reason it does not know instead of showing it raw", () => {
    const outcome = describeFaucetResponse(500, { reason: "banana", error: "Something" });
    expect(outcome.title).toBe("The faucet is not available here");
    expect(outcome.message).toBe("Something");
  });

  it("carries the signature of an unconfirmed mint so it can be looked at", () => {
    const outcome = describeFaucetResponse(502, { error: "...", signature: "abc" });
    expect(outcome.signature).toBe("abc");
    expect(outcome.message).toMatch(/explorer/i);
  });

  it("handles a status this page does not know instead of rendering nothing", () => {
    const outcome = describeFaucetResponse(418, null);
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toContain("418");
  });

  it("survives a body that is not the shape the route promises", () => {
    for (const body of [null, undefined, "plain text", 42, []]) {
      expect(() => describeFaucetResponse(429, body)).not.toThrow();
      expect(() => describeFaucetResponse(200, body)).not.toThrow();
    }
  });
});

describe("describeFaucetFailure", () => {
  it("distinguishes 'no answer at all' from any status the server sent", () => {
    const outcome = describeFaucetFailure();
    expect(outcome.tone).toBe("error");
    expect(outcome.title).toMatch(/could not reach/i);
    expect(outcome.signature).toBeUndefined();
  });
});
