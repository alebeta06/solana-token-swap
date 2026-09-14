use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("BJ7GHy1zRe1VKuKUZU2ac2q1VQmtukmHzCpbo98m21qp");

/// Price is stored as an integer scaled by 10^PRICE_DECIMALS.
/// 🇪🇸 NOTA: price = cuánto B por cada A. price = 2_000_000 → 1 A vale 2 B.
/// Los 6 decimales del precio NO tienen relación con los decimales de los tokens.
pub const PRICE_DECIMALS: u32 = 6;

#[program]
pub mod solana_token_swap {
    use super::*;

    /// Creates a market for a token pair, plus its two vaults.
    pub fn initialize_market(ctx: Context<InitializeMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;

        market.authority = ctx.accounts.authority.key();
        market.token_mint_a = ctx.accounts.token_mint_a.key();
        market.token_mint_b = ctx.accounts.token_mint_b.key();
        market.price = 0;

        // 🇪🇸 NOTA: leídos del Mint, NO recibidos como parámetro.
        // El caller elige qué cuentas pasa, pero no puede mentir sobre un dato
        // que el programa puede verificar por sí mismo.
        market.decimals_a = ctx.accounts.token_mint_a.decimals;
        market.decimals_b = ctx.accounts.token_mint_b.decimals;

        market.bump = ctx.bumps.market;
        market.vault_a_bump = ctx.bumps.vault_a;
        market.vault_b_bump = ctx.bumps.vault_b;

        emit!(MarketInitialized {
            market: market.key(),
            authority: market.authority,
            token_mint_a: market.token_mint_a,
            token_mint_b: market.token_mint_b,
            decimals_a: market.decimals_a,
            decimals_b: market.decimals_b,
        });

        Ok(())
    }

    /// Updates the exchange price. Only the market authority may call this.
    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> Result<()> {
        require!(price > 0, SwapError::ZeroAmount);

        let market = &mut ctx.accounts.market;
        market.price = price;

        emit!(PriceSet {
            market: market.key(),
            authority: market.authority,
            price,
        });

        Ok(())
    }

    /// Deposits tokens into the market vaults. Open to any depositor.
    /// 🇪🇸 NOTA: no lleva `has_one = authority` — cualquiera puede aportar liquidez.
    /// Regalar tokens a una bóveda no hace daño: nadie puede sacarlos salvo por swap.
    pub fn add_liquidity(ctx: Context<AddLiquidity>, amount_a: u64, amount_b: u64) -> Result<()> {
        // 🇪🇸 NOTA: la referencia solo hace `if amount > 0`, así que con ambos a cero
        // devuelve Ok sin hacer nada. Un no-op silencioso es peor que un error.
        require!(amount_a > 0 || amount_b > 0, SwapError::ZeroAmount);

        if amount_a > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.depositor_token_a.to_account_info(),
                to: ctx.accounts.vault_a.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
            token::transfer(cpi_ctx, amount_a)?;
        }

