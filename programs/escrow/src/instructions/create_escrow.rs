use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = creator,
        space = EscrowAccount::SPACE,
        seeds = [b"escrow", creator.key().as_ref(), &escrow_id.to_le_bytes()],
        bump
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Recipient is stored but doesn't sign at creation
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Arbiter is stored but doesn't sign at creation
    pub arbiter: UncheckedAccount<'info>,

    /// CHECK: Fee recipient is stored but doesn't sign
    pub fee_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// Creator's reputation account (optional - pass if tracking reputation)
    #[account(
        mut,
        seeds = [b"reputation", creator.key().as_ref()],
        bump = creator_reputation.bump,
    )]
    pub creator_reputation: Option<Account<'info, ReputationAccount>>,

    /// Recipient's reputation account (optional - pass if tracking reputation)
    #[account(
        mut,
        seeds = [b"reputation", recipient.key().as_ref()],
        bump = recipient_reputation.bump,
    )]
    pub recipient_reputation: Option<Account<'info, ReputationAccount>>,
}

pub fn handler(
    ctx: Context<CreateEscrow>,
    escrow_id: u64,
    amount: u64,
    deadline: i64,
    terms_hash: [u8; 32],
    fee_basis_points: u16,
    auto_release_at: i64,
) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(fee_basis_points <= 1000, EscrowError::FeeTooHigh);

    let clock = Clock::get()?;
    require!(deadline > clock.unix_timestamp, EscrowError::DeadlineExpired);

    // If auto_release_at is set, it must be after the deadline
    if auto_release_at != 0 {
        require!(auto_release_at > deadline, EscrowError::InvalidAutoRelease);
    }

    // Transfer SOL from creator to escrow PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.escrow_account.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update reputation accounts if provided AND amount >= 0.01 SOL (anti-gaming)
    const MIN_REPUTATION_AMOUNT: u64 = 10_000_000;

    if amount >= MIN_REPUTATION_AMOUNT {
        if let Some(creator_rep) = &mut ctx.accounts.creator_reputation {
            creator_rep.escrows_created = creator_rep.escrows_created.saturating_add(1);
            creator_rep.last_activity = clock.unix_timestamp;
        }

        if let Some(recipient_rep) = &mut ctx.accounts.recipient_reputation {
            recipient_rep.escrows_received = recipient_rep.escrows_received.saturating_add(1);
            recipient_rep.last_activity = clock.unix_timestamp;
        }
    }

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.creator = ctx.accounts.creator.key();
    escrow.recipient = ctx.accounts.recipient.key();
    escrow.amount = amount;
    escrow.status = EscrowStatus::Created;
    escrow.deadline = deadline;
    escrow.terms_hash = terms_hash;
    escrow.arbiter = ctx.accounts.arbiter.key();
    escrow.fee_basis_points = fee_basis_points;
    escrow.fee_recipient = ctx.accounts.fee_recipient.key();
    escrow.created_at = clock.unix_timestamp;
    escrow.escrow_id = escrow_id;
    escrow.bump = ctx.bumps.escrow_account;
    escrow.dispute_reason = [0u8; 64];
    escrow.auto_release_at = auto_release_at;

    Ok(())
}
