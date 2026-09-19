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

Para que el faucet funcione en local hace falta además `FAUCET_KEYPAIR` — ver
"El faucet" más abajo. Sin ella la web va entera menos `/api/faucet`, que
responde 500.

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
    api/faucet/   🔴 route handler del faucet — el único sitio con clave privada
  components/   Header · MarketPanel · FaucetPanel · SwapCard · TxResult · Footer
  hooks/        useMarketState · useTokenBalances · useSolBalance
  lib/
    manifest.ts  el manifest tipado + la comprobación de obsolescencia
    rpc.ts       el endpoint RPC, resuelto una vez para servidor y navegador
    faucet.ts    🔴 la política del faucet, sin red                (faucet.test.ts)
    faucetStatus.ts  qué significa cada respuesta del faucet    (faucetStatus.test.ts)
    market.ts    🔴 símbolo ↔ A/B y dirección del swap          (market.test.ts)
    units.ts     unidades base ↔ display, todo en bigint        (units.test.ts)
    quote.ts     la aritmética del programa, en el cliente      (quote.test.ts)
    program.ts   PDAs derivados + handle de Anchor
    swap.ts      las dos instrucciones de swap
    errors.ts    código de error de Anchor → una frase útil
```

`yarn test` (vitest, 55 tests) cubre los cinco módulos puros. No tocan la red: la
política del faucet se decide en `faucet.ts` justo para poder probarla sin cadena.

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

## El faucet — `POST /api/faucet`

Acuña **10 DEMO9 y 20 DEMO6** a la ATA de una wallet que no tenga ninguno de los dos.
Lo llama el botón de `FaucetPanel`, encima de la tarjeta de swap.

```bash
curl -X POST http://localhost:3000/api/faucet \
  -H 'content-type: application/json' \
  -d '{"address":"<wallet>"}'
