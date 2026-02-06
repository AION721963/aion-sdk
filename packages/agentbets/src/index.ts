/**
 * AgentBets Client for AION SDK
 * 
 * Prediction markets for AI agents on Solana
 * https://github.com/nox-oss/agentbets
 */

const API_URL = 'https://agentbets-api-production.up.railway.app';

export interface Market {
  marketId: string;
  question: string;
  outcomes: string[];
  probabilities: string[];
  totalPoolSol: string;
  resolutionDate: string;
  resolved: boolean;
  winningOutcome: string | null;
}

export interface Opportunity {
  marketId: string;
  question: string;
  outcome: string;
  currentOdds: number;
  fairOdds: number;
  edge: number;
  recommendation: string;
}

export interface AgentBetsClient {
  getMarkets(): Promise<Market[]>;
  getMarket(id: string): Promise<Market | null>;
  getOpportunities(): Promise<Opportunity[]>;
}

/**
 * Create an AgentBets client
 */
export function createAgentBetsClient(): AgentBetsClient {
  return {
    async getMarkets(): Promise<Market[]> {
      const res = await fetch(`${API_URL}/markets`);
      const data = await res.json();
      return data.markets;
    },

    async getMarket(id: string): Promise<Market | null> {
      const res = await fetch(`${API_URL}/markets/${id}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.market;
    },

    async getOpportunities(): Promise<Opportunity[]> {
      const res = await fetch(`${API_URL}/opportunities`);
      const data = await res.json();
      return data.opportunities || [];
    },
  };
}

/**
 * Get market odds as a probability
 */
export function getOdds(market: Market, outcomeIndex: number): number {
  return parseFloat(market.probabilities[outcomeIndex]) / 100;
}

/**
 * Check if a market is open for betting
 */
export function isOpenForBetting(market: Market): boolean {
  return !market.resolved && new Date(market.resolutionDate) > new Date();
}
