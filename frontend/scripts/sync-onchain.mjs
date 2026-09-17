#!/usr/bin/env node
/**
 * Copies the build/deploy artefacts the frontend needs into `src/`, where they
 * are committed.
 *
 * 🇪🇸 NOTA: `target/` está en .gitignore y `devnet.json` vive en la raíz del
 * repo, fuera del Root Directory que Vercel usa para este frontend. Ninguno de
 * los dos está disponible al clonar, así que se copian aquí y se commitean.
 * La ÚNICA fuente de verdad sigue siendo el original: este script no
 * transforma nada, copia byte a byte.
 *
 * Reejecutar tras cada `anchor build` o `scripts/seed-market.ts`.
 *
 *   yarn sync:onchain
 */
import { copyFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const frontend = join(here, "..");

const COPIES = [
  ["target/idl/solana_token_swap.json", "src/idl/solana_token_swap.json"],
  ["target/types/solana_token_swap.ts", "src/idl/solana_token_swap.ts"],
  ["target/types/solana_token_swap_errors.ts", "src/idl/solana_token_swap_errors.ts"],
  ["devnet.json", "src/config/devnet.json"],
];

for (const [from, to] of COPIES) {
  const src = join(repoRoot, from);
  if (!existsSync(src)) {
    console.error(
      `\n✖ Missing ${from}\n` +
        `  Run \`anchor build\` (for target/) or check that devnet.json exists at the repo root.\n`
    );
    process.exit(1);
  }
  const dest = join(frontend, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`  ${from} → ${to}`);
}

const idl = JSON.parse(readFileSync(join(frontend, "src/idl/solana_token_swap.json"), "utf-8"));
const manifest = JSON.parse(readFileSync(join(frontend, "src/config/devnet.json"), "utf-8"));

if (idl.address !== manifest.programId) {
  console.error(
    `\n✖ The copies disagree about the program ID:\n` +
      `    IDL:      ${idl.address}\n` +
      `    manifest: ${manifest.programId}\n` +
      `  One of the two sources is stale. Rebuild and redeploy before committing.\n`
  );
  process.exit(1);
}

console.log(`\n✔ program ${idl.address}`);
console.log(`  market  ${manifest.market.address} (A = ${manifest.market.mintAIs}, B = ${manifest.market.mintBIs})`);
console.log(`  seeded  ${manifest.seededAt}`);
