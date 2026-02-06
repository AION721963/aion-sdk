/**
 * @aion-sdk/solana - Escrow Module
 *
 * Trustless escrow for agent-to-agent transactions on Solana
 *
 * Flow:
 * 1. Creator calls create(amount, recipient, terms)
 * 2. Recipient calls accept(escrowId)
 * 3. After work completed: release(escrowId)
 * 4. If dispute: dispute(escrowId, reason)
 *
 * On-chain program: EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X
 */

import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, BN, type Idl } from '@coral-xyz/anchor';
import { createHash } from 'crypto';
import {
  type EscrowConfig,
  type EscrowState,
  EscrowStatus,
  MilestoneStatus,
  type DisputeWinner,
  type FeeConfig,
  DEFAULT_FEE_PERCENT,
  MAX_FEE_PERCENT,
  AION_TREASURY,
  validateFeePercent,
  calculateFee,
  type Signer,
  type Network,
  getRpcEndpoint,
  RPC_ENDPOINTS,
} from '@aion-sdk/core';

import escrowIdl from './idl/escrow.json';

// Re-export types from core
export type { EscrowConfig, EscrowState, FeeConfig, Network, DisputeWinner } from '@aion-sdk/core';
export { EscrowStatus, MilestoneStatus, DEFAULT_FEE_PERCENT, MAX_FEE_PERCENT, AION_TREASURY, getRpcEndpoint, RPC_ENDPOINTS } from '@aion-sdk/core';

/** Deployed escrow program ID */
export const ESCROW_PROGRAM_ID = new PublicKey('EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X');

/**
 * Escrow creation parameters
 */
export interface CreateEscrowParams {
  /** Amount in SOL (will be converted to lamports) */
  amount: number;
  /** Recipient (executor) wallet address */
  recipient: string;
  /** Deadline as Date or Unix timestamp (ms) */
  deadline: Date | number;
  /** Optional description or terms hash */
  terms?: string;
  /** Optional arbiter for disputes */
  arbiter?: string;
  /** Optional auto-release timestamp (Date or Unix ms). If set, anyone can release after this time. Must be after deadline. */
  autoReleaseAt?: Date | number;
}

/**
 * Options for SolanaEscrow client
 */
export interface SolanaEscrowOptions {
  /** Custom fee percentage (0-10%). Default: 1.5% */
  feePercent?: number;
  /** Custom fee recipient. Default: AION Treasury */
  feeRecipient?: string;
}

/**
 * Derive PDA for an escrow account
 */
export function deriveEscrowPda(
  creator: PublicKey,
  escrowId: BN | number | bigint,
  programId: PublicKey = ESCROW_PROGRAM_ID,
): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));

  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), creator.toBuffer(), idBuffer],
    programId,
  );
}

/**
 * Derive PDA for a reputation account
 */
export function deriveReputationPda(
  agent: PublicKey,
  programId: PublicKey = ESCROW_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), agent.toBuffer()],
    programId,
  );
}

/**
 * Derive PDA for a milestone escrow account
 */
export function deriveMilestoneEscrowPda(
  creator: PublicKey,
  escrowId: BN | number | bigint,
  programId: PublicKey = ESCROW_PROGRAM_ID,
): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));

  return PublicKey.findProgramAddressSync(
    [Buffer.from('milestone_escrow'), creator.toBuffer(), idBuffer],
    programId,
  );
}

/**
 * Input for a single milestone when creating a milestone escrow
 */
export interface MilestoneInput {
  /** Amount in SOL for this milestone */
  amount: number;
  /** Description of this milestone (will be SHA256 hashed) */
  description: string;
}

/**
 * Milestone state from on-chain
 */
export interface MilestoneState {
  amount: bigint;
  status: MilestoneStatus;
  descriptionHash: string;
}

/**
 * Milestone escrow creation parameters
 */
