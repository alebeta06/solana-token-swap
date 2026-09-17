# solana-token-swap — Contexto del proyecto

Proyecto del Máster CodeCrypto (Blockchain Engineering & AI), Módulo 15 — Token Swap.
Swap de tokens SPL con precio fijo, en Anchor. **Primera experiencia del autor con
Solana y Rust** — explicar antes de implementar, comparando siempre con Solidity/EVM.

> ⚠️ **Estado actual: Fases 0–7 completadas. La siguiente es la Fase 8.**
> Son 11 fases (0 a 10). Ver "Plan completo — las 11 fases" y "Estado del programa".

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
  Las ATAs se crean desde el cliente con `createAssociatedTokenAccountInstruction`.
  Se activó por error en la Fase 1 y se retiró en la Fase 2 al comprobar que no se usaba.
- **NUNCA activar una feature "por si acaso".** Una feature encendida y sin usar amplía
  la superficie de ataque a cambio de nada.
- **NUNCA asumir que "token A" es el de menos decimales.** El orden A/B lo decide la
  comparación de pubkeys (`mint_a < mint_b`), no los decimales ni el valor. Cualquier
  test o código de cliente que lo asuma está mal. Ya causó un fallo en la Fase 4.

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

### ⚠️ Cuándo el IDL se queda atrás

Si el cliente TS falla con `program.methods.X is not a function`, el IDL no incluye la
instrucción. Dos causas, en este orden:

1. **La función no está dentro del `#[program]`.** Compila igual (es una `pub fn`
   válida) pero Anchor no la ve como instrucción y no la mete en el IDL. Pasó en la
   Fase 4. Verificar con:
   `grep -n "pub mod solana_token_swap\|pub fn \|^}" programs/solana-token-swap/src/lib.rs`
   — toda instrucción debe estar antes del `}` que cierra el módulo.
2. **Caché de compilación.** `anchor build` que termina en menos de un segundo no
   regeneró nada:
   `cargo clean -p solana-token-swap && anchor build`

Comprobar siempre: `grep -c "<nombre_instruccion>" target/idl/solana_token_swap.json`

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

## MCP oficial de Solana (alta en Fase 4)

`solana-mcp` → `https://mcp.solana.com/mcp`, scope local, sin API key. Cinco tools:
`list_sections`, `get_documentation`, `Solana_Documentation_Search`,
`Solana_Expert__Ask_For_Help`, `program_autofixer`.

### Límites conocidos

- **El índice NO tiene pinning de versión** y empuja Anchor v2 / `@solana/kit`. Este
  repo va en **1.2.0** con `@anchor-lang/core`. Si un fix propone una API que no existe
  en 1.2.0, **manda el `Cargo.toml` del repo**.
- **`program_autofixer` envía el código a un tercero** (servidores de la Solana
  Foundation). Aceptable en un repo público de máster. **NO es patrón a copiar en
  auditoría ni en código privado.**
- **Un resultado limpio no es una auditoría.** Es un linter estático de antipatrones
  catalogados de Anchor/Pinocchio. No razona sobre el dominio: no sabe que los decimales
  6/9 son deliberados, ni que `mint_a < mint_b` es una invariante de diseño, ni valida
  la invariante A→B→A. Eso lo cubren los tests y el criterio.

### Resultado de la Fase 4

`program_autofixer` sobre el `lib.rs` completo: **cero issues, cero suggestions**, una
sola pasada. Nada que aplicar.

> 📌 Dato para el README y el video: los cuatro bugs encontrados en el código de
> referencia del curso (decimales del caller, división anidada, `set_price` sin
> authority, `add_liquidity` que devuelve `Ok` sin hacer nada) son del tipo que **un
> linter no detecta**. Pendiente de verificar pasando el código de referencia por la
> misma herramienta.

### Fuentes del índice ya identificadas como útiles

`gh-sealevel-attacks` (catálogo de fallos de Anchor: missing signer/owner checks,
account confusion), `gh-anchor-amm-2023` (AMM de producto constante),
`gh-anchor-escrow-2024` (token accounts con PDA owner, `new_with_signer`), `gh-spl-ata`.

---

## MCP del Solana Explorer (alta en Fase 7)

`solana-explorer` → `https://explorer.solana.com/mcp`, scope local, sin API key.
Streamable HTTP y **stateless** (no devuelve `mcp-session-id`). Dos tools de **solo
lectura** — `inspect_entity` y `ping` —; no puede firmar ni alterar estado on-chain.

