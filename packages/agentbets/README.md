# @aion-sdk/agentbets

Prediction market integration for AION SDK agents.

## Installation

```bash
pnpm add @aion-sdk/agentbets
```

## Usage

```typescript
import { createAgentBetsClient, isOpenForBetting, getOdds } from '@aion-sdk/agentbets';

const client = createAgentBetsClient();

// Get all markets
const markets = await client.getMarkets();

for (const market of markets) {
  if (isOpenForBetting(market)) {
    console.log(`${market.question}`);
    console.log(`  Yes: ${getOdds(market, 0) * 100}%`);
    console.log(`  No: ${getOdds(market, 1) * 100}%`);
  }
}

// Find +EV opportunities
const opportunities = await client.getOpportunities();

for (const opp of opportunities) {
  console.log(`${opp.question}: ${opp.edge}% edge on ${opp.outcome}`);
}
```

## API

### `createAgentBetsClient()`

Returns a client with methods:

- `getMarkets()` - List all prediction markets
- `getMarket(id)` - Get a specific market
- `getOpportunities()` - Find mispriced markets (+EV bets)

### Utilities

- `getOdds(market, outcomeIndex)` - Get odds as probability (0-1)
- `isOpenForBetting(market)` - Check if market accepts bets

## Links

- [AgentBets API](https://agentbets-api-production.up.railway.app)
- [GitHub](https://github.com/nox-oss/agentbets)
- [Hackathon Project](https://colosseum.com/agent-hackathon/projects/agentbets)
