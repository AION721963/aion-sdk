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
 * // Escrow (coming soon!)
 * import { SolanaEscrow } from '@aion-sdk/solana';
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

// Escrow module (in development)
export {
  SolanaEscrow,
  EscrowStatus,
  type EscrowConfig,
  type EscrowState,
  type CreateEscrowParams,
} from './escrow';

// Re-export core types
export type { Signer, Wallet, Network, Result } from '@aion-sdk/core';
export { getRpcEndpoint, isValidSolanaAddress, sleep } from '@aion-sdk/core';
