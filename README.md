# solana-token-swap

A fixed-price SPL token swap on Solana, written in Rust with Anchor 1.2.0.

My first Solana program, coming from Solidity and Cairo. Built as Module 15 of the CodeCrypto Master's in Blockchain Engineering & AI.

> **Status:** phases 0–6 done · 27 tests passing · `tsc --noEmit` clean · **deployed on devnet and exercised with a real round trip** · frontend not started · not audited, educational code.

---

## What it does

Each market pairs two SPL tokens and holds liquidity in two program-controlled vaults. The market authority sets a price, anyone can add liquidity, and users swap at that price.

**This is not an AMM.** The price is *stored* in a `u64` (6 fixed decimals, meaning "how much B per 1 A"), not derived from reserves like `x * y = k`. That makes the program responsible for guaranteeing, by construction, what an AMM gets for free from its equation: a coherent price in both directions.

## Instructions

| Instruction | Status | Who can call it |
|---|---|---|
| `initialize_market` | ✅ | Anyone (becomes the market authority) |
| `set_price` | ✅ | Market authority only |
| `add_liquidity` | ✅ | Any depositor |
| `swap_a_to_b` | ✅ | Any user |
| `swap_b_to_a` | ✅ | Any user |

## Accounts

| Account | Type | Seeds |
|---|---|---|
| Market | `MarketAccount` (PDA) | `["market", mint_a, mint_b]` |
| Vault A | `TokenAccount`, owner = market PDA | `["vault_a", market]` |
| Vault B | `TokenAccount`, owner = market PDA | `["vault_b", market]` |

A vault is a regular token account whose owner is a PDA instead of a wallet. No private key exists for it, so only this program can authorize moving its tokens.

## Design decisions

- **Decimals are read from the `Mint` accounts, never accepted as instruction arguments.** If the program can verify a value on its own, it shouldn't trust the caller for it. An older reference implementation took them as parameters.
- **Canonical mint order is enforced (`mint_a < mint_b`).** Seeds are order-sensitive, so `(A, B)` and `(B, A)` would create two markets for the same pair, each with its own price. Two prices for one pair are arbitrageable almost by construction, because the exact inverse of a price often isn't representable in integer math. Same convention as Uniswap V2's `token0 < token1`.
- **`set_price` requires `has_one = authority` and a `Signer`.** `has_one` compares pubkeys without requiring a signature; `Signer` requires a signature without checking who signed. Only together do they equal `require(msg.sender == market.authority)`.
- **`add_liquidity` with both amounts at zero fails** instead of returning `Ok` as a silent no-op.
- **Depositor token accounts are checked against the market's mints** before any CPI.
- **Events are emitted but are not the frontend's source of state.** Solana has no `eth_getLogs`; market state and vault balances are read with `getAccountInfo`.

## Devnet deployment

The program is live on devnet with one seeded market. Every address below comes from [`devnet.json`](devnet.json), the manifest the deploy scripts write and read.

