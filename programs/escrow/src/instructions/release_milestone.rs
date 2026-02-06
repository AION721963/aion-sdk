use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct ReleaseMilestone<'info> {
    #[account(
        mut,
        seeds = [b"milestone_escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
        constraint = escrow_account.creator == creator.key() @ EscrowError::UnauthorizedCreator,
        constraint = escrow_account.status == EscrowStatus::Active @ EscrowError::InvalidStatus,
    )]
    pub escrow_account: Account<'info, MilestoneEscrowAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

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
}

pub fn handler(ctx: Context<ReleaseMilestone>, milestone_index: u8) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;

    require!(
        (milestone_index as usize) < escrow.milestone_count as usize,
        EscrowError::InvalidMilestoneIndex
    );

    let milestone = &escrow.milestones[milestone_index as usize];
    require!(milestone.status == MilestoneStatus::Pending, EscrowError::MilestoneAlreadyReleased);

    let amount = milestone.amount;

    // Calculate fee
    let fee = (amount as u128)
        .checked_mul(escrow.fee_basis_points as u128)
        .ok_or(EscrowError::Overflow)?
        .checked_div(10_000)
        .ok_or(EscrowError::Overflow)? as u64;

    let recipient_amount = amount.checked_sub(fee).ok_or(EscrowError::Overflow)?;

    // Transfer lamports
    let escrow_info = ctx.accounts.escrow_account.to_account_info();

    if fee > 0 {
        **escrow_info.try_borrow_mut_lamports()? -= fee;
        **ctx.accounts.fee_recipient.try_borrow_mut_lamports()? += fee;
    }

    **escrow_info.try_borrow_mut_lamports()? -= recipient_amount;
    **ctx.accounts.recipient.try_borrow_mut_lamports()? += recipient_amount;

    // Update milestone status
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.milestones[milestone_index as usize].status = MilestoneStatus::Released;
    escrow.released_amount = escrow.released_amount.checked_add(amount).ok_or(EscrowError::Overflow)?;

    // If all milestones released, mark as completed
    let all_released = escrow.milestones[..escrow.milestone_count as usize]
        .iter()
        .all(|m| m.status == MilestoneStatus::Released);

    if all_released {
        escrow.status = EscrowStatus::Completed;
    }

    Ok(())
}
