/**
 * @aion-sdk/core
 *
 * Core types and utilities for AION SDK
 * Shared across all blockchain implementations
 */

import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Generic signer interface that can be implemented by any wallet
 */
export interface Signer {
  /** The public key of the signer */
  publicKey: PublicKey;

  /** Sign a transaction */
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;

  /** Sign multiple transactions */
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

/**
 * Wallet interface with key management capabilities
 */
export interface Wallet extends Signer {
  /** Export the secret key (use with caution) */
  exportSecretKey(): Uint8Array;

  /** Check if wallet is ready for signing */
  isReady(): boolean;
}

/**
 * Escrow status enum
 */
export enum EscrowStatus {
  /** Escrow created, waiting for acceptor */
  Created = 'created',
  /** Task accepted by executor */
  Active = 'active',
  /** Task completed, payment released */
  Completed = 'completed',
  /** Dispute raised */
  Disputed = 'disputed',
  /** Payment refunded to creator */
  Refunded = 'refunded',
  /** Escrow cancelled before acceptance */
  Cancelled = 'cancelled',
}

/**
 * Escrow configuration
 */
export interface EscrowConfig {
  /** Amount in lamports (or token smallest unit) */
  amount: bigint;
  /** Recipient (executor) public key */
  recipient: PublicKey;
  /** Deadline timestamp (Unix ms) */
  deadline: number;
  /** Optional terms hash (IPFS or SHA256 of agreement) */
  termsHash?: string;
  /** Optional arbiter for disputes */
  arbiter?: PublicKey;
}

/**
 * Escrow state from on-chain
 */
export interface EscrowState {
  id: string;
  creator: PublicKey;
  recipient: PublicKey;
  amount: bigint;
  status: EscrowStatus;
  deadline: number;
  termsHash?: string;
  arbiter?: PublicKey;
  createdAt: number;
  completedAt?: number;
  autoReleaseAt?: number;
}

/**
 * Fee configuration for escrow transactions
 */
export interface FeeConfig {
  /** Fee percentage (0-100). Default: 1.5% */
  feePercent: number;
  /** Fee recipient wallet address */
  feeRecipient: string;
}

/** Default fee: 0.1% */
export const DEFAULT_FEE_PERCENT = 0.1;

/** Maximum allowed fee: 10% */
export const MAX_FEE_PERCENT = 10;

/** AION treasury address for fees */
export const AION_TREASURY = 'GjJ4vt7YDjBEmawgxmAEeyD4WuTLXeMZCr5raYGg5ijo';

/**
 * Validate fee percentage
 * @throws Error if fee is out of valid range
 */
export function validateFeePercent(feePercent: number): void {
  if (feePercent < 0 || feePercent > MAX_FEE_PERCENT) {
    throw new Error(`Fee must be between 0% and ${MAX_FEE_PERCENT}%`);
  }
}

/**
 * Calculate fee amount from total
 * @param amount - Total amount in lamports
 * @param feePercent - Fee percentage (0-100)
 * @returns Fee amount in lamports
 */
export function calculateFee(amount: bigint, feePercent: number): bigint {
  validateFeePercent(feePercent);
  return (amount * BigInt(Math.round(feePercent * 100))) / BigInt(10000);
}

/**
 * Result type for SDK operations
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Network configuration
 */
export type Network = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';

/**
 * RPC endpoints by network
 */
export const RPC_ENDPOINTS: Record<Network, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  'devnet': 'https://api.devnet.solana.com',
  'testnet': 'https://api.testnet.solana.com',
  'localnet': 'http://localhost:8899',
};

/**
 * Get RPC endpoint for a network
 */
export function getRpcEndpoint(network: Network): string {
  return RPC_ENDPOINTS[network];
}

/**
 * Validate Solana address format
 */
export function isValidSolanaAddress(address: string): boolean {
  // Base58 characters only, 32-44 chars
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Sleep utility for rate limiting
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
