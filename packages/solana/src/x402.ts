/**
 * @aion-sdk/solana - x402 Payment Flow
 *
 * Implements the HTTP 402 Payment Required auto-pay pattern for AI agents.
 *
 * Flow:
 * 1. Agent sends HTTP request to service
 * 2. Service responds with 402 + payment headers
 * 3. X402Client auto-creates escrow payment
 * 4. Retries original request with X-Payment-Proof header
 *
 * Usage:
 * ```typescript
 * const client = new X402Client({
 *   escrow: solanaEscrow,
 *   maxAutoPaySol: 0.01,
 * });
 *
 * // Automatically handles 402 responses
 * const response = await client.fetch('https://api.example.com/data');
 * ```
 */

import { SolanaEscrow } from './escrow';

/**
 * Parsed 402 payment response headers
 */
export interface X402PaymentRequest {
  /** Amount in SOL */
  amount: number;
  /** Recipient wallet address */
  recipient: string;
  /** Payment description */
  description?: string;
  /** Deadline in seconds from now */
  deadlineSeconds?: number;
}

/**
 * Record of a completed payment
 */
export interface PaymentRecord {
  url: string;
  amount: number;
  recipient: string;
  escrowId: string;
  timestamp: number;
}

/**
 * X402Client configuration
 */
export interface X402ClientConfig {
  /** Escrow client for making payments */
  escrow: SolanaEscrow;
  /** Maximum auto-pay amount in SOL per request (default: 0.01) */
  maxAutoPaySol?: number;
  /** Default deadline in ms for auto-created escrows (default: 1 hour) */
  defaultDeadlineMs?: number;
}

/**
 * Parse 402 payment headers from a Response
 */
export function parseX402Headers(headers: Headers): X402PaymentRequest | null {
  const amount = headers.get('X-Payment-Amount');
  const recipient = headers.get('X-Payment-Recipient');

  if (!amount || !recipient) return null;

  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return null;

  return {
    amount: parsed,
    recipient,
    description: headers.get('X-Payment-Description') || undefined,
    deadlineSeconds: headers.get('X-Payment-Deadline')
      ? parseInt(headers.get('X-Payment-Deadline')!, 10)
      : undefined,
  };
}

/**
 * HTTP client that automatically handles 402 Payment Required responses
 * by creating escrow payments on Solana.
 */
export class X402Client {
  private escrow: SolanaEscrow;
  private maxAutoPaySol: number;
  private defaultDeadlineMs: number;
  private paymentHistory: PaymentRecord[] = [];

  constructor(config: X402ClientConfig) {
    this.escrow = config.escrow;
    this.maxAutoPaySol = config.maxAutoPaySol ?? 0.01;
    this.defaultDeadlineMs = config.defaultDeadlineMs ?? 60 * 60 * 1000; // 1 hour
  }

  /**
   * Fetch with automatic 402 payment handling
   *
   * If the server responds with 402 and valid payment headers,
   * this method will:
   * 1. Create an escrow payment
   * 2. Retry the request with X-Payment-Proof header
   *
   * @param url - URL to fetch
   * @param init - Standard fetch init options
   * @returns Response from the server (either original or after payment)
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const response = await globalThis.fetch(url, init);

    if (response.status !== 402) {
      return response;
    }

    const paymentRequest = parseX402Headers(response.headers);
    if (!paymentRequest) {
      return response; // 402 but no valid payment headers
    }

    // Check against max auto-pay limit
    if (paymentRequest.amount > this.maxAutoPaySol) {
      throw new Error(
        `Payment of ${paymentRequest.amount} SOL exceeds max auto-pay limit of ${this.maxAutoPaySol} SOL`,
      );
    }

    // Create escrow payment
    const deadlineMs = paymentRequest.deadlineSeconds
      ? paymentRequest.deadlineSeconds * 1000
      : this.defaultDeadlineMs;

    const escrowId = await this.escrow.create({
      amount: paymentRequest.amount,
      recipient: paymentRequest.recipient,
      deadline: Date.now() + deadlineMs,
      terms: paymentRequest.description || `x402 payment for ${url}`,
      autoReleaseAt: Date.now() + deadlineMs + 60000, // auto-release 1min after deadline
    });

    // Record payment
    this.paymentHistory.push({
      url,
      amount: paymentRequest.amount,
      recipient: paymentRequest.recipient,
      escrowId,
      timestamp: Date.now(),
    });

    // Retry with payment proof
    const retryHeaders = new Headers(init?.headers || {});
    retryHeaders.set('X-Payment-Proof', escrowId);
    retryHeaders.set('X-Payment-Network', 'solana');

    return globalThis.fetch(url, {
      ...init,
      headers: retryHeaders,
    });
  }

  /**
   * Get payment history
   */
  getPaymentHistory(): PaymentRecord[] {
    return [...this.paymentHistory];
  }

  /**
   * Get total spent in SOL
   */
  getTotalSpent(): number {
    return this.paymentHistory.reduce((sum, p) => sum + p.amount, 0);
  }
}

/**
 * Create a fetch function that auto-handles 402 payments
 *
 * @example
 * ```typescript
 * const secureFetch = createX402Fetch({
 *   escrow: myEscrow,
 *   maxAutoPaySol: 0.05,
 * });
 *
 * const response = await secureFetch('https://paid-api.example.com/data');
 * ```
 */
export function createX402Fetch(config: X402ClientConfig): typeof globalThis.fetch {
  const client = new X402Client(config);
  return (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return client.fetch(url, init);
  };
}
