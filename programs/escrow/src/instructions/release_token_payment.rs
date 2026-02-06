use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::*;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct ReleaseTokenPayment<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"token_escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
        constraint = escrow_account.creator == creator.key() @ EscrowError::UnauthorizedCreator,
        constraint = escrow_account.status == EscrowStatus::Active @ EscrowError::InvalidStatus,
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

    /// CHECK: validated against escrow_account.recipient
    #[account(
        mut,
        constraint = escrow_account.recipient == recipient.key() @ EscrowError::UnauthorizedRecipient
    )]
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == escrow_account.recipient,
        constraint = recipient_token_account.mint == escrow_account.mint,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.owner == escrow_account.fee_recipient,
        constraint = fee_token_account.mint == escrow_account.mint,
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReleaseTokenPayment>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_account;

    // Calculate fee
    let fee = (escrow.amount as u128)
        .checked_mul(escrow.fee_basis_points as u128)
        .ok_or(EscrowError::Overflow)?
        .checked_div(10_000)
        .ok_or(EscrowError::Overflow)? as u64;

    let recipient_amount = escrow.amount.checked_sub(fee).ok_or(EscrowError::Overflow)?;

    // PDA signer seeds
    let escrow_id_bytes = escrow.escrow_id.to_le_bytes();
    let seeds = &[
        b"token_escrow".as_ref(),
        escrow.creator.as_ref(),
        escrow_id_bytes.as_ref(),
        &[escrow.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Transfer fee to fee recipient
    if fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.fee_token_account.to_account_info(),
                    authority: ctx.accounts.escrow_account.to_account_info(),
                },
                signer_seeds,
            ),
            fee,
        )?;
    }

    // Transfer remaining to recipient
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.escrow_account.to_account_info(),
            },
            signer_seeds,
        ),
        recipient_amount,
    )?;

    // Close vault account, return rent to creator
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        },
        signer_seeds,
    ))?;

    // Update status
    let escrow = &mut ctx.accounts.escrow_account;
    escrow.status = EscrowStatus::Completed;

    Ok(())
}
