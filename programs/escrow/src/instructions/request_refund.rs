use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct RequestRefund<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
        constraint = escrow_account.creator == creator.key() @ EscrowError::UnauthorizedCreator,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    /// CHECK: validated by constraint
    #[account(mut)]
    pub creator: Signer<'info>,
}

pub fn handler(ctx: Context<RequestRefund>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let clock = Clock::get()?;

    // Allow refund if:
    // 1. Status is Created (not yet accepted) -- can cancel anytime
    // 2. Status is Active but deadline has passed
    match escrow.status {
        EscrowStatus::Created => {
            // Cancel -- no deadline check needed
        }
        EscrowStatus::Active => {
            require!(
                clock.unix_timestamp >= escrow.deadline,
                EscrowError::DeadlineNotReached
            );
        }
        _ => return Err(EscrowError::InvalidStatus.into()),
    }

    // Transfer escrowed amount back to creator
    let escrow_info = ctx.accounts.escrow_account.to_account_info();
    let amount = escrow.amount;

    **escrow_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.creator.try_borrow_mut_lamports()? += amount;

    // Update status (close will transfer remaining rent to creator)
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = if escrow.status == EscrowStatus::Created {
        EscrowStatus::Cancelled
    } else {
        EscrowStatus::Refunded
    };

    Ok(())
}
