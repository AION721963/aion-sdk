use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct RefundMilestoneEscrow<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"milestone_escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
        constraint = escrow_account.creator == creator.key() @ EscrowError::UnauthorizedCreator,
    )]
    pub escrow_account: Account<'info, MilestoneEscrowAccount>,

    /// CHECK: validated by constraint
    #[account(mut)]
    pub creator: Signer<'info>,
}

pub fn handler(ctx: Context<RefundMilestoneEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let clock = Clock::get()?;

    match escrow.status {
        EscrowStatus::Created => {}
        EscrowStatus::Active => {
            require!(
                clock.unix_timestamp >= escrow.deadline,
                EscrowError::DeadlineNotReached
            );
        }
        _ => return Err(EscrowError::InvalidStatus.into()),
    }

    // Refund only unreleased amount
    let unreleased = escrow.total_amount.checked_sub(escrow.released_amount).ok_or(EscrowError::Overflow)?;

    if unreleased > 0 {
        let escrow_info = ctx.accounts.escrow_account.to_account_info();
        **escrow_info.try_borrow_mut_lamports()? -= unreleased;
        **ctx.accounts.creator.try_borrow_mut_lamports()? += unreleased;
    }

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = if escrow.status == EscrowStatus::Created {
        EscrowStatus::Cancelled
    } else {
        EscrowStatus::Refunded
    };

    Ok(())
}
