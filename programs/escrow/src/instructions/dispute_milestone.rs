use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct DisputeMilestone<'info> {
    #[account(
        mut,
        constraint = escrow_account.status == EscrowStatus::Active @ EscrowError::InvalidStatus,
    )]
    pub escrow_account: Account<'info, MilestoneEscrowAccount>,

    pub disputer: Signer<'info>,
}

pub fn handler(ctx: Context<DisputeMilestone>, milestone_index: u8) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;
    let disputer_key = ctx.accounts.disputer.key();

    require!(
        disputer_key == escrow.creator || disputer_key == escrow.recipient,
        EscrowError::UnauthorizedDisputer
    );

    require!(
        (milestone_index as usize) < escrow.milestone_count as usize,
        EscrowError::InvalidMilestoneIndex
    );

    require!(
        escrow.milestones[milestone_index as usize].status == MilestoneStatus::Pending,
        EscrowError::MilestoneNotPending
    );

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.milestones[milestone_index as usize].status = MilestoneStatus::Disputed;
    escrow.status = EscrowStatus::Disputed;

    Ok(())
}