**Regla:** ante cualquier dirección, firma, programa, mint o wallet de Solana, llamar a
`inspect_entity` en vez de tirar de la memoria del modelo. Devuelve el registro
decodificado por IDL, el mismo que muestra el Explorer web: para mints SPL
supply/decimals/mint authority/freeze authority; para programas ownership y metadata;
para transacciones sus instrucciones y resultados en secuencia. Los fallos vienen en
`errors[]`: `NOT_FOUND` y `CURRENTLY_UNSUPPORTED`.

⚠️ **Cubre `mainnet-beta`, `devnet` y `testnet` — y nada más.** No alcanza
`solana-test-validator` ni LiteSVM, así que **durante los tests locales no sirve**: ahí
la fuente es el validador y el propio `anchor test`. Aplica **sobre lo desplegado en
devnet** — el criterio es el cluster, no la fase.

**No confundir los dos MCPs de Solana:** `mcp.solana.com` responde *cómo se construye*
(documentación + `program_autofixer`); `explorer.solana.com/mcp` responde *qué existe
on-chain ahora mismo*.

---

## Deriva de versión — regla operativa

El material del curso (videos) es **anterior a Anchor 0.31**; el proyecto va en
**1.2.0**.

> **Las lecciones son la autoridad sobre el DISEÑO. El compilador y la documentación
> son la autoridad sobre la SINTAXIS.**

**Verificado en Fase 1:**

- `use anchor_spl::token::{Mint, Token, TokenAccount};` sigue siendo válido
- `Sysvar<'info, Rent>` **ya no hace falta** en `init` (la referencia lo incluía)
- `ctx.bumps.<cuenta>` en vez de recibir bumps como parámetros de instrucción
- `#[derive(InitSpace)]` + `MarketAccount::INIT_SPACE` en vez de constantes manuales

**Verificado en Fase 2:**

- ⚠️ **`CpiContext::new` recibe `Pubkey`** como primer argumento, **no `AccountInfo`**
  (cambió respecto a 0.31). Usar `token_program.key()`, no `.to_account_info()`
- El struct `Transfer { from, to, authority }` **no cambió** de forma
- `token::transfer` **no está deprecado** en `anchor-spl` 1.2.0
- Anchor rechaza que **la misma cuenta mutable aparezca dos veces** en un contexto
  (`ConstraintDuplicateMutableAccount`)

**Verificado en Fase 3:**

- `CpiContext::new_with_signer(program_key, accounts, signer_seeds)` funciona con las
  seeds como `&[&[&[u8]]]` (array de arrays de seeds, por si firman varios PDAs)
- Copiar las `Pubkey` de los mints a variables locales antes de `as_ref()` evita
  conflictos con el borrow checker al usar `ctx.accounts.market` después

**Verificado en Fase 6:**

- ⚠️ **El tipo `.accounts()` de Anchor 1.2.0 no es una autoridad sobre qué cuentas
  hacen falta.** En `node_modules/@anchor-lang/core/.../namespace/methods.d.ts`, el
  helper `ResolvedAccount` manda a `never` toda cuenta que en el IDL lleve `pda`,
  `address` o `relations`, **sin mirar si el resolver en runtime puede derivarla**.
  De ahí el desajuste con los self-referencing PDAs.
- ⚠️ **Y en `set_price` ese desajuste estaba silenciado por accidente.** Sus dos
  cuentas caen en `never` (`market` por `pda`, `authority` por `relations`), el tipo
  resultante es `{}`, y **TypeScript no aplica excess property check contra el tipo
  vacío**: `.accounts({ market, authority })` compilaba por no tener nada contra lo
  que comparar, no por ser correcto. Los mismos campos en los swaps —donde el tipo
  no queda vacío— sí daban `TS2353`. **Que un `.accounts()` compile no dice nada
  sobre si el juego de cuentas es el que el programa espera.**
- **`initialize_market` no necesita `any`.** Sus seeds salen de `token_mint_a` /
  `token_mint_b`, que son cuentas que le pasamos, así que Anchor resuelve `market`,
  las dos bóvedas y los dos programas. Basta `{ tokenMintA, tokenMintB, authority }`.
  El `any` solo hace falta donde `market` es self-referencing (`set_price`,
  `add_liquidity`, los dos swaps).
- **`{ ...helper(), clave: x }` sigue siendo un literal** para TypeScript, que
  comprueba sus claves aunque el spread venga de una variable tipada. Un helper con
  parámetro de overrides (`swapAccounts({ vaultB: x })`) evita el `any`; el spread
  en el sitio de llamada, no.
