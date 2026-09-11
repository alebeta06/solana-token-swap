# solana-token-swap

A fixed-price SPL token swap on Solana, written in Rust with Anchor 1.2.0.

My first Solana program, coming from Solidity and Cairo. Built as Module 15 of the CodeCrypto Master's in Blockchain Engineering & AI.

> **Status:** phases 0–2 done · 12 tests passing · **local validator only, not deployed to devnet yet** · not audited, educational code.

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
| `swap_a_to_b` | ⏳ next | Any user |
| `swap_b_to_a` | ⏳ | Any user |

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

## Run the tests

Anchor 1.x uses Surfpool as its default test validator. If you don't have it installed, run the validator yourself:

```bash
# terminal 1: start from a clean ledger
rm -rf test-ledger && solana-test-validator

# terminal 2
anchor test --skip-local-validator
```

Check your Anchor version with `avm list`. `anchor --version` can report a stale version after `avm use`.

## Roadmap

- [x] Phase 0: toolchain and scaffold
- [x] Phase 1: `MarketAccount` and `initialize_market`
- [x] Phase 2: `set_price` and `add_liquidity`
- [ ] `swap_a_to_b` with `u128` intermediate math
- [ ] `swap_b_to_a`
- [ ] Next.js frontend with wallet adapter
- [ ] Devnet deploy and a faucet so anyone can try it

## Author

Alejandro Betancourt · [GitHub](https://github.com/alebeta06) · [X](https://x.com/Ale_Beta) · [LinkedIn](https://www.linkedin.com/in/alebeta/)
