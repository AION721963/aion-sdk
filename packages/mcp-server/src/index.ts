import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SolanaWallet,
  SolanaEscrow,
  generateWallet,
  importFromMnemonic,
  validateAddress,
  getRpcEndpoint,
  type Network,
} from "@aion-sdk/solana";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// ── Config from environment ──────────────────────────────────────────

const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const NETWORK = (process.env.SOLANA_NETWORK || "devnet") as Network;
const RPC_URL = process.env.SOLANA_RPC_URL || getRpcEndpoint(NETWORK);

const connection = new Connection(RPC_URL, "confirmed");

let wallet: SolanaWallet | null = null;
let escrow: SolanaEscrow | null = null;

if (PRIVATE_KEY) {
  try {
    wallet = SolanaWallet.fromSecretKey(PRIVATE_KEY);
    escrow = SolanaEscrow.fromWallet(wallet, RPC_URL);
  } catch (e) {
    console.error("Failed to initialize wallet from SOLANA_PRIVATE_KEY:", e);
  }
}

function requireWallet(): SolanaWallet {
  if (!wallet) {
    throw new Error(
      "SOLANA_PRIVATE_KEY not set. This tool requires a wallet. " +
        'Set SOLANA_PRIVATE_KEY environment variable with a base58 secret key.',
    );
  }
  return wallet;
}

function requireEscrow(): SolanaEscrow {
  if (!escrow) {
    throw new Error(
      "SOLANA_PRIVATE_KEY not set. This tool requires an escrow client. " +
        'Set SOLANA_PRIVATE_KEY environment variable with a base58 secret key.',
    );
  }
  return escrow;
}

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

// ── MCP Server ───────────────────────────────────────────────────────

const server = new McpServer({
  name: "aion",
  version: "0.1.0",
});

// ── Wallet Tools ─────────────────────────────────────────────────────

server.tool(
  "generate_wallet",
  "Generate a new Solana wallet with BIP39 mnemonic. SAVE THE MNEMONIC — it cannot be recovered!",
  {},
  async () => {
    const result = generateWallet();
    return json({
      publicKey: result.publicKey,
      mnemonic: result.mnemonic,
      warning: "SAVE YOUR MNEMONIC! It cannot be recovered.",
    });
  },
);