        if amount_b > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.depositor_token_b.to_account_info(),
                to: ctx.accounts.vault_b.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
            token::transfer(cpi_ctx, amount_b)?;
        }

        emit!(LiquidityAdded {
            market: ctx.accounts.market.key(),
            depositor: ctx.accounts.depositor.key(),
            amount_a,
            amount_b,
        });

        Ok(())
    }

    /// Swaps token A for token B at the market's fixed price.
    pub fn swap_a_to_b(ctx: Context<SwapAToB>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        let market = &ctx.accounts.market;

        require!(amount_in > 0, SwapError::ZeroAmount);
        require!(market.price > 0, SwapError::PriceNotSet);

        let amount_out = amount_a_to_b(
            amount_in,
            market.price,
            market.decimals_a,
            market.decimals_b,
        )?;

        // 🇪🇸 NOTA: la división entera trunca. Con cantidades pequeñas y decimales
        // muy distintos el resultado puede ser 0, y el usuario entregaría tokens
        // a cambio de nada. Mejor abortar que quedarse los tokens en silencio.
        require!(amount_out > 0, SwapError::ZeroOutput);

        // 🇪🇸 NOTA: comprobamos ANTES del CPI. Si dejamos que falle el SPL Token,
        // el error que llega al usuario es opaco y no dice qué pasó.
        require!(
            ctx.accounts.vault_b.amount >= amount_out,
            SwapError::InsufficientLiquidity
        );

        // 🇪🇸 NOTA: Solana no tiene mempool público, así que el front-running
        // clásico de EVM no aplica igual. El riesgo real aquí es que el authority
        // llame a set_price y tu tx aterrice después del cambio.
        require!(amount_out >= min_amount_out, SwapError::SlippageExceeded);

        // ── Entrada: usuario → vault_a. Firma el usuario. ──────────────────
        let cpi_in = CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_a.to_account_info(),
                to: ctx.accounts.vault_a.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_in, amount_in)?;

        // ── Salida: vault_b → usuario. Firma el PDA del mercado. ───────────
        // 🇪🇸 NOTA: las seeds deben ser EXACTAMENTE las que derivaron el PDA,
        // con el bump al final. El runtime las re-hashea junto al program ID;
        // si el resultado coincide con la cuenta marcada como authority, la
        // marca como firmante dentro del CPI. No es una firma criptográfica:
        // es el runtime aceptando que el programa conoce las seeds.
        let mint_a_key = market.token_mint_a;
        let mint_b_key = market.token_mint_b;
        let seeds: &[&[u8]] = &[
            b"market",
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[market.bump],
        ];
        let signer_seeds = &[seeds];

        let cpi_out = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_b.to_account_info(),
                to: ctx.accounts.user_token_b.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_out, amount_out)?;

        emit!(SwapExecuted {
            market: market.key(),
            user: ctx.accounts.user.key(),
            a_to_b: true,
            amount_in,
            amount_out,
        });

        Ok(())
    }
    /// Swaps token B for token A at the market's fixed price.
    ///
    /// 🇪🇸 NOTA: es el espejo de swap_a_to_b, pero NO es copiar y pegar:
    ///   · la bóveda que se drena es vault_a, no vault_b
    ///   · el precio DIVIDE en vez de multiplicar, así que price = 0 es fatal
    ///   · la entrada va a vault_b y la salida sale de vault_a
    pub fn swap_b_to_a(ctx: Context<SwapBToA>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        let market = &ctx.accounts.market;

        require!(amount_in > 0, SwapError::ZeroAmount);

        // 🇪🇸 NOTA: aquí `price` está en el DENOMINADOR. Sin este check,
        // checked_div devolvería None y saldría un MathOverflow engañoso:
        // el problema no es un desbordamiento, es un mercado sin precio.
        require!(market.price > 0, SwapError::PriceNotSet);

        let amount_out = amount_b_to_a(
            amount_in,
            market.price,
            market.decimals_a,
            market.decimals_b,
        )?;

        require!(amount_out > 0, SwapError::ZeroOutput);

        // 🇪🇸 NOTA: vault_A, no vault_B. Es el sitio más fácil para copiar mal
        // desde swap_a_to_b, y el fallo sería silencioso: comprobarías liquidez
        // de una bóveda y sacarías de la otra.
        require!(
            ctx.accounts.vault_a.amount >= amount_out,
            SwapError::InsufficientLiquidity
        );

        require!(amount_out >= min_amount_out, SwapError::SlippageExceeded);

        // ── Entrada: usuario → vault_b. Firma el usuario. ──────────────────
        let cpi_in = CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_b.to_account_info(),
                to: ctx.accounts.vault_b.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_in, amount_in)?;

        // ── Salida: vault_a → usuario. Firma el PDA del mercado. ───────────
        // 🇪🇸 NOTA: las seeds son IDÉNTICAS a las de swap_a_to_b. Derivan el
        // mercado, no la bóveda. Lo que cambia es de qué cuenta sale el token.
        let mint_a_key = market.token_mint_a;
        let mint_b_key = market.token_mint_b;
        let seeds: &[&[u8]] = &[
            b"market",
            mint_a_key.as_ref(),
            mint_b_key.as_ref(),
            &[market.bump],
        ];
        let signer_seeds = &[seeds];

        let cpi_out = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_a.to_account_info(),
                to: ctx.accounts.user_token_a.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_out, amount_out)?;

        emit!(SwapExecuted {
            market: market.key(),
            user: ctx.accounts.user.key(),
            a_to_b: false,
            amount_in,
            amount_out,
        });

        Ok(())
    }
}

