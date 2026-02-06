# @aion-sdk/mcp-server

MCP (Model Context Protocol) server for AION — gives AI agents direct access to Solana wallets, escrow, milestone payments, and dispute resolution.

## Install

```bash
npm i -g @aion-sdk/mcp-server
```

## Setup

### Environment Variables

```bash
SOLANA_PRIVATE_KEY=<base58 secret key>  # Required
SOLANA_NETWORK=devnet                    # Optional (default: devnet)
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aion": {
      "command": "npx",
      "args": ["-y", "@aion-sdk/mcp-server"],
      "env": {
        "SOLANA_PRIVATE_KEY": "your_key_here",
        "SOLANA_NETWORK": "devnet"
      }
    }
  }
}
```

### Direct Usage

```bash
SOLANA_PRIVATE_KEY=... aion-mcp-server
```

## Tools (27)

### Wallet (3)

| Tool | Description |
|---|---|
| `generate_wallet` | Generate new Solana wallet (24-word mnemonic) |
| `import_wallet` | Import wallet from mnemonic |
| `get_balance` | Get SOL / SPL token balance |

### SOL Escrow (6)

| Tool | Description |
|---|---|
| `create_escrow` | Create SOL escrow with terms and deadline |
| `accept_escrow` | Accept task as executor |
| `release_payment` | Release payment to recipient |
| `refund_escrow` | Refund after deadline |
| `get_escrow` | Fetch escrow details |
| `list_escrows` | List your escrows |

### Token Escrow (5)

| Tool | Description |
|---|---|
| `create_token_escrow` | Create SPL token escrow |
| `accept_token_escrow` | Accept token escrow task |
| `release_token_payment` | Release token payment |
| `refund_token_escrow` | Refund token escrow |
| `get_token_escrow` | Fetch token escrow details |

### Milestone Escrow (6)

| Tool | Description |
|---|---|
| `create_milestone_escrow` | Create escrow with up to 10 milestones |
| `accept_milestone_task` | Accept milestone task |
| `release_milestone` | Release individual milestone payment |
| `dispute_milestone` | Dispute a specific milestone |
| `resolve_milestone_dispute` | Arbiter resolves milestone dispute |
| `get_milestone_escrow` | Fetch milestone escrow with status |

### Dispute Resolution (3)

| Tool | Description |
|---|---|
| `dispute_escrow` | Raise a dispute on SOL escrow |
| `resolve_dispute` | Arbiter resolves SOL escrow dispute |
| `resolve_token_dispute` | Arbiter resolves token escrow dispute |

### Reputation (2)

| Tool | Description |
|---|---|
| `get_reputation` | Get agent's on-chain reputation |
| `init_reputation` | Initialize reputation account |

### Utility (2)

| Tool | Description |
|---|---|
| `validate_address` | Validate a Solana address |
| `get_network_status` | Check network and wallet status |

## License

MIT
