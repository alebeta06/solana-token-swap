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

  // 🇪🇸 NOTA: las dos instrucciones de swap comparten el mismo juego de cuentas.
  // Lo que cambia entre ellas es la aritmética, no el contexto.
  const swapAccounts = () => ({
    market: marketPda,
    vaultA: vaultAPda,
    vaultB: vaultBPda,
    userTokenA: authorityTokenA,
    userTokenB: authorityTokenB,
    user: authority.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  const liquidityAccounts = (tokenA: PublicKey = authorityTokenA) => ({
    market: marketPda,
    vaultA: vaultAPda,
    vaultB: vaultBPda,
    depositorTokenA: tokenA,
    depositorTokenB: authorityTokenB,
    depositor: authority.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  before(async () => {
    const first = await createMint(
      provider.connection, payer, authority.publicKey, null, DECIMALS_LOW
    );
    const second = await createMint(
      provider.connection, payer, authority.publicKey, null, DECIMALS_HIGH
    );

    // 🇪🇸 NOTA: el programa exige mint_a < mint_b. El orden lo decide la pubkey,
    // NO el valor ni los decimales. El frontend debe replicar este mapeo, y
    // ningún test puede asumir que "A" es el token de 6 decimales.
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

  // ───────────────────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────────────
  describe("add_liquidity", () => {
    it("moves tokens from the depositor into both vaults", async () => {
      const amountA = baseUnits(100, decimalsA);
      const amountB = baseUnits(200, decimalsB);

      await program.methods
        .addLiquidity(amountA, amountB)
        .accounts(liquidityAccounts())
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
        .accounts(liquidityAccounts())
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
          .accounts(liquidityAccounts())
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
          .accounts(liquidityAccounts(foreignTokenB)) // mint equivocado
          .rpc();
        assert.fail("expected InvalidMint");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "InvalidMint");
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("swap_a_to_b", () => {
    // 🇪🇸 NOTA: price = 2_000_000 → 1 A vale 2 B.
    // 1 A = 10^decimalsA unidades base → 2 B = 2 × 10^decimalsB unidades base.
    // Si decimals_a y decimals_b estuvieran intercambiados en la fórmula, el
    // resultado se desviaría por un factor de 10^|decimalsB - decimalsA|.
    it("converts at the market price, honouring both token scales", async () => {
      const amountIn = baseUnits(1, decimalsA);
      const expectedOut = baseUnits(2, decimalsB);

      const vaultBBefore = await getAccount(provider.connection, vaultBPda);
      const userBBefore = await getAccount(provider.connection, authorityTokenB);

      await program.methods
        .swapAToB(amountIn, new anchor.BN(0))
        .accounts(swapAccounts())
        .rpc();

      const vaultBAfter = await getAccount(provider.connection, vaultBPda);
      const userBAfter = await getAccount(provider.connection, authorityTokenB);

      assert.equal(
        (userBAfter.amount - userBBefore.amount).toString(),
        expectedOut.toString()
      );
      assert.equal(
        (vaultBBefore.amount - vaultBAfter.amount).toString(),
        expectedOut.toString()
      );
    });

    it("moves the input tokens into vault_a", async () => {
      const amountIn = baseUnits(1, decimalsA);
      const before = await getAccount(provider.connection, vaultAPda);

      await program.methods
        .swapAToB(amountIn, new anchor.BN(0))
        .accounts(swapAccounts())
        .rpc();

      const after = await getAccount(provider.connection, vaultAPda);
      assert.equal(
        (after.amount - before.amount).toString(),
        amountIn.toString()
      );
    });

    it("rejects a zero input", async () => {
      try {
        await program.methods
          .swapAToB(new anchor.BN(0), new anchor.BN(0))
          .accounts(swapAccounts())
          .rpc();
        assert.fail("expected ZeroAmount");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "ZeroAmount");
      }
    });

    // 🇪🇸 NOTA: Solana no tiene mempool público, así que el front-running
    // clásico de EVM no aplica igual. El riesgo real es que el authority llame
    // a set_price y tu tx aterrice después del cambio.
    it("rejects an output below the requested minimum", async () => {
      try {
        await program.methods
          .swapAToB(baseUnits(1, decimalsA), baseUnits(999, decimalsB))
          .accounts(swapAccounts())
          .rpc();
        assert.fail("expected SlippageExceeded");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "SlippageExceeded");
      }
    });

    it("rejects a swap larger than the liquidity in vault_b", async () => {
      try {
        await program.methods
          .swapAToB(baseUnits(10_000, decimalsA), new anchor.BN(0))
          .accounts(swapAccounts())
          .rpc();
        assert.fail("expected InsufficientLiquidity");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "InsufficientLiquidity");
      }
    });

    // 🇪🇸 NOTA: el test de account confusion. Lo detienen las `seeds`, NO el
    // Signer: el atacante firma legítimamente su propia transacción. Anchor
    // re-deriva vault_b desde market.key() y la comparación falla.
    it("rejects a vault belonging to a different market", async () => {
      const otherMintRaw = await createMint(
        provider.connection, payer, authority.publicKey, null, DECIMALS_LOW
      );
      const [lowMint, highMint] =
        mintA.toBuffer().compare(otherMintRaw.toBuffer()) < 0
          ? [mintA, otherMintRaw]
          : [otherMintRaw, mintA];

      const [otherMarket] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), lowMint.toBuffer(), highMint.toBuffer()],
        program.programId
      );
      const [otherVaultA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_a"), otherMarket.toBuffer()], program.programId
      );
      const [otherVaultB] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_b"), otherMarket.toBuffer()], program.programId
      );

      await program.methods
        .initializeMarket()
        .accounts({
          market: otherMarket,
          tokenMintA: lowMint,
          tokenMintB: highMint,
          vaultA: otherVaultA,
          vaultB: otherVaultB,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .swapAToB(baseUnits(1, decimalsA), new anchor.BN(0))
          .accounts({ ...swapAccounts(), vaultB: otherVaultB })
          .rpc();
        assert.fail("expected ConstraintSeeds");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "ConstraintSeeds");
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("swap_b_to_a", () => {
    // 🇪🇸 NOTA: si 1 A vale 2 B, entonces 1 B vale 0,5 A.
    it("applies the inverse of the market price", async () => {
      const amountIn = baseUnits(1, decimalsB);
      const expectedOut = baseUnits(1, decimalsA).divn(2);

      const before = await getAccount(provider.connection, authorityTokenA);

      await program.methods
        .swapBToA(amountIn, new anchor.BN(0))
        .accounts(swapAccounts())
        .rpc();

      const after = await getAccount(provider.connection, authorityTokenA);
      assert.equal(
        (after.amount - before.amount).toString(),
        expectedOut.toString()
      );
    });

    it("moves the input tokens into vault_b", async () => {
      const amountIn = baseUnits(1, decimalsB);
      const before = await getAccount(provider.connection, vaultBPda);

      await program.methods
        .swapBToA(amountIn, new anchor.BN(0))
        .accounts(swapAccounts())
        .rpc();

      const after = await getAccount(provider.connection, vaultBPda);
      assert.equal(
        (after.amount - before.amount).toString(),
        amountIn.toString()
      );
    });

    // 🔴 LA INVARIANTE. Si el truncamiento no favoreciera al pool en ambas
    // direcciones, un bucle de swaps drenaría las bóvedas. Como truncar solo
    // puede REDUCIR la salida, la vuelta nunca supera la ida. El test lo
    // confirma; no lo descubre.
    it("never returns more than went in on a round trip A→B→A", async () => {
      const amountIn = baseUnits(3, decimalsA);
      const beforeA = await getAccount(provider.connection, authorityTokenA);

      await program.methods
        .swapAToB(amountIn, new anchor.BN(0))
        .accounts(swapAccounts())
        .rpc();

      const midA = await getAccount(provider.connection, authorityTokenA);
      const spentA = beforeA.amount - midA.amount;
      assert.equal(spentA.toString(), amountIn.toString());

      // 3 A × precio 2 = 6 B. Devolvemos exactamente eso.
      await program.methods
        .swapBToA(baseUnits(6, decimalsB), new anchor.BN(0))
        .accounts(swapAccounts())
        .rpc();

      const afterA = await getAccount(provider.connection, authorityTokenA);
      const returnedA = afterA.amount - midA.amount;

      // 🇪🇸 NOTA: <= , no ==. Truncar puede devolver un poco menos, y esa
      // migaja se queda en el pool. Lo que NUNCA debe pasar es que vuelva MÁS:
      // eso sería imprimir tokens de la nada.
      assert.isTrue(
        returnedA <= spentA,
        `round trip returned ${returnedA}, more than the ${spentA} that went in`
      );
    });

    it("rejects a zero input", async () => {
      try {
        await program.methods
          .swapBToA(new anchor.BN(0), new anchor.BN(0))
          .accounts(swapAccounts())
          .rpc();
        assert.fail("expected ZeroAmount");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "ZeroAmount");
      }
    });

    // 🇪🇸 NOTA: 1 unidad base solo trunca a 0 si el token de SALIDA tiene menos
    // decimales que el de entrada. Como el orden A/B lo decide la pubkey y no
    // los decimales, la dirección se elige en tiempo de ejecución. Asumir que
    // "A es el de 6 decimales" es exactamente el bug que el orden canónico
    // introduce en cualquier cliente descuidado.
    it("rejects an input so small that the output truncates to zero", async () => {
      const call = decimalsB > decimalsA
        ? program.methods.swapBToA(new anchor.BN(1), new anchor.BN(0))
        : program.methods.swapAToB(new anchor.BN(1), new anchor.BN(0));

      try {
        await call.accounts(swapAccounts()).rpc();
        assert.fail("expected ZeroOutput");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "ZeroOutput");
      }
    });

    it("rejects an output below the requested minimum", async () => {
      try {
        await program.methods
          .swapBToA(baseUnits(1, decimalsB), baseUnits(999, decimalsA))
          .accounts(swapAccounts())
          .rpc();
        assert.fail("expected SlippageExceeded");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "SlippageExceeded");
      }
    });

    // 🇪🇸 NOTA: aquí la bóveda que se drena es vault_A, no vault_B. Es el sitio
    // donde un copy-paste desde swap_a_to_b habría comprobado la cuenta
    // equivocada, y el fallo habría sido silencioso.
    it("rejects a swap larger than the liquidity in vault_a", async () => {
      try {
        await program.methods
          .swapBToA(baseUnits(100_000, decimalsB), new anchor.BN(0))
          .accounts(swapAccounts())
          .rpc();
        assert.fail("expected InsufficientLiquidity");
      } catch (err) {
        assert.equal(err.error.errorCode.code, "InsufficientLiquidity");
      }
    });
  });
});