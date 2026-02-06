use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct AcceptMilestoneTask<'info> {
    #[account(
        mut,
        constraint = escrow_account.recipient == recipient.key() @ EscrowError::UnauthorizedRecipient,
        constraint = escrow_account.status == EscrowStatus::Created @ EscrowError::InvalidStatus,
    )]
    pub escrow_account: Account<'info, MilestoneEscrowAccount>,

    pub recipient: Signer<'info>,
}

pub fn handler(ctx: Context<AcceptMilestoneTask>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < ctx.accounts.escrow_account.deadline,
        EscrowError::DeadlineExpired
    );

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Active;

    Ok(())
}
