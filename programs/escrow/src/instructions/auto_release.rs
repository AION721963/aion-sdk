use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct AutoRelease<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
        constraint = escrow_account.status == EscrowStatus::Active @ EscrowError::InvalidStatus,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    /// Anyone can trigger auto-release (no Signer constraint on caller)
    pub caller: Signer<'info>,

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

pub fn handler(ctx: Context<AutoRelease>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let amount = escrow.amount;

    // Auto-release must be enabled
    require!(escrow.auto_release_at != 0, EscrowError::AutoReleaseNotEnabled);

    // Check timestamp
    let clock = Clock::get()?;
    require!(clock.unix_timestamp >= escrow.auto_release_at, EscrowError::AutoReleaseNotReady);

    // Calculate fee (same logic as release_payment)
    let fee = (amount as u128)
        .checked_mul(escrow.fee_basis_points as u128)
        .ok_or(EscrowError::Overflow)?
        .checked_div(10_000)
        .ok_or(EscrowError::Overflow)? as u64;

    let recipient_amount = amount.checked_sub(fee).ok_or(EscrowError::Overflow)?;

    // Transfer lamports from PDA
    let escrow_info = ctx.accounts.escrow_account.to_account_info();

    if fee > 0 {
        **escrow_info.try_borrow_mut_lamports()? -= fee;
        **ctx.accounts.fee_recipient.try_borrow_mut_lamports()? += fee;
    }

    **escrow_info.try_borrow_mut_lamports()? -= recipient_amount;
    **ctx.accounts.recipient.try_borrow_mut_lamports()? += recipient_amount;

    // Update reputation accounts if provided AND amount >= 0.01 SOL (anti-gaming)
    const MIN_REPUTATION_AMOUNT: u64 = 10_000_000;

    if amount >= MIN_REPUTATION_AMOUNT {
        if let Some(creator_rep) = &mut ctx.accounts.creator_reputation {
            creator_rep.escrows_completed = creator_rep.escrows_completed.saturating_add(1);
            creator_rep.total_volume_lamports = creator_rep.total_volume_lamports.saturating_add(amount);
            creator_rep.last_activity = clock.unix_timestamp;
        }

        if let Some(recipient_rep) = &mut ctx.accounts.recipient_reputation {
            recipient_rep.tasks_completed = recipient_rep.tasks_completed.saturating_add(1);
            recipient_rep.total_volume_lamports = recipient_rep.total_volume_lamports.saturating_add(amount);
            recipient_rep.last_activity = clock.unix_timestamp;
        }
    }

    // Update status (close transfers remaining rent to creator)
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Completed;

    Ok(())
}