```

| Código | Cuándo |
| ------ | ------ |
| 200 | Acuñado y **verificado**: devuelve `signature` y los saldos nuevos |
| 400 | La dirección falta, no es base58 válido, o es una PDA |
| 429 | Esa wallet ya tiene saldo de alguno de los dos tokens |
| 500 | `FAUCET_KEYPAIR` ausente, mal formada, o de otra clave — con `reason` |
| 502 | El mint **falló**: no se acuñó nada y se puede volver a pedir |
| 503 | El faucet se quedó sin SOL |
| 504 | Se mandó pero **no se pudo confirmar** a tiempo — puede haber llegado |

El 200 **no se devuelve por optimismo**: tras confirmar la transacción se releen las
dos ATAs y se exige que el delta sea exactamente el prometido. Si no cuadra, es un 502
con la firma para que se pueda mirar. (Viene de un fallo real del paso 1 de esta fase:
un `curl` de verificación que no miraba su propio status habría dado por bueno un 404.)

### 🔴 Requisitos del RPC — solo HTTP, nada de WebSocket

**Esto es lo que rompió el faucet en la primera prueba real, y afecta al despliegue.**

`connection.confirmTransaction` confirma **suscribiéndose por WebSocket** con
`signatureSubscribe`, y no todos los proveedores lo exponen. El endpoint de Alchemy
configurado en este proyecto responde:

```
Received JSON-RPC error calling `signatureSubscribe`
error: { code: -32601, message: "Method 'signatureSubscribe' not found" }
…
[faucet] mint failed: TransactionExpiredBlockheightExceededError
POST /api/faucet 502 in 26840ms
```

La librería reintenta ocho veces, agota el plazo y lanza — **pero el mint ya se había
ejecutado**. Los tokens llegaban a la wallet y el endpoint devolvía 502 a los 27
segundos. Con el RPC público no pasaba, porque ese sí soporta la suscripción: el fallo
dependía del proveedor, no del código.

El handler ya **no usa WebSocket en ningún punto**. Confirma sondeando
`getSignatureStatuses`, que es HTTP y está en cualquier RPC:

| Necesita | Método | Por qué |
| -------- | ------ | ------- |
| Sí | `getSignatureStatuses` | Confirmar sin suscripción |
| Sí | `getMultipleAccounts` con `minContextSlot` | Leer sin carreras (ver abajo) |
| Sí | `getLatestBlockhash`, `getBlockHeight`, `sendTransaction`, `getBalance` | Lo básico |
| **No** | `signatureSubscribe` / `accountSubscribe` | Ya no se usan |

⚠️ **`NEXT_PUBLIC_RPC_URL` afecta también al navegador, y ahí el swap SÍ depende del
WebSocket:** `src/lib/swap.ts` usa `.rpc()` de Anchor, que confirma igual que lo hacía
el faucet. Con un RPC sin `signatureSubscribe`, el swap del navegador fallará del mismo
modo aunque la transacción entre. **Pendiente de arreglar** — no entraba en el alcance
de este arreglo, pero hay que resolverlo antes de la Fase 9.

### Plazos

| Etapa | Plazo |
| ----- | ----- |
| Confirmación (`getSignatureStatuses`, cada 400 ms) | 10 s |
| Verificación de saldos (`minContextSlot`, cada 400 ms) | 5 s |

Antes eran 27 segundos hasta el error, casi todo el presupuesto de una función
serverless. La ruta declara `maxDuration = 30`; **comprobar que el plan de Vercel lo
permite** antes de desplegar.

### 🔴 Leer justo después de escribir: `minContextSlot`

**El fallo que costó el paso 4.** El faucet acuñaba bien y devolvía 502: los tokens
llegaban a la wallet y la UI decía que no. Al segundo clic salía un 429 diciendo que ya
los tenía — dos mensajes que se contradicen, y los dos ciertos para la lectura que hizo
cada uno.

`confirmTransaction` se entera por **WebSocket**, en cuanto el nodo que confirmó la
transacción la ve. La lectura siguiente es una **petición HTTP nueva**, y
`api.devnet.solana.com` es un balanceador. Medido con 20 `getSlot` simultáneos:

```
slots devueltos en el mismo instante: 500549320 … 500549323
spread entre backends = 3 slots (~1,2 s)
```

Si la relectura caía en un nodo atrasado, la ATA recién creada "no existía", el saldo
salía 0 y el delta no cuadraba. Peor: `balanceOf` traduce "cuenta inexistente" a **0**,
que es correcto ANTES de acuñar y es exactamente lo contrario DESPUÉS. El valor por
defecto mentía en el único sitio donde importaba.

El arreglo es `minContextSlot`, que es el mecanismo diseñado para esto: se pasa el slot
de la confirmación y el RPC **prefiere fallar antes que contestar con datos
anteriores**. Comprobado contra el RPC público:

```
minContextSlot = slot + 5000  →  -32016 "Minimum context slot has not been reached"
minContextSlot = slot - 50    →  ok, context slot 500553712
```

Un nodo atrasado deja de ser un cero silencioso y pasa a ser un "todavía no" que se
reintenta (15 s, cada 400 ms). **Y el 200 devuelve ese `slot`**, que el navegador
reenvía en su refresco de saldos: sin eso, el frontend repetía la misma carrera que el
handler acababa de ganar y pintaba 0 justo después de recibir tokens.

Ni `finalized` arregla esto: el desfase es entre backends, no entre niveles de
compromiso.

### La UI — `FaucetPanel`

Cada respuesta del endpoint significa algo distinto para quien pulsa el botón, y la
traducción vive en `src/lib/faucetStatus.ts` —sin red, con tests— no en el componente.

| Código | Tono | Título | Por qué ese tono |
| ------ | ---- | ------ | ---------------- |
| 200 | verde `#14F195` | Tokens sent | Acaba de confirmarse algo on-chain; enlaza la firma |
| 429 | ámbar `#F5A623` | You already have tokens | 🔴 **No es un error.** Ya tiene lo que venía a pedir |
| 503 | ámbar `#F5A623` | The faucet is empty | No es culpa suya, y el texto lo dice |
| 400 | ámbar `#F5A623` | Connect your wallet first | Le falta un paso, no ha fallado nada |
| 502 | rojo `#FF5C5C` | The mint did not go through | No se acuñó nada; puede volver a pedir |
| 504 | rojo `#FF5C5C` | Could not confirm the mint | 🔴 **No dice que falló:** puede haber llegado |
| 500 · sin respuesta | rojo `#FF5C5C` | | El despliegue o la red están rotos |