/// Converts an input amount of token A into the corresponding amount of token B.
///
/// 🇪🇸 NOTA: tres trabajos en una fórmula:
///   1. aplicar el precio            → × price
///   2. deshacer la escala del precio → ÷ 10^PRICE_DECIMALS
///   3. convertir de escala A a B     → × 10^dec_b ÷ 10^dec_a
///
/// ⚠️ TODAS las multiplicaciones van antes que TODAS las divisiones. El README
/// oficial propone `(amount * 10^6) / (price * 10^dec_a / 10^dec_b)`: esa división
/// anidada trunca antes de tiempo y con dec_b > dec_a el denominador colapsa a 0.
///
/// ⚠️ El intermedio va en u128: con 9 decimales y precio de 6 el producto llega a
/// ~10^27, y u64::MAX es ~1,8×10^19.
pub fn amount_a_to_b(amount_a: u64, price: u64, decimals_a: u8, decimals_b: u8) -> Result<u64> {
    let numerator = (amount_a as u128)
        .checked_mul(price as u128)
        .ok_or(SwapError::MathOverflow)?
        .checked_mul(10u128.pow(decimals_b as u32))
        .ok_or(SwapError::MathOverflow)?;

    let denominator = 10u128
        .pow(PRICE_DECIMALS)
        .checked_mul(10u128.pow(decimals_a as u32))
        .ok_or(SwapError::MathOverflow)?;

    // 🇪🇸 NOTA: la división entera trunca hacia abajo, y eso favorece al pool.
    // Es la dirección correcta: el usuario nunca recibe de más.
    let amount_b = numerator
        .checked_div(denominator)
        .ok_or(SwapError::MathOverflow)?;

    u64::try_from(amount_b).map_err(|_| SwapError::MathOverflow.into())
}

/// Converts an input amount of token B into the corresponding amount of token A.
///
/// 🇪🇸 NOTA: es la inversa de `amount_a_to_b`. Lo que allí multiplicaba, aquí
/// divide, y viceversa:
///   A→B:  (amount × price   × 10^dec_b) / (10^PRICE_DECIMALS × 10^dec_a)
///   B→A:  (amount × 10^PRICE_DECIMALS × 10^dec_a) / (price × 10^dec_b)
///
/// ⚠️ El README oficial propone `(amount * 10^6) / (price * 10^dec_a / 10^dec_b)`.
/// Esa división anidada se evalúa primero y, con dec_b > dec_a, el denominador
/// interno trunca a 0 → pánico por división por cero. Aquí no hay ninguna
/// división hasta el final.
///
/// ⚠️ `price` aparece en el DENOMINADOR. El caller debe garantizar que no es
/// cero antes de llamar; el `checked_div` es la red de seguridad, no la defensa.
pub fn amount_b_to_a(amount_b: u64, price: u64, decimals_a: u8, decimals_b: u8) -> Result<u64> {
    let numerator = (amount_b as u128)
        .checked_mul(10u128.pow(PRICE_DECIMALS))
        .ok_or(SwapError::MathOverflow)?
        .checked_mul(10u128.pow(decimals_a as u32))
        .ok_or(SwapError::MathOverflow)?;

    let denominator = (price as u128)
        .checked_mul(10u128.pow(decimals_b as u32))
        .ok_or(SwapError::MathOverflow)?;

    // 🇪🇸 NOTA: la división entera trunca hacia abajo, igual que en A→B. Como
    // truncar solo puede REDUCIR la salida, ambas direcciones favorecen al pool.
    // De ahí que la invariante A→B→A ≤ entrada esté garantizada, no sea suerte.
    let amount_a = numerator
        .checked_div(denominator)
        .ok_or(SwapError::MathOverflow)?;

    u64::try_from(amount_a).map_err(|_| SwapError::MathOverflow.into())
}

/// Market state. One account per token pair, addressed by a PDA.
/// 🇪🇸 NOTA: en Solidity esto sería `mapping(bytes32 => Market)` dentro del contrato.
/// Aquí cada mercado es su propia cuenta y la dirección del PDA hace de índice.
#[account]
#[derive(InitSpace)]
pub struct MarketAccount {
    /// Authority allowed to update the price. Per-market, not per-program.
    pub authority: Pubkey,
    /// Mint of token A. Canonical order guarantees token_mint_a < token_mint_b.
    pub token_mint_a: Pubkey,
    pub token_mint_b: Pubkey,
    /// Scaled by 10^PRICE_DECIMALS.
    pub price: u64,
    /// 🇪🇸 NOTA: se leen del Mint al crear el mercado, NUNCA del caller.
    pub decimals_a: u8,
    pub decimals_b: u8,
    pub bump: u8,
    pub vault_a_bump: u8,
    pub vault_b_bump: u8,
}

