use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitReputation<'info> {
    #[account(
        init,
        payer = payer,
        space = ReputationAccount::SPACE,
        seeds = [b"reputation", agent.key().as_ref()],
        bump
    )]
    pub reputation_account: Account<'info, ReputationAccount>,

    /// CHECK: The agent whose reputation is being initialized
    pub agent: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitReputation>) -> Result<()> {
    let reputation = &mut ctx.accounts.reputation_account;
    reputation.agent = ctx.accounts.agent.key();
    reputation.escrows_created = 0;
    reputation.escrows_completed = 0;
    reputation.escrows_received = 0;
    reputation.tasks_completed = 0;
    reputation.disputes_initiated = 0;
    reputation.disputes_won = 0;
    reputation.disputes_lost = 0;
    reputation.total_volume_lamports = 0;
    reputation.last_activity = Clock::get()?.unix_timestamp;
    reputation.bump = ctx.bumps.reputation_account;

    Ok(())
}
