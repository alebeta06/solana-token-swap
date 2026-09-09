use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

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
