use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateTokenEscrow<'info> {
    #[account(
        init,
        payer = creator,
        space = TokenEscrowAccount::SPACE,
        seeds = [b"token_escrow", creator.key().as_ref(), &escrow_id.to_le_bytes()],
        bump
    )]
    pub escrow_account: Account<'info, TokenEscrowAccount>,

    #[account(
        init,
        payer = creator,
        token::mint = mint,
        token::authority = escrow_account,
        seeds = [b"token_vault", escrow_account.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Recipient stored but doesn't sign at creation
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Arbiter stored but doesn't sign at creation
    pub arbiter: UncheckedAccount<'info>,

    /// CHECK: Fee recipient stored but doesn't sign
    pub fee_recipient: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key(),
        constraint = creator_token_account.mint == mint.key(),
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateTokenEscrow>,
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

    if auto_release_at != 0 {
        require!(auto_release_at > deadline, EscrowError::InvalidAutoRelease);
    }

    // Transfer tokens from creator to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        amount,
    )?;

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.creator = ctx.accounts.creator.key();
    escrow.recipient = ctx.accounts.recipient.key();
    escrow.mint = ctx.accounts.mint.key();
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