server.tool(
  "import_wallet",
  "Import a Solana wallet from a BIP39 mnemonic phrase (12 or 24 words)",
  { mnemonic: z.string().describe("BIP39 mnemonic phrase (12 or 24 words)") },
  async ({ mnemonic }) => {
    try {
      const result = importFromMnemonic(mnemonic);
      return json({ publicKey: result.publicKey });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "get_balance",
  "Get SOL balance and all SPL token balances for a Solana address",
  {
    address: z.string().describe("Solana wallet address (base58)"),
  },
  async ({ address }) => {
    try {
      const pubkey = new PublicKey(address);

      // SOL balance
      const solBalance = await connection.getBalance(pubkey);

      // SPL token balances
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        pubkey,
        { programId: TOKEN_PROGRAM_ID },
      );

      const tokens = tokenAccounts.value
        .map((account) => {
          const parsed = account.account.data.parsed?.info;
          if (!parsed) return null;
          const amount = parsed.tokenAmount;
          if (amount.uiAmount === 0) return null;
          return {
            mint: parsed.mint,
            amount: amount.uiAmountString,
            decimals: amount.decimals,
          };
        })
        .filter(Boolean);

      return json({
        address,
        network: NETWORK,
        sol: {
          lamports: solBalance,
          sol: solBalance / LAMPORTS_PER_SOL,
        },
        tokens,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

// ── Escrow Tools ─────────────────────────────────────────────────────

server.tool(
  "create_escrow",
  "Create a new SOL escrow. Locks funds on-chain until task completion. Returns escrow ID.",
  {
    amount: z.number().positive().describe("Amount in SOL to lock in escrow"),
    recipient: z.string().describe("Recipient (executor) wallet address"),
    deadline_hours: z
      .number()
      .positive()
      .default(24)
      .describe("Deadline in hours from now (default: 24)"),
    terms: z
      .string()
      .optional()
      .describe("Task description or terms"),
    arbiter: z
      .string()
      .optional()
      .describe("Optional arbiter address for disputes"),
  },
  async ({ amount, recipient, deadline_hours, terms, arbiter }) => {
    try {
      const e = requireEscrow();
      const deadlineMs = Date.now() + deadline_hours * 60 * 60 * 1000;

      const escrowId = await e.create({
        amount,
        recipient,
        deadline: deadlineMs,
        terms,
        arbiter,
      });

      return json({
        escrowId,
        amount,
        recipient,
        deadline: new Date(deadlineMs).toISOString(),
        terms: terms || null,
        network: NETWORK,
        status: "created",
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "accept_escrow",
  "Accept an escrow task as the executor. Status changes from Created to Active.",
  {
    escrow_id: z.string().describe("Escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const e = requireEscrow();
      const signature = await e.accept(escrow_id);

      return json({
        escrowId: escrow_id,
        signature,
        status: "active",
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "release_payment",
  "Release escrow payment to the executor. Only the creator can call this.",
  {
    escrow_id: z.string().describe("Escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const e = requireEscrow();
      const signature = await e.release(escrow_id);

      return json({
        escrowId: escrow_id,
        signature,
        status: "completed",
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "refund_escrow",
  "Request refund from escrow. Creator can cancel if status is Created, or refund after deadline if Active.",
  {
    escrow_id: z.string().describe("Escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const e = requireEscrow();
      const signature = await e.refund(escrow_id);

      return json({
        escrowId: escrow_id,
        signature,
        status: "refunded",
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "get_escrow",
  "Get escrow status and full details by escrow ID",
  {
    escrow_id: z.string().describe("Escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const e = escrow || SolanaEscrow.fromWallet(
        SolanaWallet.generate(),
        RPC_URL,
      );
      const state = await e.getEscrow(escrow_id);

      if (!state) {
        return text(`Escrow not found: ${escrow_id}`);
      }

      return json({
        id: state.id,
        creator: state.creator.toBase58(),
        recipient: state.recipient.toBase58(),
        amount: {
          lamports: state.amount.toString(),
          sol: Number(state.amount) / LAMPORTS_PER_SOL,
        },
        status: state.status,
        deadline: new Date(state.deadline).toISOString(),
        arbiter: state.arbiter?.toBase58(),
        createdAt: new Date(state.createdAt).toISOString(),
        autoReleaseAt: state.autoReleaseAt
          ? new Date(state.autoReleaseAt).toISOString()
          : null,
        network: NETWORK,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "list_escrows",
  "List escrows for the current wallet. Filter by role (creator or recipient).",
  {
    role: z
      .enum(["creator", "recipient"])
      .describe("Filter: 'creator' = escrows you created, 'recipient' = tasks assigned to you"),
  },
  async ({ role }) => {
    try {
      const e = requireEscrow();

      const escrows =
        role === "creator"
          ? await e.listMyEscrows()
          : await e.listTasksForMe();

      const formatted = escrows.map((s) => ({
        id: s.id,
        creator: s.creator.toBase58(),
        recipient: s.recipient.toBase58(),
        amount_sol: Number(s.amount) / LAMPORTS_PER_SOL,
        status: s.status,
        deadline: new Date(s.deadline).toISOString(),
      }));

      return json({
        role,
        count: formatted.length,
        escrows: formatted,
        network: NETWORK,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

// ── Reputation Tools ─────────────────────────────────────────────────

server.tool(
  "get_reputation",
  "Get on-chain reputation (trust score, escrow history) for a Solana address",
  {
    address: z.string().describe("Agent wallet address"),
  },
  async ({ address }) => {
    try {
      const e = escrow || SolanaEscrow.fromWallet(
        SolanaWallet.generate(),
        RPC_URL,
      );
      const rep = await e.getReputation(address);

      if (!rep) {
        return text(
          `No reputation found for ${address}. Use init_reputation to create one.`,
        );
      }

      return json({
        agent: rep.agent,
        escrowsCreated: rep.escrowsCreated,
        escrowsCompleted: rep.escrowsCompleted,
        escrowsReceived: rep.escrowsReceived,
        tasksCompleted: rep.tasksCompleted,
        disputesInitiated: rep.disputesInitiated,
        disputesWon: rep.disputesWon,
        disputesLost: rep.disputesLost,
        totalVolume: {
          lamports: rep.totalVolumeLamports.toString(),
          sol: Number(rep.totalVolumeLamports) / LAMPORTS_PER_SOL,
        },
        completionRate: `${(rep.completionRate * 100).toFixed(1)}%`,
        trustScore: `${(rep.trustScore * 100).toFixed(1)}%`,
        lastActivity: rep.lastActivity
          ? new Date(rep.lastActivity).toISOString()
          : null,
        network: NETWORK,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "init_reputation",
  "Initialize on-chain reputation account for an agent. Required before reputation tracking starts.",
  {
    address: z
      .string()
      .optional()
      .describe("Agent address to initialize (defaults to current wallet)"),
  },
  async ({ address }) => {
    try {
      const e = requireEscrow();
      const sig = await e.initReputation(address);

      return json({
        signature: sig,
        agent: address || wallet!.publicKey.toBase58(),
        status: "initialized",
        network: NETWORK,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

// ── Utility Tools ────────────────────────────────────────────────────

server.tool(
  "validate_address",
  "Validate a Solana wallet address format",
  {
    address: z.string().describe("Address to validate"),
  },
  async ({ address }) => {
    const valid = validateAddress(address);
    return json({
      address,
      valid,
      message: valid
        ? "Valid Solana address"
        : "Invalid Solana address format",
    });
  },
);

server.tool(
  "get_network_status",
  "Get current Solana network info: network name, RPC URL, slot height, and wallet address if configured",
  {},
  async () => {
    try {
      const slot = await connection.getSlot();

      return json({
        network: NETWORK,
        rpcUrl: RPC_URL,
        slot,
        walletConfigured: !!wallet,
        walletAddress: wallet?.publicKey.toBase58() || null,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

// ── Start Server ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
