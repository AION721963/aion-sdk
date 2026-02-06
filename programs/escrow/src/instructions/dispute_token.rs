use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct DisputeToken<'info> {
    #[account(
        mut,
        constraint = escrow_account.status == EscrowStatus::Active @ EscrowError::InvalidStatus,
    )]
    pub escrow_account: Account<'info, TokenEscrowAccount>,

    pub disputer: Signer<'info>,
}

pub fn handler(ctx: Context<DisputeToken>, reason: [u8; 64]) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let disputer_key = ctx.accounts.disputer.key();

    require!(
        disputer_key == escrow.creator || disputer_key == escrow.recipient,
        EscrowError::UnauthorizedDisputer
    );

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Disputed;
    escrow.dispute_reason = reason;

    Ok(())
}
