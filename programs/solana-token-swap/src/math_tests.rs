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

/// Cases per property. proptest's default is 256.
///
/// 🇪🇸 NOTA: con 256 casos, `b_to_a_falls_with_price` pasaba en verde siendo
/// falsa; con 50 000 cayó a la primera. El default esconde los casos raros, y
/// los casos raros son justo los que busca un atacante. Son funciones puras sin
/// red ni cuentas: miles de casos cuestan segundos.
const CASES: u32 = 50_000;

fn assert_ok_or_overflow(result: Result<u64>) {
    if let Err(err) = result {
        assert_eq!(err, SwapError::MathOverflow.into());
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

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

// ── Strategies for P2–P4 ────────────────────────────────────────────────────
// 🇪🇸 NOTA: P2, P3 y P4 solo afirman algo cuando la función devuelve `Ok`. Con
// valores uniformes en todo el u64 y decimales en todo el u8, casi todo desborda
// y la propiedad se comprobaría sobre muy pocos casos. Por eso:
//   · cantidades y precios repartidos por ORDEN DE MAGNITUD (x >> shift), para
//     que salgan tanto 7 como 10^18;
//   · decimales sesgados 3:1 hacia 0–18 (los de mints reales), sin excluir el
//     resto del u8: la cuarta parte de los casos sigue cubriendo todo el rango.
// P1 no usa estas estrategias: la totalidad se prueba sobre el dominio entero.

fn magnitude() -> impl Strategy<Value = u64> {
    (any::<u64>(), 0u32..64).prop_map(|(x, shift)| x >> shift)
}

fn magnitude_price() -> impl Strategy<Value = u64> {
    magnitude().prop_map(|p| p.max(1))
}

fn decimals() -> impl Strategy<Value = u8> {
    prop_oneof![3 => 0u8..=18, 1 => any::<u8>()]
}

// 🇪🇸 NOTA: 1024 bits alcanzan para cualquier combinación de entradas: el peor
// producto es u64 · u64 · 10^255 · 10^6 < 2^980. La referencia nunca desborda,
// así que no hace falta descartar casos con `prop_assume!`.
type Big = ruint::aliases::U1024;

fn big(x: u64) -> Big {
    Big::from(x)
}

fn big_pow10(exp: u32) -> Big {
    Big::from(10u8).pow(Big::from(exp))
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    // ── P2 — Each swap is the exact floor: favours the pool by < 1 unit ─────
    // 🇪🇸 NOTA: por qué la desigualdad de dos lados ES "floor exacto".
    // Para enteros con d > 0, q = floor(n / d) se define como el único q tal que
    //     q · d  ≤  n  <  (q + 1) · d
    // El test no divide nunca: multiplica en 1024 bits, donde nada trunca ni
    // desborda, y comprueba que la salida del programa cumple esa definición.
    //
    // Lo que el test escribe no es el algoritmo del programa, es el SIGNIFICADO
    // del precio: "in unidades de A valen in · price · 10^dec_b / (10^6 · 10^dec_a)
    // unidades de B". Cómo se llega al número (orden de las operaciones, dónde
    // se divide, en qué tipo) queda fuera. Por eso caza:
    //   · lado izquierdo  → el pool paga MÁS de lo que vale la entrada
    //                       (redondeo hacia arriba, escalas invertidas);
    //   · lado derecho    → el usuario pierde una unidad entera o más
    //                       (división anidada que trunca antes de tiempo).
    // Lo que NO caza: que el significado del precio esté mal en los dos sitios a
    // la vez. Eso lo fijan los tests de integración con números concretos.
    #[test]
    fn a_to_b_pays_the_exact_floor(amount in magnitude(), price in magnitude_price(),
                                   dec_a in decimals(), dec_b in decimals()) {
        if let Ok(out) = amount_a_to_b(amount, price, dec_a, dec_b) {
            let value_in = big(amount) * big(price) * big_pow10(dec_b.into());
            let unit_out = big_pow10(PRICE_DECIMALS) * big_pow10(dec_a.into());
            prop_assert!(big(out) * unit_out <= value_in, "pool pays more than the input is worth");
            prop_assert!(value_in < (big(out) + big(1)) * unit_out, "user loses a whole unit or more");
        }
    }

    #[test]
    fn b_to_a_pays_the_exact_floor(amount in magnitude(), price in magnitude_price(),
                                   dec_a in decimals(), dec_b in decimals()) {
        if let Ok(out) = amount_b_to_a(amount, price, dec_a, dec_b) {
            let value_in = big(amount) * big_pow10(PRICE_DECIMALS) * big_pow10(dec_a.into());
            let unit_out = big(price) * big_pow10(dec_b.into());
            prop_assert!(big(out) * unit_out <= value_in, "pool pays more than the input is worth");
            prop_assert!(value_in < (big(out) + big(1)) * unit_out, "user loses a whole unit or more");
        }
    }

    // ── P3 — A round trip never returns more than went in ───────────────────
    // 🇪🇸 NOTA: hoy está garantizada por construcción (floor ∘ floor ≤ identidad).
    // Es una propiedad de REGRESIÓN: si alguien toca una de las dos funciones y
    // deja de ser la inversa de la otra, el programa crea valor de la nada.
    #[test]
    fn a_to_b_to_a_never_gains(amount in magnitude(), price in magnitude_price(),
                               dec_a in decimals(), dec_b in decimals()) {
        if let Ok(b) = amount_a_to_b(amount, price, dec_a, dec_b) {
            if let Ok(back) = amount_b_to_a(b, price, dec_a, dec_b) {
                prop_assert!(back <= amount, "round trip created {} units", back - amount);
            }
        }
    }

    #[test]
    fn b_to_a_to_b_never_gains(amount in magnitude(), price in magnitude_price(),
                               dec_a in decimals(), dec_b in decimals()) {
        if let Ok(a) = amount_b_to_a(amount, price, dec_a, dec_b) {
            if let Ok(back) = amount_a_to_b(a, price, dec_a, dec_b) {
                prop_assert!(back <= amount, "round trip created {} units", back - amount);
            }
        }
    }

    // ── P4 — Monotonic, including the error ─────────────────────────────────
    // 🇪🇸 NOTA: si la entrada mayor da Ok, la menor también tiene que dar Ok y
    // una salida que no sea mayor. La mitad del "también Ok" importa: un error
    // que aparece al BAJAR la entrada no es un overflow, es un bug.
    // Caza sobre todo el overflow silencioso (`as u64`, `wrapping_mul`): al
    // envolver, más entrada da MENOS salida, sin panic y sin error. Ni P1 ni P3
    // lo ven, porque la salida envuelta es pequeña y no hay panic.
    #[test]
    fn a_to_b_is_monotonic_in_amount(x in magnitude(), y in magnitude(), price in magnitude_price(),
                                     dec_a in decimals(), dec_b in decimals()) {
        let (lo, hi) = (x.min(y), x.max(y));
        if let Ok(out_hi) = amount_a_to_b(hi, price, dec_a, dec_b) {
            let out_lo = amount_a_to_b(lo, price, dec_a, dec_b);
            prop_assert!(matches!(out_lo, Ok(v) if v <= out_hi), "{} -> {:?}, {} -> {}", lo, out_lo, hi, out_hi);
        }
    }

    #[test]
    fn b_to_a_is_monotonic_in_amount(x in magnitude(), y in magnitude(), price in magnitude_price(),
                                     dec_a in decimals(), dec_b in decimals()) {
        let (lo, hi) = (x.min(y), x.max(y));
        if let Ok(out_hi) = amount_b_to_a(hi, price, dec_a, dec_b) {
            let out_lo = amount_b_to_a(lo, price, dec_a, dec_b);
            prop_assert!(matches!(out_lo, Ok(v) if v <= out_hi), "{} -> {:?}, {} -> {}", lo, out_lo, hi, out_hi);
        }
    }

    // 🇪🇸 NOTA: en precio, las dos direcciones van al revés: A→B multiplica por
    // price (sube con él) y B→A divide (baja con él).
    #[test]
    fn a_to_b_rises_with_price(amount in magnitude(), p in magnitude_price(), q in magnitude_price(),
                               dec_a in decimals(), dec_b in decimals()) {
        let (lo, hi) = (p.min(q), p.max(q));
        if let Ok(out_hi) = amount_a_to_b(amount, hi, dec_a, dec_b) {
            let out_lo = amount_a_to_b(amount, lo, dec_a, dec_b);
            prop_assert!(matches!(out_lo, Ok(v) if v <= out_hi), "{} -> {:?}, {} -> {}", lo, out_lo, hi, out_hi);
        }
    }

    //
    // 🇪🇸 NOTA: esta es la ÚNICA de las cuatro sin la mitad del error, y no por
    // comodidad. La primera versión exigía "si el precio bajo da Ok, el alto
    // también", y con 50 000 casos cayó SIN sabotaje alguno:
    //     amount = 0, price 1 → Ok(0), price 43556142965880192 → MathOverflow
    // En B→A el precio está en el DENOMINADOR (price · 10^dec_b): subirlo puede
    // desbordar el intermedio u128 aunque el resultado real sea menor. Es un
    // rechazo conservador —del pool no sale nada—, documentado en
    // `amount_b_to_a` y en el README (Known limitations). Aquí solo se exige la
    // mitad que sí es cierta: si las dos dan Ok, más precio no da más salida.
    #[test]
    fn b_to_a_falls_with_price(amount in magnitude(), p in magnitude_price(), q in magnitude_price(),
                               dec_a in decimals(), dec_b in decimals()) {
        let (lo, hi) = (p.min(q), p.max(q));
        if let (Ok(out_lo_price), Ok(out_hi_price)) =
            (amount_b_to_a(amount, lo, dec_a, dec_b), amount_b_to_a(amount, hi, dec_a, dec_b))
        {
            prop_assert!(out_hi_price <= out_lo_price,
                         "{} -> {}, {} -> {}", lo, out_lo_price, hi, out_hi_price);
        }
    }
}
