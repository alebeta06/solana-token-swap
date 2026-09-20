# solana-token-swap — Contexto del proyecto

Proyecto del Máster CodeCrypto (Blockchain Engineering & AI), Módulo 15 — Token Swap.
Swap de tokens SPL con precio fijo, en Anchor. **Primera experiencia del autor con
Solana y Rust** — explicar antes de implementar, comparando siempre con Solidity/EVM.

> ⚠️ **Estado actual: Fases 0–8 completadas — el faucet funciona en producción.
> La Fase 9 está EN CURSO: el README de la raíz está escrito (bloque 2); quedan el
> deploy documentado en Vercel y el verified build.**
> Son 11 fases (0 a 10). Ver "Plan completo — las 11 fases" y "Estado del programa".

> 🔴 **Tarea pendiente, anterior a cerrar la Fase 9 — REGRESIÓN, no limitación de
> diseño:** `scripts/swap-demo.ts` y `scripts/seed-market.ts` tienen que leer
> `FAUCET_KEYPAIR` para sus `mintTo`. Llevan roto desde el traspaso de la mint
> authority en la Fase 8 y no se notó porque no se han vuelto a ejecutar. Un script
> roto en el repo es algo que el evaluador puede intentar correr. Ver "Efecto
> colateral abierto".

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
- **NUNCA generar keypairs desde el agente.** Las genera Alejandro en su terminal.
  `solana-keygen new` es **la única operación del proyecto cuya salida es irrecuperable
  si no se lee en el momento**: la seed phrase se imprime una vez y no se reconstruye
  después. Un fichero de keypair de Solana son **64 bytes de clave en bruto y no
  contiene la mnemónica** — de `faucet.json` NO se recupera la seed phrase. Además,
  generarla desde un tool call la escribiría en el transcript de la sesión.
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

### ⚠️ El repo tiene DOS alcances: correr uno no es correr todo

Hay **dos `tsconfig.json`** y **dos runners de test**, con alcances disjuntos:

| Alcance      | tsconfig                | Runner | Qué cubre                             |
| ------------ | ----------------------- | ------ | ------------------------------------- |
| Raíz         | `tsconfig.json`         | Mocha (`ts-mocha`) | `scripts/`, `tests/`, `target/types/` |
| Frontend     | `frontend/tsconfig.json`| Vitest | `frontend/**`                         |

**Quien corre uno y cree que ha corrido todo, se equivoca. Ya ha causado dos falsos
positivos.** Las dos configuraciones son incompatibles a propósito: la raíz va en
`commonjs` sin `jsx` ni `dom`; el frontend en `esnext` + `bundler` con `jsx`,
`resolveJsonModule` y el alias `@/`.

El comando que cubre los dos a la vez:

```bash
yarn typecheck:all      # = yarn typecheck && yarn typecheck:frontend
```

⚠️ **Para los tests no existe equivalente**: hay que correr los dos a mano.

```bash
anchor test --skip-local-validator   # 27 tests del programa (necesita el validador)
yarn --cwd frontend test             # 31 tests de vitest
```

**El `include` del tsconfig raíz es explícito y debe seguir siéndolo.** Sin `include`
ni `exclude`, TypeScript arrastra *todo* el subárbol: hasta la Fase 8 el alcance raíz
eran 37 ficheros, 29 de ellos de `frontend/`, comprobados por segunda vez con la
configuración equivocada y produciendo 141 errores que no eran reales. `skipLibCheck`
tampoco es cosmético: `@metaplex-foundation/umi` publica `.d.ts` que referencian tipos
que no define, y sin esa opción no compila nada que importe umi.

### ⚠️ Artefactos generados commiteados — hay que regenerarlos a mano

`target/` está en el `.gitignore`, **con tres excepciones que sí están commiteadas:**

```
target/idl/solana_token_swap.json
target/types/solana_token_swap.ts
target/types/solana_token_swap_errors.ts
```

Sin ellas, quien clone el repo —el evaluador incluido— no puede correr
`yarn typecheck`: `tests/` y `scripts/` importan `../target/types/solana_token_swap`,
que lo genera `anchor build`. Con ellas, el repo es autosuficiente para el typecheck
sin instalar el toolchain de Solana. El IDL va además porque es el artefacto que
necesita cualquier cliente para hablar con el programa, y porque tener el origen
permite comprobar que la copia de `frontend/src/idl/` está al día.

