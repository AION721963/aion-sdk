import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SolanaWallet,
  SolanaEscrow,
  ESCROW_PROGRAM_ID,
  generateWallet,
  importFromMnemonic,
  validateAddress,
  getRpcEndpoint,
  type Network,
} from "@aion-sdk/solana";
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN, type Idl } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "crypto";
import escrowIdl from "./idl.json";

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

function getProgram(): Program {
  const w = requireWallet();
  const provider = new AnchorProvider(
    connection,
    w as any,
    { commitment: "confirmed" },
  );
  return new Program(escrowIdl as Idl, ESCROW_PROGRAM_ID, provider);
}

function deriveTokenEscrowPda(creator: PublicKey, escrowId: BN): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_escrow"), creator.toBuffer(), idBuffer],
    ESCROW_PROGRAM_ID,
  );
}

function deriveTokenVaultPda(escrowPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), escrowPda.toBuffer()],
    ESCROW_PROGRAM_ID,
  );
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

// ── Token Escrow Tools (any SPL token) ───────────────────────────────

server.tool(
  "create_token_escrow",
  "Create escrow with ANY SPL token (USDC, BONK, etc.). Agents choose their payment token. Locks tokens on-chain.",
  {
    mint: z.string().describe("SPL token mint address (e.g. USDC mint)"),
    amount: z.number().positive().describe("Amount in token units (e.g. 10.5 USDC)"),
    decimals: z.number().int().min(0).max(18).describe("Token decimals (USDC=6, most tokens=9)"),
    recipient: z.string().describe("Recipient wallet address"),
    deadline_hours: z.number().positive().default(24).describe("Deadline in hours (default: 24)"),
    terms: z.string().optional().describe("Task description"),
    arbiter: z.string().optional().describe("Optional arbiter for disputes"),
  },
  async ({ mint, amount, decimals, recipient, deadline_hours, terms, arbiter }) => {
    try {
      const w = requireWallet();
      const program = getProgram();

      const mintPubkey = new PublicKey(mint);
      const recipientPubkey = new PublicKey(recipient);
      const arbiterPubkey = arbiter ? new PublicKey(arbiter) : w.publicKey;
      const feeRecipientPubkey = new PublicKey("GjJ4vt7YDjBEmawgxmAEeyD4WuTLXeMZCr5raYGg5ijo"); // AION Treasury

      // Random escrow ID
      const escrowIdBytes = new Uint8Array(8);
      crypto.getRandomValues(escrowIdBytes);
      const escrowId = new BN(Buffer.from(escrowIdBytes), "le");

      const [escrowPda] = deriveTokenEscrowPda(w.publicKey, escrowId);
      const [vaultPda] = deriveTokenVaultPda(escrowPda);

      const amountRaw = new BN(Math.round(amount * Math.pow(10, decimals)));
      const deadlineUnix = new BN(Math.floor((Date.now() + deadline_hours * 3600000) / 1000));
      const termsHash = terms
        ? Array.from(createHash("sha256").update(terms).digest())
        : Array(32).fill(0);

      const creatorTokenAccount = await getAssociatedTokenAddress(mintPubkey, w.publicKey);

      await program.methods
        .createTokenEscrow(escrowId, amountRaw, deadlineUnix, termsHash, 10, new BN(0))
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          creator: w.publicKey,
          recipient: recipientPubkey,
          arbiter: arbiterPubkey,
          feeRecipient: feeRecipientPubkey,
          mint: mintPubkey,
          creatorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: new PublicKey("SysvarRent111111111111111111111111"),
        })
        .rpc();

      return json({
        escrowId: escrowPda.toBase58(),
        type: "token",
        mint,
        amount,
        decimals,
        recipient,
        deadline: new Date(Date.now() + deadline_hours * 3600000).toISOString(),
        network: NETWORK,
        status: "created",
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "accept_token_escrow",
  "Accept a token escrow task as executor. Works with any SPL token.",
  {
    escrow_id: z.string().describe("Token escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const w = requireWallet();
      const program = getProgram();

      await program.methods
        .acceptTokenTask()
        .accounts({
          escrowAccount: new PublicKey(escrow_id),
          recipient: w.publicKey,
        })
        .rpc();

      return json({ escrowId: escrow_id, status: "active" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "release_token_payment",
  "Release token escrow payment to executor. Supports any SPL token. Creator only.",
  {
    escrow_id: z.string().describe("Token escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const w = requireWallet();
      const program = getProgram();
      const escrowPubkey = new PublicKey(escrow_id);

      const escrowData = await program.account.tokenEscrowAccount.fetch(escrowPubkey);
      const recipientPubkey = escrowData.recipient as PublicKey;
      const mintPubkey = escrowData.mint as PublicKey;
      const feeRecipientPubkey = escrowData.feeRecipient as PublicKey;

      const [vaultPda] = deriveTokenVaultPda(escrowPubkey);
      const recipientTokenAccount = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
      const feeTokenAccount = await getAssociatedTokenAddress(mintPubkey, feeRecipientPubkey);

      const sig = await program.methods
        .releaseTokenPayment()
        .accounts({
          escrowAccount: escrowPubkey,
          vault: vaultPda,
          creator: w.publicKey,
          recipient: recipientPubkey,
          recipientTokenAccount,
          feeTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      return json({ escrowId: escrow_id, signature: sig, status: "completed" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "refund_token_escrow",
  "Refund token escrow. Creator can cancel if Created, or refund after deadline if Active.",
  {
    escrow_id: z.string().describe("Token escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const w = requireWallet();
      const program = getProgram();
      const escrowPubkey = new PublicKey(escrow_id);

      const escrowData = await program.account.tokenEscrowAccount.fetch(escrowPubkey);
      const mintPubkey = escrowData.mint as PublicKey;

      const [vaultPda] = deriveTokenVaultPda(escrowPubkey);
      const creatorTokenAccount = await getAssociatedTokenAddress(mintPubkey, w.publicKey);

      const sig = await program.methods
        .refundTokenEscrow()
        .accounts({
          escrowAccount: escrowPubkey,
          vault: vaultPda,
          creator: w.publicKey,
          creatorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      return json({ escrowId: escrow_id, signature: sig, status: "refunded" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "get_token_escrow",
  "Get token escrow status and details (works with any SPL token)",
  {
    escrow_id: z.string().describe("Token escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const program = getProgram();
      const escrowPubkey = new PublicKey(escrow_id);

      const data = await program.account.tokenEscrowAccount.fetch(escrowPubkey);

      const statusMap: Record<string, string> = {};
      const status = data.status as any;
      const statusStr = status.created !== undefined ? "created"
        : status.active !== undefined ? "active"
        : status.completed !== undefined ? "completed"
        : status.disputed !== undefined ? "disputed"
        : status.refunded !== undefined ? "refunded"
        : status.cancelled !== undefined ? "cancelled"
        : "unknown";

      return json({
        id: escrow_id,
        type: "token",
        creator: (data.creator as PublicKey).toBase58(),
        recipient: (data.recipient as PublicKey).toBase58(),
        mint: (data.mint as PublicKey).toBase58(),
        amount: (data.amount as BN).toString(),
        status: statusStr,
        deadline: new Date((data.deadline as BN).toNumber() * 1000).toISOString(),
        feeBasisPoints: data.feeBasisPoints,
        createdAt: new Date((data.createdAt as BN).toNumber() * 1000).toISOString(),
        network: NETWORK,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

// ── Milestone Escrow Tools ───────────────────────────────────────────

function deriveMilestoneEscrowPda(creator: PublicKey, escrowId: BN): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("milestone_escrow"), creator.toBuffer(), idBuffer],
    ESCROW_PROGRAM_ID,
  );
}

server.tool(
  "create_milestone_escrow",
  "Create milestone-based escrow. Splits work into up to 10 milestones, each with its own payment amount. Creator releases payments milestone by milestone.",
  {
    recipient: z.string().describe("Recipient (executor) wallet address"),
    deadline_hours: z.number().positive().default(168).describe("Deadline in hours (default: 168 = 1 week)"),
    terms: z.string().optional().describe("Overall task description"),
    arbiter: z.string().optional().describe("Optional arbiter for disputes"),
    milestones: z.array(z.object({
      amount: z.number().positive().describe("Amount in SOL for this milestone"),
      description: z.string().describe("Description of this milestone"),
    })).min(1).max(10).describe("Array of milestones (1-10)"),
  },
  async ({ recipient, deadline_hours, terms, arbiter, milestones }) => {
    try {
      const w = requireWallet();
      const program = getProgram();

      const recipientPubkey = new PublicKey(recipient);
      const arbiterPubkey = arbiter ? new PublicKey(arbiter) : w.publicKey;
      const feeRecipientPubkey = new PublicKey("GjJ4vt7YDjBEmawgxmAEeyD4WuTLXeMZCr5raYGg5ijo");

      const escrowIdBytes = new Uint8Array(8);
      crypto.getRandomValues(escrowIdBytes);
      const escrowId = new BN(Buffer.from(escrowIdBytes), "le");

      const [escrowPda] = deriveMilestoneEscrowPda(w.publicKey, escrowId);
      const deadlineUnix = new BN(Math.floor((Date.now() + deadline_hours * 3600000) / 1000));
      const termsHash = terms
        ? Array.from(createHash("sha256").update(terms).digest())
        : Array(32).fill(0);

      const milestoneInputs = milestones.map((m) => ({
        amount: new BN(Math.round(m.amount * LAMPORTS_PER_SOL)),
        descriptionHash: Array.from(createHash("sha256").update(m.description).digest()),
      }));

      const totalSol = milestones.reduce((sum, m) => sum + m.amount, 0);

      await program.methods
        .createMilestoneEscrow(escrowId, deadlineUnix, termsHash, 10, milestoneInputs)
        .accounts({
          escrowAccount: escrowPda,
          creator: w.publicKey,
          recipient: recipientPubkey,
          arbiter: arbiterPubkey,
          feeRecipient: feeRecipientPubkey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return json({
        escrowId: escrowPda.toBase58(),
        type: "milestone",
        totalAmount: totalSol,
        milestoneCount: milestones.length,
        milestones: milestones.map((m, i) => ({ index: i, amount: m.amount, description: m.description })),
        recipient,
        deadline: new Date(Date.now() + deadline_hours * 3600000).toISOString(),
        network: NETWORK,
        status: "created",
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "accept_milestone_task",
  "Accept a milestone escrow task as executor. Status changes from Created to Active.",
  {
    escrow_id: z.string().describe("Milestone escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const w = requireWallet();
      const program = getProgram();

      const sig = await program.methods
        .acceptMilestoneTask()
        .accounts({
          escrowAccount: new PublicKey(escrow_id),
          recipient: w.publicKey,
        })
        .rpc();

      return json({ escrowId: escrow_id, signature: sig, status: "active" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "release_milestone",
  "Release payment for a specific milestone (creator only). Each milestone is released individually.",
  {
    escrow_id: z.string().describe("Milestone escrow PDA address"),
    milestone_index: z.number().int().min(0).max(9).describe("Index of the milestone to release (0-based)"),
  },
  async ({ escrow_id, milestone_index }) => {
    try {
      const w = requireWallet();
      const program = getProgram();
      const escrowPubkey = new PublicKey(escrow_id);

      const escrowData = await program.account.milestoneEscrowAccount.fetch(escrowPubkey);

      const sig = await program.methods
        .releaseMilestone(milestone_index)
        .accounts({
          escrowAccount: escrowPubkey,
          creator: w.publicKey,
          recipient: escrowData.recipient as PublicKey,
          feeRecipient: escrowData.feeRecipient as PublicKey,
        })
        .rpc();

      return json({ escrowId: escrow_id, milestoneIndex: milestone_index, signature: sig, status: "milestone_released" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "dispute_milestone",
  "Dispute a specific milestone (creator or executor). Only pending milestones can be disputed.",
  {
    escrow_id: z.string().describe("Milestone escrow PDA address"),
    milestone_index: z.number().int().min(0).max(9).describe("Index of the milestone to dispute (0-based)"),
  },
  async ({ escrow_id, milestone_index }) => {
    try {
      const w = requireWallet();
      const program = getProgram();

      const sig = await program.methods
        .disputeMilestone(milestone_index)
        .accounts({
          escrowAccount: new PublicKey(escrow_id),
          disputer: w.publicKey,
        })
        .rpc();

      return json({ escrowId: escrow_id, milestoneIndex: milestone_index, signature: sig, status: "disputed" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "resolve_milestone_dispute",
  "Resolve a milestone dispute (arbiter only). Sends funds to the winner.",
  {
    escrow_id: z.string().describe("Milestone escrow PDA address"),
    milestone_index: z.number().int().min(0).max(9).describe("Index of the disputed milestone"),
    winner: z.enum(["creator", "recipient"]).describe("Who wins: 'creator' or 'recipient'"),
  },
  async ({ escrow_id, milestone_index, winner }) => {
    try {
      const w = requireWallet();
      const program = getProgram();
      const escrowPubkey = new PublicKey(escrow_id);

      const escrowData = await program.account.milestoneEscrowAccount.fetch(escrowPubkey);
      const winnerEnum = winner === "creator" ? { creator: {} } : { recipient: {} };

      const sig = await program.methods
        .resolveMilestoneDispute(milestone_index, winnerEnum)
        .accounts({
          escrowAccount: escrowPubkey,
          arbiter: w.publicKey,
          creator: escrowData.creator as PublicKey,
          recipient: escrowData.recipient as PublicKey,
          feeRecipient: escrowData.feeRecipient as PublicKey,
        })
        .rpc();

      return json({ escrowId: escrow_id, milestoneIndex: milestone_index, winner, signature: sig, status: "resolved" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "get_milestone_escrow",
  "Get milestone escrow status and all milestone details",
  {
    escrow_id: z.string().describe("Milestone escrow PDA address"),
  },
  async ({ escrow_id }) => {
    try {
      const program = getProgram();
      const escrowPubkey = new PublicKey(escrow_id);

      const data = await program.account.milestoneEscrowAccount.fetch(escrowPubkey);
      const status = data.status as any;
      const statusStr = status.created !== undefined ? "created"
        : status.active !== undefined ? "active"
        : status.completed !== undefined ? "completed"
        : status.disputed !== undefined ? "disputed"
        : status.refunded !== undefined ? "refunded"
        : "unknown";

      const milestoneCount = data.milestoneCount as number;
      const rawMilestones = data.milestones as any[];

      const milestones = rawMilestones.slice(0, milestoneCount).map((m: any, i: number) => {
        const ms = m.status as any;
        const msStatus = ms.pending !== undefined ? "pending"
          : ms.released !== undefined ? "released"
          : ms.disputed !== undefined ? "disputed"
          : "unknown";

        return {
          index: i,
          amount_sol: (m.amount as BN).toNumber() / LAMPORTS_PER_SOL,
          status: msStatus,
        };
      });

      return json({
        id: escrow_id,
        type: "milestone",
        creator: (data.creator as PublicKey).toBase58(),
        recipient: (data.recipient as PublicKey).toBase58(),
        totalAmount_sol: (data.totalAmount as BN).toNumber() / LAMPORTS_PER_SOL,
        releasedAmount_sol: (data.releasedAmount as BN).toNumber() / LAMPORTS_PER_SOL,
        status: statusStr,
        deadline: new Date((data.deadline as BN).toNumber() * 1000).toISOString(),
        milestoneCount,
        milestones,
        network: NETWORK,
      });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

// ── Dispute Resolution Tools ────────────────────────────────────────

server.tool(
  "dispute_escrow",
  "Open a dispute on a SOL escrow (creator or executor). Reason is stored on-chain.",
  {
    escrow_id: z.string().describe("Escrow PDA address"),
    reason: z.string().max(64).describe("Reason for dispute (max 64 chars)"),
  },
  async ({ escrow_id, reason }) => {
    try {
      const e = requireEscrow();
      const sig = await e.dispute(escrow_id, reason);
      return json({ escrowId: escrow_id, signature: sig, reason, status: "disputed" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "resolve_dispute",
  "Resolve a SOL escrow dispute (arbiter only). Sends funds to the winner.",
  {
    escrow_id: z.string().describe("Escrow PDA address"),
    winner: z.enum(["creator", "recipient"]).describe("Who wins the dispute"),
  },
  async ({ escrow_id, winner }) => {
    try {
      const e = requireEscrow();
      const sig = await e.resolveDispute(escrow_id, winner);
      return json({ escrowId: escrow_id, winner, signature: sig, status: "resolved" });
    } catch (e: any) {
      return text(`Error: ${e.message}`);
    }
  },
);

server.tool(
  "resolve_token_dispute",
  "Resolve a token escrow dispute (arbiter only). Sends tokens to the winner.",
  {
    escrow_id: z.string().describe("Token escrow PDA address"),
    winner: z.enum(["creator", "recipient"]).describe("Who wins the dispute"),
  },
  async ({ escrow_id, winner }) => {
    try {
      const w = requireWallet();
      const program = getProgram();
      const escrowPubkey = new PublicKey(escrow_id);

      const escrowData = await program.account.tokenEscrowAccount.fetch(escrowPubkey);
      const mintPubkey = escrowData.mint as PublicKey;
      const creatorPubkey = escrowData.creator as PublicKey;
      const recipientPubkey = escrowData.recipient as PublicKey;
      const feeRecipientPubkey = escrowData.feeRecipient as PublicKey;

      const [vaultPda] = deriveTokenVaultPda(escrowPubkey);
      const creatorTokenAccount = await getAssociatedTokenAddress(mintPubkey, creatorPubkey);
      const recipientTokenAccount = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
      const feeTokenAccount = await getAssociatedTokenAddress(mintPubkey, feeRecipientPubkey);

      const winnerEnum = winner === "creator" ? { creator: {} } : { recipient: {} };

      const sig = await program.methods
        .resolveTokenDispute(winnerEnum)
        .accounts({
          escrowAccount: escrowPubkey,
          vault: vaultPda,
          arbiter: w.publicKey,
          creator: creatorPubkey,
          recipient: recipientPubkey,
          creatorTokenAccount,
          recipientTokenAccount,
          feeTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      return json({ escrowId: escrow_id, winner, signature: sig, status: "resolved" });
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
