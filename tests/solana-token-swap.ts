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

  // 🇪🇸 NOTA: price = 2_000_000 → 1 A vale 2 B. Vive aquí porque lo necesitan
  // el test de set_price Y el helper que garantiza que el mercado opera.
  const PRICE = 2_000_000;

  // Liquidez mínima que cada test de swap puede dar por supuesta.
  const MIN_LIQUIDITY_A = 100;
  const MIN_LIQUIDITY_B = 200;

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

  // ─── Helper de errores ──────────────────────────────────────────────────────
  // 🇪🇸 NOTA: el patrón try/catch + assert.fail que había antes tenía un fallo
  // propio: cuando la transacción NO fallaba, el assert.fail lanzaba un
  // AssertionError normal, el catch lo recogía y `err.error.errorCode` reventaba
  // con "Cannot read properties of undefined". El mensaje que veías describía
  // el bug del test, no el del programa. Ya pasó dos veces.
  //
  // Los tres casos se distinguen explícitamente:
  //   1. la transacción no falló          → "expected X, but the transaction succeeded"
  //   2. falló con otro código de Anchor  → "expected X, got Y"
  //   3. falló con algo que no es Anchor  → se enseña el error crudo
  const expectAnchorError = async (
    attempt: () => Promise<unknown>,
    expected: string
  ) => {
    let raised: unknown;

    try {
      await attempt();
    } catch (err) {
      raised = err;
    }

    if (raised === undefined) {
      assert.fail(`expected ${expected}, but the transaction succeeded`);
    }

    const code = (raised as any)?.error?.errorCode?.code;

    if (code === undefined) {
      const raw =
        raised instanceof Error
          ? (raised.stack ?? raised.message)
          : String(raised);
      assert.fail(
        `expected ${expected}, but the call failed with something that is not ` +
          `an Anchor error:\n${raw}`
      );
    }

    if (code !== expected) {
      assert.fail(`expected ${expected}, got ${code}`);
    }
  };

  // 🇪🇸 NOTA: las dos instrucciones de swap comparten el mismo juego de cuentas.
  // Lo que cambia entre ellas es la aritmética, no el contexto.
  //
  // ⚠️ El parámetro de overrides no es cosmético. `{ ...swapAccounts(), vaultB: x }`
  // sigue siendo un literal para TypeScript, que comprueba sus claves contra un
  // tipo del que Anchor ya ha borrado `market` y las bóvedas. Pasar el objeto ya
  // construido evita la comprobación sin necesidad de un `any` por sitio.
  const swapAccounts = (overrides: Record<string, PublicKey> = {}) => ({
    market: marketPda,
    vaultA: vaultAPda,
    vaultB: vaultBPda,
    userTokenA: authorityTokenA,
    userTokenB: authorityTokenB,
    user: authority.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    ...overrides,
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

  // ─── Independencia de orden ─────────────────────────────────────────────────
  // 🇪🇸 NOTA: antes, cada test de swap dependía de la liquidez que hubieran
  // dejado los anteriores y del precio que hubiera fijado el describe de
  // set_price. Reordenar un test rompía otro, y el error que salía hablaba de
  // InsufficientLiquidity o PriceNotSet, no de la causa real.
  //
  // Este helper rellena lo que falte hasta el mínimo, en vez de depositar una
  // cantidad fija: es idempotente, así que da igual cuántas veces corra ni qué
  // haya pasado antes. Acuñamos los tokens que falten en la ATA del depositante
  // para que el top-up tampoco dependa de cuánto quedara allí.
  const ensureMarketReady = async () => {
    const market = await program.account.marketAccount.fetch(marketPda);
    if (market.price.isZero()) {
      await program.methods
        .setPrice(new anchor.BN(PRICE))
        .accounts({ market: marketPda, authority: authority.publicKey })
        .rpc();
    }

    const vaultA = await getAccount(provider.connection, vaultAPda);
    const vaultB = await getAccount(provider.connection, vaultBPda);

    const targetA = BigInt(baseUnits(MIN_LIQUIDITY_A, decimalsA).toString());
    const targetB = BigInt(baseUnits(MIN_LIQUIDITY_B, decimalsB).toString());

    const deficitA = vaultA.amount < targetA ? targetA - vaultA.amount : 0n;
    const deficitB = vaultB.amount < targetB ? targetB - vaultB.amount : 0n;

    if (deficitA === 0n && deficitB === 0n) return;

    if (deficitA > 0n) {
      await mintTo(
        provider.connection, payer, mintA, authorityTokenA, payer, deficitA
      );
    }
    if (deficitB > 0n) {
      await mintTo(
        provider.connection, payer, mintB, authorityTokenB, payer, deficitB
      );
    }

    await program.methods
      .addLiquidity(
        new anchor.BN(deficitA.toString()),
        new anchor.BN(deficitB.toString())
      )
      .accounts(liquidityAccounts())
      .rpc();
  };

  // 🇪🇸 NOTA: un mercado ajeno, para los tests de account confusion. Se empareja
  // mintA con un mint nuevo, así que el par (y por tanto el PDA) es distinto del
  // mercado principal. El orden canónico se recalcula: NO se puede asumir que
  // mintA siga siendo el "bajo" frente a un mint recién creado.
  const createForeignMarket = async () => {
    const otherMintRaw = await createMint(
      provider.connection, payer, authority.publicKey, null, DECIMALS_LOW
    );
    const [lowMint, highMint] =
      mintA.toBuffer().compare(otherMintRaw.toBuffer()) < 0
        ? [mintA, otherMintRaw]
        : [otherMintRaw, mintA];

    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), lowMint.toBuffer(), highMint.toBuffer()],
      program.programId
    );
    const [foreignVaultA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_a"), market.toBuffer()], program.programId
    );
    const [foreignVaultB] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_b"), market.toBuffer()], program.programId
    );

    await program.methods
      .initializeMarket()
      .accounts({
        tokenMintA: lowMint,
        tokenMintB: highMint,
        authority: authority.publicKey,
      })
      .rpc();

    return { market, vaultA: foreignVaultA, vaultB: foreignVaultB };
  };

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
        tokenMintA: mintA,
        tokenMintB: mintB,
        authority: authority.publicKey,
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

    // ⚠️ DEPENDENCIA DE ORDEN DELIBERADA: este test mira el mercado principal
    // recién creado, así que tiene que correr antes que set_price. Es la única
    // dependencia que queda en la suite y no se puede quitar sin perder lo que
    // el test afirma: que initialize_market NO deja el mercado operativo.
    // Mocha ejecuta los describe en orden de declaración, e initialize_market
    // está declarado antes que set_price.
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
    });

    it("rejects mints passed in non-canonical order", async () => {
      // 🇪🇸 NOTA: basta con pasar los mints al revés. Anchor deriva el PDA del
      // mercado de los mints que le damos, así que el contexto es coherente y
      // lo único que falla es la constraint del programa.
      await expectAnchorError(
        () =>
          program.methods
            .initializeMarket()
            .accounts({
              tokenMintA: mintB,
              tokenMintB: mintA,
              authority: authority.publicKey,
            })
            .rpc(),
        "MintOrder"
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("set_price", () => {
    it("lets the authority set the price", async () => {
      await program.methods
        .setPrice(new anchor.BN(PRICE))
        .accounts({ market: marketPda, authority: authority.publicKey })
        .rpc();

      const market = await program.account.marketAccount.fetch(marketPda);
      assert.equal(market.price.toNumber(), PRICE);
    });

    it("rejects a price of zero", async () => {
      await expectAnchorError(
        () =>
          program.methods
            .setPrice(new anchor.BN(0))
            .accounts({ market: marketPda, authority: authority.publicKey })
            .rpc(),
        "ZeroAmount"
      );
    });

    // 🇪🇸 NOTA: este es el test del bug más caro del proyecto. Sin `has_one`,
    // cualquiera fija el precio a 1 y vacía las bóvedas por swap.
    it("rejects anyone who is not the market authority", async () => {
      const intruder = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        intruder.publicKey, anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      await expectAnchorError(
        () =>
          program.methods
            .setPrice(new anchor.BN(1))
            .accounts({ market: marketPda, authority: intruder.publicKey })
            .signers([intruder])
            .rpc(),
        "Unauthorized"
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("add_liquidity", () => {
    // 🇪🇸 NOTA: la aserción es sobre el DELTA de cada bóveda, no sobre su saldo
    // absoluto. Así el test dice lo que promete su nombre —que los tokens se
    // mueven— sin depender de que las bóvedas estuvieran vacías al empezar.
    it("moves tokens from the depositor into both vaults", async () => {
      const amountA = baseUnits(100, decimalsA);
      const amountB = baseUnits(200, decimalsB);

      const vaultABefore = await getAccount(provider.connection, vaultAPda);
      const vaultBBefore = await getAccount(provider.connection, vaultBPda);

      await program.methods
        .addLiquidity(amountA, amountB)
        .accounts(liquidityAccounts())
        .rpc();

      const vaultAAfter = await getAccount(provider.connection, vaultAPda);
      const vaultBAfter = await getAccount(provider.connection, vaultBPda);
      assert.equal(
        (vaultAAfter.amount - vaultABefore.amount).toString(),
        amountA.toString()
      );
      assert.equal(
        (vaultBAfter.amount - vaultBBefore.amount).toString(),
        amountB.toString()
      );
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
      await expectAnchorError(
        () =>
          program.methods
            .addLiquidity(new anchor.BN(0), new anchor.BN(0))
            .accounts(liquidityAccounts())
            .rpc(),
        "ZeroAmount"
      );
    });

    it("rejects a token account whose mint does not match the market", async () => {
      await expectAnchorError(
        () =>
          program.methods
            .addLiquidity(baseUnits(1, decimalsA), new anchor.BN(0))
            .accounts(liquidityAccounts(foreignTokenB)) // mint equivocado
            .rpc(),
        "InvalidMint"
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("swap_a_to_b", () => {
    beforeEach(ensureMarketReady);

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
      await expectAnchorError(
        () =>
          program.methods
            .swapAToB(new anchor.BN(0), new anchor.BN(0))
            .accounts(swapAccounts())
            .rpc(),
        "ZeroAmount"
      );
    });

    // 🇪🇸 NOTA: Solana no tiene mempool público, así que el front-running
    // clásico de EVM no aplica igual. El riesgo real es que el authority llame
    // a set_price y tu tx aterrice después del cambio.
    it("rejects an output below the requested minimum", async () => {
      await expectAnchorError(
        () =>
          program.methods
            .swapAToB(baseUnits(1, decimalsA), baseUnits(999, decimalsB))
            .accounts(swapAccounts())
            .rpc(),
        "SlippageExceeded"
      );
    });

    // 🇪🇸 NOTA: el margen NO es ajustado, y conviene que siga sin serlo. El
    // suelo que garantiza ensureMarketReady es 200 B; este swap pide 10 000 A ×
    // precio 2 = 20 000 B. Factor 100× contra el suelo (medido: 100×). Si algún
    // día se sube MIN_LIQUIDITY_B por encima de 20 000, este test dejaría de
    // fallar por InsufficientLiquidity — y el helper lo cantaría con
    // "expected InsufficientLiquidity, but the transaction succeeded",
    // no con un error críptico.
    it("rejects a swap larger than the liquidity in vault_b", async () => {
      await expectAnchorError(
        () =>
          program.methods
            .swapAToB(baseUnits(10_000, decimalsA), new anchor.BN(0))
            .accounts(swapAccounts())
            .rpc(),
        "InsufficientLiquidity"
      );
    });

    // 🇪🇸 NOTA: initialize_market deja price = 0 a propósito; el mercado no
    // opera hasta set_price. Hace falta un mercado NUEVO porque el principal ya
    // tiene precio, y el helper de liquidez se lo fijaría igualmente.
    // El swap falla por PriceNotSet antes de mirar la liquidez, así que este
    // mercado ni siquiera necesita bóvedas con fondos.
    it("rejects a swap on a market whose price was never set", async () => {
      const firstRaw = await createMint(
        provider.connection, payer, authority.publicKey, null, DECIMALS_LOW
      );
      const secondRaw = await createMint(
        provider.connection, payer, authority.publicKey, null, DECIMALS_HIGH
      );

      // El orden canónico se recalcula para ESTE par. No hay nada que permita
      // suponer que el mint de 6 decimales vuelve a caer del lado A.
      const firstIsLower = firstRaw.toBuffer().compare(secondRaw.toBuffer()) < 0;
      const freshMintA = firstIsLower ? firstRaw : secondRaw;
      const freshMintB = firstIsLower ? secondRaw : firstRaw;
      const freshDecimalsA = firstIsLower ? DECIMALS_LOW : DECIMALS_HIGH;

      const [freshMarket] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), freshMintA.toBuffer(), freshMintB.toBuffer()],
        program.programId
      );
      const [freshVaultA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_a"), freshMarket.toBuffer()], program.programId
      );
      const [freshVaultB] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_b"), freshMarket.toBuffer()], program.programId
      );

      await program.methods
        .initializeMarket()
        .accounts({
          tokenMintA: freshMintA,
          tokenMintB: freshMintB,
          authority: authority.publicKey,
        })
        .rpc();

      const userTokenA = await createAssociatedTokenAccount(
        provider.connection, payer, freshMintA, authority.publicKey
      );
      const userTokenB = await createAssociatedTokenAccount(
        provider.connection, payer, freshMintB, authority.publicKey
      );
      await mintTo(
        provider.connection, payer, freshMintA, userTokenA, payer,
        BigInt(baseUnits(10, freshDecimalsA).toString())
      );

      // 🇪🇸 NOTA: el `any` es obligatorio y el cast en línea `{...} as any` NO
      // sirve — TypeScript valida el literal antes de aplicar el cast.
      const freshSwapAccounts: any = {
        market: freshMarket,
        vaultA: freshVaultA,
        vaultB: freshVaultB,
        userTokenA,
        userTokenB,
        user: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      };

      await expectAnchorError(
        () =>
          program.methods
            .swapAToB(baseUnits(1, freshDecimalsA), new anchor.BN(0))
            .accounts(freshSwapAccounts)
            .rpc(),
        "PriceNotSet"
      );
    });

    // 🇪🇸 NOTA: el test de account confusion. Lo detienen las `seeds`, NO el
    // Signer: el atacante firma legítimamente su propia transacción. Anchor
    // re-deriva vault_b desde market.key() y la comparación falla.
    it("rejects a vault belonging to a different market", async () => {
      const foreign = await createForeignMarket();

      await expectAnchorError(
        () =>
          program.methods
            .swapAToB(baseUnits(1, decimalsA), new anchor.BN(0))
            .accounts(swapAccounts({ vaultB: foreign.vaultB }))
            .rpc(),
        "ConstraintSeeds"
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("swap_b_to_a", () => {
    beforeEach(ensureMarketReady);

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
      await expectAnchorError(
        () =>
          program.methods
            .swapBToA(new anchor.BN(0), new anchor.BN(0))
            .accounts(swapAccounts())
            .rpc(),
        "ZeroAmount"
      );
    });

    // 🇪🇸 NOTA: 1 unidad base solo trunca a 0 si el token de SALIDA tiene menos
    // decimales que el de entrada. Como el orden A/B lo decide la pubkey y no
    // los decimales, la dirección se elige en tiempo de ejecución. Asumir que
    // "A es el de 6 decimales" es exactamente el bug que el orden canónico
    // introduce en cualquier cliente descuidado.
    it("rejects an input so small that the output truncates to zero", async () => {
      await expectAnchorError(
        () =>
          (decimalsB > decimalsA
            ? program.methods.swapBToA(new anchor.BN(1), new anchor.BN(0))
            : program.methods.swapAToB(new anchor.BN(1), new anchor.BN(0))
          )
            .accounts(swapAccounts())
            .rpc(),
        "ZeroOutput"
      );
    });

    it("rejects an output below the requested minimum", async () => {
      await expectAnchorError(
        () =>
          program.methods
            .swapBToA(baseUnits(1, decimalsB), baseUnits(999, decimalsA))
            .accounts(swapAccounts())
            .rpc(),
        "SlippageExceeded"
      );
    });

    // 🇪🇸 NOTA: aquí la bóveda que se drena es vault_A, no vault_B. Es el sitio
    // donde un copy-paste desde swap_a_to_b habría comprobado la cuenta
    // equivocada, y el fallo habría sido silencioso.
    // 🇪🇸 NOTA: mismo razonamiento que en A→B, con más holgura todavía. El suelo
    // de vault_a es 100 A y este swap pide 100 000 B ÷ precio 2 = 50 000 A:
    // factor 500× contra el suelo (medido: 331× en una corrida real, porque los
    // swaps anteriores habían dejado 151 A en la bóveda).
    it("rejects a swap larger than the liquidity in vault_a", async () => {
      await expectAnchorError(
        () =>
          program.methods
            .swapBToA(baseUnits(100_000, decimalsB), new anchor.BN(0))
            .accounts(swapAccounts())
            .rpc(),
        "InsufficientLiquidity"
      );
    });

    // 🇪🇸 NOTA: el espejo del test de account confusion de swap_a_to_b. La
    // bóveda que se pasa mal es vault_A, porque es la que drena esta dirección.
    // Lo que la detiene sigue siendo la derivación de las `seeds`: el usuario
    // firma su propia transacción con total legitimidad, así que el Signer no
    // aporta nada aquí.
    it("rejects a vault belonging to a different market", async () => {
      const foreign = await createForeignMarket();

      await expectAnchorError(
        () =>
          program.methods
            .swapBToA(baseUnits(1, decimalsB), new anchor.BN(0))
            .accounts(swapAccounts({ vaultA: foreign.vaultA }))
            .rpc(),
        "ConstraintSeeds"
      );
    });
  });
});
