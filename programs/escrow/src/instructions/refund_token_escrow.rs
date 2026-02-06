use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct RefundTokenEscrow<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"token_escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
        constraint = escrow_account.creator == creator.key() @ EscrowError::UnauthorizedCreator,
    )]
    pub escrow_account: Account<'info, TokenEscrowAccount>,

    #[account(
        mut,
        seeds = [b"token_vault", escrow_account.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = creator_token_account.owner == escrow_account.creator,
        constraint = creator_token_account.mint == escrow_account.mint,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RefundTokenEscrow>) -> Result<()> {
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

    let escrow_id_bytes = escrow.escrow_id.to_le_bytes();
    let seeds = &[
        b"token_escrow".as_ref(),
        escrow.creator.as_ref(),
        escrow_id_bytes.as_ref(),
        &[escrow.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Transfer tokens back to creator
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.creator_token_account.to_account_info(),
                authority: ctx.accounts.escrow_account.to_account_info(),
            },
            signer_seeds,
        ),
        escrow.amount,
    )?;

    // Close vault
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        },
        signer_seeds,
    ))?;

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = if escrow.status == EscrowStatus::Created {
        EscrowStatus::Cancelled
    } else {
        EscrowStatus::Refunded
    };

    Ok(())
}
