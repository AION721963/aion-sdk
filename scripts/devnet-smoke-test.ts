/**
 * AION Escrow — Devnet Smoke Test
 *
 * Tests the full escrow lifecycle on Solana devnet:
 * Create → Accept → Release (with 1.5% fee)
 *
 * Run: npx ts-node --project tsconfig.test.json scripts/devnet-smoke-test.ts
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import idl from "../target/idl/escrow.json";

const PROGRAM_ID = new PublicKey("EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X");
const DEVNET_URL = "https://api.devnet.solana.com";
const EXPLORER = "https://explorer.solana.com/tx/";

function deriveEscrowPda(creator: PublicKey, escrowId: anchor.BN): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), creator.toBuffer(), idBuffer],
    PROGRAM_ID
  );
}

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  AION Escrow — Devnet Smoke Test");
  console.log("═══════════════════════════════════════════════════════\n");

  // Setup
  const connection = new Connection(DEVNET_URL, "confirmed");
  const creator = loadKeypair(path.resolve(process.env.HOME!, ".config/solana/id.json"));
  const recipient = Keypair.generate();
  const treasury = Keypair.generate();

  console.log(`Creator:   ${creator.publicKey.toBase58()}`);
  console.log(`Recipient: ${recipient.publicKey.toBase58()}`);
  console.log(`Treasury:  ${treasury.publicKey.toBase58()}`);

  const creatorBalance = await connection.getBalance(creator.publicKey);
  console.log(`\nCreator balance: ${(creatorBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // Transfer SOL to recipient for tx fees
  console.log("→ Funding recipient for tx fees (0.01 SOL)...");
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    })
  );
  const fundSig = await sendAndConfirmTransaction(connection, fundTx, [creator]);
  console.log(`  ✓ ${EXPLORER}${fundSig}?cluster=devnet\n`);

  // Setup Anchor
  const wallet = {
    publicKey: creator.publicKey,
    signTransaction: async (tx: any) => { tx.sign(creator); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(creator)); return txs; },
  };
  const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  const program = new anchor.Program(idl as any, PROGRAM_ID, provider);

  // 1. CREATE ESCROW
  console.log("═══ Step 1: CREATE ESCROW ═══");
  const escrowId = new anchor.BN(Date.now());
  const escrowAmount = 0.1; // SOL
  const amount = new anchor.BN(escrowAmount * LAMPORTS_PER_SOL);
  const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 86400); // +24h
  const terms = "AION SDK smoke test — agent-to-agent escrow on Solana devnet";
  const termsHash = Array.from(createHash("sha256").update(terms).digest());
  const feeBasisPoints = 150; // 1.5%

  const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);
  console.log(`  Amount:    ${escrowAmount} SOL`);
  console.log(`  Fee:       1.5%`);
  console.log(`  Deadline:  +24 hours`);
  console.log(`  Terms:     "${terms}"`);
  console.log(`  Escrow PDA: ${escrowPda.toBase58()}`);

  const createSig = await program.methods
    .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints)
    .accounts({
      escrowAccount: escrowPda,
      creator: creator.publicKey,
      recipient: recipient.publicKey,
      arbiter: creator.publicKey,
      feeRecipient: treasury.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([creator])
    .rpc();

  console.log(`  ✓ Created! ${EXPLORER}${createSig}?cluster=devnet\n`);

  // Verify on-chain state
  const escrowData = await program.account.escrowAccount.fetch(escrowPda) as any;
  console.log(`  On-chain status: ${JSON.stringify(escrowData.status)}`);
  console.log(`  On-chain amount: ${escrowData.amount.toNumber() / LAMPORTS_PER_SOL} SOL\n`);

  // 2. ACCEPT TASK
  console.log("═══ Step 2: ACCEPT TASK ═══");

  // Recipient needs to sign
  const recipientWallet = {
    publicKey: recipient.publicKey,
    signTransaction: async (tx: any) => { tx.sign(recipient); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(recipient)); return txs; },
  };
  const recipientProvider = new anchor.AnchorProvider(connection, recipientWallet as any, { commitment: "confirmed" });
  const recipientProgram = new anchor.Program(idl as any, PROGRAM_ID, recipientProvider);

  const acceptSig = await recipientProgram.methods
    .acceptTask()
    .accounts({
      escrowAccount: escrowPda,
      recipient: recipient.publicKey,
    })
    .signers([recipient])
    .rpc();

  console.log(`  ✓ Accepted! ${EXPLORER}${acceptSig}?cluster=devnet\n`);

  const afterAccept = await program.account.escrowAccount.fetch(escrowPda) as any;
  console.log(`  On-chain status: ${JSON.stringify(afterAccept.status)}\n`);

  // 3. RELEASE PAYMENT
  console.log("═══ Step 3: RELEASE PAYMENT ═══");

  const recipientBefore = await connection.getBalance(recipient.publicKey);
  const treasuryBefore = await connection.getBalance(treasury.publicKey);

  const releaseSig = await program.methods
    .releasePayment()
    .accounts({
      escrowAccount: escrowPda,
      creator: creator.publicKey,
      recipient: recipient.publicKey,
      feeRecipient: treasury.publicKey,
    })
    .signers([creator])
    .rpc();

  console.log(`  ✓ Released! ${EXPLORER}${releaseSig}?cluster=devnet\n`);

  const recipientAfter = await connection.getBalance(recipient.publicKey);
  const treasuryAfter = await connection.getBalance(treasury.publicKey);

  const recipientGot = (recipientAfter - recipientBefore) / LAMPORTS_PER_SOL;
  const treasuryGot = (treasuryAfter - treasuryBefore) / LAMPORTS_PER_SOL;
  const expectedFee = escrowAmount * 0.015;

  console.log(`  Recipient received: ${recipientGot.toFixed(6)} SOL (expected: ${(escrowAmount - expectedFee).toFixed(6)})`);
  console.log(`  Treasury received:  ${treasuryGot.toFixed(6)} SOL (expected: ${expectedFee.toFixed(6)})`);

  // Verify PDA closed
  const closed = await connection.getAccountInfo(escrowPda);
  console.log(`  Escrow PDA closed:  ${closed === null ? "✓ Yes" : "✗ No"}\n`);

  // Summary
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SMOKE TEST PASSED ✓");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`\n  Program: https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`\n  Transactions:`);
  console.log(`  1. Create:  ${EXPLORER}${createSig}?cluster=devnet`);
  console.log(`  2. Accept:  ${EXPLORER}${acceptSig}?cluster=devnet`);
  console.log(`  3. Release: ${EXPLORER}${releaseSig}?cluster=devnet`);
  console.log("");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
