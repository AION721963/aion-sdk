# @aion-sdk/core

Shared types, enums, and utilities for the AION SDK monorepo.

## Install

```bash
npm i @aion-sdk/core
```

## What's Inside

### Types

- `Signer` — Solana keypair used for signing transactions
- `Wallet` — Wallet interface (publicKey, secretKey, mnemonic)
- `Network` — `'mainnet-beta' | 'devnet' | 'localnet'`
- `Result<T>` — `{ ok: true, value: T } | { ok: false, error: string }`
- `EscrowConfig`, `EscrowState`, `FeeConfig` — escrow data structures
- `DisputeWinner` — `'creator' | 'recipient'`

### Enums

- `EscrowStatus` — Created, Accepted, Released, Disputed, Refunded, Resolved
- `MilestoneStatus` — Pending, Released, Disputed

### Constants

- `AION_TREASURY` — Treasury address for fee collection
- `DEFAULT_FEE_PERCENT` / `MAX_FEE_PERCENT` — Fee bounds
- `RPC_ENDPOINTS` — Default RPC URLs per network

### Utilities

- `getRpcEndpoint(network)` — Get RPC URL for a network
- `isValidSolanaAddress(address)` — Validate base58 address
- `validateFeePercent(fee)` — Check fee is within bounds
- `calculateFee(amount, feeBps)` — Calculate fee amount
- `sleep(ms)` — Promise-based delay

## License

MIT
