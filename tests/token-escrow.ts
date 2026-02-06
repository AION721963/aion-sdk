import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { createHash } from "crypto";

import idl from "../target/idl/escrow.json";

const PROGRAM_ID = new PublicKey("EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X");

function deriveTokenEscrowPda(
  creator: PublicKey,
  escrowId: anchor.BN,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(escrowId.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_escrow"), creator.toBuffer(), idBuffer],
    programId
  );
}

function deriveVaultPda(
  escrowPda: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), escrowPda.toBuffer()],
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

describe("token-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as any, PROGRAM_ID, provider);
  const connection = provider.connection;

  // Actors
  const creator = Keypair.generate();
  const recipient = Keypair.generate();
  const arbiter = Keypair.generate();
  const treasury = Keypair.generate();

  // Token vars
  let mint: PublicKey;
  let creatorAta: PublicKey;
  let recipientAta: PublicKey;
  let treasuryAta: PublicKey;

  const feeBasisPoints = 150; // 1.5%
  const tokenAmount = 1_000_000; // 1 token with 6 decimals

  before(async () => {
    // Fund actors
    await airdrop(connection, creator.publicKey, 10);
    await airdrop(connection, recipient.publicKey, 2);
    await airdrop(connection, arbiter.publicKey, 1);
    await airdrop(connection, treasury.publicKey, 1);

    // Create mint (creator is mint authority)
    mint = await createMint(
      connection,
      creator,
      creator.publicKey,
      null,
      6 // 6 decimals
    );

    // Create ATAs
    creatorAta = await createAccount(connection, creator, mint, creator.publicKey);
    recipientAta = await createAccount(connection, recipient, mint, recipient.publicKey);
    treasuryAta = await createAccount(connection, treasury, mint, treasury.publicKey);

    // Mint tokens to creator
    await mintTo(connection, creator, mint, creatorAta, creator, 10_000_000);
  });

  describe("create_token_escrow", () => {
    it("creates a token escrow with valid parameters", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(tokenAmount);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array.from(createHash("sha256").update("Token escrow test").digest());

      const [escrowPda] = deriveTokenEscrowPda(creator.publicKey, escrowId);
      const [vaultPda] = deriveVaultPda(escrowPda);

      await program.methods
        .createTokenEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          arbiter: arbiter.publicKey,
          feeRecipient: treasury.publicKey,
          mint: mint,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([creator])
        .rpc();

      const escrow = await program.account.tokenEscrowAccount.fetch(escrowPda) as any;
      expect(escrow.creator.toBase58()).to.equal(creator.publicKey.toBase58());
      expect(escrow.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
      expect(escrow.mint.toBase58()).to.equal(mint.toBase58());
      expect(escrow.amount.toNumber()).to.equal(tokenAmount);
      expect(escrow.status).to.have.property("created");

      // Verify tokens in vault
      const vaultAccount = await getAccount(connection, vaultPda);
      expect(Number(vaultAccount.amount)).to.equal(tokenAmount);
    });
  });

  describe("full token lifecycle", () => {
    it("create → accept → release with fee split", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(tokenAmount);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveTokenEscrowPda(creator.publicKey, escrowId);
      const [vaultPda] = deriveVaultPda(escrowPda);

      // Create
      await program.methods
        .createTokenEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          arbiter: arbiter.publicKey,
          feeRecipient: treasury.publicKey,
          mint: mint,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([creator])
        .rpc();

      // Accept
      await program.methods
        .acceptTokenTask()
        .accounts({
          escrowAccount: escrowPda,
          recipient: recipient.publicKey,
        })
        .signers([recipient])
        .rpc();

      const afterAccept = await program.account.tokenEscrowAccount.fetch(escrowPda) as any;
      expect(afterAccept.status).to.have.property("active");

      // Record balances before release
      const recipientBefore = Number((await getAccount(connection, recipientAta)).amount);
      const treasuryBefore = Number((await getAccount(connection, treasuryAta)).amount);

      // Release
      await program.methods
        .releaseTokenPayment()
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          recipientTokenAccount: recipientAta,
          feeTokenAccount: treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      const recipientAfter = Number((await getAccount(connection, recipientAta)).amount);
      const treasuryAfter = Number((await getAccount(connection, treasuryAta)).amount);

      // Fee = 1_000_000 * 150 / 10000 = 15_000
      const expectedFee = Math.floor(tokenAmount * feeBasisPoints / 10000);
      expect(recipientAfter - recipientBefore).to.equal(tokenAmount - expectedFee);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);

      // Escrow PDA closed
      const info = await connection.getAccountInfo(escrowPda);
      expect(info).to.be.null;
    });
  });

  describe("refund_token_escrow", () => {
    it("creator can cancel token escrow before acceptance", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(tokenAmount);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveTokenEscrowPda(creator.publicKey, escrowId);
      const [vaultPda] = deriveVaultPda(escrowPda);

      const creatorBefore = Number((await getAccount(connection, creatorAta)).amount);

      // Create
      await program.methods
        .createTokenEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          arbiter: arbiter.publicKey,
          feeRecipient: treasury.publicKey,
          mint: mint,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([creator])
        .rpc();

      // Refund (cancel)
      await program.methods
        .refundTokenEscrow()
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      // Tokens returned
      const creatorAfter = Number((await getAccount(connection, creatorAta)).amount);
      expect(creatorAfter).to.equal(creatorBefore);

      // PDA closed
      const info = await connection.getAccountInfo(escrowPda);
      expect(info).to.be.null;
    });
  });

  describe("dispute_token + resolve_token_dispute", () => {
    it("dispute and resolve in favor of recipient", async () => {
      const escrowId = randomEscrowId();
      const amount = new anchor.BN(tokenAmount);
      const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const termsHash = Array(32).fill(0);

      const [escrowPda] = deriveTokenEscrowPda(creator.publicKey, escrowId);
      const [vaultPda] = deriveVaultPda(escrowPda);

      // Create → Accept → Dispute
      await program.methods
        .createTokenEscrow(escrowId, amount, deadline, termsHash, feeBasisPoints, new anchor.BN(0))
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          arbiter: arbiter.publicKey,
          feeRecipient: treasury.publicKey,
          mint: mint,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([creator])
        .rpc();

      await program.methods
        .acceptTokenTask()
        .accounts({ escrowAccount: escrowPda, recipient: recipient.publicKey })
        .signers([recipient])
        .rpc();

      const reasonBytes = Buffer.alloc(64);
      reasonBytes.write("Token dispute test");
      await program.methods
        .disputeToken(Array.from(reasonBytes))
        .accounts({ escrowAccount: escrowPda, disputer: creator.publicKey })
        .signers([creator])
        .rpc();

      const recipientBefore = Number((await getAccount(connection, recipientAta)).amount);
      const treasuryBefore = Number((await getAccount(connection, treasuryAta)).amount);

      // Resolve: recipient wins
      await program.methods
        .resolveTokenDispute({ recipient: {} })
        .accounts({
          escrowAccount: escrowPda,
          vault: vaultPda,
          arbiter: arbiter.publicKey,
          creator: creator.publicKey,
          recipient: recipient.publicKey,
          creatorTokenAccount: creatorAta,
          recipientTokenAccount: recipientAta,
          feeTokenAccount: treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([arbiter])
        .rpc();

      const recipientAfter = Number((await getAccount(connection, recipientAta)).amount);
      const treasuryAfter = Number((await getAccount(connection, treasuryAta)).amount);

      const expectedFee = Math.floor(tokenAmount * feeBasisPoints / 10000);
      expect(recipientAfter - recipientBefore).to.equal(tokenAmount - expectedFee);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);

      // PDA closed
      const info = await connection.getAccountInfo(escrowPda);
      expect(info).to.be.null;
    });
  });
});