export interface CreateMilestoneEscrowParams {
  /** Recipient (executor) wallet address */
  recipient: string;
  /** Deadline as Date or Unix timestamp (ms) */
  deadline: Date | number;
  /** Optional overall terms description */
  terms?: string;
  /** Optional arbiter for disputes */
  arbiter?: string;
  /** Milestones (1-10). Amounts are in SOL. */
  milestones: MilestoneInput[];
}

/**
 * Milestone escrow state from on-chain
 */
export interface MilestoneEscrowState {
  id: string;
  creator: PublicKey;
  recipient: PublicKey;
  totalAmount: bigint;
  releasedAmount: bigint;
  status: EscrowStatus;
  deadline: number;
  termsHash: string;
  arbiter: PublicKey;
  feeBasisPoints: number;
  feeRecipient: PublicKey;
  createdAt: number;
  milestoneCount: number;
  milestones: MilestoneState[];
}

/**
 * Agent reputation data
 */
export interface AgentReputation {
  agent: string;
  escrowsCreated: number;
  escrowsCompleted: number;
  escrowsReceived: number;
  tasksCompleted: number;
  disputesInitiated: number;
  disputesWon: number;
  disputesLost: number;
  totalVolumeLamports: bigint;
  lastActivity: number;
  // Derived metrics
  completionRate: number;
  trustScore: number;
}

/**
 * Escrow client for Solana — trustless agent-to-agent transactions
 */
export class SolanaEscrow {
  private connection: Connection;
  private signer: Signer;
  private feePercent: number;
  private feeRecipient: string;

  constructor(signer: Signer, connection: Connection, options?: SolanaEscrowOptions) {
    this.signer = signer;
    this.connection = connection;

    this.feePercent = options?.feePercent ?? DEFAULT_FEE_PERCENT;
    this.feeRecipient = options?.feeRecipient ?? AION_TREASURY;

    validateFeePercent(this.feePercent);
  }

  /**
   * Create escrow from wallet directly
   *
   * @param wallet - Signer wallet
   * @param networkOrUrl - Network name ('mainnet-beta', 'devnet', 'testnet', 'localnet') or custom RPC URL
   * @param options - Optional fee configuration
   *
   * @example
   * ```typescript
   * // Use mainnet
   * const escrow = SolanaEscrow.fromWallet(wallet, 'mainnet-beta');
   *
   * // Use devnet (default)
   * const escrow = SolanaEscrow.fromWallet(wallet);
   *
   * // Use custom RPC
   * const escrow = SolanaEscrow.fromWallet(wallet, 'https://my-rpc.com');
   * ```
   */
  static fromWallet(
    wallet: Signer,
    networkOrUrl: Network | string = 'devnet',
    options?: SolanaEscrowOptions,
  ): SolanaEscrow {
    const rpcUrl = ['mainnet-beta', 'devnet', 'testnet', 'localnet'].includes(networkOrUrl)
      ? getRpcEndpoint(networkOrUrl as Network)
      : networkOrUrl;
    const connection = new Connection(rpcUrl, 'confirmed');
    return new SolanaEscrow(wallet, connection, options);
  }

  /**
   * Get current fee configuration
   */
  getFeeConfig(): FeeConfig {
    return {
      feePercent: this.feePercent,
      feeRecipient: this.feeRecipient,
    };
  }

  /**
   * Update fee configuration
   * @throws Error if fee is out of valid range
   */
  setFeeConfig(config: Partial<FeeConfig>): void {
    if (config.feePercent !== undefined) {
      validateFeePercent(config.feePercent);
      this.feePercent = config.feePercent;
    }
    if (config.feeRecipient !== undefined) {
      this.feeRecipient = config.feeRecipient;
    }
  }

  /**
   * Calculate fee for a given amount
   */
  calculateFeeForAmount(amountLamports: bigint): bigint {
    return calculateFee(amountLamports, this.feePercent);
  }

