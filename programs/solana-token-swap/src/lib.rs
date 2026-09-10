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