🔴 **Tras cualquier cambio en `programs/`: `anchor build` y commitear esos tres
ficheros regenerados.** Git no avisa de que están atrasados — son ficheros normales,
no hay hook ni check. Un typecheck en verde contra un IDL viejo **no comprueba nada
real**: valida el cliente contra un programa que ya no existe. Lo mismo vale para las
tres copias de `frontend/src/idl/`, que hay que actualizar desde `target/` (`diff` las
seis para verificarlo).

⚠️ **Nada más de `target/`.** El `.so`, la keypair del programa y los artefactos de
compilación siguen ignorados. Comprobarlo con
`git add -A --dry-run | grep target` antes de commitear.

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

### Cómo se llama (los dos puntos que rompen una consulta)

1. 🔴 **Pasar `cluster: "devnet"` SIEMPRE, explícitamente.** El parámetro tiene
   `default: "mainnet-beta"`, donde no existe nada de este proyecto. Omitirlo no da
   error: da `NOT_FOUND`, que se lee como "esa cuenta no existe" cuando lo que pasa es
   que se preguntó a la red equivocada.
2. 🔴 **Leer `errors[]` en cada respuesta**, aunque venga `payload`:
   - `NOT_FOUND` — no existe **en ese cluster**. Antes de concluir nada, comprobar que
     el cluster era el correcto. Y ojo: el MCP hereda los huecos del nodo que tenga
     detrás, así que también sale `NOT_FOUND` cuando la entidad existe pero su nodo no
     la tiene. Verificado en la evaluación con una firma que `getSignaturesForAddress`
     sí lista y que el RPC público tampoco resuelve.
   - `CURRENTLY_UNSUPPORTED` — reconoce el tipo de cuenta pero no sabe decodificarla.
     **Es una respuesta, no un fallo.**

⚠️ **Cubre `mainnet-beta`, `devnet` y `testnet` — y nada más.** No alcanza
`solana-test-validator` ni LiteSVM, así que **durante los tests locales no sirve**: ahí
la fuente es el validador y el propio `anchor test`. Aplica **sobre lo desplegado en
devnet** — el criterio es el cluster, no la fase.

### Qué hace bien y qué NO (medido, 9 consultas, 2026-09-18)

Evaluación con las direcciones de `devnet.json`. Detalle en la conversación; resumen
operativo:

**Acierta:** `MarketAccount` decodificado campo a campo con los valores correctos
—incluidos los tres bumps, verificados aparte con `findProgramAddressSync`— porque el
IDL está publicado on-chain en el **program-metadata program** (`idl.source: "pmp"`),
no porque se lo demos. Instrucciones decodificadas con sus cuentas nombradas. Los dos
CPIs de un swap con **las autoridades correctas y distintas**: la wallet firma la
entrada, el PDA del mercado la salida. Mints completos. Programas con
`upgrade_authority` y `verification.status` (hoy `unverified` — eso cambia en Fase 9).

**Cuatro huecos que hay que suplir por otra vía:**

1. **Las token accounts NO traen saldo.** Ni las bóvedas ni las ATAs: devuelve
   `mint`, `owner` y `token_program`, nunca `amount`. Para saldos, `getTokenAccountBalance`.
2. **Los eventos `emit!` no se decodifican**, aunque las instrucciones del mismo IDL sí.
   Quedan como `Program data: <base64>` en los logs.
3. **Metaplex Token Metadata no se decodifica:** devuelve `{"kind":"unknown"}` vacío y
   `errors: []` — falla en silencio, sin `CURRENTLY_UNSUPPORTED`. **Se suple leyendo el
   `data` a mano** — verificado en la Fase 9 sobre las dos metadatas:

   ```bash
   solana account <PDA_de_la_metadata> --output json --url devnet
   ```

   Layout: **1 byte de `key`** (`4` = `MetadataV1`), **32 bytes de update authority**,
   **32 de mint**, y luego `name` / `symbol` / `uri`, cada uno con 4 bytes de longitud
   por delante. El mint que sale ahí sirve de control: si no cuadra con el manifest, se
   está leyendo otra cuenta. Resultado en la Fase 9: update authority `9aaPGTS7…` en
   DEMO6 y DEMO9 — **no el faucet**, que es lo que había que descartar.
