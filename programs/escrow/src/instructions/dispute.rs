use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(
        mut,
        constraint = escrow_account.status == EscrowStatus::Active @ EscrowError::InvalidStatus,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub disputer: Signer<'info>,

    /// Disputer's reputation account (optional - pass if tracking reputation)
    #[account(
        mut,
        seeds = [b"reputation", disputer.key().as_ref()],
        bump = disputer_reputation.bump,
    )]
    pub disputer_reputation: Option<Account<'info, ReputationAccount>>,
}

pub fn handler(ctx: Context<Dispute>, reason: [u8; 64]) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let disputer_key = ctx.accounts.disputer.key();

    // Only creator or recipient can dispute
    require!(
        disputer_key == escrow.creator || disputer_key == escrow.recipient,
        EscrowError::UnauthorizedDisputer
    );

    // Update reputation if provided
    if let Some(disputer_rep) = &mut ctx.accounts.disputer_reputation {
        let clock = Clock::get()?;
        disputer_rep.disputes_initiated = disputer_rep.disputes_initiated.saturating_add(1);
        disputer_rep.last_activity = clock.unix_timestamp;
    }

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Disputed;
    escrow.dispute_reason = reason;

    Ok(())
}
