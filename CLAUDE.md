# solana-token-swap — Contexto del proyecto

Proyecto del Máster CodeCrypto (Blockchain Engineering & AI), Módulo 15 — Token Swap.
Swap de tokens SPL con precio fijo, en Anchor. **Primera experiencia del autor con
Solana y Rust** — explicar antes de implementar, comparando siempre con Solidity/EVM.

---

## ⛔ Reglas duras

- **NUNCA hacer push.** Alejandro empuja manualmente desde su terminal.
- **NUNCA añadir `Co-Authored-By`** en los commits.
- **NUNCA quitar `solana_version` de `Anchor.toml`.** Ver "Entorno".
- **NUNCA gestionar la versión de Solana desde fuera** (`agave-install`, `rustup`,
  symlinks). Anchor la sobreescribe en cada build.
- **NUNCA borrar `target/deploy/` entero.** Contiene la keypair del programa; borrarla
  genera un program ID nuevo y hay que resincronizar.
- **NUNCA activar `init-if-needed`** en el `Cargo.toml`. Es el footgun conocido de
  Anchor: permite que una cuenta ya existente pase la constraint sin error, así que sin
  una comprobación explícita un atacante puede re-inicializarla y **resetear el estado**.
  Las ATAs se crean desde el cliente con `createAssociatedTokenAccountInstruction`, como
  instrucción separada en la misma transacción. Se activó por error en la Fase 1 y se
  retiró en la Fase 2 al comprobar que no se usaba.
- **NUNCA activar una feature "por si acaso".** Una feature encendida y sin usar amplía
  la superficie de ataque a cambio de nada, y el siguiente que lea el código asumirá que
  está ahí por algún motivo.

---

## Entorno (verificado, funcionando)

| Pieza                               | Versión            |
| ----------------------------------- | ------------------ |
| anchor-cli                          | **1.2.0**          |
| anchor-lang / anchor-spl            | **1.2.0**          |
| `@anchor-lang/core` (TS)            | **1.2.0**          |
| Solana (declarada en `Anchor.toml`) | **4.2.2**          |
| platform-tools                      | v1.57 (rustc 1.95) |
| SBPF del binario                    | **v3**             |
| rustc (sistema)                     | 1.98.0             |
| node / yarn                         | v24.15.0 / 1.22.22 |

### ⚠️ Las dos líneas críticas

```toml
[toolchain]
solana_version = "4.2.2"
```

**`anchor build` desinstala y re-enlaza el toolchain de Rust en cada ejecución**, según
la versión de Solana que él decide. Sin `solana_version` explícito usa un default
(2.1.0), cuyo rustc 1.79 es anterior a edition2024 y no compila las dependencias
actuales.

**Por qué 4.2.2 y no 3.1.14** (que es lo que recomienda la doc de Anchor): las
platform-tools que trae Anchor 1.2.0 compilan a **SBPFv3**, y el validador de la 3.1.14
no lo carga — falla con `Failed to parse ELF file: invalid file header`. El binario y el
validador tienen que salir de la misma versión de Solana, y `solana_version` controla
las dos a la vez.

**El `Cargo.lock` no tiene pins y no debe tenerlos.**

### ⚠️ Cómo se corren los tests

`anchor test` **no funciona solo**: el runner por defecto de Anchor 1.x es **Surfpool**,
que no está instalado (`Failed to spawn surfpool`).

```bash
# terminal 1 — estado limpio en cada sesión
rm -rf test-ledger && solana-test-validator

# terminal 2
anchor test --skip-local-validator
```

Sin `rm -rf test-ledger`, el ledger conserva los mercados de la corrida anterior y los
tests fallan con "account already in use".

### Verificación del entorno

```bash
avm list                    # ← usar esto, NO `anchor --version`
cargo-build-sbf --version
solana-test-validator --version
```

⚠️ **`anchor --version` miente.** Bug conocido de avm: no se actualiza tras `avm use`.
Reporta 0.31.1 aunque estés en 1.2.0. La fuente de verdad es `avm list`.

ℹ️ AVM y Anchor los mantiene ahora **otter-sec** (repositorio oficial actual).

---

## Deriva de versión — regla operativa

El material del curso (videos) es **anterior a Anchor 0.31**; el proyecto va en
**1.2.0**.

> **Las lecciones son la autoridad sobre el DISEÑO. El compilador y la documentación
> son la autoridad sobre la SINTAXIS.**

**Verificado en Fase 1 — lo que SÍ funciona en 1.2.0:**