| What | Address |
|---|---|
| Program | [`BJ7GHy1zRe1VKuKUZU2ac2q1VQmtukmHzCpbo98m21qp`](https://explorer.solana.com/address/BJ7GHy1zRe1VKuKUZU2ac2q1VQmtukmHzCpbo98m21qp?cluster=devnet) |
| Market PDA | [`AJkpcg6k51gitf2LomH92fVWdpLrCNFSdyoKPKxrMEWx`](https://explorer.solana.com/address/AJkpcg6k51gitf2LomH92fVWdpLrCNFSdyoKPKxrMEWx?cluster=devnet) |
| Vault A | [`AFjr2164TK4nYackkK6G4Aj8ZXWEycrhBEXaRCvJSWuJ`](https://explorer.solana.com/address/AFjr2164TK4nYackkK6G4Aj8ZXWEycrhBEXaRCvJSWuJ?cluster=devnet) |
| Vault B | [`D877FMppZMfjWWuhz2HwWXQR72xNVkut643Gb5rpjquJ`](https://explorer.solana.com/address/D877FMppZMfjWWuhz2HwWXQR72xNVkut643Gb5rpjquJ?cluster=devnet) |
| Mint A — DEMO9, 9 decimals | [`BzrxQu3xBu9kppHCHVUFBfRCHdu4hfVji9K5Xyj8VLRF`](https://explorer.solana.com/address/BzrxQu3xBu9kppHCHVUFBfRCHdu4hfVji9K5Xyj8VLRF?cluster=devnet) |
| Mint B — DEMO6, 6 decimals | [`EUbsGAeLh2d2qeptdgfsP6sanVzPZMTXN9P4e8sn4acR`](https://explorer.solana.com/address/EUbsGAeLh2d2qeptdgfsP6sanVzPZMTXN9P4e8sn4acR?cluster=devnet) |
| Market authority | [`9aaPGTS7DikpFQugaPZVzVTaQ7dagUk1GpUwBDo15Y4y`](https://explorer.solana.com/address/9aaPGTS7DikpFQugaPZVzVTaQ7dagUk1GpUwBDo15Y4y?cluster=devnet) |

The market price is `2000000` (6 fixed decimals), meaning **1 DEMO9 = 2 DEMO6**. Which mint became A is decided by the pubkey comparison `mint_a < mint_b`, not by decimals or by value — here the 9-decimal mint happened to sort first.

A real round trip against that market, sent by `scripts/swap-demo.ts`:

| Direction | Transaction |
|---|---|
| Swap A→B | [`5Yp8k61zHXqGWPNY…`](https://explorer.solana.com/tx/5Yp8k61zHXqGWPNYQgqqng63cgwxsHfqPnBsadCZmU38StoukNSnZJAD7UJBiDbAC8UwCuxmARXJH4keHCgZWemt?cluster=devnet) |
| Swap B→A | [`4uwCfaDzDP3CZr6Y…`](https://explorer.solana.com/tx/4uwCfaDzDP3CZr6YGZnjsxMUhyAoFzy2JrNDJbzcouXTbL4ahQ18uuEHtL6bu31G6qcK6NH3qUHVboP5wYjZEYMV?cluster=devnet) |

**The mints have no Metaplex metadata.** Wallets and explorers show them as raw addresses, not as `DEMO6`/`DEMO9`. Their names live in the manifest and in the scripts only. Freeze authority is set to `null` on both, deliberately: a mint that keeps it can freeze any token account of that mint, vaults included.

There is no faucet yet — the mint authority is the deployer wallet, so only it can mint test tokens today.

---

## Tests

Test names state what the program guarantees. Mints use **6 and 9 decimals on purpose**: with equal decimals, the conversion factors cancel out and a swapped-decimals bug would still pass.

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
swap_a_to_b
  ✔ converts at the market price, honouring both token scales
  ✔ moves the input tokens into vault_a
  ✔ rejects a zero input
  ✔ rejects an output below the requested minimum
  ✔ rejects a swap larger than the liquidity in vault_b
  ✔ rejects a swap on a market whose price was never set
  ✔ rejects a vault belonging to a different market
swap_b_to_a
  ✔ applies the inverse of the market price
  ✔ moves the input tokens into vault_b
  ✔ never returns more than went in on a round trip A→B→A
  ✔ rejects a zero input
  ✔ rejects an input so small that the output truncates to zero
  ✔ rejects an output below the requested minimum
  ✔ rejects a swap larger than the liquidity in vault_a
  ✔ rejects a vault belonging to a different market
```

## Toolchain

| Piece | Version |
|---|---|
| Anchor (`anchor-lang`, `anchor-spl`, CLI) | 1.2.0 |
| `@anchor-lang/core` | 1.2.0 |
| Solana (declared in `Anchor.toml`) | 4.2.2 |
| platform-tools | v1.57 (rustc 1.95) |
| SBPF | v3 |

**Why `solana_version = "4.2.2"` in `Anchor.toml`:** Anchor enforces the Solana version declared there on every build, overriding anything set with `agave-install`, `rustup` or symlinks. Without it, the default toolchain's rustc predates edition 2024 and current dependencies don't compile. With 3.1.14 it compiles, but that validator can't load the SBPFv3 binary (`Failed to parse ELF file: invalid file header`). The binary and the validator must come from the same Solana version.

**Why Anchor 1.2.0 and not 0.31:** the course brief predates Anchor 1.0, but 0.31 pulls a Solana toolchain whose rustc is older than edition 2024, so the current dependency tree doesn't build. Going to 1.2.0 also renames the TypeScript client package — `@coral-xyz/anchor` becomes `@anchor-lang/core` — so client code written against course material needs that import changed. The design in the course lessons still applies unchanged; only the syntax moved.

## Running it

### What you need

| Piece | Version | Check it with |
|---|---|---|
| anchor-cli | 1.2.0 | `avm list` |
| Solana CLI | 4.2.2 | `solana-test-validator --version` |
| Node / Yarn | 24.x / 1.22.x | `node -v`, `yarn -v` |

`anchor build` installs and pins the Solana toolchain itself from `solana_version` in `Anchor.toml`, so your system Solana version does not have to match beforehand.

Check Anchor with `avm list`, **not** `anchor --version` — the latter can report a stale version after `avm use`.

```bash
yarn install
anchor build
```

### Tests

⚠️ **`anchor test` on its own does not work here.** Anchor 1.x defaults to Surfpool as its test validator, and if Surfpool isn't installed the run dies with `Failed to spawn surfpool`. Start the validator yourself and skip Anchor's:

```bash
# terminal 1 — a clean ledger every time
rm -rf test-ledger && solana-test-validator

# terminal 2
anchor test --skip-local-validator
```

Without `rm -rf test-ledger` the previous run's markets survive and the tests fail with `account already in use`. All 27 tests should pass.

Type-check the TypeScript (tests and scripts) separately:

```bash
yarn typecheck
```

### Devnet scripts

Three scripts in `scripts/`, run with `npx ts-node scripts/<name>.ts` against the wallet at `~/.config/solana/id.json`. They all read and write [`devnet.json`](devnet.json).

| Script | What it does | Safe to re-run? |
|---|---|---|
| `create-mints.ts` | Creates the two demo mints, works out the canonical `mint_a < mint_b` order and writes the manifest | ❌ **No.** It mints two brand new tokens and overwrites `devnet.json`, orphaning the deployed market. Only for bootstrapping a fresh deployment. |
| `seed-market.ts` | Initialises the market, sets the price, tops up both vaults | ✅ Idempotent. Reads existing state, sets the price only if unset and refills only the shortfall. |
| `swap-demo.ts` | Sends a real A→B then B→A round trip and checks nothing was created out of thin air | ✅ Re-runnable. Each run sends two new transactions and mints itself whatever token A it is short of. |

To reproduce the deployment from scratch: `anchor build` → `anchor deploy --provider.cluster devnet` → `create-mints.ts` → `seed-market.ts` → `swap-demo.ts`. Against the existing deployment, start at `seed-market.ts`.

## Roadmap

- [x] Phase 0: toolchain and scaffold
- [x] Phase 1: `MarketAccount` and `initialize_market`
- [x] Phase 2: `set_price` and `add_liquidity`
- [x] Phase 3: `swap_a_to_b` with `u128` intermediate math
- [x] Phase 4: `swap_b_to_a` and the A→B→A invariant
- [x] Phase 5: hardened test suite
- [x] Phase 6: devnet deploy, demo mints and seed scripts
- [ ] Phase 7: Next.js frontend with wallet adapter
- [ ] Phase 8: faucet and a second market
- [ ] Phase 9: full docs, account diagrams and a hosted demo

## Author

Alejandro Betancourt · [X](https://x.com/Ale_Beta) · [LinkedIn](https://www.linkedin.com/in/alebeta/)
