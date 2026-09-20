import { afterEach, describe, expect, it } from "vitest";
import { rpcEndpoint, serverRpcEndpoint } from "./rpc";

const PUBLIC = "https://public.example/rpc";
const SERVER = "https://server.example/rpc";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_RPC_URL;
  delete process.env.SOLANA_RPC_URL;
});

describe("rpcEndpoint (browser)", () => {
  it("uses the public variable", () => {
    process.env.NEXT_PUBLIC_RPC_URL = PUBLIC;
    expect(rpcEndpoint()).toBe(PUBLIC);
  });

  // 🔴 Esto es el bug de producción, al revés: si el navegador cogiera la
  // variable del servidor, la clave sin restricción de dominio acabaría en el
  // bundle público — la que está expuesta tiene que ser la restringida.
  it("ignores the server-only variable", () => {
    process.env.SOLANA_RPC_URL = SERVER;
    expect(rpcEndpoint()).not.toBe(SERVER);
  });

  it("falls back to the cluster endpoint when nothing is set", () => {
    expect(rpcEndpoint()).toContain("devnet");
  });
});

describe("serverRpcEndpoint (faucet handler)", () => {
  // 🔴 El fallo de producción: la key pública está restringida por dominio y la
  // función serverless no manda `Origin`, así que el proveedor la rechaza con
  // 403. Con las dos definidas, el servidor tiene que quedarse con la suya.
  it("prefers its own variable over the public one", () => {
    process.env.NEXT_PUBLIC_RPC_URL = PUBLIC;
    process.env.SOLANA_RPC_URL = SERVER;
    expect(serverRpcEndpoint()).toBe(SERVER);
  });

  it("falls back to the public one when it has none of its own", () => {
    process.env.NEXT_PUBLIC_RPC_URL = PUBLIC;
    expect(serverRpcEndpoint()).toBe(PUBLIC);
  });

  it("falls back to the cluster endpoint when neither is set", () => {
    expect(serverRpcEndpoint()).toContain("devnet");
  });
});
