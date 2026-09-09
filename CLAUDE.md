# solana-token-swap — Contexto del proyecto

Proyecto del Máster CodeCrypto (Blockchain Engineering & AI), Módulo 15 — Token Swap.
Swap de tokens SPL con precio fijo, en Anchor. Primera experiencia del autor con Solana/Rust.

## ⛔ Reglas duras

- **NUNCA ejecutar `cargo update` sin argumentos.** El `Cargo.lock` contiene 8 pins
  deliberados. Ver "Entorno" más abajo.
- **NUNCA ejecutar `agave-install update` ni `solana-install update`.** Rompería la
  compatibilidad con Anchor 0.31.1.
- **NUNCA hacer push.** Alejandro empuja manualmente desde su terminal.
- **NUNCA añadir `Co-Authored-By`** en los commits.

## Entorno (verificado)

| | Versión |
|---|---|
| rustc (sistema) | 1.98.0 |
| rustc (platform-tools SBF) | **1.79.0** |
| solana-cli | 2.1.0 (Agave) |
| anchor-cli | 0.31.1 |
| node | v24.15.0 |

**El compilador de SBF es rustc 1.79**, anterior a la estabilización de edition2024
(rustc 1.85). Cualquier dependencia publicada desde febrero 2025 puede no compilar.

Pins en `Cargo.lock`: `solana-program 2.1.0`, `blake3 1.5.5`, `proc-macro-crate 3.2.0`,
`zeroize 1.8.1`, `indexmap 2.7.1`, `unicode-segmentation 1.12.0`.

## Regla de deriva de versión

El material del curso es anterior a Anchor 0.31.

> **Las lecciones son la autoridad sobre el DISEÑO. El compilador y la documentación
> son la autoridad sobre la SINTAXIS.**

Verificar siempre la API contra la documentación de 0.31.1 antes de escribir código.
No asumir que un patrón visto en un tutorial compila.

## Decisiones de arquitectura cerradas

- Instrucciones: `initialize_market`, `set_price`, `add_liquidity`, `swap_a_to_b`, `swap_b_to_a`
- **Dos instrucciones de swap**, no una con flag de dirección
- Seeds: `["market", mint_a, mint_b]`, `["vault_a", market]`, `["vault_b", market]`
- **Orden canónico obligatorio:** `mint_a.key() < mint_b.key()`
- **Los decimales se leen del `Mint`**, nunca se aceptan como parámetro del caller
- `price` con 6 decimales fijos (`PRICE_DECIMALS`). Significa: cuánto B por cada A
- `min_amount_out` en ambos swaps
- Eventos (`emit!`) desde el principio, pero **el frontend NO los usa como fuente de
  estado** — no existe `eth_getLogs` en Solana. El estado se lee con `getAccountInfo`
- `add_liquidity` abierto a cualquier depositante (sin `has_one`)

## Riesgos técnicos — verificar en cada cambio

1. **Aritmética en `u128`**, vuelta a `u64` con `try_into()`. `u64` desborda con
   9 decimales y precio de 6.
2. **Todas las multiplicaciones antes de todas las divisiones.** Ninguna división
   anidada: trunca y puede colapsar a cero.
3. **El truncamiento debe favorecer al pool en ambas direcciones.**
   Invariante: A→B→A nunca devuelve más de lo que entró.
4. **`set_price` requiere `has_one = authority` Y `Signer`.** Por separado no valen nada.
5. **Output cero tras truncar** debe dar error explícito, no quedarse los tokens.

## Convenciones

- Conventional Commits en inglés, atómicos por unidad lógica
- Código y doc-comments en inglés; notas pedagógicas con prefijo `🇪🇸 NOTA:` en español
- Tests: nombres como aserción, no como descripción

## Frontend (fase 7+)

- Next.js 15 App Router, TypeScript strict, Tailwind
- `@solana/wallet-adapter-react` (genérico, no el adapter específico de Solflare)
- Paleta Solana: morado `#9945FF`, verde `#14F195`, fondo oscuro
- Footer con enlaces: GitHub https://github.com/alebeta06 ·
  X https://x.com/Ale_Beta · LinkedIn https://www.linkedin.com/in/alebeta/
- `data-testid` en todo elemento interactivo desde el inicio
- Conversión unidades base ↔ display centralizada en un único módulo, con tests
