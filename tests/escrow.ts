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

// Load the IDL from the built program
import idl from "../target/idl/escrow.json";

// Program ID from declare_id!
const PROGRAM_ID = new PublicKey("EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X");

function deriveEscrowPda(
  creator: PublicKey,
  escrowId: anchor.BN,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), creator.toBuffer(), idBuffer],
    programId
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
  for (let i = 0; i < 8; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return new anchor.BN(Buffer.from(bytes), "le");
}

describe("escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl, PROGRAM_ID, provider);
  const connection = provider.connection;

  // Actors
  const creator = Keypair.generate();
  const recipient = Keypair.generate();
  const arbiter = Keypair.generate();
  const treasury = Keypair.generate();

  // Fee: 1.5% = 150 basis points
  const feeBasisPoints = 150;

  before(async () => {
    // Fund all actors
    await airdrop(connection, creator.publicKey, 10);
    await airdrop(connection, recipient.publicKey, 2);
    await airdrop(connection, arbiter.publicKey, 1);
  });

  describe("create_escrow", () => {
    it("creates an escrow with valid parameters", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // +1 hour
      const terms = "Build feature X";
      const termsHash = Array.from(createHash("sha256").update(terms).digest());

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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

      const escrow = await program.account.escrowAccount.fetch(escrowPda);
      expect(escrow.creator.toBase58()).to.equal(creator.publicKey.toBase58());
      expect(escrow.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
      expect(escrow.amount.toNumber()).to.equal(0.5 * LAMPORTS_PER_SOL);
      expect(escrow.feeBasisPoints).to.equal(feeBasisPoints);
      expect(escrow.feeRecipient.toBase58()).to.equal(treasury.publicKey.toBase58());
      expect(escrow.arbiter.toBase58()).to.equal(arbiter.publicKey.toBase58());
      expect(escrow.status).to.have.property("created");

      // Verify SOL was transferred to PDA
      const pdaBalance = await connection.getBalance(escrowPda);
      // PDA balance = rent + escrow amount
      expect(pdaBalance).to.be.greaterThan(0.5 * LAMPORTS_PER_SOL);
    });

    it("fails with zero amount", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      try {
        await program.methods
          .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("ZeroAmount");
      }
    });

    it("fails with fee > 10%", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      try {
        await program.methods
          .createEscrow(escrowId, amount, deadline, termsHash, 1001, new anchor.BN(0)) // >10%
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
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("FeeTooHigh");
      }
    });
  });

  describe("accept_task", () => {
    let escrowPda: PublicKey;
    let escrowId: anchor.BN;

    before(async () => {
      escrowId = randomEscrowId();
      const amount = new anchor.BN(1 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
    });

    it("recipient can accept the task", async () => {
      await program.methods
        .acceptTask()
        .accounts({
          escrowAccount: escrowPda,
          recipient: recipient.publicKey,
        })
        .signers([recipient])
        .rpc();

      const escrow = await program.account.escrowAccount.fetch(escrowPda);
      expect(escrow.status).to.have.property("active");
    });

    it("non-recipient cannot accept", async () => {
      // Create a fresh escrow
      const newId = randomEscrowId();
      const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [newPda] = deriveEscrowPda(creator.publicKey, newId);

      await program.methods
        .createEscrow(newId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
        .accounts({
          escrowAccount: newPda,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          arbiter: arbiter.publicKey,
          feeRecipient: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const imposter = Keypair.generate();
      await airdrop(connection, imposter.publicKey, 1);

      try {
        await program.methods
          .acceptTask()
          .accounts({
            escrowAccount: newPda,
            recipient: imposter.publicKey,
          })
          .signers([imposter])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("UnauthorizedRecipient");
      }
    });
  });

  describe("release_payment", () => {
    it("creator releases payment with correct fee split", async () => {
      const escrowId = randomEscrowId();
      const escrowAmount = 2 * LAMPORTS_PER_SOL;
      const amount = new anchor.BN(escrowAmount);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      // Create
      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        .acceptTask()
        .accounts({
          escrowAccount: escrowPda,
          recipient: recipient.publicKey,
        })
        .signers([recipient])
        .rpc();

      // Record balances before release
      const recipientBefore = await connection.getBalance(recipient.publicKey);
      const treasuryBefore = await connection.getBalance(treasury.publicKey);
      const creatorBefore = await connection.getBalance(creator.publicKey);

      // Release
      await program.methods
        .releasePayment()
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
      const creatorAfter = await connection.getBalance(creator.publicKey);

      // Fee = 2 SOL * 150 / 10000 = 0.03 SOL = 30_000_000 lamports
      const expectedFee = Math.floor(escrowAmount * feeBasisPoints / 10000);
      const expectedRecipientPayment = escrowAmount - expectedFee;

      // Recipient gets amount - fee
      const recipientDelta = recipientAfter - recipientBefore;
      expect(recipientDelta).to.equal(expectedRecipientPayment);

      // Treasury gets fee
      const treasuryDelta = treasuryAfter - treasuryBefore;
      expect(treasuryDelta).to.equal(expectedFee);

      // Creator gets rent back (PDA closed)
      expect(creatorAfter).to.be.greaterThan(creatorBefore - 10000); // minus tx fee, plus rent back

      // Escrow account closed
      const accountInfo = await connection.getAccountInfo(escrowPda);
      expect(accountInfo).to.be.null;
    });
  });

  describe("request_refund", () => {
    it("creator can cancel before acceptance", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      const creatorBefore = await connection.getBalance(creator.publicKey);

      // Create
      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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

      // Refund (cancel) — escrow is still in Created status
      await program.methods
        .requestRefund()
        .accounts({
          escrowAccount: escrowPda,
          creator: creator.publicKey,
        })
        .signers([creator])
        .rpc();

      // Escrow account closed
      const accountInfo = await connection.getAccountInfo(escrowPda);
      expect(accountInfo).to.be.null;

      // Creator got funds back (minus tx fees)
      const creatorAfter = await connection.getBalance(creator.publicKey);
      expect(creatorAfter).to.be.greaterThan(creatorBefore - 0.01 * LAMPORTS_PER_SOL);
    });

    it("cannot refund active escrow before deadline", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // far future
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      // Create
      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        .acceptTask()
        .accounts({
          escrowAccount: escrowPda,
          recipient: recipient.publicKey,
        })
        .signers([recipient])
        .rpc();

      // Try refund — should fail (deadline not reached)
      try {
        await program.methods
          .requestRefund()
          .accounts({
            escrowAccount: escrowPda,
            creator: creator.publicKey,
          })
          .signers([creator])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("DeadlineNotReached");
      }
    });
  });

  describe("dispute", () => {
    let escrowPda: PublicKey;

    before(async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(1 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        .acceptTask()
        .accounts({
          escrowAccount: escrowPda,
          recipient: recipient.publicKey,
        })
        .signers([recipient])
        .rpc();
    });

    it("creator can open a dispute", async () => {
      const reason = "Work not delivered";
      const reasonBytes = Buffer.alloc(64);
      reasonBytes.write(reason.substring(0, 64));

      await program.methods
        .dispute(Array.from(reasonBytes))
        .accounts({
          escrowAccount: escrowPda,
          disputer: creator.publicKey,
        })
        .signers([creator])
        .rpc();

      const escrow = await program.account.escrowAccount.fetch(escrowPda);
      expect(escrow.status).to.have.property("disputed");

      // Verify reason stored
      const storedReason = Buffer.from(escrow.disputeReason as number[])
        .toString("utf8")
        .replace(/\0+$/, "");
      expect(storedReason).to.equal(reason);
    });
  });

  describe("resolve_dispute", () => {
    it("arbiter resolves in favor of recipient (payment released)", async () => {
      const escrowId = randomEscrowId();
      const escrowAmount = 1 * LAMPORTS_PER_SOL;
      const amount = new anchor.BN(escrowAmount);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      // Create → Accept → Dispute
      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        .acceptTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      const reasonBytes = Buffer.alloc(64);
      reasonBytes.write("Dispute test");
      await program.methods
        .dispute(Array.from(reasonBytes))
        .accounts({ escrowAccount: escrowPda, disputer: creator.publicKey })
        .signers([creator])
        .rpc();

      const recipientBefore = await connection.getBalance(recipient.publicKey);
      const treasuryBefore = await connection.getBalance(treasury.publicKey);

      // Resolve: recipient wins
      await program.methods
        .resolveDispute({ recipient: {} })
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
      const treasuryAfter = await connection.getBalance(treasury.publicKey);

      const expectedFee = Math.floor(escrowAmount * feeBasisPoints / 10000);
      expect(recipientAfter - recipientBefore).to.equal(escrowAmount - expectedFee);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);

      // Account closed
      const accountInfo = await connection.getAccountInfo(escrowPda);
      expect(accountInfo).to.be.null;
    });

    it("arbiter resolves in favor of creator (full refund)", async () => {
      const escrowId = randomEscrowId();
      const escrowAmount = 1 * LAMPORTS_PER_SOL;
      const amount = new anchor.BN(escrowAmount);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      // Create → Accept → Dispute
      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        .acceptTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      const reasonBytes = Buffer.alloc(64);
      reasonBytes.write("Creator dispute");
      await program.methods
        .dispute(Array.from(reasonBytes))
        .accounts({ escrowAccount: escrowPda, disputer: recipient.publicKey })
        .signers([recipient])
        .rpc();

      const creatorBefore = await connection.getBalance(creator.publicKey);

      // Resolve: creator wins → full refund, no fee
      await program.methods
        .resolveDispute({ creator: {} })
        .accounts({
          escrowAccount: escrowPda,
          arbiter: arbiter.publicKey,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          feeRecipient: treasury.publicKey,
        })
        .signers([arbiter])
        .rpc();

      const creatorAfter = await connection.getBalance(creator.publicKey);

      // Creator gets full amount back + rent
      expect(creatorAfter - creatorBefore).to.be.greaterThan(escrowAmount - 10000);

      // Account closed
      const accountInfo = await connection.getAccountInfo(escrowPda);
      expect(accountInfo).to.be.null;
    });

    it("non-arbiter cannot resolve dispute", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        .acceptTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      const reasonBytes = Buffer.alloc(64);
      reasonBytes.write("Test");
      await program.methods
        .dispute(Array.from(reasonBytes))
        .accounts({ escrowAccount: escrowPda, disputer: creator.publicKey })
        .signers([creator])
        .rpc();

      // Creator tries to resolve (not arbiter)
      try {
        await program.methods
          .resolveDispute({ recipient: {} })
          .accounts({
            escrowAccount: escrowPda,
            arbiter: creator.publicKey, // wrong person
            creator: creator.publicKey,
            recipient: recipient.publicKey,
            feeRecipient: treasury.publicKey,
          })
          .signers([creator])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("UnauthorizedArbiter");
      }
    });
  });

  describe("full lifecycle", () => {
    it("create → accept → release (happy path)", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const terms = "Deliver the feature by EOD";
      const termsHash = Array.from(createHash("sha256").update(terms).digest());

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      // 1. Create
      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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

      let escrow = await program.account.escrowAccount.fetch(escrowPda);
      expect(escrow.status).to.have.property("created");

      // 2. Accept
      await program.methods
        .acceptTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      escrow = await program.account.escrowAccount.fetch(escrowPda);
      expect(escrow.status).to.have.property("active");

      // 3. Release
      await program.methods
        .releasePayment()
        .accounts({
          escrowAccount: escrowPda,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          feeRecipient: treasury.publicKey,
        })
        .signers([creator])
        .rpc();

      // Account closed after release
      const info = await connection.getAccountInfo(escrowPda);
      expect(info).to.be.null;
    });
  });

  describe("auto_release", () => {
    it("creates escrow with auto_release_at and stores it", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // +1h
      const autoReleaseAt = new anchor.BN(Math.floor(Date.now() / 1000) + 7200); // +2h (after deadline)
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, autoReleaseAt)
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

      const escrow = await program.account.escrowAccount.fetch(escrowPda) as any;
      expect(escrow.autoReleaseAt.toNumber()).to.equal(autoReleaseAt.toNumber());
    });

    it("fails auto-release when disabled (auto_release_at = 0)", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      // Create with auto_release_at = 0 (disabled)
      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
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
        .acceptTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      // Try auto-release — should fail
      try {
        await program.methods
          .autoRelease()
          .accounts({
            escrowAccount: escrowPda,
            caller: creator.publicKey,
            creator: creator.publicKey,
            recipient: recipient.publicKey,
            feeRecipient: treasury.publicKey,
          })
          .signers([creator])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("AutoReleaseNotEnabled");
      }
    });

    it("fails auto-release before timestamp", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // +1h
      const autoReleaseAt = new anchor.BN(Math.floor(Date.now() / 1000) + 7200); // +2h
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      await program.methods
        .createEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, autoReleaseAt)
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
        .acceptTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      // Try auto-release now — should fail (too early)
      try {
        await program.methods
          .autoRelease()
          .accounts({
            escrowAccount: escrowPda,
            caller: creator.publicKey,
            creator: creator.publicKey,
            recipient: recipient.publicKey,
            feeRecipient: treasury.publicKey,
          })
          .signers([creator])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("AutoReleaseNotReady");
      }
    });

    it("auto-release succeeds after timestamp (anyone can trigger)", async () => {
      const escrowId = randomEscrowId();
      const escrowAmount = 1 * LAMPORTS_PER_SOL;
      const amount = new anchor.BN(escrowAmount);
      const deadline = new anchor.BN(1); // already passed (unix epoch + 1s)
      const autoReleaseAt = new anchor.BN(2); // already passed
      const termsHash = Array(32).fill(0);

      // Use a past deadline workaround: set deadline to just after current time
      // Actually we need deadline > clock. Let's set both to just after "now"
      // but auto_release_at must be > deadline
      const now = Math.floor(Date.now() / 1000);
      const dl = new anchor.BN(now + 2);
      const ar = new anchor.BN(now + 3); // auto_release 1s after deadline

      const [escrowPda] = deriveEscrowPda(creator.publicKey, escrowId);

      await program.methods
        .createEscrow(escrowId, amount, dl, termsHash, feeBasisPoints, ar)
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

      // Accept immediately (before deadline)
      await program.methods
        .acceptTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      // Wait for auto-release timestamp to pass
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const recipientBefore = await connection.getBalance(recipient.publicKey);
      const treasuryBefore = await connection.getBalance(treasury.publicKey);

      // A random third party triggers auto-release
      const thirdParty = Keypair.generate();
      await airdrop(connection, thirdParty.publicKey, 1);

      await program.methods
        .autoRelease()
        .accounts({
          escrowAccount: escrowPda,
          caller: thirdParty.publicKey,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          feeRecipient: treasury.publicKey,
        })
        .signers([thirdParty])
        .rpc();

      const recipientAfter = await connection.getBalance(recipient.publicKey);
      const treasuryAfter = await connection.getBalance(treasury.publicKey);

      const expectedFee = Math.floor(escrowAmount * feeBasisPoints / 10000);
      expect(recipientAfter - recipientBefore).to.equal(escrowAmount - expectedFee);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);

      // Account closed
      const accountInfo = await connection.getAccountInfo(escrowPda);
      expect(accountInfo).to.be.null;
    });
  });
});
