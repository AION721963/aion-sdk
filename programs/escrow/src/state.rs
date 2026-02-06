use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Created,
    Active,
    Completed,
    Disputed,
    Refunded,
    Cancelled,
    Resolved,
}

#[account]
pub struct EscrowAccount {
    /// Creator (task poster) pubkey
    pub creator: Pubkey,
    /// Recipient (task executor) pubkey
    pub recipient: Pubkey,
    /// Amount in lamports held in escrow
    pub amount: u64,
    /// Current status
    pub status: EscrowStatus,
    /// Deadline as Unix timestamp (seconds)
    pub deadline: i64,
    /// SHA256 hash of terms/agreement
    pub terms_hash: [u8; 32],
    /// Arbiter pubkey (for dispute resolution)
    pub arbiter: Pubkey,
    /// Fee in basis points (e.g. 150 = 1.5%)
    pub fee_basis_points: u16,
    /// Fee recipient (treasury) pubkey
    pub fee_recipient: Pubkey,
    /// Creation timestamp (Unix seconds)
    pub created_at: i64,
    /// Unique escrow ID
    pub escrow_id: u64,
    /// PDA bump seed
    pub bump: u8,
    /// Dispute reason (truncated to 64 bytes)
    pub dispute_reason: [u8; 64],
    /// Auto-release timestamp (0 = disabled, >0 = unix timestamp when anyone can release)
    pub auto_release_at: i64,
}

impl EscrowAccount {
    pub const SPACE: usize = 8  // discriminator
        + 32  // creator
        + 32  // recipient
        + 8   // amount
        + 1   // status
        + 8   // deadline
        + 32  // terms_hash
        + 32  // arbiter
        + 2   // fee_basis_points
        + 32  // fee_recipient
        + 8   // created_at
        + 8   // escrow_id
        + 1   // bump
        + 64  // dispute_reason
        + 8;  // auto_release_at
}

#[account]
pub struct TokenEscrowAccount {
    /// Creator (task poster) pubkey
    pub creator: Pubkey,
    /// Recipient (task executor) pubkey
    pub recipient: Pubkey,
    /// SPL token mint address
    pub mint: Pubkey,
    /// Amount in token smallest units
    pub amount: u64,
    /// Current status
    pub status: EscrowStatus,
    /// Deadline as Unix timestamp (seconds)
    pub deadline: i64,
    /// SHA256 hash of terms/agreement
    pub terms_hash: [u8; 32],
    /// Arbiter pubkey (for dispute resolution)
    pub arbiter: Pubkey,
    /// Fee in basis points (e.g. 10 = 0.1%)
    pub fee_basis_points: u16,
    /// Fee recipient (treasury) pubkey
    pub fee_recipient: Pubkey,
    /// Creation timestamp (Unix seconds)
    pub created_at: i64,
    /// Unique escrow ID
    pub escrow_id: u64,
    /// PDA bump seed
    pub bump: u8,
    /// Dispute reason (truncated to 64 bytes)
    pub dispute_reason: [u8; 64],
    /// Auto-release timestamp (0 = disabled)
    pub auto_release_at: i64,
}

impl TokenEscrowAccount {
    pub const SPACE: usize = 8  // discriminator
        + 32  // creator
        + 32  // recipient
        + 32  // mint
        + 8   // amount
        + 1   // status
        + 8   // deadline
        + 32  // terms_hash
        + 32  // arbiter
        + 2   // fee_basis_points
        + 32  // fee_recipient
        + 8   // created_at
        + 8   // escrow_id
        + 1   // bump
        + 64  // dispute_reason
        + 8;  // auto_release_at
}

pub const MAX_MILESTONES: usize = 10;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MilestoneStatus {
    Pending,
    Released,
    Disputed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Milestone {
    pub amount: u64,
    pub status: MilestoneStatus,
    pub description_hash: [u8; 32],
}

impl Milestone {
    pub const SPACE: usize = 8 + 1 + 32; // 41 bytes
}

impl Default for Milestone {
    fn default() -> Self {
        Milestone {
            amount: 0,
            status: MilestoneStatus::Pending,
            description_hash: [0u8; 32],
        }
    }
}

#[account]
pub struct MilestoneEscrowAccount {
    pub creator: Pubkey,
    pub recipient: Pubkey,
    pub total_amount: u64,
    pub released_amount: u64,
    pub status: EscrowStatus,
    pub deadline: i64,
    pub terms_hash: [u8; 32],
    pub arbiter: Pubkey,
    pub fee_basis_points: u16,
    pub fee_recipient: Pubkey,
    pub created_at: i64,
    pub escrow_id: u64,
    pub bump: u8,
    pub milestone_count: u8,
    pub milestones: [Milestone; MAX_MILESTONES],
}

impl MilestoneEscrowAccount {
    pub const SPACE: usize = 8  // discriminator
        + 32  // creator
        + 32  // recipient
        + 8   // total_amount
        + 8   // released_amount
        + 1   // status
        + 8   // deadline
        + 32  // terms_hash
        + 32  // arbiter
        + 2   // fee_basis_points
        + 32  // fee_recipient
        + 8   // created_at
        + 8   // escrow_id
        + 1   // bump
        + 1   // milestone_count
        + (Milestone::SPACE * MAX_MILESTONES); // milestones
}

#[account]
pub struct ReputationAccount {
    /// Agent's public key
    pub agent: Pubkey,
    /// Number of escrows created
    pub escrows_created: u32,
    /// Number of escrows completed as creator
    pub escrows_completed: u32,
    /// Number of escrows received as recipient
    pub escrows_received: u32,
    /// Number of tasks completed as recipient
    pub tasks_completed: u32,
    /// Number of disputes initiated
    pub disputes_initiated: u32,
    /// Number of disputes won
    pub disputes_won: u32,
    /// Number of disputes lost
    pub disputes_lost: u32,
    /// Total volume in lamports
    pub total_volume_lamports: u64,
    /// Last activity timestamp
    pub last_activity: i64,
    /// PDA bump
    pub bump: u8,
}

impl ReputationAccount {
    pub const SPACE: usize = 8  // discriminator
        + 32  // agent
        + 4   // escrows_created
        + 4   // escrows_completed
        + 4   // escrows_received
        + 4   // tasks_completed
        + 4   // disputes_initiated
        + 4   // disputes_won
        + 4   // disputes_lost
        + 8   // total_volume_lamports
        + 8   // last_activity
        + 1;  // bump
}