- `use anchor_spl::token::{Mint, Token, TokenAccount};` sigue siendo válido
- `Sysvar<'info, Rent>` **ya no hace falta** en `init` (la referencia lo incluía)
- `ctx.bumps.<cuenta>` en vez de recibir bumps como parámetros de instrucción
- `#[derive(InitSpace)]` + `MarketAccount::INIT_SPACE` en vez de constantes manuales

**Verificado en Fase 2:**

- ⚠️ **`CpiContext::new` recibe `Pubkey`** como primer argumento, **no `AccountInfo`**
  (cambió respecto a 0.31). Usar `token_program.key()`, no `.to_account_info()`
- El struct `Transfer { from, to, authority }` **no cambió** de forma
- `token::transfer` **no está deprecado** en `anchor-spl` 1.2.0
- Anchor rechaza que **la misma cuenta mutable aparezca dos veces** en un contexto,
  antes de evaluar tus constraints (`ConstraintDuplicateMutableAccount`)

**Cambios de 1.0+ ya aplicados:**

- Paquete TypeScript: `@coral-xyz/anchor` → **`@anchor-lang/core`**

---

## Decisiones de arquitectura cerradas

- Instrucciones: `initialize_market`, `set_price`, `add_liquidity`, `swap_a_to_b`,
  `swap_b_to_a`
- **Dos instrucciones de swap**, no una con flag de dirección
- Seeds: `["market", mint_a, mint_b]`, `["vault_a", market]`, `["vault_b", market]`
- **Orden canónico obligatorio:** `mint_a.key() < mint_b.key()`
- **Los decimales se leen del `Mint`**, nunca se aceptan como parámetro del caller
- `price` con 6 decimales fijos (`PRICE_DECIMALS`). Significa: **cuánto B por cada A**
- `initialize_market` deja `price = 0`; el mercado no opera hasta `set_price`
- `min_amount_out` en ambos swaps
- Eventos (`emit!`) desde el principio, pero **el frontend NO los usa como fuente de
  estado** — no existe `eth_getLogs` en Solana. El estado se lee con `getAccountInfo`
- `add_liquidity` abierto a cualquier depositante (sin `has_one`)
- Bumps de las bóvedas guardados en `MarketAccount`

---

## Modelo de autorización (precisión importante)

⚠️ **SPL Token SÍ tiene allowance.** La `TokenAccount` guarda `delegate: COption<Pubkey>`
y `delegated_amount: u64`, y el programa expone `Approve` y `Revoke`. Es el mismo
mecanismo conceptual del ERC20.

Lo correcto **no** es "en Solana no hay allowance", sino:

> **Este programa no necesita allowance** porque la firma del usuario sobre la
> transacción se propaga al CPI. La transacción previa de `approve` que en EVM sería
> obligatoria aquí sobra.

El `delegate` se usa cuando quien mueve los tokens **no puede firmar** en esa
transacción — no es nuestro caso.

Las dos direcciones de un CPI:

| Dirección        | Contexto                              | Quién firma                             |
| ---------------- | ------------------------------------- | --------------------------------------- |
| Usuario → bóveda | `CpiContext::new`                     | El usuario, por propagación de su firma |
| Bóveda → usuario | `CpiContext::new_with_signer` + seeds | El PDA, autorizado por el runtime       |

---

## Riesgos técnicos — verificar en cada cambio

1. **Aritmética en `u128`**, vuelta a `u64` con `try_into()`. `u64` desborda con
   9 decimales y precio de 6 (`amount × price × 10^9` ≈ 10²⁷ vs `u64::MAX` ≈ 1,8×10¹⁹).
2. **Todas las multiplicaciones antes de todas las divisiones.** Ninguna división
   anidada: trunca y el denominador puede colapsar a cero.
3. **El truncamiento debe favorecer al pool en ambas direcciones.**
   Invariante: A→B→A nunca devuelve más de lo que entró.
4. **`set_price` requiere `has_one = authority` Y `Signer`.** Por separado no valen nada.
   ✅ implementado y probado en Fase 2.
5. **Output cero tras truncar** debe dar error explícito, no quedarse los tokens.
6. **Liquidez insuficiente** con error tipado antes del CPI.
7. **`add_liquidity` con ambos importes a cero** debe fallar, no devolver `Ok`.
   ✅ implementado y probado en Fase 2.
8. **Account confusion:** lo que impide que pasen la bóveda de otro mercado son las
   **`seeds`**, no el `Signer`. Anchor re-deriva la dirección desde `market.key()` y
   la compara. El atacante firma legítimamente su propia transacción; el problema
   nunca es la identidad, son las cuentas que pasa.

