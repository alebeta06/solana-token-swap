//! Property tests for the swap arithmetic (`amount_a_to_b`, `amount_b_to_a`).
//!
//! 🇪🇸 NOTA: los tests de integración (Mocha) prueban casos concretos contra un
//! validador. Aquí se prueban PROPIEDADES: afirmaciones que deben cumplirse para
//! cualquier entrada. proptest genera cientos de entradas aleatorias y, si una
//! falla, la reduce ("shrinking") al contraejemplo mínimo. Es el equivalente al
//! fuzzing de Foundry (`function testFuzz_X(uint256 x)`).
//!
//! Solo se compila con `cargo test` (`#[cfg(test)]` en lib.rs): no entra en el
//! binario BPF.

use super::*;
use proptest::prelude::*;

/// `price == 0` is excluded: both handlers reject it with `PriceNotSet` before
/// calling the math, so it is not a reachable input.
fn price() -> impl Strategy<Value = u64> {
    1..=u64::MAX
}

fn assert_ok_or_overflow(result: Result<u64>) {
    if let Err(err) = result {
        assert_eq!(err, SwapError::MathOverflow.into());
    }
}

proptest! {
    // ── P1 — Totality ───────────────────────────────────────────────────────
    // 🇪🇸 NOTA: los decimales se leen del Mint, y SPL Token acepta cualquier u8.
    // Limitar el rango a los decimales "razonables" (≤ 38) sería escribir un test
    // diseñado para pasar: el atacante elige el mint, no nosotros.
    // Un panic on-chain aborta la transacción sin error tipado; la propiedad
    // exige que cualquier fallo sea `MathOverflow`.
    #[test]
    fn a_to_b_never_panics(amount in any::<u64>(), price in price(),
                           dec_a in any::<u8>(), dec_b in any::<u8>()) {
        assert_ok_or_overflow(amount_a_to_b(amount, price, dec_a, dec_b));
    }

    #[test]
    fn b_to_a_never_panics(amount in any::<u64>(), price in price(),
                           dec_a in any::<u8>(), dec_b in any::<u8>()) {
        assert_ok_or_overflow(amount_b_to_a(amount, price, dec_a, dec_b));
    }
}