**El rojo se reserva a lo que está roto.** Un 429 en rojo, junto a los demás, haría
parecer averiado un faucet que funciona perfectamente: el mensaje va en positivo y sin
las palabras "error", "failed" ni "rejected" — hay un test que lo comprueba.

El verde se reserva a "acaba de pasar algo en la cadena", que es lo que significa en
`TxResult`. El 429 es un estado bueno, pero no ha acuñado nada; en verde parecería que
sí.

El botón queda deshabilitado sin wallet (*"Connect a wallet to use the faucet"*) y
mientras la petición está en vuelo (*"Minting…"*, con un punto que pulsa). Al recibir
un 200 refresca los balances de la tarjeta de swap.

**El aviso del SOL está siempre visible**, no solo tras acuñar: el faucet da tokens, no
SOL, y sin SOL el swap falla al firmar. Enseñarlo después del 200 sería tarde — para
entonces ya ha pulsado Swap y ha visto un error que no entiende. Lleva enlace a
`faucet.solana.com` y el comando de CLI.

El 502 y el 504 son mensajes distintos a propósito: *"no se acuñó nada"* y *"puede
que sí"* mandan a hacer cosas contrarias, y confundirlos fue justo el bug que devolvía
502 sobre un mint que había funcionado.

`data-testid`: `faucet-panel`, `faucet-submit`, `faucet-status` (con `data-tone`),
`faucet-tx-link`, `faucet-sol-notice`, `sol-faucet-link`.

### Límites conocidos de la verificación

- **El 504 (sin confirmar a tiempo) no se ha provocado a propósito.** Su renderizado sí
  tiene test, incluida la afirmación de que no dice que el mint falló.
- **El 200 y el 429 del servidor sí están ejercitados contra devnet**; los tres 500
  también, uno por cada fallo de configuración (variable ausente, contenido que no es
  una keypair, y una keypair válida que no es la del faucet).
- **El 503 del servidor nunca se ha ejercitado.** Provocarlo exigiría drenar el faucet
  por debajo de 0,05 SOL. Lo que sí está cubierto es el 429/503 **de la UI**: que la
  respuesta se traduzca al tono y al texto correctos tiene test. Queda escrito como
  límite conocido, no como olvido.
- **No hay tests de render.** Vitest corre en `environment: "node"` y no están
  instalados `jsdom` ni `@testing-library/react`. Meter dos dependencias de peso en el
  último paso de la fase sería encender algo "por si acaso"; la lógica que decidiría
  el render está extraída a `faucetStatus.ts` justo para poder probarla sin DOM.

### 🔴 La clave privada

`FAUCET_KEYPAIR` **no lleva el prefijo `NEXT_PUBLIC_`**, y es lo único que la mantiene
privada: Next sustituye en el JavaScript del navegador, literalmente y en tiempo de
build, el valor de toda variable que lleve ese prefijo. Con él, la clave quedaría
publicada en cuanto alguien abriera la web.

Solo la lee `src/app/api/faucet/route.ts`, y dentro del handler — nunca al importar el
módulo, para que el proceso de build no la tenga en memoria.

**Comprobado, no supuesto.** Build con un canario en lugar de la clave real
(`FAUCET_KEYPAIR=CANARY-PRIVATE-…`), y grep sobre lo que se sirve al cliente:

| Patrón | `.next/static` | Todo `.next` |
| ------ | -------------- | ------------ |
| El canario privado | 0 ficheros | **0 ficheros** |
| `FAUCET_KEYPAIR` | 0 ficheros | — |
| Canario **público** (`NEXT_PUBLIC_RPC_URL`) | 1 fichero | — |
| Pubkey del faucet (dato del manifest) | 2 ficheros | — |

Las dos últimas filas son el control positivo: sin ellas, un cero en las dos primeras
podría significar simplemente que el grep está mal escrito. Se usa un canario y no la
clave real para no pasearla por la línea de comandos ni por el historial del shell.

### Los dos límites, y lo que NO frenan

El activo que hay que proteger **no son los tokens** — los acuña este faucet y no valen
nada. Es **el SOL del faucet**: cada ATA nueva cuesta ~0,002 SOL de renta que paga él.

1. **Límite de saldo → 429.** Si la wallet ya tiene DEMO6 o DEMO9, no se le acuña.
   Frena la **repetición honesta**: el clic repetido por impaciencia, que es el caso
   real y el que más SOL consume sin querer.
2. **Umbral de SOL → 503.** Por debajo de **0,05 SOL** el faucet se apaga solo. Frena
   el **drenaje**: deja de operar mientras aún le queda saldo, en vez de morir a mitad
   de una transacción.

**Ninguno de los dos frena a un atacante con direcciones nuevas.** Un bucle de pubkeys
distintas pasa los dos límites, porque cada una es legítimamente alguien que nunca ha
pedido nada. Está aceptado a propósito: lo que acota ese caso es **el saldo del faucet
— 0,5 SOL, elegidos como tope de daño**, y el peor desenlace es quedarse sin faucet
hasta que alguien lo recargue. Tampoco hay límite por IP ni contador en memoria: en
Vercel cada instancia tiene su propia memoria y no se hablan entre sí, y una IP se
rota, así que daría sensación de protección sin darla.

#### Por qué el límite mira el saldo y no si la ATA existe

Era la idea de partida y es **peor**. Crear la ATA de otro puede hacerlo cualquiera: la
instrucción no exige la firma del dueño, solo que alguien pague la renta. Con "¿tiene
ATA?" como criterio, un atacante creaba las ATAs de las direcciones que quisiera y las
dejaba excluidas del faucet para siempre — el límite se convertía en un vector de
bloqueo. Para bloquear a alguien con el criterio del saldo habría que **mandarle**
tokens, y quien tiene tokens es justo a quien el faucet no necesita servir.

**Limitación conocida del criterio del saldo:** quien reciba tokens, haga swaps y se
quede a cero, puede volver a pedir. Sin un KV externo no hay forma de distinguirlo de
un visitante nuevo, y se acepta: el coste de esa segunda vez es solo el mint, no la
renta — la ATA ya existe.

### Desplegar en Vercel (fase 9)

En *Settings → Environment Variables*, **Production**:

| Variable | Valor |
| -------- | ----- |
| `FAUCET_KEYPAIR` | El array JSON de 64 números del fichero de la keypair, en una línea |
| `NEXT_PUBLIC_RPC_URL` | Opcional, un RPC de devnet dedicado |

`FAUCET_KEYPAIR` no se marca como pública ni se renombra con el prefijo. El fichero de
la keypair **no está en el repo** y no debe estarlo.

## Estado de verificación

| Comprobación                                        | Estado |
| --------------------------------------------------- | ------ |
| `yarn test` — 55 tests (31 + 13 política + 11 estados) | ✅ |
| `yarn typecheck`                                     | ✅ |
| `yarn build`                                         | ✅ |
| Comprobación de manifest obsoleto rompe el build     | ✅ (provocada a propósito) |
| Lectura del mercado real de devnet con estos módulos | ✅ (precio 2.000000, decimales 9/6, bóvedas 1000/2000) |
| **Swap real desde el navegador con una wallet**      | ✅ (Solflare, devnet) |
| La clave del faucet no llega al bundle               | ✅ (canario + control positivo) |

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