  private getProgram(): Program {
    const provider = new AnchorProvider(
      this.connection,
      this.signer as any,
      { commitment: 'confirmed' },
    );
    return new Program(escrowIdl as Idl, ESCROW_PROGRAM_ID, provider);
  }

  /**
   * Create a new escrow
   *
   * @param params - Escrow creation parameters
   * @returns Escrow PDA address (use this as escrowId for other methods)
   *
   * @example
   * ```typescript
   * const escrowId = await escrow.create({
   *   amount: 0.5,
   *   recipient: 'RecipientAddress...',
   *   deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
   *   terms: 'Build feature X'
   * });
   * ```
   */
  async create(params: CreateEscrowParams): Promise<string> {
    const program = this.getProgram();

    const amountLamports = new BN(Math.round(params.amount * LAMPORTS_PER_SOL));
    const deadlineUnix = new BN(
      Math.floor(
        (params.deadline instanceof Date ? params.deadline.getTime() : params.deadline) / 1000,
      ),
    );

    const termsHash = params.terms
      ? Array.from(createHash('sha256').update(params.terms).digest())
      : Array(32).fill(0);

    // Random escrow ID to avoid collisions
    const escrowIdBytes = new Uint8Array(8);
    crypto.getRandomValues(escrowIdBytes);
    const escrowId = new BN(Buffer.from(escrowIdBytes), 'le');

    const recipientPubkey = new PublicKey(params.recipient);
    const arbiterPubkey = params.arbiter
      ? new PublicKey(params.arbiter)
      : this.signer.publicKey;
    const feeRecipientPubkey = new PublicKey(this.feeRecipient);
    const feeBasisPoints = Math.round(this.feePercent * 100);

    const [escrowPda] = deriveEscrowPda(this.signer.publicKey, escrowId);

    const autoReleaseUnix = params.autoReleaseAt
      ? new BN(
          Math.floor(
            (params.autoReleaseAt instanceof Date ? params.autoReleaseAt.getTime() : params.autoReleaseAt) / 1000,
          ),
        )
      : new BN(0);

    // Derive reputation PDAs (optional accounts - pass if they exist)
    const [creatorRepPda] = deriveReputationPda(this.signer.publicKey);
    const [recipientRepPda] = deriveReputationPda(recipientPubkey);

    // Check if reputation accounts exist
    const creatorRepExists = await this.accountExists(creatorRepPda);
    const recipientRepExists = await this.accountExists(recipientRepPda);

    // Build accounts object with optional reputation accounts
    const accounts: Record<string, PublicKey> = {
      escrowAccount: escrowPda,
      creator: this.signer.publicKey,
      recipient: recipientPubkey,
      arbiter: arbiterPubkey,
      feeRecipient: feeRecipientPubkey,
      systemProgram: SystemProgram.programId,
    };

    if (creatorRepExists) {
      accounts.creatorReputation = creatorRepPda;
    }
    if (recipientRepExists) {
      accounts.recipientReputation = recipientRepPda;
    }

    await program.methods
      .createEscrow(escrowId, amountLamports, deadlineUnix, termsHash, feeBasisPoints, autoReleaseUnix)
      .accounts(accounts)
      .rpc();

    return escrowPda.toBase58();
  }

  /**
   * Check if an account exists on chain
   */
  private async accountExists(pubkey: PublicKey): Promise<boolean> {
    try {
      const info = await this.connection.getAccountInfo(pubkey);
      return info !== null;
    } catch {
      return false;
    }
  }

  /**
   * Accept a task as the executor
   *
   * @param escrowId - The escrow PDA address
   * @returns Transaction signature
   */
  async accept(escrowId: string): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const sig = await program.methods
      .acceptTask()
      .accounts({
        escrowAccount: escrowPubkey,
        recipient: this.signer.publicKey,
      })
      .rpc();