- **`target`/`lib` en `es2020`**, el mínimo que legaliza los literales `BigInt`
  (`0n`). **No subir a `es2022` sin decidirlo aparte:** a partir de ahí
  `useDefineForClassFields` pasa a `true` por defecto y cambia la semántica de los
  campos de clase.
- `migrations/deploy.ts` **borrado**. Era scaffold de Anchor que nunca se completó,
  importaba `@coral-xyz/anchor` y solo lo consumiría `anchor migrate`, que no usamos:
  se despliega con `anchor deploy` y se siembra con `scripts/seed-market.ts`.

**Cambios de 1.0+ ya aplicados:**

- Paquete TypeScript: `@coral-xyz/anchor` → **`@anchor-lang/core`**

---

## Decisiones de arquitectura cerradas

- Instrucciones: `initialize_market`, `set_price`, `add_liquidity`, `swap_a_to_b`,
  `swap_b_to_a` — **las cinco implementadas**
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
y `delegated_amount: u64`, y el programa expone `Approve` y `Revoke`.

Lo correcto **no** es "en Solana no hay allowance", sino:

> **Este programa no necesita allowance** porque la firma del usuario sobre la
> transacción se propaga al CPI. La transacción previa de `approve` que en EVM sería
> obligatoria aquí sobra.

| Dirección        | Contexto                              | Quién firma                             |
| ---------------- | ------------------------------------- | --------------------------------------- |
| Usuario → bóveda | `CpiContext::new`                     | El usuario, por propagación de su firma |
| Bóveda → usuario | `CpiContext::new_with_signer` + seeds | El PDA, autorizado por el runtime       |

Las seeds del `new_with_signer` derivan **el mercado**, no la bóveda. El mismo PDA firma
en ambas direcciones; lo que cambia es de qué cuenta salen los tokens.

---

## Aritmética de precios

```
A→B:  amount_b = (amount_a × price × 10^dec_b) / (10^PRICE_DECIMALS × 10^dec_a)
B→A:  amount_a = (amount_b × 10^PRICE_DECIMALS × 10^dec_a) / (price × 10^dec_b)
```

`price` y `10^PRICE_DECIMALS` **intercambian de lado**, igual que `dec_a` y `dec_b`.
Es un reflejo exacto.

⚠️ **Tres escalas distintas conviven y NO son la misma:**

|                  | Valor | Quién la decide                    |
| ---------------- | ----- | ---------------------------------- |
| `PRICE_DECIMALS` | 6     | Constante del programa             |
| `decimals_a`     | 6 o 9 | El mint, según el orden de pubkeys |
| `decimals_b`     | 9 o 6 | El mint, según el orden de pubkeys |

En el denominador de A→B hay dos factores que **por casualidad pueden valer lo mismo**:
`10^PRICE_DECIMALS` y `10^dec_a`. No se multiplica el token A por sí mismo.

---

## Riesgos técnicos — verificar en cada cambio

1. **Aritmética en `u128`**, vuelta a `u64` con `try_into()`. `u64` desborda con
   9 decimales y precio de 6 (`amount × price × 10^9` ≈ 10²⁷ vs `u64::MAX` ≈ 1,8×10¹⁹).
   ✅ implementado en ambas funciones.
2. **Todas las multiplicaciones antes de todas las divisiones.** Ninguna división
   anidada: trunca y el denominador puede colapsar a cero. ✅
3. **El truncamiento debe favorecer al pool en ambas direcciones.** Como truncar solo
   puede REDUCIR la salida, está garantizado por construcción. ✅ probado con la
   invariante A→B→A.
4. **`set_price` requiere `has_one = authority` Y `Signer`.** ✅ probado.
5. **Output cero tras truncar** debe dar error explícito. ✅ `ZeroOutput`.
6. **Liquidez insuficiente** con error tipado antes del CPI. ✅ en ambos swaps,
   mirando la bóveda correcta en cada dirección.
7. **`add_liquidity` con ambos importes a cero** debe fallar. ✅
8. **Account confusion:** lo que impide que pasen la bóveda de otro mercado son las
   **`seeds`**, NO el `Signer`. El atacante firma legítimamente su propia transacción.
   ✅ probado — el error que salta es `ConstraintSeeds`, de Anchor.
9. **`price` en el denominador de B→A.** Sin `require!(price > 0, PriceNotSet)` antes
   de la aritmética, saldría un `MathOverflow` engañoso. ✅

---

## Estado del programa

**Fases 0–7 completadas** ✅ — programa con **27 tests en verde**, desplegado en
devnet, y **frontend funcionando con el swap verificado on-chain**.

### El frontend (Fase 7)

