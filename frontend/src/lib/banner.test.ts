import { describe, it, expect, vi, afterEach } from "vitest";
import { SUCCESS_DISMISS_MS, dismissDelay, startDismissTimer } from "./banner";

afterEach(() => {
  vi.useRealTimers();
});

describe("dismissDelay", () => {
  it("only a success goes away on its own", () => {
    expect(dismissDelay("success")).toBe(SUCCESS_DISMISS_MS);
    expect(dismissDelay("error")).toBeNull();
    expect(dismissDelay("notice")).toBeNull();
    expect(dismissDelay(null)).toBeNull();
  });

  it("leaves long enough to read it and click the explorer link", () => {
    expect(SUCCESS_DISMISS_MS).toBeGreaterThanOrEqual(5_000);
  });
});

describe("startDismissTimer", () => {
  it("hides a success once the time is up, and not before", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    startDismissTimer("success", dismiss);

    vi.advanceTimersByTime(SUCCESS_DISMISS_MS - 1);
    expect(dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("🔴 never hides an error, however long the user stares at their wallet", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    startDismissTimer("error", dismiss);

    vi.advanceTimersByTime(60 * 60 * 1000); // una hora
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("🔴 never hides a notice either: it explains why nothing happened", () => {
    // El 429 del faucet ("ya tienes tokens") no es un fallo, pero es la única
    // respuesta a "¿por qué no ha pasado nada?". Borrarlo solo deja igual de
    // perdido que borrar un error.
    vi.useFakeTimers();
    const dismiss = vi.fn();
    startDismissTimer("notice", dismiss);

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("cancels the pending dismissal when the banner is replaced", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const cancel = startDismissTimer("success", dismiss);

    cancel();
    vi.advanceTimersByTime(SUCCESS_DISMISS_MS * 2);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("gives back a cancel that is safe to call for a banner that never armed", () => {
    const cancel = startDismissTimer("error", vi.fn());
    expect(() => cancel()).not.toThrow();
  });

  it("uses the timers it is handed, so nothing real is scheduled", () => {
    const setTimeout = vi.fn().mockReturnValue(7);
    const clearTimeout = vi.fn();

    const cancel = startDismissTimer("success", vi.fn(), { setTimeout, clearTimeout });

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), SUCCESS_DISMISS_MS);
    cancel();
    expect(clearTimeout).toHaveBeenCalledWith(7);
  });
});