    return sig;
  }

  /**
   * Release payment to the executor (creator only)
   *
   * Fee is automatically deducted based on the on-chain fee configuration.
   * Recipient receives: amount - fee
   * Fee goes to: feeRecipient (configured at creation)
   *
   * @param escrowId - The escrow PDA address
   * @returns Transaction signature
   */
  async release(escrowId: string): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const escrowData = await program.account.escrowAccount.fetch(escrowPubkey);
    const creatorPubkey = escrowData.creator as PublicKey;
    const recipientPubkey = escrowData.recipient as PublicKey;

    // Derive reputation PDAs
    const [creatorRepPda] = deriveReputationPda(creatorPubkey);
    const [recipientRepPda] = deriveReputationPda(recipientPubkey);

    // Check if reputation accounts exist
    const creatorRepExists = await this.accountExists(creatorRepPda);
    const recipientRepExists = await this.accountExists(recipientRepPda);

    // Build accounts object with optional reputation accounts
    const accounts: Record<string, PublicKey> = {
      escrowAccount: escrowPubkey,
      creator: this.signer.publicKey,
      recipient: recipientPubkey,
      feeRecipient: escrowData.feeRecipient as PublicKey,
    };

    if (creatorRepExists) {
      accounts.creatorReputation = creatorRepPda;
    }
    if (recipientRepExists) {
      accounts.recipientReputation = recipientRepPda;
    }

    const sig = await program.methods
      .releasePayment()
      .accounts(accounts)
      .rpc();

    return sig;
  }

  /**
   * Request refund (creator only)
   *
   * - If status is Created: cancel anytime
   * - If status is Active: only after deadline passed
   *
   * @param escrowId - The escrow PDA address
   * @returns Transaction signature
   */
  async refund(escrowId: string): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const sig = await program.methods
      .requestRefund()
      .accounts({
        escrowAccount: escrowPubkey,
        creator: this.signer.publicKey,
      })
      .rpc();

    return sig;
  }

  /**
   * Auto-release payment to the executor (anyone can call after auto_release_at timestamp)
   *
   * @param escrowId - The escrow PDA address
   * @returns Transaction signature
   */
  async autoRelease(escrowId: string): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const escrowData = await program.account.escrowAccount.fetch(escrowPubkey);
    const creatorPubkey = escrowData.creator as PublicKey;
    const recipientPubkey = escrowData.recipient as PublicKey;

    // Derive reputation PDAs
    const [creatorRepPda] = deriveReputationPda(creatorPubkey);
    const [recipientRepPda] = deriveReputationPda(recipientPubkey);

    // Check if reputation accounts exist
    const creatorRepExists = await this.accountExists(creatorRepPda);
    const recipientRepExists = await this.accountExists(recipientRepPda);

    // Build accounts object with optional reputation accounts
    const accounts: Record<string, PublicKey> = {
      escrowAccount: escrowPubkey,
      caller: this.signer.publicKey,
      creator: creatorPubkey,
      recipient: recipientPubkey,
      feeRecipient: escrowData.feeRecipient as PublicKey,
    };

    if (creatorRepExists) {
      accounts.creatorReputation = creatorRepPda;
    }
    if (recipientRepExists) {
      accounts.recipientReputation = recipientRepPda;
    }

    const sig = await program.methods
      .autoRelease()
      .accounts(accounts)
      .rpc();

    return sig;
  }

  /**
   * Open a dispute (creator or executor)
   *
   * @param escrowId - The escrow PDA address
   * @param reason - Reason for the dispute (max 64 bytes)
   * @returns Transaction signature
   */
  async dispute(escrowId: string, reason: string): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const reasonBytes = Buffer.alloc(64);
    reasonBytes.write(reason.substring(0, 64));

    // Derive disputer reputation PDA
    const [disputerRepPda] = deriveReputationPda(this.signer.publicKey);
    const disputerRepExists = await this.accountExists(disputerRepPda);

    // Build accounts object with optional reputation account
    const accounts: Record<string, PublicKey> = {
      escrowAccount: escrowPubkey,
      disputer: this.signer.publicKey,
    };

    if (disputerRepExists) {
      accounts.disputerReputation = disputerRepPda;
    }

    const sig = await program.methods
      .dispute(Array.from(reasonBytes))
      .accounts(accounts)
      .rpc();

    return sig;
  }

  /**
   * Get escrow state
   *
   * @param escrowId - The escrow PDA address
   * @returns Escrow state or null if not found
   */
  async getEscrow(escrowId: string): Promise<EscrowState | null> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    try {
      const data = await program.account.escrowAccount.fetch(escrowPubkey);
      return this.mapOnChainToEscrowState(escrowPubkey, data);
    } catch {
      return null;
    }
  }

  /**
   * List escrows created by the current signer
   */
  async listMyEscrows(): Promise<EscrowState[]> {
    const program = this.getProgram();

    const accounts = await program.account.escrowAccount.all([
      {
        memcmp: {
          offset: 8, // After discriminator: creator is first field
          bytes: this.signer.publicKey.toBase58(),
        },
      },
    ]);

    return accounts.map((a) => this.mapOnChainToEscrowState(a.publicKey, a.account));
  }

  /**
   * List escrows where current signer is the recipient
   */
  async listTasksForMe(): Promise<EscrowState[]> {
    const program = this.getProgram();

    const accounts = await program.account.escrowAccount.all([
      {
        memcmp: {
          offset: 8 + 32, // After discriminator + creator: recipient is second field
          bytes: this.signer.publicKey.toBase58(),
        },
      },
    ]);

    return accounts.map((a) => this.mapOnChainToEscrowState(a.publicKey, a.account));
  }

  /**
   * Initialize reputation account for an agent
   *
   * @param agent - Optional agent address. Defaults to current signer.
   * @returns Transaction signature
   */
  async initReputation(agent?: string): Promise<string> {
    const program = this.getProgram();
    const agentPubkey = agent ? new PublicKey(agent) : this.signer.publicKey;
    const [reputationPda] = deriveReputationPda(agentPubkey);

    const sig = await program.methods
      .initReputation()
      .accounts({
        reputationAccount: reputationPda,
        agent: agentPubkey,
        payer: this.signer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return sig;
  }

  /**
   * Get reputation for an agent
   *
   * @param agent - Agent address to get reputation for
   * @returns Agent reputation or null if not found
   */
  async getReputation(agent: string): Promise<AgentReputation | null> {
    const program = this.getProgram();
    const agentPubkey = new PublicKey(agent);
    const [reputationPda] = deriveReputationPda(agentPubkey);

    try {
      const data = await program.account.reputationAccount.fetch(reputationPda);
      return this.mapOnChainToReputation(data);
    } catch {
      return null;
    }
  }

  /**
   * Ensure reputation account exists for an agent (initialize if needed)
   *
   * @param agent - Optional agent address. Defaults to current signer.
   * @returns Transaction signature if initialized, null if already exists
   */
  async ensureReputation(agent?: string): Promise<string | null> {
    const agentPubkey = agent ? new PublicKey(agent) : this.signer.publicKey;
    const [reputationPda] = deriveReputationPda(agentPubkey);

    const exists = await this.accountExists(reputationPda);
    if (exists) {
      return null;
    }

    return this.initReputation(agent);
  }

  // ── Dispute Resolution ───────────────────────────────────────────

  /**
   * Resolve a dispute (arbiter only)
   *
   * @param escrowId - The escrow PDA address
   * @param winner - 'creator' or 'recipient'
   * @returns Transaction signature
   */
  async resolveDispute(escrowId: string, winner: DisputeWinner): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);
    const escrowData = await program.account.escrowAccount.fetch(escrowPubkey);

    const creatorPubkey = escrowData.creator as PublicKey;
    const recipientPubkey = escrowData.recipient as PublicKey;
    const feeRecipientPubkey = escrowData.feeRecipient as PublicKey;

    const [creatorRepPda] = deriveReputationPda(creatorPubkey);
    const [recipientRepPda] = deriveReputationPda(recipientPubkey);
    const creatorRepExists = await this.accountExists(creatorRepPda);
    const recipientRepExists = await this.accountExists(recipientRepPda);

    const accounts: Record<string, PublicKey> = {
      escrowAccount: escrowPubkey,
      arbiter: this.signer.publicKey,
      creator: creatorPubkey,
      recipient: recipientPubkey,
      feeRecipient: feeRecipientPubkey,
    };

    if (creatorRepExists) accounts.creatorReputation = creatorRepPda;
    if (recipientRepExists) accounts.recipientReputation = recipientRepPda;

    const winnerEnum = winner === 'creator' ? { creator: {} } : { recipient: {} };

    const sig = await program.methods
      .resolveDispute(winnerEnum)
      .accounts(accounts)
      .rpc();

    return sig;
  }

  // ── Milestone Escrow ────────────────────────────────────────────

  /**
   * Create a milestone-based escrow
   *
   * Splits work into up to 10 milestones, each with its own payment.
   * Creator can release payments milestone by milestone.
   *
   * @param params - Milestone escrow creation parameters
   * @returns Milestone escrow PDA address
   */
  async createMilestoneEscrow(params: CreateMilestoneEscrowParams): Promise<string> {
    const program = this.getProgram();

    if (params.milestones.length < 1 || params.milestones.length > 10) {
      throw new Error('Milestones must be between 1 and 10');
    }

    const deadlineUnix = new BN(
      Math.floor(
        (params.deadline instanceof Date ? params.deadline.getTime() : params.deadline) / 1000,
      ),
    );

    const termsHash = params.terms
      ? Array.from(createHash('sha256').update(params.terms).digest())
      : Array(32).fill(0);

    const escrowIdBytes = new Uint8Array(8);
    crypto.getRandomValues(escrowIdBytes);
    const escrowId = new BN(Buffer.from(escrowIdBytes), 'le');

    const recipientPubkey = new PublicKey(params.recipient);
    const arbiterPubkey = params.arbiter
      ? new PublicKey(params.arbiter)
      : this.signer.publicKey;
    const feeRecipientPubkey = new PublicKey(this.feeRecipient);
    const feeBasisPoints = Math.round(this.feePercent * 100);

    const [escrowPda] = deriveMilestoneEscrowPda(this.signer.publicKey, escrowId);

    // Convert milestones: SOL → lamports, description → SHA256 hash
    const milestoneInputs = params.milestones.map((m) => ({
      amount: new BN(Math.round(m.amount * LAMPORTS_PER_SOL)),
      descriptionHash: Array.from(createHash('sha256').update(m.description).digest()),
    }));

    await program.methods
      .createMilestoneEscrow(escrowId, deadlineUnix, termsHash, feeBasisPoints, milestoneInputs)
      .accounts({
        escrowAccount: escrowPda,
        creator: this.signer.publicKey,
        recipient: recipientPubkey,
        arbiter: arbiterPubkey,
        feeRecipient: feeRecipientPubkey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return escrowPda.toBase58();
  }

  /**
   * Accept a milestone task as the executor
   *
   * @param escrowId - The milestone escrow PDA address
   * @returns Transaction signature
   */
  async acceptMilestoneTask(escrowId: string): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const sig = await program.methods
      .acceptMilestoneTask()
      .accounts({
        escrowAccount: escrowPubkey,
        recipient: this.signer.publicKey,
      })
      .rpc();

    return sig;
  }

  /**
   * Release payment for a specific milestone (creator only)
   *
   * @param escrowId - The milestone escrow PDA address
   * @param milestoneIndex - Index of the milestone to release (0-9)
   * @returns Transaction signature
   */
  async releaseMilestone(escrowId: string, milestoneIndex: number): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);
    const escrowData = await program.account.milestoneEscrowAccount.fetch(escrowPubkey);

    const sig = await program.methods
      .releaseMilestone(milestoneIndex)
      .accounts({
        escrowAccount: escrowPubkey,
        creator: this.signer.publicKey,
        recipient: escrowData.recipient as PublicKey,
        feeRecipient: escrowData.feeRecipient as PublicKey,
      })
      .rpc();

    return sig;
  }

  /**
   * Dispute a specific milestone (creator or executor)
   *
   * @param escrowId - The milestone escrow PDA address
   * @param milestoneIndex - Index of the milestone to dispute (0-9)
   * @returns Transaction signature
   */
  async disputeMilestone(escrowId: string, milestoneIndex: number): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const sig = await program.methods
      .disputeMilestone(milestoneIndex)
      .accounts({
        escrowAccount: escrowPubkey,
        disputer: this.signer.publicKey,
      })
      .rpc();

    return sig;
  }

  /**
   * Resolve a milestone dispute (arbiter only)
   *
   * @param escrowId - The milestone escrow PDA address
   * @param milestoneIndex - Index of the disputed milestone (0-9)
   * @param winner - 'creator' or 'recipient'
   * @returns Transaction signature
   */
  async resolveMilestoneDispute(
    escrowId: string,
    milestoneIndex: number,
    winner: DisputeWinner,
  ): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);
    const escrowData = await program.account.milestoneEscrowAccount.fetch(escrowPubkey);

    const winnerEnum = winner === 'creator' ? { creator: {} } : { recipient: {} };

    const sig = await program.methods
      .resolveMilestoneDispute(milestoneIndex, winnerEnum)
      .accounts({
        escrowAccount: escrowPubkey,
        arbiter: this.signer.publicKey,
        creator: escrowData.creator as PublicKey,
        recipient: escrowData.recipient as PublicKey,
        feeRecipient: escrowData.feeRecipient as PublicKey,
      })
      .rpc();

    return sig;
  }

  /**
   * Refund unreleased milestones (creator only)
   *
   * - If status is Created: refund anytime
   * - If status is Active: only after deadline passed
   *
   * @param escrowId - The milestone escrow PDA address
   * @returns Transaction signature
   */
  async refundMilestoneEscrow(escrowId: string): Promise<string> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    const sig = await program.methods
      .refundMilestoneEscrow()
      .accounts({
        escrowAccount: escrowPubkey,
        creator: this.signer.publicKey,
      })
      .rpc();

    return sig;
  }

  /**
   * Get milestone escrow state
   *
   * @param escrowId - The milestone escrow PDA address
   * @returns Milestone escrow state or null if not found
   */
  async getMilestoneEscrow(escrowId: string): Promise<MilestoneEscrowState | null> {
    const program = this.getProgram();
    const escrowPubkey = new PublicKey(escrowId);

    try {
      const data = await program.account.milestoneEscrowAccount.fetch(escrowPubkey);
      return this.mapOnChainToMilestoneEscrowState(escrowPubkey, data);
    } catch {
      return null;
    }
  }

  /**
   * List milestone escrows created by the current signer
   */
  async listMyMilestoneEscrows(): Promise<MilestoneEscrowState[]> {
    const program = this.getProgram();

    const accounts = await program.account.milestoneEscrowAccount.all([
      {
        memcmp: {
          offset: 8, // After discriminator: creator is first field
          bytes: this.signer.publicKey.toBase58(),
        },
      },
    ]);

    return accounts.map((a) => this.mapOnChainToMilestoneEscrowState(a.publicKey, a.account));
  }

  // ── Private helpers ─────────────────────────────────────────────

  private getMilestoneStatusFromAnchor(status: any): MilestoneStatus {
    if (status.pending !== undefined) return MilestoneStatus.Pending;
    if (status.released !== undefined) return MilestoneStatus.Released;
    if (status.disputed !== undefined) return MilestoneStatus.Disputed;
    return MilestoneStatus.Pending;
  }

  private mapOnChainToMilestoneEscrowState(pubkey: PublicKey, data: any): MilestoneEscrowState {
    const milestoneCount = data.milestoneCount as number;
    const rawMilestones = data.milestones as any[];

    const milestones: MilestoneState[] = rawMilestones
      .slice(0, milestoneCount)
      .map((m: any) => ({
        amount: BigInt(m.amount.toString()),
        status: this.getMilestoneStatusFromAnchor(m.status),
        descriptionHash: Buffer.from(m.descriptionHash as number[]).toString('hex'),
      }));

    return {
      id: pubkey.toBase58(),
      creator: data.creator as PublicKey,
      recipient: data.recipient as PublicKey,
      totalAmount: BigInt(data.totalAmount.toString()),
      releasedAmount: BigInt(data.releasedAmount.toString()),
      status: this.getStatusFromAnchor(data.status),
      deadline: (data.deadline as BN).toNumber() * 1000,
      termsHash: Buffer.from(data.termsHash as number[]).toString('hex'),
      arbiter: data.arbiter as PublicKey,
      feeBasisPoints: data.feeBasisPoints as number,
      feeRecipient: data.feeRecipient as PublicKey,
      createdAt: (data.createdAt as BN).toNumber() * 1000,
      milestoneCount,
      milestones,
    };
  }

  private mapOnChainToReputation(data: any): AgentReputation {
    const escrowsCreated = data.escrowsCreated as number;
    const escrowsCompleted = data.escrowsCompleted as number;
    const tasksCompleted = data.tasksCompleted as number;
    const escrowsReceived = data.escrowsReceived as number;
    const disputesWon = data.disputesWon as number;
    const disputesLost = data.disputesLost as number;

    // Calculate derived metrics
    const totalEscrows = escrowsCreated + escrowsReceived;
    const completionRate = totalEscrows > 0
      ? (escrowsCompleted + tasksCompleted) / totalEscrows
      : 0;

    const totalDisputes = disputesWon + disputesLost;
    const trustScore = totalDisputes > 0
      ? disputesWon / totalDisputes
      : 1.0; // Default to 1.0 if no disputes

    return {
      agent: (data.agent as PublicKey).toBase58(),
      escrowsCreated,
      escrowsCompleted,
      escrowsReceived,
      tasksCompleted,
      disputesInitiated: data.disputesInitiated as number,
      disputesWon,
      disputesLost,
      totalVolumeLamports: BigInt(data.totalVolumeLamports.toString()),
      lastActivity: (data.lastActivity as BN).toNumber() * 1000,
      completionRate,
      trustScore,
    };
  }

  private getStatusFromAnchor(status: any): EscrowStatus {
    if (status.created !== undefined) return EscrowStatus.Created;
    if (status.active !== undefined) return EscrowStatus.Active;
    if (status.completed !== undefined) return EscrowStatus.Completed;
    if (status.disputed !== undefined) return EscrowStatus.Disputed;
    if (status.refunded !== undefined) return EscrowStatus.Refunded;
    if (status.cancelled !== undefined) return EscrowStatus.Cancelled;
    if (status.resolved !== undefined) return EscrowStatus.Completed;
    return EscrowStatus.Created;
  }

  private mapOnChainToEscrowState(pubkey: PublicKey, data: any): EscrowState {
    return {
      id: pubkey.toBase58(),
      creator: data.creator as PublicKey,
      recipient: data.recipient as PublicKey,
      amount: BigInt(data.amount.toString()),
      status: this.getStatusFromAnchor(data.status),
      deadline: (data.deadline as BN).toNumber() * 1000,
      termsHash: Buffer.from(data.termsHash as number[]).toString('hex'),
      arbiter: data.arbiter as PublicKey,
      createdAt: (data.createdAt as BN).toNumber() * 1000,
      autoReleaseAt: (data.autoReleaseAt as BN).toNumber() === 0
        ? undefined
        : (data.autoReleaseAt as BN).toNumber() * 1000,
    };
  }
}
