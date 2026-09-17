# Frontend — Solana Token Swap (devnet)

Next.js 15 (App Router) + TypeScript strict + Tailwind v4. Talks to the program
deployed on devnet, reading state with `getAccountInfo` and sending the two swap
instructions.

```bash
yarn install
yarn sync:onchain   # ⚠️ ver abajo
yarn dev            # http://localhost:3000
```

Optional `.env.local` (see `.env.local.example`): `NEXT_PUBLIC_RPC_URL` for a
dedicated devnet RPC. Without it the app uses `clusterApiUrl("devnet")`, which is
rate-limited but enough for a demo.

## ⚠️ `yarn sync:onchain` — cuándo hay que reejecutarlo

El frontend **no** lee `target/` ni el `devnet.json` de la raíz en tiempo de
ejecución: los dos quedan fuera del clon que Vercel construye (`target/` está en
`.gitignore`, y `devnet.json` vive por encima del Root Directory `frontend/`).
`yarn sync:onchain` los copia byte a byte a `src/`, y esas copias **se commitean**:

| Origen                                     | Copia                                    |
| ------------------------------------------ | ---------------------------------------- |
| `target/idl/solana_token_swap.json`        | `src/idl/solana_token_swap.json`         |
| `target/types/solana_token_swap.ts`        | `src/idl/solana_token_swap.ts`           |
| `target/types/solana_token_swap_errors.ts` | `src/idl/solana_token_swap_errors.ts`    |
| `devnet.json`                              | `src/config/devnet.json`                 |

**Reejecutarlo y commitear el resultado después de:**

- cualquier `anchor build` que cambie el programa (instrucciones, cuentas, errores),
- cualquier `anchor deploy` a una dirección nueva,
- cualquier `npx ts-node scripts/seed-market.ts` (reescribe `devnet.json`).

La única fuente de verdad sigue siendo el original. Este script no transforma nada.

### Qué pasa si te olvidas

Copiar crea una forma nueva de fallar: que el frontend hable de un despliegue que
ya no existe mostrando datos plausibles. Por eso hay **tres comprobaciones que
revientan en el arranque** (y en `next build`, que prerenderiza la página), no en
el primer swap:

1. `sync-onchain.mjs` aborta si el `address` del IDL y el `programId` del manifest
   no coinciden — no llega a dejar copias incoherentes.
2. `src/lib/manifest.ts` repite esa comparación al importarse, por si las copias se
   editaron a mano.
3. `src/lib/program.ts` **deriva** el mercado y las dos bóvedas con las mismas seeds
   que el programa y las compara con las del manifest.

Las tres lanzan con el mismo remedio en el mensaje: `yarn sync:onchain`. Verificado
rompiendo las copias a propósito: el build falla con
`Error: Stale on-chain artefacts: …`.

## Arquitectura

```
src/
  app/          layout, providers (wallet + connection), página única
  components/   Header · MarketPanel · FaucetNotice · SwapCard · TxResult · Footer
  hooks/        useMarketState · useTokenBalances · useSolBalance
  lib/
    manifest.ts  el manifest tipado + la comprobación de obsolescencia
    market.ts    🔴 símbolo ↔ A/B y dirección del swap          (market.test.ts)
    units.ts     unidades base ↔ display, todo en bigint        (units.test.ts)
    quote.ts     la aritmética del programa, en el cliente      (quote.test.ts)
    program.ts   PDAs derivados + handle de Anchor
    swap.ts      las dos instrucciones de swap
    errors.ts    código de error de Anchor → una frase útil
```

`yarn test` (vitest, 31 tests) cubre los tres módulos puros. No tocan la red.

### 🔴 El mapeo A/B

`market.ts` es el **único** sitio que traduce "el token que el usuario eligió" a
`swap_a_to_b` / `swap_b_to_a`, y lo **lee** de `mintAIs` / `mintBIs` en el manifest.
Cuál de los dos es A lo decide `mint_a.key() < mint_b.key()`: ni el nombre, ni los
decimales, ni el valor. En este despliegue DEMO9 es el token A, pero eso es una
propiedad **del despliegue**, no de DEMO9 — reacuñar las mints puede darle la vuelta.

