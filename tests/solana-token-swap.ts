import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SolanaTokenSwap } from "../target/types/solana_token_swap";
import { assert } from "chai";

describe("solana-token-swap", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.solanaTokenSwap as Program<SolanaTokenSwap>;
  const authority = provider.wallet;
  const payer = (authority as any).payer;

  // 🇪🇸 NOTA: decimales DISTINTOS a propósito. Con 6 y 6 los factores de la
  // fórmula se cancelan y un bug de conversión sería invisible.
  const DECIMALS_LOW = 6;
  const DECIMALS_HIGH = 9;

  let mintA: PublicKey;
  let mintB: PublicKey;
  let decimalsA: number;
  let decimalsB: number;
  let marketPda: PublicKey;
  let vaultAPda: PublicKey;
  let vaultBPda: PublicKey;
  let authorityTokenA: PublicKey;
  let authorityTokenB: PublicKey;
  let foreignTokenB: PublicKey;

  const baseUnits = (amount: number, decimals: number) =>
    new anchor.BN(amount).mul(new anchor.BN(10).pow(new anchor.BN(decimals)));

  before(async () => {
    const first = await createMint(
      provider.connection, payer, authority.publicKey, null, DECIMALS_LOW
    );
    const second = await createMint(
      provider.connection, payer, authority.publicKey, null, DECIMALS_HIGH
    );

    // 🇪🇸 NOTA: el programa exige mint_a < mint_b. El orden lo decide la pubkey,
    // no el valor ni los decimales. El frontend debe replicar este mapeo.
    const firstIsLower = first.toBuffer().compare(second.toBuffer()) < 0;
    mintA = firstIsLower ? first : second;
    mintB = firstIsLower ? second : first;
    decimalsA = firstIsLower ? DECIMALS_LOW : DECIMALS_HIGH;
    decimalsB = firstIsLower ? DECIMALS_HIGH : DECIMALS_LOW;

    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), mintA.toBuffer(), mintB.toBuffer()],
      program.programId
    );
    [vaultAPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_a"), marketPda.toBuffer()], program.programId
    );
    [vaultBPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_b"), marketPda.toBuffer()], program.programId
    );

    authorityTokenA = await createAssociatedTokenAccount(
      provider.connection, payer, mintA, authority.publicKey
    );
    authorityTokenB = await createAssociatedTokenAccount(
      provider.connection, payer, mintB, authority.publicKey
    );

     // 🇪🇸 NOTA: ATA de mint B en una wallet distinta, para probar el constraint
    // de mint sin que Anchor rechace antes por cuenta mutable duplicada.
    const outsider = Keypair.generate();
    foreignTokenB = await createAssociatedTokenAccount(
      provider.connection, payer, mintB, outsider.publicKey
    );

    await mintTo(
      provider.connection, payer, mintA, authorityTokenA, payer,
      BigInt(baseUnits(1000, decimalsA).toString())
    );
    await mintTo(
      provider.connection, payer, mintB, authorityTokenB, payer,
      BigInt(baseUnits(1000, decimalsB).toString())
    );

    await program.methods
      .initializeMarket()
      .accounts({
        market: marketPda,
        tokenMintA: mintA,
        tokenMintB: mintB,
        vaultA: vaultAPda,
        vaultB: vaultBPda,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  });

  describe("initialize_market", () => {
    it("stores the authority and both mints", async () => {
      const market = await program.account.marketAccount.fetch(marketPda);
      assert.isTrue(market.authority.equals(authority.publicKey));
      assert.isTrue(market.tokenMintA.equals(mintA));
      assert.isTrue(market.tokenMintB.equals(mintB));
    });

    it("reads decimals from the mints instead of trusting the caller", async () => {
      const market = await program.account.marketAccount.fetch(marketPda);
      assert.equal(market.decimalsA, decimalsA);
      assert.equal(market.decimalsB, decimalsB);
    });

    it("starts with price unset", async () => {
      const market = await program.account.marketAccount.fetch(marketPda);
      assert.equal(market.price.toNumber(), 0);
    });

    it("creates both vaults owned by the market PDA", async () => {
      const vaultA = await getAccount(provider.connection, vaultAPda);
      const vaultB = await getAccount(provider.connection, vaultBPda);
      assert.isTrue(vaultA.mint.equals(mintA));
      assert.isTrue(vaultB.mint.equals(mintB));
      assert.isTrue(vaultA.owner.equals(marketPda));
      assert.isTrue(vaultB.owner.equals(marketPda));
      assert.equal(vaultA.amount.toString(), "0");
    });

    it("rejects mints passed in non-canonical order", async () => {
      const [reversedMarket] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), mintB.toBuffer(), mintA.toBuffer()],
        program.programId
      );
      const [reversedVaultA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_a"), reversedMarket.toBuffer()], program.programId
      );
      const [reversedVaultB] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_b"), reversedMarket.toBuffer()], program.programId
      );

      try {
        await program.methods
          .initializeMarket()
          .accounts({
            market: reversedMarket,
            tokenMintA: mintB,
            tokenMintB: mintA,
            vaultA: reversedVaultA,
            vaultB: reversedVaultB,
            authority: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected MintOrder");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "MintOrder");
      }
    });
  });

  describe("set_price", () => {
    it("lets the authority set the price", async () => {
      await program.methods
        .setPrice(new anchor.BN(2_000_000))
        .accounts({ market: marketPda, authority: authority.publicKey })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      assert.equal(market.price.toNumber(), 2_000_000);
    });

    it("rejects a price of zero", async () => {
      try {
        await program.methods
          .setPrice(new anchor.BN(0))
          .accounts({ market: marketPda, authority: authority.publicKey })
          .rpc();
        assert.fail("expected ZeroAmount");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "ZeroAmount");
      }
    });

    // 🇪🇸 NOTA: este es el test del bug más caro del proyecto. Sin `has_one`,
    // cualquiera fija el precio a 1 y vacía las bóvedas por swap.
    it("rejects anyone who is not the market authority", async () => {
      const intruder = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        intruder.publicKey, anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await program.methods
          .setPrice(new anchor.BN(1))
          .accounts({ market: marketPda, authority: intruder.publicKey })
          .signers([intruder])
          .rpc();
        assert.fail("expected Unauthorized");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "Unauthorized");
      }
    });
  });

  describe("add_liquidity", () => {
    it("moves tokens from the depositor into both vaults", async () => {
      const amountA = baseUnits(100, decimalsA);
      const amountB = baseUnits(200, decimalsB);

      await program.methods
        .addLiquidity(amountA, amountB)
        .accounts({
          market: marketPda,
          vaultA: vaultAPda,
          vaultB: vaultBPda,
          depositorTokenA: authorityTokenA,
          depositorTokenB: authorityTokenB,
          depositor: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vaultA = await getAccount(provider.connection, vaultAPda);
      const vaultB = await getAccount(provider.connection, vaultBPda);
      assert.equal(vaultA.amount.toString(), amountA.toString());
      assert.equal(vaultB.amount.toString(), amountB.toString());
    });

    it("accepts a deposit of only one side", async () => {
      const before = await getAccount(provider.connection, vaultAPda);
      const amountA = baseUnits(50, decimalsA);

      await program.methods
        .addLiquidity(amountA, new anchor.BN(0))
        .accounts({
          market: marketPda,
          vaultA: vaultAPda,
          vaultB: vaultBPda,
          depositorTokenA: authorityTokenA,
          depositorTokenB: authorityTokenB,
          depositor: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const after = await getAccount(provider.connection, vaultAPda);
      assert.equal(
        (after.amount - before.amount).toString(),
        amountA.toString()
      );
    });

    // 🇪🇸 NOTA: la referencia devuelve Ok sin hacer nada con ambos a cero.
    // Un no-op silencioso es peor que un error.
    it("rejects a deposit where both amounts are zero", async () => {
      try {
        await program.methods
          .addLiquidity(new anchor.BN(0), new anchor.BN(0))
          .accounts({
            market: marketPda,
            vaultA: vaultAPda,
            vaultB: vaultBPda,
            depositorTokenA: authorityTokenA,
            depositorTokenB: authorityTokenB,
            depositor: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected ZeroAmount");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "ZeroAmount");
      }
    });

    it("rejects a token account whose mint does not match the market", async () => {
      try {
        await program.methods
          .addLiquidity(baseUnits(1, decimalsA), new anchor.BN(0))
          .accounts({
            market: marketPda,
            vaultA: vaultAPda,
            vaultB: vaultBPda,
            depositorTokenA: foreignTokenB, // mint equivocado
            depositorTokenB: authorityTokenB,
            depositor: authority.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected InvalidMint");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "InvalidMint");
      }
    });
  });
});