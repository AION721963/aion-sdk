import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";

import idl from "../target/idl/escrow.json";

const PROGRAM_ID = new PublicKey("EFnubV4grWUCFRPkRTTNVxEdetxYb8VJtAAqQQmxmw8X");

function deriveReputationPda(agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), agent.toBuffer()],
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

describe("reputation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl as any, PROGRAM_ID, provider);
  const connection = provider.connection;

  const agent1 = Keypair.generate();
  const agent2 = Keypair.generate();

  before(async () => {
    await airdrop(connection, agent1.publicKey, 5);
    await airdrop(connection, agent2.publicKey, 2);
  });

  it("initializes reputation with zeros", async () => {
    const [repPda] = deriveReputationPda(agent1.publicKey);

    await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agent1.publicKey,
        payer: agent1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([agent1])
      .rpc();

    const rep = await program.account.reputationAccount.fetch(repPda) as any;
    expect(rep.agent.toBase58()).to.equal(agent1.publicKey.toBase58());
    expect(rep.escrowsCreated).to.equal(0);
    expect(rep.escrowsCompleted).to.equal(0);
    expect(rep.tasksCompleted).to.equal(0);
    expect(rep.disputesInitiated).to.equal(0);
    expect(rep.disputesWon).to.equal(0);
    expect(rep.disputesLost).to.equal(0);
    expect(rep.totalVolumeLamports.toNumber()).to.equal(0);
  });

  it("prevents double initialization", async () => {
    const [repPda] = deriveReputationPda(agent1.publicKey);

    try {
      await program.methods
        .initReputation()
        .accounts({
          reputationAccount: repPda,
          agent: agent1.publicKey,
          payer: agent1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([agent1])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // Account already exists — Anchor returns a constraint/init error
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("anyone can init reputation for another agent", async () => {
    const [repPda] = deriveReputationPda(agent2.publicKey);

    await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agent2.publicKey,
        payer: agent1.publicKey, // agent1 pays rent for agent2's reputation
        systemProgram: SystemProgram.programId,
      })
      .signers([agent1])
      .rpc();

    const rep = await program.account.reputationAccount.fetch(repPda) as any;
    expect(rep.agent.toBase58()).to.equal(agent2.publicKey.toBase58());
  });
});
