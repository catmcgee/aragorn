// Sync engine (BUILD_SPEC §6.3): tail Settled/LeafInserted events, view-tag scan, decrypt,
// upsert projection. The in-memory tree mirrors the on-chain incremental tree exactly.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";
import {
  MerkleTree,
  commitment,
  fieldToHex,
  hexToField,
  nullifier,
  plaintextToNote,
  tryDecryptNote,
  type Field,
  type OrgEncKeys,
} from "@aragorn/protocol";
import type { RingConfig } from "./config.ts";
import type { Sql } from "./db.ts";

// Settlement chain: local anvil by default, Sepolia when CHAIN=sepolia (so signed txs
// carry the right chainId).
const CHAIN = process.env.CHAIN === "sepolia" ? sepolia : foundry;

const LEAF_EVENT = parseAbiItem(
  "event LeafInserted(uint32 indexed index, bytes32 commitment, bytes32 newRoot)",
);
const SETTLED_EVENT = parseAbiItem(
  "event Settled(uint32 indexed circuitId, bytes32[] nullifiers, bytes32[] commitments, bytes[] ciphertexts, uint256 timeBound, address txOrigin)",
);

export type RingEvent = {
  type: string;
  [k: string]: unknown;
};

export class ChainSync {
  tree = new MerkleTree();
  readonly pub: PublicClient;
  readonly fundingWallet: WalletClient;
  readonly fundingAddress: `0x${string}`;
  private listeners = new Set<(e: RingEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private syncing = false;

  constructor(
    private cfg: RingConfig,
    private sql: Sql,
    private encKeys: OrgEncKeys,
    /** party pubkey x (hex, lowercase) → party label, for owner attribution */
    private partyXToLabel: Record<string, string>,
  ) {
    this.pub = createPublicClient({ chain: CHAIN, transport: http(cfg.rpcUrl) });
    const account = privateKeyToAccount(cfg.fundingEoaKey);
    this.fundingAddress = account.address;
    this.fundingWallet = createWalletClient({ account, chain: CHAIN, transport: http(cfg.rpcUrl) });
  }

  on(fn: (e: RingEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: RingEvent) {
    for (const fn of this.listeners) fn(e);
  }

  /** For non-chain events that belong on the same SSE stream (approvals, workflows). */
  emitExternal(e: RingEvent): void {
    this.emit(e);
  }

  /** Rebuild the in-memory tree from the projection, then start tailing. */
  async start(): Promise<void> {
    // On a public testnet, start scanning at the contract's deploy block (not 0) so the
    // first getLogs sweep is bounded. Only applies to a fresh cursor.
    const start = process.env.SYNC_START_BLOCK ? Number(process.env.SYNC_START_BLOCK) : 0;
    if (start > 0) {
      await this.sql`UPDATE sync_cursor SET last_block = ${start - 1} WHERE id = 1 AND last_block = 0`;
    }
    const leaves = await this.sql`SELECT idx, commitment FROM leaves ORDER BY idx`;
    for (const l of leaves) this.tree.insert(hexToField(l.commitment));
    await this.syncOnce();
    this.timer = setInterval(() => void this.syncOnce().catch(console.error), 1200);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** `ring resync --from-zero`: drop the disposable cache and replay the chain. */
  async resync(wipe: () => Promise<void>): Promise<void> {
    this.stop();
    await wipe();
    this.tree = new MerkleTree();
    await this.start();
  }

  async syncOnce(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const [{ last_block }] = await this.sql`SELECT last_block FROM sync_cursor WHERE id = 1`;
      const tip = await this.pub.getBlockNumber();
      let fromBlock = BigInt(last_block) + 1n;
      if (tip < fromBlock) return;

      // Chunk the scan: public testnet RPCs (e.g. Alchemy free tier) cap eth_getLogs at a
      // small block range. SYNC_LOG_RANGE bounds each request; local anvil sets it huge.
      const RANGE = BigInt(process.env.SYNC_LOG_RANGE ?? 50_000);
      while (fromBlock <= tip) {
        const toBlock = fromBlock + RANGE - 1n < tip ? fromBlock + RANGE - 1n : tip;
        const [leafLogs, settledLogs] = await Promise.all([
          this.pub.getLogs({ address: this.cfg.registryAddr, event: LEAF_EVENT, fromBlock, toBlock }),
          this.pub.getLogs({ address: this.cfg.registryAddr, event: SETTLED_EVENT, fromBlock, toBlock }),
        ]);

        for (const log of leafLogs) {
          const idx = this.tree.insert(hexToField(log.args.commitment!));
          await this.sql`INSERT INTO leaves (idx, commitment) VALUES (${idx}, ${log.args.commitment!}) ON CONFLICT DO NOTHING`;
        }
        for (const log of settledLogs) {
          await this.handleSettled(log.args, log.transactionHash!, log.blockNumber!);
        }
        // persist progress per chunk so a mid-scan failure resumes cleanly
        await this.sql`UPDATE sync_cursor SET last_block = ${Number(toBlock)} WHERE id = 1`;
        fromBlock = toBlock + 1n;
      }
    } finally {
      this.syncing = false;
    }
  }

  private async handleSettled(
    args: {
      circuitId?: number;
      nullifiers?: readonly `0x${string}`[];
      commitments?: readonly `0x${string}`[];
      ciphertexts?: readonly `0x${string}`[];
    },
    txHash: string,
    blockNum: bigint,
  ): Promise<void> {
    // consumed notes: any of ours whose expected nullifier was published
    for (const n of args.nullifiers ?? []) {
      const updated = await this.sql`
        UPDATE notes SET status = 'consumed', consumed_tx = ${txHash}
        WHERE expected_nullifier = ${n} AND status <> 'consumed'
        RETURNING cid, owner_party`;
      for (const row of updated) {
        this.emit({ type: "note_consumed", cid: row.cid, ownerParty: row.owner_party, txid: txHash });
      }
    }

    // created notes: view-tag scan + decrypt every ciphertext
    for (const ct of args.ciphertexts ?? []) {
      const plain = tryDecryptNote(this.encKeys, Buffer.from(ct.slice(2), "hex"));
      if (!plain) continue; // not for us — the whole privacy model in one line
      const note = plaintextToNote(plain);
      const c = commitment(note);
      const cidHex = fieldToHex(c);
      if (!(args.commitments ?? []).includes(cidHex)) {
        console.warn(`[sync] decrypted payload does not match any commitment in tx ${txHash}`);
        continue;
      }
      const expectedNullifier = fieldToHex(nullifier(c, note.noteSecret));
      const ownerX = note.fields.owner_x !== undefined ? fieldToHex(note.fields.owner_x) : undefined;
      const ownerParty = ownerX ? (this.partyXToLabel[ownerX] ?? null) : null;
      const [leaf] = await this.sql`SELECT idx FROM leaves WHERE commitment = ${cidHex}`;
      const amountMicro =
        note.fields.amount !== undefined ? note.fields.amount.toString() : null;
      await this.sql`
        INSERT INTO notes (cid, template_id, payload, salt, note_secret, stakeholders,
                           expected_nullifier, amount_micro, status, owner_party, leaf_index, created_tx, block_num)
        VALUES (${cidHex}, ${note.templateId}, ${this.sql.json(plain.fields as any)},
                ${plain.salt}, ${plain.note_secret}, ${plain.stakeholders as any},
                ${expectedNullifier}, ${amountMicro}, 'active', ${ownerParty}, ${leaf?.idx ?? null}, ${txHash}, ${Number(blockNum)})
        ON CONFLICT (cid) DO NOTHING`;
      this.emit({
        type: "note_created",
        cid: cidHex,
        templateId: note.templateId,
        ownerParty,
        txid: txHash,
      });
    }

    this.emit({
      type: "settlement_status",
      txid: txHash,
      circuitId: args.circuitId,
      status: "committed",
    });
  }

  /** Submit settle calldata through the coordinator relayer (gas-paid, identity-blinded). */
  async relay(to: `0x${string}`, calldata: `0x${string}`): Promise<{ txid: string }> {
    const res = await fetch(`${this.cfg.relayerUrl}/relay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.relayerToken}`,
      },
      body: JSON.stringify({ to, calldata }),
    });
    const body = (await res.json()) as { txid?: string; status?: string; error?: string };
    if (!res.ok || body.status !== "success") {
      throw new Error(`relay failed: ${body.error ?? body.status}`);
    }
    // pull events immediately so the API reflects the settlement without waiting for the poll
    await this.syncOnce();
    return { txid: body.txid! };
  }
}
