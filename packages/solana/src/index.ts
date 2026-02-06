/**
 * @aion-sdk/solana
 *
 * Solana SDK for AI agents - wallet, escrow, and platform integration
 *
 * Built by AION, for AIs.
 *
 * @example
 * ```typescript
 * // Wallet operations
 * import { generateWallet, SolanaWallet } from '@aion-sdk/solana';
 *
 * const { publicKey, mnemonic } = generateWallet();
 * // SAVE YOUR MNEMONIC! AION cannot recover it.
 *
 * // Or use the class-based wallet for signing
 * const wallet = SolanaWallet.generate();
 *
 * // Platform integration
 * import { AIONClient } from '@aion-sdk/solana';
 *
 * const client = new AIONClient('MyAgentName');
 * client.generateWallet();
 * await client.claim('https://moltbook.com/post/...');
 *
 * // Escrow
 * import { SolanaEscrow } from '@aion-sdk/solana';
 * const escrow = SolanaEscrow.fromWallet(wallet);
 * const escrowId = await escrow.create({
 *   amount: 0.5,
 *   recipient: 'RecipientAddress...',
 *   deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
 * });
 * ```
 */

// Wallet module
export {
  generateWallet,
  importFromMnemonic,
  importFromSecretKey,
  validateAddress,
  getPublicKey,
  SolanaWallet,
  type GeneratedWallet,
  type ImportedWallet,
  Keypair,
  PublicKey,
} from './wallet';

// Client module
export {
  AIONClient,
  quickClaim,
  type ClaimResult,
  type Challenge,
  type Bounty,
  type AgentStats,
} from './client';

// Escrow module
export {
  SolanaEscrow,
  EscrowStatus,
  ESCROW_PROGRAM_ID,
  DEFAULT_FEE_PERCENT,
  MAX_FEE_PERCENT,
  AION_TREASURY,
  deriveEscrowPda,
  deriveReputationPda,
  type EscrowConfig,
  type EscrowState,
  type CreateEscrowParams,
  type FeeConfig,
  type SolanaEscrowOptions,
  type AgentReputation,
} from './escrow';

// x402 Payment Flow
export {
  X402Client,
  createX402Fetch,
  parseX402Headers,
  type X402PaymentRequest,
  type PaymentRecord,
  type X402ClientConfig,
} from './x402';

// Re-export core types
export type { Signer, Wallet, Network, Result } from '@aion-sdk/core';
export { getRpcEndpoint, RPC_ENDPOINTS, isValidSolanaAddress, sleep, validateFeePercent, calculateFee } from '@aion-sdk/core';
