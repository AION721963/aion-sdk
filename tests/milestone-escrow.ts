import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";

import idl from "../target/idl/escrow.json";

const PROGRAM_ID = new PublicKey("EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X");

function deriveMilestoneEscrowPda(
  creator: PublicKey,
  escrowId: anchor.BN,
): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("milestone_escrow"), creator.toBuffer(), idBuffer],
    PROGRAM_ID
  );
}

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  amount: number
) {
  const sig = await connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

function randomEscrowId(): anchor.BN {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  return new anchor.BN(Buffer.from(bytes), "le");
}

describe("milestone-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as any, PROGRAM_ID, provider);
  const connection = provider.connection;

  const creator = Keypair.generate();
  const recipient = Keypair.generate();
  const arbiter = Keypair.generate();
  const treasury = Keypair.generate();

  const feeBasisPoints = 150;

  before(async () => {
    await airdrop(connection, creator.publicKey, 10);
    await airdrop(connection, recipient.publicKey, 2);
    await airdrop(connection, arbiter.publicKey, 1);
  });

  it("creates 3-milestone escrow and verifies structure", async () => {
    const escrowId = randomEscrowId();
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    const termsHash = Array.from(createHash("sha256").update("Milestone test").digest());

    const milestones = [
      { amount: new anchor.BN(0.3 * LAMPORTS_PER_SOL), descriptionHash: Array.from(createHash("sha256").update("Phase 1").digest()) },
      { amount: new anchor.BN(0.3 * LAMPORTS_PER_SOL), descriptionHash: Array.from(createHash("sha256").update("Phase 2").digest()) },
      { amount: new anchor.BN(0.4 * LAMPORTS_PER_SOL), descriptionHash: Array.from(createHash("sha256").update("Phase 3").digest()) },
    ];

    const [escrowPda] = deriveMilestoneEscrowPda(creator.publicKey, escrowId);

    await program.methods
      .createMilestoneEscrow(escrowId, deadline, termsHash, feeBasisPoints, milestones)
      .accounts({
        escrowAccount: escrowPda,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        arbiter: arbiter.publicKey,
        feeRecipient: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.milestoneEscrowAccount.fetch(escrowPda) as any;
    expect(escrow.milestoneCount).to.equal(3);
    expect(escrow.totalAmount.toNumber()).to.equal(1 * LAMPORTS_PER_SOL);
    expect(escrow.releasedAmount.toNumber()).to.equal(0);
    expect(escrow.status).to.have.property("created");
  });

  it("releases milestone 0, verifies partial payment", async () => {
    const escrowId = randomEscrowId();
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    const termsHash = Array(32).fill(0);

    const m0Amount = 0.5 * LAMPORTS_PER_SOL;
    const m1Amount = 0.5 * LAMPORTS_PER_SOL;

    const milestones = [
      { amount: new anchor.BN(m0Amount), descriptionHash: Array(32).fill(0) },
      { amount: new anchor.BN(m1Amount), descriptionHash: Array(32).fill(1) },
    ];

    const [escrowPda] = deriveMilestoneEscrowPda(creator.publicKey, escrowId);

    await program.methods
      .createMilestoneEscrow(escrowId, deadline, termsHash, feeBasisPoints, milestones)
      .accounts({
        escrowAccount: escrowPda,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        arbiter: arbiter.publicKey,
        feeRecipient: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Accept
    await program.methods
      .acceptMilestoneTask()
      .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
      .signers([recipient])
      .rpc();

    const recipientBefore = await connection.getBalance(recipient.publicKey);
    const treasuryBefore = await connection.getBalance(treasury.publicKey);

    // Release milestone 0
    await program.methods
      .releaseMilestone(0)
      .accounts({
        escrowAccount: escrowPda,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        feeRecipient: treasury.publicKey,
      })
      .signers([creator])
      .rpc();

    const recipientAfter = await connection.getBalance(recipient.publicKey);
    const treasuryAfter = await connection.getBalance(treasury.publicKey);

    const expectedFee = Math.floor(m0Amount * feeBasisPoints / 10000);
    expect(recipientAfter - recipientBefore).to.equal(m0Amount - expectedFee);
    expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);

    // Escrow still exists (milestone 1 pending)
    const escrow = await program.account.milestoneEscrowAccount.fetch(escrowPda) as any;
    expect(escrow.status).to.have.property("active");
    expect(escrow.releasedAmount.toNumber()).to.equal(m0Amount);
  });

  it("release all milestones → account marked completed", async () => {
    const escrowId = randomEscrowId();
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    const termsHash = Array(32).fill(0);

    const milestones = [
      { amount: new anchor.BN(0.3 * LAMPORTS_PER_SOL), descriptionHash: Array(32).fill(0) },
      { amount: new anchor.BN(0.7 * LAMPORTS_PER_SOL), descriptionHash: Array(32).fill(1) },
    ];

    const [escrowPda] = deriveMilestoneEscrowPda(creator.publicKey, escrowId);

    await program.methods
      .createMilestoneEscrow(escrowId, deadline, termsHash, feeBasisPoints, milestones)
      .accounts({
        escrowAccount: escrowPda,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        arbiter: arbiter.publicKey,
        feeRecipient: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .acceptMilestoneTask()
      .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
      .signers([recipient])
      .rpc();

    // Release both milestones
    await program.methods
      .releaseMilestone(0)
      .accounts({
        escrowAccount: escrowPda,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        feeRecipient: treasury.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .releaseMilestone(1)
      .accounts({
        escrowAccount: escrowPda,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        feeRecipient: treasury.publicKey,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.milestoneEscrowAccount.fetch(escrowPda) as any;
    expect(escrow.status).to.have.property("completed");
  });

  it("dispute single milestone → arbiter resolves", async () => {
    const escrowId = randomEscrowId();
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    const termsHash = Array(32).fill(0);

    const m0Amount = 0.5 * LAMPORTS_PER_SOL;
    const milestones = [
      { amount: new anchor.BN(m0Amount), descriptionHash: Array(32).fill(0) },
      { amount: new anchor.BN(0.5 * LAMPORTS_PER_SOL), descriptionHash: Array(32).fill(1) },
    ];

    const [escrowPda] = deriveMilestoneEscrowPda(creator.publicKey, escrowId);

    await program.methods
      .createMilestoneEscrow(escrowId, deadline, termsHash, feeBasisPoints, milestones)
      .accounts({
        escrowAccount: escrowPda,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        arbiter: arbiter.publicKey,
        feeRecipient: treasury.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .acceptMilestoneTask()
      .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
      .signers([recipient])
      .rpc();

    // Dispute milestone 0
    await program.methods
      .disputeMilestone(0)
      .accounts({ escrowAccount: escrowPda, disputer: creator.publicKey })
      .signers([creator])
      .rpc();

    let escrow = await program.account.milestoneEscrowAccount.fetch(escrowPda) as any;
    expect(escrow.status).to.have.property("disputed");

    const recipientBefore = await connection.getBalance(recipient.publicKey);

    // Resolve in favor of recipient
    await program.methods
      .resolveMilestoneDispute(0, { recipient: {} })
      .accounts({
        escrowAccount: escrowPda,
        arbiter: arbiter.publicKey,
        creator: creator.publicKey,
        recipient: recipient.publicKey,
        feeRecipient: treasury.publicKey,
      })
      .signers([arbiter])
      .rpc();

    const recipientAfter = await connection.getBalance(recipient.publicKey);
    const expectedFee = Math.floor(m0Amount * feeBasisPoints / 10000);
    expect(recipientAfter - recipientBefore).to.equal(m0Amount - expectedFee);

    escrow = await program.account.milestoneEscrowAccount.fetch(escrowPda) as any;
    expect(escrow.status).to.have.property("active"); // Back to active, milestone 1 still pending
  });
});
