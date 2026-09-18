/**
 * The RPC endpoint, resolved once and in one place.
 *
 * 🇪🇸 NOTA: el faucet (route handler, servidor) y el swap (navegador) tienen
 * que hablar con el MISMO nodo. Si el servidor acuña contra un RPC y el
 * navegador lee el saldo contra otro, un desfase de propagación se ve como un
 * faucet que "no hizo nada" — un fallo intermitente y carísimo de diagnosticar.
 *
 * `NEXT_PUBLIC_RPC_URL` SÍ lleva el prefijo público a propósito: es un endpoint
 * de lectura que el navegador necesita conocer. La clave del faucet no.
 */
import { clusterApiUrl } from "@solana/web3.js";
import { CLUSTER } from "./manifest";

export function rpcEndpoint(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_URL ||
    clusterApiUrl(CLUSTER as Parameters<typeof clusterApiUrl>[0])
  );
}
