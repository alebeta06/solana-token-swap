import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey, Keypair } from "@solana/web3.js";
import { createMint, TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { SolanaTokenSwap } from "../target/types/solana_token_swap";
import { assert } from "chai";

describe("initialize_market", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.solanaTokenSwap as Program<SolanaTokenSwap>;
  const authority = provider.wallet;

  // 🇪🇸 NOTA: decimales DISTINTOS a propósito. Con 6 y 6 los factores de la
  // fórmula se cancelan y un bug de conversión sería invisible.
  const DECIMALS_LOW = 6;
  const DECIMALS_HIGH = 9;

  let mintA: PublicKey;   // canonical: mintA < mintB
  let mintB: PublicKey;
  let decimalsA: number;
  let decimalsB: number;
  let marketPda: PublicKey;
  let vaultAPda: PublicKey;
  let vaultBPda: PublicKey;

  before(async () => {
    const first = await createMint(
      provider.connection, (authority as any).payer,
      authority.publicKey, null, DECIMALS_LOW
    );
    const second = await createMint(
      provider.connection, (authority as any).payer,
      authority.publicKey, null, DECIMALS_HIGH
    );

    // 🇪🇸 NOTA: el programa exige mint_a < mint_b. El orden lo decide la pubkey,
    // no el valor ni los decimales, así que hay que ordenar aquí igual que en
    // el frontend. Este mapeo es un sitio fácil para un bug silencioso.
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
  });

  it("stores the authority and both mints", async () => {
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
          tokenMintA: mintB,      // invertidos
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