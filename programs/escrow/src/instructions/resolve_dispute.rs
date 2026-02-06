use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DisputeWinner {
    Creator,
    Recipient,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
        constraint = escrow_account.status == EscrowStatus::Disputed @ EscrowError::InvalidStatus,
        constraint = escrow_account.arbiter == arbiter.key() @ EscrowError::UnauthorizedArbiter,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub arbiter: Signer<'info>,

    /// CHECK: validated against escrow_account.creator
    #[account(
        mut,
        constraint = escrow_account.creator == creator.key() @ EscrowError::UnauthorizedCreator
    )]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: validated against escrow_account.recipient
    #[account(
        mut,
        constraint = escrow_account.recipient == recipient.key() @ EscrowError::UnauthorizedRecipient
    )]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: validated against escrow_account.fee_recipient
    #[account(
        mut,
        constraint = escrow_account.fee_recipient == fee_recipient.key()
    )]
    pub fee_recipient: UncheckedAccount<'info>,

    /// Creator's reputation account (optional - pass if tracking reputation)
    #[account(
        mut,
        seeds = [b"reputation", escrow_account.creator.as_ref()],
        bump = creator_reputation.bump,
    )]
    pub creator_reputation: Option<Account<'info, ReputationAccount>>,

    /// Recipient's reputation account (optional - pass if tracking reputation)
    #[account(
        mut,
        seeds = [b"reputation", escrow_account.recipient.as_ref()],
        bump = recipient_reputation.bump,
    )]
    pub recipient_reputation: Option<Account<'info, ReputationAccount>>,
}

pub fn handler(ctx: Context<ResolveDispute>, winner: DisputeWinner) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let escrow_info = ctx.accounts.escrow_account.to_account_info();
    let amount = escrow.amount;

    match winner {
        DisputeWinner::Recipient => {
            // Fee + remainder to recipient
            let fee = (amount as u128)
                .checked_mul(escrow.fee_basis_points as u128)
                .ok_or(EscrowError::Overflow)?
                .checked_div(10_000)
                .ok_or(EscrowError::Overflow)? as u64;
            let recipient_amount = amount.checked_sub(fee).ok_or(EscrowError::Overflow)?;

            if fee > 0 {
                **escrow_info.try_borrow_mut_lamports()? -= fee;
                **ctx.accounts.fee_recipient.try_borrow_mut_lamports()? += fee;
            }
            **escrow_info.try_borrow_mut_lamports()? -= recipient_amount;
            **ctx.accounts.recipient.try_borrow_mut_lamports()? += recipient_amount;
        }
        DisputeWinner::Creator => {
            // Full refund to creator, no fee
            **escrow_info.try_borrow_mut_lamports()? -= amount;
            **ctx.accounts.creator.try_borrow_mut_lamports()? += amount;
        }
    }

    // Update reputation accounts if provided
    let clock = Clock::get()?;

    match winner {
        DisputeWinner::Recipient => {
            if let Some(recipient_rep) = &mut ctx.accounts.recipient_reputation {
                recipient_rep.disputes_won = recipient_rep.disputes_won.saturating_add(1);
                recipient_rep.last_activity = clock.unix_timestamp;
            }
            if let Some(creator_rep) = &mut ctx.accounts.creator_reputation {
                creator_rep.disputes_lost = creator_rep.disputes_lost.saturating_add(1);
                creator_rep.last_activity = clock.unix_timestamp;
            }
        }
        DisputeWinner::Creator => {
            if let Some(creator_rep) = &mut ctx.accounts.creator_reputation {
                creator_rep.disputes_won = creator_rep.disputes_won.saturating_add(1);
                creator_rep.last_activity = clock.unix_timestamp;
            }
            if let Some(recipient_rep) = &mut ctx.accounts.recipient_reputation {
                recipient_rep.disputes_lost = recipient_rep.disputes_lost.saturating_add(1);
                recipient_rep.last_activity = clock.unix_timestamp;
            }
        }
    }

    // Update status (close will transfer remaining rent to creator)
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Resolved;

    Ok(())
}
