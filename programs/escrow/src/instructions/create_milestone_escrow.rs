use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MilestoneInput {
    pub amount: u64,
    pub description_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateMilestoneEscrow<'info> {
    #[account(
        init,
        payer = creator,
        space = MilestoneEscrowAccount::SPACE,
        seeds = [b"milestone_escrow", creator.key().as_ref(), &escrow_id.to_le_bytes()],
        bump
    )]
    pub escrow_account: Account<'info, MilestoneEscrowAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Recipient stored but doesn't sign at creation
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Arbiter stored but doesn't sign at creation
    pub arbiter: UncheckedAccount<'info>,

    /// CHECK: Fee recipient stored but doesn't sign
    pub fee_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateMilestoneEscrow>,
    escrow_id: u64,
    deadline: i64,
    terms_hash: [u8; 32],
    fee_basis_points: u16,
    milestones: Vec<MilestoneInput>,
) -> Result<()> {
    require!(milestones.len() > 0 && milestones.len() <= MAX_MILESTONES, EscrowError::TooManyMilestones);
    require!(fee_basis_points <= 1000, EscrowError::FeeTooHigh);

    let clock = Clock::get()?;
    require!(deadline > clock.unix_timestamp, EscrowError::DeadlineExpired);

    // Calculate total amount
    let total_amount: u64 = milestones.iter()
        .map(|m| m.amount)
        .try_fold(0u64, |acc, a| acc.checked_add(a))
        .ok_or(EscrowError::Overflow)?;

    require!(total_amount > 0, EscrowError::ZeroAmount);

    // Transfer SOL from creator to escrow PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.escrow_account.to_account_info(),
            },
        ),
        total_amount,
    )?;

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.creator = ctx.accounts.creator.key();
    escrow.recipient = ctx.accounts.recipient.key();
    escrow.total_amount = total_amount;
    escrow.released_amount = 0;
    escrow.status = EscrowStatus::Created;
    escrow.deadline = deadline;
    escrow.terms_hash = terms_hash;
    escrow.arbiter = ctx.accounts.arbiter.key();
    escrow.fee_basis_points = fee_basis_points;
    escrow.fee_recipient = ctx.accounts.fee_recipient.key();
    escrow.created_at = clock.unix_timestamp;
    escrow.escrow_id = escrow_id;
    escrow.bump = ctx.bumps.escrow_account;
    escrow.milestone_count = milestones.len() as u8;

    // Initialize milestones
    let mut ms_array = [Milestone::default(); MAX_MILESTONES];
    for (i, m) in milestones.iter().enumerate() {
        ms_array[i] = Milestone {
            amount: m.amount,
            status: MilestoneStatus::Pending,
            description_hash: m.description_hash,
        };
    }
    escrow.milestones = ms_array;

    Ok(())
}