#[error_code]
pub enum SwapError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Price has not been set")]
    PriceNotSet,
    #[msg("Insufficient liquidity in vault")]
    InsufficientLiquidity,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Output amount is zero after truncation")]
    ZeroOutput,
    #[msg("Output below minimum requested")]
    SlippageExceeded,
    #[msg("Mints must be in canonical order (mint_a < mint_b)")]
    MintOrder,
    #[msg("Only the market authority can perform this action")]
    Unauthorized,
    #[msg("Token account does not match the market mint")]
    InvalidMint,
}

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MarketAccount::INIT_SPACE,
        seeds = [b"market", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump,
        constraint = token_mint_a.key() < token_mint_b.key() @ SwapError::MintOrder,
    )]
    pub market: Account<'info, MarketAccount>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [b"vault_a", market.key().as_ref()],
        bump,
        token::mint = token_mint_a,
        token::authority = market,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"vault_b", market.key().as_ref()],
        bump,
        token::mint = token_mint_b,
        token::authority = market,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct MarketInitialized {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub token_mint_a: Pubkey,
    pub token_mint_b: Pubkey,
    pub decimals_a: u8,
    pub decimals_b: u8,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    /// 🇪🇸 NOTA: `has_one` y `Signer` juntos equivalen a
    /// `require(msg.sender == market.authority)` de Solidity.
    /// Por separado no valen nada: `has_one` sin `Signer` dejaría que cualquiera
    /// pase la pubkey del authority sin demostrar que la controla.
    #[account(
        mut,
        has_one = authority @ SwapError::Unauthorized,
        seeds = [b"market", market.token_mint_a.as_ref(), market.token_mint_b.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketAccount>,

    pub authority: Signer<'info>,
}

#[event]
pub struct PriceSet {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub price: u64,
}
#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(
        seeds = [b"market", market.token_mint_a.as_ref(), market.token_mint_b.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketAccount>,

    #[account(
        mut,
        seeds = [b"vault_a", market.key().as_ref()],
        bump = market.vault_a_bump,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", market.key().as_ref()],
        bump = market.vault_b_bump,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    /// 🇪🇸 NOTA: ATA del depositante. El `constraint` impide que pase una cuenta
    /// de otro token — el caller elige las cuentas, así que hay que verificar.
    #[account(
        mut,
        constraint = depositor_token_a.mint == market.token_mint_a @ SwapError::InvalidMint,
    )]
    pub depositor_token_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = depositor_token_b.mint == market.token_mint_b @ SwapError::InvalidMint,
    )]
    pub depositor_token_b: Account<'info, TokenAccount>,

    pub depositor: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct LiquidityAdded {
    pub market: Pubkey,
    pub depositor: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
}

#[derive(Accounts)]
pub struct SwapAToB<'info> {
    #[account(
        seeds = [b"market", market.token_mint_a.as_ref(), market.token_mint_b.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketAccount>,

    /// 🇪🇸 NOTA: estas `seeds` son lo que impide el account confusion. Anchor
    /// re-deriva la dirección desde market.key() y la compara. Pasar la bóveda
    /// de otro mercado aborta la instrucción. NO es el Signer quien lo detiene:
    /// el atacante firma legítimamente su propia transacción.
    #[account(
        mut,
        seeds = [b"vault_a", market.key().as_ref()],
        bump = market.vault_a_bump,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", market.key().as_ref()],
        bump = market.vault_b_bump,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_a.mint == market.token_mint_a @ SwapError::InvalidMint,
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_b.mint == market.token_mint_b @ SwapError::InvalidMint,
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// 🇪🇸 NOTA: las cuentas son las mismas que en SwapAToB. Podría reutilizarse
/// el mismo struct, pero tener uno por instrucción deja el IDL explícito y
/// permite añadir constraints específicas si alguna dirección las necesitara.
#[derive(Accounts)]
pub struct SwapBToA<'info> {
    #[account(
        seeds = [b"market", market.token_mint_a.as_ref(), market.token_mint_b.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketAccount>,

    #[account(
        mut,
        seeds = [b"vault_a", market.key().as_ref()],
        bump = market.vault_a_bump,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", market.key().as_ref()],
        bump = market.vault_b_bump,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_a.mint == market.token_mint_a @ SwapError::InvalidMint,
    )]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_token_b.mint == market.token_mint_b @ SwapError::InvalidMint,
    )]
    pub user_token_b: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct SwapExecuted {
    pub market: Pubkey,
    pub user: Pubkey,
    /// true = A→B, false = B→A
    pub a_to_b: bool,
    pub amount_in: u64,
    pub amount_out: u64,
}