`market.test.ts` lo fija con tres casos: el despliegue real, un manifest con la
asignación invertida (la dirección se da la vuelta) y — el que importa — dos
manifests con la **misma** asignación A/B y los decimales intercambiados, donde la
dirección **no** se mueve. Ese último es el que se pone rojo si alguien vuelve a
deducir el lado de los decimales, que es el fallo que ya ocurrió en la fase 4.

### Las cuentas de los swaps

Seis, no siete. `market` es un self-referencing PDA (sus seeds salen de
`market.token_mint_a`), así que el resolver de Anchor no puede derivarlo y van a
mano el mercado y las dos bóvedas. `tokenProgram` **no** se pasa: Anchor lo resuelve
por su dirección fija del IDL y rechaza que se le pase. El objeto va en una variable
declarada `any` — el cast en línea `{ … } as any` no sirve, porque TypeScript valida
el literal antes de aplicarlo. Mismo patrón que `scripts/swap-demo.ts`.

### Wallets

`wallets={[]}` en el `WalletProvider`. Phantom, Solflare y Backpack implementan el
Wallet Standard y se anuncian solas; el adapter las recoge. `@solana/wallet-adapter-wallets`
no está instalado a propósito.

### Sin faucet en esta fase

La mint authority de DEMO6 y DEMO9 es la wallet del desplegador, así que **solo ella**
puede conseguir tokens de prueba. El aviso está siempre visible encima de la tarjeta
de swap, y con balance cero el botón queda deshabilitado con "Not enough …": el
usuario se entera antes de intentarlo, no después de que falle. El faucet es la fase 8.

## Estado de verificación

| Comprobación                                        | Estado |
| --------------------------------------------------- | ------ |
| `yarn test` — 31 tests                               | ✅ |
| `yarn typecheck`                                     | ✅ |
| `yarn build`                                         | ✅ |
| Comprobación de manifest obsoleto rompe el build     | ✅ (provocada a propósito) |
| Lectura del mercado real de devnet con estos módulos | ✅ (precio 2.000000, decimales 9/6, bóvedas 1000/2000) |
| **Swap real desde el navegador con una wallet**      | ✅ (Solflare, devnet) |

## La prueba del swap end-to-end

Swap real ejecutado desde el navegador con **Solflare** contra devnet:
**1 DEMO9 → 2 DEMO6**.

[Ver la transacción en Solana Explorer](https://explorer.solana.com/tx/24V6rz2WHL3FZsbzrGrUBU3RJEeGYmKZdgUjjw4C3cpqCQDxdZyghgQbHNb3ze4Zz3Tv6dJb53S1v1XZ8bda4DwQ?cluster=devnet)

```
24V6rz2WHL3FZsbzrGrUBU3RJEeGYmKZdgUjjw4C3cpqCQDxdZyghgQbHNb3ze4Zz3Tv6dJb53S1v1XZ8bda4DwQ
```

Lo que confirma, punto por punto:

| Lo que se ve en la transacción      | Lo que demuestra                                           |
| ----------------------------------- | ---------------------------------------------------------- |
| CPI 1, authority = la wallet        | La firma del usuario se propaga al CPI — sin `approve`     |
| CPI 2, authority = el PDA `market`  | `new_with_signer` con las seeds del mercado                |
| `Min Amount Out: 1,990,000`         | El slippage por defecto del 0,5 % sobre los 2 DEMO6 esperados |
| Evento `SwapExecuted`, `A To B: true` | Dirección resuelta por `market.ts`: DEMO9 es el token A  |
| 17.031 CU de 200.000                | Margen de sobra sobre el límite por instrucción            |

El `Min Amount Out` en unidades base con 6 decimales es 1,99 DEMO6 — el 99,5 % de los
2 DEMO6 que da el precio de 2.000000. Que la salida real fuera exactamente 2 DEMO6
(y no menos) es lo esperado en un mercado de precio fijo sin fees: el slippage aquí
protege contra un `set_price` que se cuele entre la cotización y la confirmación, no
contra el impacto del propio swap.