4. **`kind: "unknown"` en cuentas que sí decodifica** (el propio `MarketAccount`). No
   enrutar por `kind`: mirar si hay `decoded`.

**Y no deriva nada.** Solo mira direcciones que ya tienes: no acepta seeds, no calcula
PDAs, no sabe que DEMO9 es el token A *de este despliegue* (eso vive en el manifest) y
no computa `min_amount_out`. Eso sigue siendo nuestro.

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

### En curso: Fase 8 — faucet + metadata de Metaplex

Cuatro pasos. **Los pasos 1 y 2 están cerrados; el 3 y el 4 están escritos y a falta
de probarlos contra devnet desde el navegador.**

| Paso | Contenido                                                        | Estado |
| ---- | ---------------------------------------------------------------- | ------ |
| 1    | Metadata de Metaplex en DEMO6 y DEMO9                            | ✅     |
| 2    | Keypair dedicada del faucet + traspaso de la mint authority      | ✅     |
| 3    | Route handler del faucet en Next.js (acuña a la ATA del visitante) | 🔄 escrito, sin probar |
| 4    | Botón de faucet en el frontend, en lugar del `FaucetNotice`      | 🔄 escrito, sin probar |

La documentación general **no** es la fase 8: el README de la raíz y los diagramas
van en la fase 9, junto con el deploy a Vercel.

#### Paso 1 — metadata (cerrado)

`scripts/upload-metadata.ts` (imagen + JSON a Pinata) y
`scripts/create-token-metadata.ts` (`CreateMetadataAccountV3` sobre cada mint). Los
`uri` y las PDAs quedaron registrados en `devnet.json`.

⚠️ **Va antes del paso 2 por obligación:** `CreateMetadataAccountV3` exige que firme
la **mint authority**. Una vez traspasada al faucet, la metadata solo la podría crear
el faucet. En cambio la **update authority es un dato, no un firmante**: se fijó a
`9aaPGTS7…` y ahí se queda. El faucet acuñará, pero no podrá renombrar los tokens.

#### Paso 2 — keypair del faucet (cerrado)

Keypair dedicada en `~/.solana-keys/faucet.json` (`chmod 600`, **fuera del repo**),
que solo pueda acuñar DEMO6 y DEMO9. Objetivo: no poner en un servidor la clave que
también es autoridad del programa desplegado y del mercado.

Orden obligatorio, sin saltos:

1. Generar la keypair.
2. **Respaldarla y verificar el respaldo comparando pubkeys** (`solana-keygen pubkey`
   sobre el original y sobre la copia) **antes de traspasar nada**. Si esa keypair se
   pierde después del traspaso, DEMO6 y DEMO9 se quedan con el supply congelado para
   siempre — nadie podrá volver a acuñar.
3. Traspasar la mint authority de ambos mints, firmando con `9aaPGTS7…`.
4. Enviar **0,5 SOL** al faucet. La cifra es deliberada: cada ATA nueva cuesta
   ~0,002 SOL, así que cubre ~250 visitantes y es el **tope de daño** si alguien abusa.
5. Verificar el traspaso por partida doble: `spl-token display` muestra la authority
   nueva **y** `9aaPGTS7…` ya **no** puede acuñar (comprobarlo intentándolo). Lo
   segundo es lo que demuestra que el privilegio se movió, no que se duplicó.
6. Confirmar que la **update authority de la metadata NO cambió**.

En el manifest se registra **solo la pubkey** del faucet. Nunca la privada, ni el
fichero, ni en ningún `.env` commiteado.

**Resultado (2026-09-18)** — `scripts/transfer-mint-authority.ts`, que hace dry-run por
defecto y solo firma con `--execute`:

| Comprobación                                              | Resultado |
| --------------------------------------------------------- | --------- |
| Faucet                                                     | `GTxTmFKt58JTTAVohkSM9aKfiFsz2atoo7GEPfFMmik2` |
| Mint authority de DEMO6 y DEMO9 (`spl-token display`)      | el faucet ✅ |
| `9aaPGTS7…` intenta acuñar                                 | falla con `owner does not match` ✅ |
| Update authority de la metadata de ambos                   | sigue en `9aaPGTS7…` ✅ |
| Balance del faucet                                         | 0,5 SOL ✅ |

Firmas: DEMO6 `4BEabMLj…`, DEMO9 `3DF6be5a…`, fondeo `3ob27XJd…`.

