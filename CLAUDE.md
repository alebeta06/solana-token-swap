# solana-token-swap — Contexto del proyecto

Proyecto del Máster CodeCrypto (Blockchain Engineering & AI), Módulo 15 — Token Swap.
Swap de tokens SPL con precio fijo, en Anchor. **Primera experiencia del autor con
Solana y Rust** — explicar antes de implementar, comparando siempre con Solidity/EVM.

---

## ⛔ Reglas duras

- **NUNCA hacer push.** Alejandro empuja manualmente desde su terminal.
- **NUNCA añadir `Co-Authored-By`** en los commits.
- **NUNCA quitar `solana_version` de `Anchor.toml`.** Ver "Entorno" — es la línea que
  hace que el proyecto compile.
- **NUNCA gestionar la versión de Solana desde fuera** (`agave-install`, `rustup`,
  symlinks). Anchor la sobreescribe en cada build.

---

## Entorno (verificado, funcionando)

| Pieza                               | Versión            |
| ----------------------------------- | ------------------ |
| anchor-cli                          | **1.2.0**          |
| anchor-lang / anchor-spl            | **1.2.0**          |
| Solana (declarada en `Anchor.toml`) | **3.1.14**         |
| platform-tools                      | v1.52 (rustc 1.89) |
| rustc (sistema)                     | 1.98.0             |
| node                                | v24.15.0           |

### ⚠️ La línea crítica

```toml
[toolchain]
solana_version = "3.1.14"
```

**`anchor build` desinstala y re-enlaza el toolchain de Rust en cada ejecución**, según
la versión de Solana que él decide. Sin `solana_version` explícito usa un default
(2.1.0), que trae platform-tools v1.43 con **rustc 1.79** — anterior a la
estabilización de edition2024 (rustc 1.85). Resultado: media docena de dependencias
modernas fallan al parsear su manifiesto.

Se intentó fijar dependencias una por una (`blake3`, `digest`, `proc-macro-crate`,
`zeroize`, `indexmap`, `unicode-segmentation`, `solana-program`) y **no converge**:
cada crate nuevo reintroduce el problema, y añadir `anchor-spl` invalidó todos los pins
de golpe. También se intentó corregir el symlink de `active_release` a mano y con
`agave-install init stable`: **Anchor lo revierte en el siguiente build**.

La solución es declarar la versión en `Anchor.toml`. **El `Cargo.lock` no tiene ningún
pin y no debe tenerlos.**

### Verificación del entorno

```bash
avm list            # ← usar esto, NO `anchor --version`
cargo-build-sbf --version
```

⚠️ **`anchor --version` miente.** Es un bug conocido de avm: no se actualiza tras
`avm use`. Reporta 0.31.1 aunque estés en 1.2.0. La fuente de verdad es `avm list`.

ℹ️ AVM y Anchor los mantiene ahora **otter-sec** (repositorio oficial actual). Un
`avm self-update` que cambia el origen de `solana-foundation` a `otter-sec` es
esperado, no un compromiso de la cadena de suministro.

---

## Deriva de versión — regla operativa

El material del curso (videos) es **anterior a Anchor 0.31**; el proyecto va en
**1.2.0**. Habrá diferencias de sintaxis significativas.

> **Las lecciones son la autoridad sobre el DISEÑO. El compilador y la documentación
> son la autoridad sobre la SINTAXIS.**

| Tomar de las lecciones             | Ignorar de las lecciones      |
| ---------------------------------- | ----------------------------- |
| Qué cuentas lleva cada instrucción | Firmas exactas de las macros  |
| Cómo se estructuran las seeds      | Nombres de imports            |
| La lógica de negocio y la fórmula  | Versiones de dependencias     |
| Qué validaciones ponen y cuáles no | Cómo se declara el program ID |

**Verificar siempre la API contra la documentación de Anchor 1.x antes de escribir.**
No asumir que un patrón visto en un tutorial compila.

Cambios conocidos de 1.0+ a tener presentes:

- Paquete TypeScript renombrado: `@coral-xyz/anchor` → **`@anchor-lang/core`**
- `anchor init` genera plantilla de tests **LiteSVM** por defecto. El enunciado pide
  **Mocha/Chai** → usar `--test-template mocha` o adaptar el `tests/` existente
- ⚠️ **Verificar** los nombres del módulo de tokens en `anchor-spl` 1.2.0: el árbol
  ahora resuelve `spl-token-interface`, no `spl-token`. Los imports pueden haber
  cambiado respecto a `anchor_spl::token`

---

## Decisiones de arquitectura cerradas

- Instrucciones: `initialize_market`, `set_price`, `add_liquidity`, `swap_a_to_b`,
  `swap_b_to_a`
- **Dos instrucciones de swap**, no una con flag de dirección
- Seeds: `["market", mint_a, mint_b]`, `["vault_a", market]`, `["vault_b", market]`
- **Orden canónico obligatorio:** `mint_a.key() < mint_b.key()`
- **Los decimales se leen del `Mint`**, nunca se aceptan como parámetro del caller
- `price` con 6 decimales fijos (`PRICE_DECIMALS`). Significa: **cuánto B por cada A**
- `min_amount_out` en ambos swaps
- Eventos (`emit!`) desde el principio, pero **el frontend NO los usa como fuente de
  estado** — no existe `eth_getLogs` en Solana. El estado se lee con `getAccountInfo`
- `add_liquidity` abierto a cualquier depositante (sin `has_one`)
- Bumps de las bóvedas guardados en `MarketAccount`

---

## Riesgos técnicos — verificar en cada cambio

1. **Aritmética en `u128`**, vuelta a `u64` con `try_into()`. `u64` desborda con
   9 decimales y precio de 6 (`amount × price × 10^9` ≈ 10²⁷ frente a `u64::MAX` ≈ 1,8×10¹⁹).
2. **Todas las multiplicaciones antes de todas las divisiones.** Ninguna división
   anidada: trunca y el denominador puede colapsar a cero.
3. **El truncamiento debe favorecer al pool en ambas direcciones.**
   Invariante: A→B→A nunca devuelve más de lo que entró.
4. **`set_price` requiere `has_one = authority` Y `Signer`.** Por separado no valen nada.
5. **Output cero tras truncar** debe dar error explícito, no quedarse los tokens.
6. **Liquidez insuficiente** con error tipado antes del CPI, no dejar que falle el
   SPL Token con un error opaco.

---

## Convenciones

- Conventional Commits en inglés, atómicos por unidad lógica
- Código y doc-comments en inglés; notas pedagógicas con prefijo `🇪🇸 NOTA:` en español
- Tests: nombres como aserción, no como descripción
- Custom errors con argumentos solo cuando aportan valor de depuración

---

## Frontend (fase 7+)

- Next.js 15 App Router, TypeScript strict, Tailwind
- `@solana/wallet-adapter-react` (genérico, no el adapter específico de Solflare)
- Cliente Anchor: **`@anchor-lang/core`** (no `@coral-xyz/anchor`)
- Paleta Solana: morado `#9945FF`, verde `#14F195`, fondo oscuro
- Footer con enlaces: GitHub https://github.com/alebeta06 ·
  X https://x.com/Ale_Beta · LinkedIn https://www.linkedin.com/in/alebeta/
- `data-testid` en todo elemento interactivo desde el inicio
- Conversión unidades base ↔ display centralizada en un único módulo, con tests
- ⚠️ El mapeo "token que el usuario ve" ↔ A/B necesita test propio: con orden canónico,
  "vender USDC" puede ser `swap_a_to_b` o `swap_b_to_a` según el orden de las pubkeys
