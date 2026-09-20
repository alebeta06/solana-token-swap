/**
 * Los endpoints RPC, resueltos en un solo sitio.
 *
 * 🔴 Son DOS, y con claves distintas a propósito. La del navegador queda
 * expuesta —Next la sustituye literalmente en el JavaScript que sirve— así que
 * se protege **restringiéndola por dominio** en el panel del proveedor. La del
 * servidor no se expone nunca, así que no necesita esa restricción; y no puede
 * tenerla, porque una función serverless **no envía cabecera `Origin`** y el
 * proveedor la rechaza con 403. Eso rompió el faucet en producción mientras los
 * swaps, que salen del navegador, seguían funcionando.
 *
 * 🇪🇸 NOTA: ya no hace falta que los dos lados hablen con el MISMO nodo. Ese
 * requisito existía cuando un desfase de propagación entre nodos se veía como
 * un faucet que "no hizo nada", y lo que lo resolvió no fue compartir endpoint
 * —un proveedor sirve muchos nodos detrás de una URL, así que compartirla nunca
 * garantizó nada— sino `minContextSlot`: el handler devuelve el slot en que
 * confirmó y el navegador lo exige al leer. Ver `useTokenBalances`.
 */
import { clusterApiUrl } from "@solana/web3.js";
import { CLUSTER } from "./manifest";

function fallback(): string {
  return clusterApiUrl(CLUSTER as Parameters<typeof clusterApiUrl>[0]);
}

/**
 * El endpoint del NAVEGADOR.
 *
 * `NEXT_PUBLIC_RPC_URL` lleva el prefijo público a propósito: es un endpoint de
 * lectura que el navegador tiene que conocer para poder usarlo.
 */
export function rpcEndpoint(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || fallback();
}

/**
 * El endpoint del SERVIDOR — solo lo usa `app/api/faucet/route.ts`.
 *
 * ⚠️ `SOLANA_RPC_URL` **no lleva el prefijo `NEXT_PUBLIC_`**, y no es un
 * descuido: con él, Next la incrustaría en el bundle del navegador y la clave
 * sin restricción de dominio quedaría publicada — justo la que no la necesita
 * porque nadie la ve.
 *
 * El fallback a `NEXT_PUBLIC_RPC_URL` mantiene funcionando un despliegue que
 * solo tenga configurada la pública (el caso de desarrollo local, donde no hay
 * restricción de dominio que molestar), y de ahí al endpoint público de devnet.
 */
export function serverRpcEndpoint(): string {
  return process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || fallback();
}