🔴 **REGRESIÓN ABIERTA, no una limitación de diseño:** `scripts/seed-market.ts` y
`scripts/swap-demo.ts` acuñan con `~/.config/solana/id.json`, que ya no es mint
authority. Fallarán **cuando necesiten acuñar** — seed-market solo si hay déficit en
las bóvedas (hoy están llenas, así que hoy es no-op); swap-demo siempre que le falte
saldo. El arreglo es leer la keypair del faucet de `FAUCET_KEYPAIR` para el `mintTo`.
**Sin hacer, y es tarea pendiente de la Fase 9.**

Lo que lo dejó pasar no fue el traspaso, fue que **nadie volvió a ejecutar los
scripts**: un script solo se rompe a la vista cuando se corre. Documentado como
regresión en el README de la raíz ("Known limitations"), no como decisión.

#### Paso 3 — el único sitio del proyecto con una clave privada en un servidor

`POST /api/faucet` acuña 10 DEMO9 + 20 DEMO6. La política vive en
`frontend/src/lib/faucet.ts` —sin red, con 13 tests— y el handler solo habla con la
cadena. El detalle completo (códigos de respuesta, los dos límites, la prueba del
bundle y las variables de Vercel) está en `frontend/README.md`.

⚠️ **Pendiente: ejecutarlo contra devnet.** Falta `frontend/.env.local` con
`FAUCET_KEYPAIR`, que crea Alejandro.

⚠️ **Una wallet NUEVA por cada prueba, y nunca la de Alejandro.** La suya ya
tiene saldo de los dos tokens, así que el faucet le responderá siempre 429 y el camino
del 200 —que es el que hay que ver funcionar desde el navegador— no se ejercitaría.

**El límite mira el SALDO del destinatario, no si su ATA existe.** Crear la ATA de
otro puede hacerlo cualquiera —la instrucción no exige la firma del dueño, solo que
alguien pague la renta—, así que "¿tiene ATA?" como criterio convertía el límite en un
**vector de bloqueo**: un atacante excluía del faucet a las direcciones que quisiera.


⚠️ La variable de entorno con la keypair del faucet **NO lleva prefijo
`NEXT_PUBLIC_`**. Ese prefijo la embebería en el bundle del navegador y la haría
pública.

⚠️ **El vector de ataque a vigilar no es el supply de tokens** — DEMO6 y DEMO9 no
valen nada. **Es el SOL del faucet:** cada ATA nueva cuesta ~0,002 SOL que paga el
servidor, así que un bucle de direcciones distintas lo drena. De ahí el tope de 0,5 SOL
del paso 2, y de ahí que el endpoint necesite rate limit.

#### Paso 4 — la UI del faucet

`FaucetPanel` sustituye al `FaucetNotice`. La traducción respuesta → mensaje vive en
`frontend/src/lib/faucetStatus.ts`, sin red y con tests; el componente solo pinta.

**El rojo se reserva a lo que está roto** (500, 502, sin respuesta). El 429 va en
ámbar y en positivo: no es un fallo, es que esa wallet ya tiene lo que venía a pedir, y
en rojo junto a los demás parecería averiado un faucet que funciona. El 503 dice que no
es culpa del visitante. El verde sigue significando "acaba de confirmarse algo
on-chain", igual que en `TxResult`.

**Bug del paso 4, arreglado:** el faucet acuñaba bien y devolvía 502, porque la
relectura posterior a la confirmación caía en un backend atrasado del RPC. Ver la
lección de `minContextSlot` en "Convenciones" y el detalle en `frontend/README.md`.
Los tres 500 de configuración ya devuelven cuál de los tres fallos es, con `reason`.

⚠️ **El 503 del servidor sigue sin ejercitarse:** provocarlo exigiría drenar el faucet
por debajo de 0,05 SOL. Su renderizado sí está cubierto en test. Límite conocido,
escrito en `frontend/README.md`.

#### ⛔ El mercado EURC/USDC queda descartado

Era el contenido previsto de la Fase 8 y **no se hace**. Dos razones:

1. **USDC y EURC de Circle tienen ambos 6 decimales.** Con `dec_a == dec_b`, los
   factores `10^dec_a` y `10^dec_b` de la fórmula **se cancelan**: el mercado no
   ejercita la conversión de escalas, que es justo lo que DEMO6/DEMO9 (6 y 9) sí
   demuestra.