Next.js 15 en `frontend/`, con **31 tests de vitest** sobre los tres módulos puros
(`units`, `market`, `quote`) y `typecheck` + `build` en verde.

**Swap real desde el navegador, con Solflare contra devnet:** 1 DEMO9 → 2 DEMO6.
Firma
`24V6rz2WHL3FZsbzrGrUBU3RJEeGYmKZdgUjjw4C3cpqCQDxdZyghgQbHNb3ze4Zz3Tv6dJb53S1v1XZ8bda4DwQ`.
La transacción confirma las dos autoridades distintas (CPI 1 firmado por la wallet,
CPI 2 por el PDA del mercado), `Min Amount Out: 1,990,000` — el 0,5 % de slippage por
defecto —, el evento `SwapExecuted` con `A To B: true` y **17.031 CU de 200.000**.
El desglose está en `frontend/README.md`.

### Los tests del programa

```
initialize_market (5)
  ✔ stores the authority and both mints
  ✔ reads decimals from the mints instead of trusting the caller
  ✔ starts with price unset
  ✔ creates both vaults owned by the market PDA
  ✔ rejects mints passed in non-canonical order
set_price (3)
  ✔ lets the authority set the price
  ✔ rejects a price of zero
  ✔ rejects anyone who is not the market authority
add_liquidity (4)
  ✔ moves tokens from the depositor into both vaults
  ✔ accepts a deposit of only one side
  ✔ rejects a deposit where both amounts are zero
  ✔ rejects a token account whose mint does not match the market
swap_a_to_b (7)
  ✔ converts at the market price, honouring both token scales
  ✔ moves the input tokens into vault_a
  ✔ rejects a zero input
  ✔ rejects an output below the requested minimum
  ✔ rejects a swap larger than the liquidity in vault_b
  ✔ rejects a swap on a market whose price was never set     ← Fase 5
  ✔ rejects a vault belonging to a different market
swap_b_to_a (8)
  ✔ applies the inverse of the market price
  ✔ moves the input tokens into vault_b
  ✔ never returns more than went in on a round trip A→B→A
  ✔ rejects a zero input
  ✔ rejects an input so small that the output truncates to zero
  ✔ rejects an output below the requested minimum
  ✔ rejects a swap larger than the liquidity in vault_a
  ✔ rejects a vault belonging to a different market           ← Fase 5
```

**Todos los errores de `SwapError` están en uso**, `PriceNotSet` incluido desde la
Fase 5.

**Rúbrica cubierta:** mercado+liquidez con PDAs (30%) ✅ · swap A→B (20%) ✅ ·
swap B→A (30%) ✅ · tests (parte del 20%) ✅ · frontend ✅ (fase 7) ·
documentación ⬜ (fase 9)

### Lo que resolvió la Fase 5

- **`expectAnchorError()` sustituye los 11 `try/catch`.** Ver "Convenciones".
- **`ensureMarketReady()` en un `beforeEach` de los dos describes de swap.** Es
  idempotente: fija el precio si está a cero y rellena **solo el déficit** de cada
  bóveda hasta el mínimo (100 A / 200 B), acuñando antes lo que falte en la ATA del
  depositante. Verificado con ledger limpio ejecutando **solo** los swaps
  (`-g "swap_"`): **15 passing** sin que corrieran `set_price` ni `add_liquidity`.
- **`add_liquidity › moves tokens…` pasó de saldo absoluto a delta**, que es lo que
  promete su nombre y no exige encontrar las bóvedas vacías.
- **Margen de los tests de liquidez medido, no supuesto:** 100× en A→B (suelo 200 B
  contra 20 000 B pedidos) y 500× en B→A contra el suelo (medido 331× en una corrida
  real, porque los swaps previos habían dejado 151 A). Documentado en el propio test.

### Dependencia de orden que queda (deliberada)

`initialize_market › starts with price unset` mira el mercado principal recién creado,
así que **tiene que correr antes que `set_price`**. Quitarla significaría perder lo que
el test afirma: que `initialize_market` NO deja el mercado operativo. Mocha respeta el
orden de declaración; el test lo dice en un comentario.

### Siguiente: Fase 8 — faucet + metadata de Metaplex

La Fase 7 (frontend Next.js) está cerrada, con el swap verificado on-chain desde el
navegador — ver "Estado del programa".

La documentación general **no** es la fase 8: el README de la raíz y los diagramas
van en la fase 9, junto con el deploy a Vercel.

#### ⛔ El mercado EURC/USDC queda descartado

Era el contenido previsto de la Fase 8 y **no se hace**. Dos razones:

