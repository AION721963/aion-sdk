/**
 * @aion-sdk/solana - Error Handling
 *
 * Typed errors for escrow program failures with Anchor error code mapping.
 */

/** Base SDK error with optional Anchor error code */
export class AionSdkError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AionSdkError';
  }
}

/** Escrow account not found on chain */
export class EscrowNotFoundError extends AionSdkError {
  constructor(escrowId: string) {
    super(`Escrow not found: ${escrowId}`);
    this.name = 'EscrowNotFoundError';
  }
}

/** Caller lacks permission for this operation */
export class UnauthorizedError extends AionSdkError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = 'UnauthorizedError';
  }
}

/** Invalid input parameters */
export class InvalidInputError extends AionSdkError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = 'InvalidInputError';
  }
}

/** Escrow is not in the expected status */
export class InvalidStatusError extends AionSdkError {
  constructor(code?: number) {
    super('Escrow is not in the expected status for this operation', code);
    this.name = 'InvalidStatusError';
  }
}

/** Deadline constraint violated */
export class DeadlineError extends AionSdkError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = 'DeadlineError';
  }
}

/** Milestone-specific errors */
export class MilestoneError extends AionSdkError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = 'MilestoneError';
  }
}

/**
 * Map Anchor program error codes (6000-6017) to typed SDK errors.
 *
 * Usage:
 * ```ts
 * try {
 *   await escrow.release(id);
 * } catch (err) {
 *   throw mapProgramError(err);
 * }
 * ```
 */
export function mapProgramError(err: unknown): AionSdkError {
  const code = extractErrorCode(err);
  if (code === null) {
    return new AionSdkError(
      err instanceof Error ? err.message : String(err),
      undefined,
      err,
    );
  }

  switch (code) {
    case 6000:
      return new InvalidStatusError(code);
    case 6001:
      return new UnauthorizedError('Only the creator can perform this action', code);
    case 6002:
      return new UnauthorizedError('Only the recipient can perform this action', code);
    case 6003:
      return new UnauthorizedError('Only the arbiter can resolve disputes', code);
    case 6004:
      return new DeadlineError('Deadline has not passed yet', code);
    case 6005:
      return new DeadlineError('Deadline has already passed', code);
    case 6006:
      return new InvalidInputError('Fee basis points exceeds maximum (1000 = 10%)', code);
    case 6007:
      return new InvalidInputError('Amount must be greater than zero', code);
    case 6008:
      return new AionSdkError('Arithmetic overflow', code);
    case 6009:
      return new UnauthorizedError('Only creator or recipient can dispute', code);
    case 6010:
      return new InvalidInputError('Auto-release timestamp must be after deadline', code);
    case 6011:
      return new InvalidInputError('Auto-release is not enabled for this escrow', code);
    case 6012:
      return new DeadlineError('Auto-release timestamp has not been reached yet', code);
    case 6013:
      return new MilestoneError('Too many milestones (max 10)', code);
    case 6014:
      return new MilestoneError('Milestone amounts must sum to total amount', code);
    case 6015:
      return new MilestoneError('Invalid milestone index', code);
    case 6016:
      return new MilestoneError('Milestone already released', code);
    case 6017:
      return new MilestoneError('Milestone is not in pending status', code);
    default:
      return new AionSdkError(`Program error ${code}`, code, err);
  }
}

/** Extract Anchor error code from various error shapes */
function extractErrorCode(err: unknown): number | null {
  if (err == null || typeof err !== 'object') return null;

  const e = err as Record<string, unknown>;

  // AnchorError shape: err.error.errorCode.number
  if (e.error && typeof e.error === 'object') {
    const inner = e.error as Record<string, unknown>;
    if (inner.errorCode && typeof inner.errorCode === 'object') {
      const ec = inner.errorCode as Record<string, unknown>;
      if (typeof ec.number === 'number') return ec.number;
    }
  }

  // Flat shape: err.code
  if (typeof e.code === 'number' && e.code >= 6000) return e.code;

  // Message parsing: "custom program error: 0x1770"
  const msg = e.message ?? (e.msg as string | undefined);
  if (typeof msg === 'string') {
    const hex = msg.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (hex) return parseInt(hex[1], 16);

    const dec = msg.match(/Error Code: (\d+)/);
    if (dec) return parseInt(dec[1], 10);
  }

  return null;
}
