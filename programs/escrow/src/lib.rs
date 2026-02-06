use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X");

#[program]
pub mod escrow {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        escrow_id: u64,
        amount: u64,
        deadline: i64,
        terms_hash: [u8; 32],
        fee_basis_points: u16,
        auto_release_at: i64,
    ) -> Result<()> {
        instructions::create_escrow::handler(ctx, escrow_id, amount, deadline, terms_hash, fee_basis_points, auto_release_at)
    }

    pub fn auto_release(ctx: Context<AutoRelease>) -> Result<()> {
        instructions::auto_release::handler(ctx)
    }

    pub fn accept_task(ctx: Context<AcceptTask>) -> Result<()> {
        instructions::accept_task::handler(ctx)
    }

    pub fn release_payment(ctx: Context<ReleasePayment>) -> Result<()> {
        instructions::release_payment::handler(ctx)
    }

    pub fn request_refund(ctx: Context<RequestRefund>) -> Result<()> {
        instructions::request_refund::handler(ctx)
    }

    pub fn dispute(ctx: Context<Dispute>, reason: [u8; 64]) -> Result<()> {
        instructions::dispute::handler(ctx, reason)
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, winner: DisputeWinner) -> Result<()> {
        instructions::resolve_dispute::handler(ctx, winner)
    }

    // --- Token Escrow Instructions ---

    pub fn create_token_escrow(
        ctx: Context<CreateTokenEscrow>,
        escrow_id: u64,
        amount: u64,
        deadline: i64,
        terms_hash: [u8; 32],
        fee_basis_points: u16,
        auto_release_at: i64,
    ) -> Result<()> {
        instructions::create_token_escrow::handler(ctx, escrow_id, amount, deadline, terms_hash, fee_basis_points, auto_release_at)
    }

    pub fn accept_token_task(ctx: Context<AcceptTokenTask>) -> Result<()> {
        instructions::accept_token_task::handler(ctx)
    }

    pub fn release_token_payment(ctx: Context<ReleaseTokenPayment>) -> Result<()> {
        instructions::release_token_payment::handler(ctx)
    }

    pub fn refund_token_escrow(ctx: Context<RefundTokenEscrow>) -> Result<()> {
        instructions::refund_token_escrow::handler(ctx)
    }

    pub fn dispute_token(ctx: Context<DisputeToken>, reason: [u8; 64]) -> Result<()> {
        instructions::dispute_token::handler(ctx, reason)
    }

    pub fn resolve_token_dispute(ctx: Context<ResolveTokenDispute>, winner: DisputeWinner) -> Result<()> {
        instructions::resolve_token_dispute::handler(ctx, winner)
    }

    pub fn auto_release_token(ctx: Context<AutoReleaseToken>) -> Result<()> {
        instructions::auto_release_token::handler(ctx)
    }

    // --- Milestone Escrow Instructions ---

    pub fn create_milestone_escrow(
        ctx: Context<CreateMilestoneEscrow>,
        escrow_id: u64,
        deadline: i64,
        terms_hash: [u8; 32],
        fee_basis_points: u16,
        milestones: Vec<MilestoneInput>,
    ) -> Result<()> {
        instructions::create_milestone_escrow::handler(ctx, escrow_id, deadline, terms_hash, fee_basis_points, milestones)
    }

    pub fn accept_milestone_task(ctx: Context<AcceptMilestoneTask>) -> Result<()> {
        instructions::accept_milestone_task::handler(ctx)
    }

    pub fn release_milestone(ctx: Context<ReleaseMilestone>, milestone_index: u8) -> Result<()> {
        instructions::release_milestone::handler(ctx, milestone_index)
    }

    pub fn dispute_milestone(ctx: Context<DisputeMilestone>, milestone_index: u8) -> Result<()> {
        instructions::dispute_milestone::handler(ctx, milestone_index)
    }

    pub fn resolve_milestone_dispute(ctx: Context<ResolveMilestoneDispute>, milestone_index: u8, winner: DisputeWinner) -> Result<()> {
        instructions::resolve_milestone_dispute::handler(ctx, milestone_index, winner)
    }

    pub fn refund_milestone_escrow(ctx: Context<RefundMilestoneEscrow>) -> Result<()> {
        instructions::refund_milestone_escrow::handler(ctx)
    }

    // --- Reputation ---

    pub fn init_reputation(ctx: Context<InitReputation>) -> Result<()> {
        instructions::init_reputation::handler(ctx)
    }
}