---

## Estado del programa

**Fases 0–2 completadas** ✅ — `initialize_market`, `set_price`, `add_liquidity`,
3 eventos y **12 tests en verde**.

```
initialize_market
  ✔ stores the authority and both mints
  ✔ reads decimals from the mints instead of trusting the caller
  ✔ starts with price unset
  ✔ creates both vaults owned by the market PDA
  ✔ rejects mints passed in non-canonical order
set_price
  ✔ lets the authority set the price
  ✔ rejects a price of zero
  ✔ rejects anyone who is not the market authority
add_liquidity
  ✔ moves tokens from the depositor into both vaults
  ✔ accepts a deposit of only one side
  ✔ rejects a deposit where both amounts are zero
  ✔ rejects a token account whose mint does not match the market
```

**Errores en uso:** `ZeroAmount`, `MintOrder`, `InvalidMint`, `Unauthorized`.
**Definidos pero aún sin usar:** `PriceNotSet`, `InsufficientLiquidity`, `MathOverflow`,
`ZeroOutput`, `SlippageExceeded` — los consumen los swaps.

**Siguiente:** Fase 3 — `swap_a_to_b` con aritmética en `u128`, `min_amount_out`, y el
primer `CpiContext::new_with_signer` (el PDA firmando la salida de la bóveda).

⚠️ **Deuda de la suite:** los tests comparten estado en el ledger y el orden importa
(`set_price` debe correr antes que `add_liquidity`). Revisar en la Fase 5.

---

## Convenciones

- Conventional Commits en inglés, atómicos por unidad lógica
- Código y doc-comments en inglés; notas pedagógicas con prefijo `🇪🇸 NOTA:` en español
- **Tests: nombres como aserción de lo que garantiza el programa**, no descripción del
  test. Ej: `"reads decimals from the mints instead of trusting the caller"`
- Rama única `main`

---

## Frontend (fase 7+)

- Next.js 15 App Router, TypeScript strict, Tailwind
- `@solana/wallet-adapter-react` (genérico, no el adapter específico de Solflare)
- Cliente Anchor: **`@anchor-lang/core`**
- Paleta Solana: morado `#9945FF`, verde `#14F195`, fondo oscuro
- Footer con enlaces: GitHub https://github.com/alebeta06 ·
  X https://x.com/Ale_Beta · LinkedIn https://www.linkedin.com/in/alebeta/
- `data-testid` en todo elemento interactivo desde el inicio
- Conversión unidades base ↔ display centralizada en un único módulo, con tests
- Las ATAs que falten se crean **desde el cliente**, nunca con `init-if-needed`
- ⚠️ El mapeo "token que el usuario ve" ↔ A/B necesita test propio: con orden canónico,
  "vender USDC" puede ser `swap_a_to_b` o `swap_b_to_a` según el orden de las pubkeys.
  El patrón de ordenación está en el `before()` del test de Fase 1

---

## ⛔ MCP de Solana — `program_autofixer` obligatorio

Este repo tiene configurado el MCP oficial de Solana (`solana-mcp`, HTTP remoto,
**scope local**: solo se carga en este proyecto). Expone 5 tools: `list_sections`,
`get_documentation`, `Solana_Documentation_Search`, `Solana_Expert__Ask_For_Help` y
`program_autofixer`.

**Regla:** antes de devolver CUALQUIER código Rust de este repo —programa Anchor,
instrucción nueva, refactor de una existente— pasarlo por `program_autofixer`, que
detecta antipatrones de seguridad de Anchor y Pinocchio.

El bucle no es opcional y no termina en la primera pasada:

1. Llamar a `program_autofixer` con el Rust propuesto.
2. Aplicar los fixes que devuelva.
3. Si `require_another_tool_call_after_fixing` es `true`, **volver al paso 1** con el
   código ya corregido.
4. Repetir hasta que `require_another_tool_call_after_fixing` sea `false`.
5. Solo entonces devolver el código.

⚠️ **Dos avisos que no anulan la regla, pero hay que tener presentes:**

- `program_autofixer` **envía este código Rust a un tercero**. Vale para un proyecto de
  máster con repo público; no es el patrón a copiar en una auditoría o en código privado.
- El índice sirve documentación de Anchor "actual", **sin pinning de versión**. Este repo
  está clavado en `anchor-lang` 1.2.0 y `solana_version = "4.2.2"` (ver "Entorno" y
  "Deriva de versión"): si un fix propone una API que no existe en 1.2.0, **manda el
  `Cargo.toml` de este repo**, no el autofixer.
