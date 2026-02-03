/**
 * @aion-sdk/solana - Wallet Module
 *
 * Solana wallet utilities for AI agents
 *
 * IMPORTANT: AION does NOT store your mnemonic or private keys!
 * You are responsible for saving your recovery phrase.
 * Lost mnemonic = Lost funds. No recovery possible.
 */

import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';
import type { Wallet, Signer } from '@aion-sdk/core';

/**
 * Result of wallet generation
 */
export interface GeneratedWallet {
  /** Solana public key (base58) */
  publicKey: string;
  /** 64-byte secret key */
  secretKey: Uint8Array;
  /** 24-word BIP39 mnemonic - SAVE THIS! */
  mnemonic: string;
}

/**
 * Result of wallet import
 */
export interface ImportedWallet {
  /** Solana public key (base58) */
  publicKey: string;
  /** 64-byte secret key */
  secretKey: Uint8Array;
}

/**
 * Solana derivation path (BIP44)
 */
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

/**
 * Generate a new Solana wallet with a BIP39 mnemonic (24 words)
 *
 * CRITICAL: AION does NOT store your mnemonic or private key!
 * You MUST save the mnemonic yourself. It's your ONLY way to recover.
 *
 * @returns Wallet object with publicKey, secretKey, and mnemonic
 *
 * @example
 * ```typescript
 * const wallet = generateWallet();
 * console.log(`Address: ${wallet.publicKey}`);
 * console.log(`Mnemonic: ${wallet.mnemonic}`);
 * // SAVE THIS IMMEDIATELY! AION CANNOT RECOVER IT!
 * ```
 */
export function generateWallet(): GeneratedWallet {
  // Generate 24-word mnemonic (256-bit entropy for maximum security)
  const mnemonic = bip39.generateMnemonic(256);

  // Derive seed from mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Use Solana's derivation path
  const derived = derivePath(SOLANA_DERIVATION_PATH, seed.toString('hex'));

  // Create keypair from derived seed
  const keypair = Keypair.fromSeed(derived.key);

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
    mnemonic,
  };
}

/**
 * Import a wallet from an existing BIP39 mnemonic phrase
 *
 * @param mnemonic - 24 word mnemonic phrase (12 words also supported)
 * @returns ImportedWallet object with publicKey and secretKey
 * @throws Error if mnemonic is invalid
 *
 * @example
 * ```typescript
 * const wallet = importFromMnemonic("your twenty four word mnemonic phrase here");
 * console.log(`Address: ${wallet.publicKey}`);
 * ```
 */
export function importFromMnemonic(mnemonic: string): ImportedWallet {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Derive seed from mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Use Solana's derivation path
  const derived = derivePath(SOLANA_DERIVATION_PATH, seed.toString('hex'));

  // Create keypair from derived seed
  const keypair = Keypair.fromSeed(derived.key);

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

/**
 * Import a wallet from a raw secret key (Uint8Array or base58 string)
 *
 * @param secretKey - 64-byte secret key as Uint8Array or base58 string
 * @returns ImportedWallet object
 */
export function importFromSecretKey(secretKey: Uint8Array | string): ImportedWallet {
  let keypair: Keypair;

  if (typeof secretKey === 'string') {
    // Assume base58 encoded
    keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
  } else {
    keypair = Keypair.fromSecretKey(secretKey);
  }

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

/**
 * Validate a Solana address format
 *
 * @param address - Solana address string to validate
 * @returns true if valid base58 Solana address format
 *
 * @example
 * ```typescript
 * if (validateAddress(userInput)) {
 *   // Safe to use as wallet address
 * }
 * ```
 */
export function validateAddress(address: string): boolean {
  try {
    // Check length (32-44 chars for base58)
    if (address.length < 32 || address.length > 44) {
      return false;
    }

    // Check base58 characters only
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (!base58Regex.test(address)) {
      return false;
    }

    // Try to decode
    const decoded = bs58.decode(address);

    // Solana addresses are 32 bytes
    return decoded.length === 32;
  } catch {
    return false;
  }
}

/**
 * Get the public key from a secret key without exposing the full wallet
 *
 * @param secretKey - 64-byte secret key
 * @returns Public key as base58 string
 */
export function getPublicKey(secretKey: Uint8Array): string {
  const keypair = Keypair.fromSecretKey(secretKey);
  return keypair.publicKey.toBase58();
}

/**
 * SolanaWallet class implementing Signer interface
 * Use this for signing transactions
 */
export class SolanaWallet implements Wallet {
  private keypair: Keypair;
  private _mnemonic?: string;

  private constructor(keypair: Keypair, mnemonic?: string) {
    this.keypair = keypair;
    this._mnemonic = mnemonic;
  }

  /**
   * Create a new wallet (generates new keypair)
   */
  static generate(): SolanaWallet {
    const { secretKey, mnemonic } = generateWallet();
    const keypair = Keypair.fromSecretKey(secretKey);
    return new SolanaWallet(keypair, mnemonic);
  }

  /**
   * Import wallet from mnemonic
   */
  static fromMnemonic(mnemonic: string): SolanaWallet {
    const { secretKey } = importFromMnemonic(mnemonic);
    const keypair = Keypair.fromSecretKey(secretKey);
    return new SolanaWallet(keypair, mnemonic);
  }

  /**
   * Import wallet from secret key
   */
  static fromSecretKey(secretKey: Uint8Array | string): SolanaWallet {
    const { secretKey: sk } = importFromSecretKey(secretKey);
    const keypair = Keypair.fromSecretKey(sk);
    return new SolanaWallet(keypair);
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  get mnemonic(): string | undefined {
    return this._mnemonic;
  }

  exportSecretKey(): Uint8Array {
    return this.keypair.secretKey;
  }

  isReady(): boolean {
    return true;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.sign(this.keypair);
    } else {
      tx.sign([this.keypair]);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map(tx => this.signTransaction(tx)));
  }

  /**
   * Get the underlying Keypair for advanced usage
   */
  getKeypair(): Keypair {
    return this.keypair;
  }
}

// Re-export Keypair for convenience
export { Keypair, PublicKey } from '@solana/web3.js';