1. **USDC y EURC de Circle tienen ambos 6 decimales.** Con `dec_a == dec_b`, los
   factores `10^dec_a` y `10^dec_b` de la fórmula **se cancelan**: el mercado no
   ejercita la conversión de escalas, que es justo lo que DEMO6/DEMO9 (6 y 9) sí
   demuestra.
2. **El visitante tendría que ir al faucet de Circle** para conseguir EURC o USDC de
   devnet: una dependencia externa en mitad de la demo.

No aporta nada que el mercado principal no demuestre ya.

En su lugar, la Fase 8 es **faucet + metadata de Metaplex** para que DEMO6 y DEMO9
aparezcan con nombre en las wallets en vez de como direcciones.

---

## Plan completo — las 11 fases

| Fase | Contenido                                        | Estado |
| ---- | ------------------------------------------------ | ------ |
| 0    | Scaffold, toolchain, program ID                  | ✅     |
| 1    | `MarketAccount` + `initialize_market`            | ✅     |
| 2    | `set_price` + `add_liquidity`                    | ✅     |
| 3    | `swap_a_to_b` + aritmética `u128`                | ✅     |
| 4    | `swap_b_to_a` + invariante A→B→A                 | ✅     |
| 5    | Endurecer la suite                               | ✅     |
| 6    | Deploy devnet + mints propias + script de seed   | ✅     |
| 7    | Frontend Next.js                                 | ✅     |
| 8    | Faucet + metadata de Metaplex (DEMO6/DEMO9)      | ⬅️ siguiente |
| 9    | Vercel + README + diagramas + **verified build** | ⬜     |
| 10   | Video + entrega GitHub/GitLab                    | ⬜     |

### El verified build de la Fase 9

Un **verified build** permite a cualquiera reproducir el binario desde el código fuente y
comprobar que coincide con el que está desplegado on-chain. Sin él, "está desplegado" solo
significa que hay un binario en esa dirección — nadie puede saber si corresponde a este
repositorio.

**Por qué va en la Fase 9 y no antes:** se rompe con cada redespliegue, porque verifica un
binario concreto contra un commit concreto. Su producto es un badge y un enlace que van al
README. Hacerlo antes de cerrar frontend (Fase 7) y faucet (Fase 8) sería trabajo repetido.

⚠️ **El proceso hay que investigarlo cuando toque.** Existe la herramienta `solana-verify`
y un registro público, pero **el flujo exacto no está verificado en este proyecto**.
**Primera acción de esa tarea: consultar el MCP oficial de Solana**
(`Solana_Documentation_Search` / `Solana_Expert__Ask_For_Help`). Contar también con que
normalmente exige un **build reproducible dentro de Docker**, lo que aquí puede no ser
trivial dado el historial de incompatibilidades de toolchain (ver "Entorno").

---

## Convenciones

- Conventional Commits en inglés, atómicos por unidad lógica
- Código y doc-comments en inglés; notas pedagógicas con prefijo `🇪🇸 NOTA:` en español
- **Tests: nombres como aserción de lo que garantiza el programa**, no descripción del
  test. Ej: `"reads decimals from the mints instead of trusting the caller"`
- Los `describe` van todos al mismo nivel dentro del `describe` raíz, nunca anidados
  dentro del `before()`
- **Nunca `try/catch` en un test: usar `expectAnchorError(() => …rpc(), "CodigoEsperado")`.**
  El patrón `try { …; assert.fail() } catch (err) { err.error.errorCode.code }` tiene un
  bug propio: cuando la transacción **no** falla, el `assert.fail` está DENTRO del `try`,
  así que su `AssertionError` lo recoge el `catch` de al lado, y ahí `err.error` es
  `undefined`. Lo que ves es `Cannot read properties of undefined (reading 'errorCode')`
  — un mensaje que describe el bug del test y oculta el del programa. Ya pasó dos veces.
  El helper captura el error en una variable y sale del `try` antes de decidir nada,
  distinguiendo los tres casos:
  `"expected X, but the transaction succeeded"` · `"expected X, got Y"` ·
  el error crudo con su `stack` si no es de Anchor.
  Recibe un *thunk* (`() => …rpc()`), no una promesa ya lanzada, para que también capture
  lo que el cliente tire de forma síncrona antes de enviar la transacción.
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
- ⚠️ **El mapeo "token que el usuario ve" ↔ A/B necesita test propio.** Con orden
  canónico, "vender USDC" puede ser `swap_a_to_b` o `swap_b_to_a` según el orden de las
  pubkeys. El patrón de ordenación está en el `before()` del test. Asumir la dirección
  ya causó un fallo en la Fase 4 — y fue en un test, que es donde menos duele.
