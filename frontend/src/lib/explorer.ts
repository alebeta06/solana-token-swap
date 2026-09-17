import { CLUSTER } from "./manifest";

const base = "https://explorer.solana.com";
const suffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;

export const txUrl = (signature: string) => `${base}/tx/${signature}${suffix}`;
export const addressUrl = (address: string) => `${base}/address/${address}${suffix}`;

/** Shortens a base58 address for display without hiding which one it is. */
export const shorten = (address: string, chars = 4) =>
  `${address.slice(0, chars)}…${address.slice(-chars)}`;
