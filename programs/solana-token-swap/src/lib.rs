use anchor_lang::prelude::*;

declare_id!("9LEv8jBxh7mLKJ5V95DpgHsCzF2S6zJEqq8kUMSopJFL");

#[program]
pub mod solana_token_swap {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
