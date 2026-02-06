use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Escrow is not in the expected status for this operation")]
    InvalidStatus,
    #[msg("Only the creator can perform this action")]
    UnauthorizedCreator,
    #[msg("Only the recipient can perform this action")]
    UnauthorizedRecipient,
    #[msg("Only the arbiter can resolve disputes")]
    UnauthorizedArbiter,
    #[msg("Deadline has not passed yet")]
    DeadlineNotReached,
    #[msg("Deadline has already passed")]
    DeadlineExpired,
    #[msg("Fee basis points exceeds maximum (1000 = 10%)")]
    FeeTooHigh,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Only creator or recipient can dispute")]
    UnauthorizedDisputer,
    #[msg("Auto-release timestamp must be after deadline")]
    InvalidAutoRelease,
    #[msg("Auto-release is not enabled for this escrow")]
    AutoReleaseNotEnabled,
    #[msg("Auto-release timestamp has not been reached yet")]
    AutoReleaseNotReady,
    #[msg("Too many milestones (max 10)")]
    TooManyMilestones,
    #[msg("Milestone amounts must sum to total amount")]
    MilestoneAmountMismatch,
    #[msg("Invalid milestone index")]
    InvalidMilestoneIndex,
    #[msg("Milestone already released")]
    MilestoneAlreadyReleased,
    #[msg("Milestone is not in pending status")]
    MilestoneNotPending,
}