2. **El visitante tendría que ir al faucet de Circle** para conseguir EURC o USDC de
   devnet: una dependencia externa en mitad de la demo.

No aporta nada que el mercado principal no demuestre ya. En su lugar, la Fase 8 es
el faucet y la metadata: que DEMO6 y DEMO9 aparezcan con nombre en las wallets, y que
cualquier visitante consiga tokens sin pedírselos al desplegador.

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
| 8    | Faucet + metadata de Metaplex (DEMO6/DEMO9)      | ✅     |
| 9    | Vercel + README + diagramas + **verified build** | 🔄 en curso (README de la raíz ✅) |
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
- 🔴 **Una prueba que modifica el estado que comprueba deja de ser válida a la segunda
  ejecución.** Probar el faucet CREA la ATA, así que el segundo intento con la misma
  wallet ya no reproduce el caso de una wallet nueva — que es el único caso que el
  faucet existe para servir. **Wallet nueva por prueba, sin excepciones.** Reutilizarlas
  ocultó durante todo el paso 3 de la Fase 8 un bug que devolvía 502 después de acuñar
  bien. Aplica a cualquier prueba con efectos: el ledger de los tests (`rm -rf
  test-ledger`) es el mismo principio.
- 🔴 **`confirmTransaction` de web3.js confirma por WebSocket (`signatureSubscribe`) y
  no todos los RPC lo exponen.** El de Alchemy de este proyecto responde `-32601 Method
  not found`; la librería reintenta, agota el plazo y lanza
  `TransactionExpiredBlockheightExceededError` **después de que la transacción se haya
  ejecutado**. Confirmar sondeando `getSignatureStatuses` (HTTP) funciona con cualquier
  proveedor. Los dos caminos que mandan transacciones —faucet en el servidor y swap en
  el navegador— confirman ya con `frontend/src/lib/confirm.ts`. **El proyecto no
  depende de `signatureSubscribe` en ninguna parte**, y `frontend/README.md` documenta
  qué necesita un RPC para servirlo.
- **Se confirma a `confirmed`, nunca a `processed`.** `processed` devuelve estado que la
  cadena puede descartar: se daría por buena una transacción que no ocurrió. El doble
  clic ya lo acota la UI deshabilitando el botón. Peor caso de esperar: acuñar dos veces
  unos tokens de prueba. Peor caso de `processed`: enseñar un estado que nunca existió.
- ⚠️ **Mandar la transacción a mano cuesta los mensajes de error de Anchor.** Sin
  `.rpc()` el error llega crudo (`custom program error: 0x1775`); `errors.ts` resuelve
  el hexadecimal contra los códigos generados del IDL, en el mensaje y en los logs.
- 🔴 **"No pude confirmarlo" no es "falló".** Si el mint pudo ejecutarse, decir que no
  se acuñó nada manda a reintentar a quien ya ha recibido — y entonces le sale un
  "ya tienes tokens" que le contradice. Códigos distintos (502 vs 504) y textos
  distintos.
- 🔴 **El blockhash se pide `finalized`, no `confirmed`.** Lo pide una petición y la
  simulación la hace otra: con un proveedor multinodo pueden caer en backends distintos
  y el preflight falla con `Blockhash not found`, **de forma intermitente**. Un
  blockhash finalizado tiene ~31 slots de antigüedad contra los 3 de desfase medido. El
  coste, medido: la ventana de validez baja de ~146 a ~115 bloques (~59 s → ~46 s).
- **El reintento de blockhash NO es automático en el navegador.** Cambiar el blockhash
  invalida la firma de la wallet, así que reintentar abre el popup por segunda vez y el
  usuario no sabe si pagará dos. El swap avisa y deja el botón listo; el faucet, que
  firma con clave propia y sin humano delante, reintenta una vez en silencio.
- 🔴 **En Solana, leer justo después de escribir necesita `minContextSlot`.** El RPC
  público es un balanceador: sus backends van desfasados entre sí (medido: ~1,2 s en
  devnet), así que la lectura posterior a una confirmación puede caer en un nodo que aún
  no ha visto la transacción y devolver el estado viejo *sin error*. Se pasa el slot de
  la confirmación y el RPC falla con `-32016` en vez de mentir. Ver `frontend/README.md`.
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
