// Cash flow builders: shield, transfer (internal + X1 inter-Ring), unshield.
// Each = select inputs → build outputs → sign → prove (queued) → relay → projection updates
// arrive via the sync engine like any other chain event.
import { readFileSync } from "fs";
import { encodeFunctionData, erc20Abi, parseAbi } from "viem";
import {
  CircuitId,
  NOTE_REGISTRY_ABI,
  TemplateId,
  addressToField,
  commitment,
  derivePartyKeys,
  encryptNoteFor,
  fieldToHex,
  hexToField,
  newNote,
  nullifier,
  prove,
  signField,
  transitionMessage,
  type Field,
  type Note,
  type PartyKeys,
} from "@aragorn/protocol";
import type { RingConfig } from "./config.ts";
import type { ChainSync } from "./chain.ts";
import type { EnsDirectory } from "./ens.ts";
import { releaseNotes, selectCash, type SelectedNote } from "./notes.ts";
import type { Sql } from "./db.ts";

const CIRCUITS_DIR = process.env.CIRCUITS_DIR ?? "circuits";
const artifacts = new Map<string, any>();
function artifact(name: string) {
  if (!artifacts.has(name))
    artifacts.set(name, JSON.parse(readFileSync(`${CIRCUITS_DIR}/${name}/target/${name}.json`, "utf8")));
  return artifacts.get(name);
}

// prover queue: concurrency 1 (BUILD_SPEC §6.3)
let proverChain: Promise<unknown> = Promise.resolve();
function enqueueProof<T>(fn: () => Promise<T>): Promise<T> {
  const next = proverChain.then(fn, fn);
  proverChain = next.catch(() => {});
  return next;
}

export class Flows {
  private parties: Record<string, PartyKeys> = {};

  constructor(
    private cfg: RingConfig,
    private sql: Sql,
    private chain: ChainSync,
    private orgEncPub: Uint8Array,
    private ens?: EnsDirectory,
  ) {
    for (const [label, priv] of Object.entries(cfg.partyKeys)) {
      this.parties[label] = derivePartyKeys(priv);
    }
  }

  party(label: string): PartyKeys {
    const p = this.parties[label];
    if (!p) throw new Error(`unknown party ${this.cfg.orgName}::${label}`);
    return p;
  }

  get partyXToLabel(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.parties).map(([label, k]) => [fieldToHex(k.x), label]),
    );
  }

  /** Resolve a recipient: "party" / "ORG::party" (internal/static directory) or an ENS
   *  name like "drw.aragorn-rings.eth" (whitelist-gated; party = the org's partyroot). */
  async resolveRecipient(spec: string): Promise<{ x: Field; encPub: Uint8Array; internal: boolean }> {
    const [orgPart, party] = spec.includes("::") ? spec.split("::") : [spec, undefined];
    if (orgPart.endsWith(".eth")) {
      if (!this.ens) throw new Error("ENS directory not configured");
      const resolved = await this.ens.lookupWhitelisted(orgPart);
      return {
        x: hexToField(resolved.partyRoot),
        encPub: Buffer.from(resolved.encPubkey.replace("0x", ""), "hex"),
        internal: false,
      };
    }
    const org = party === undefined ? this.cfg.orgName : orgPart;
    const label = party ?? orgPart;
    if (org === this.cfg.orgName) {
      return { x: this.party(label).x, encPub: this.orgEncPub, internal: true };
    }
    const entry = this.cfg.directory[org];
    if (!entry) throw new Error(`unknown counterparty org ${org} (not in directory)`);
    const partyX = entry.parties[label];
    if (!partyX) throw new Error(`unknown party ${spec}`);
    return {
      x: hexToField(partyX),
      encPub: Buffer.from(entry.encPubkey.replace("0x", ""), "hex"),
      internal: false,
    };
  }

  async settleRaw(
    circuitId: number,
    bundle: { proof: Uint8Array; publicInputs: string[] },
    ciphertexts: Uint8Array[],
  ): Promise<string> {
    const calldata = encodeFunctionData({
      abi: NOTE_REGISTRY_ABI,
      functionName: "settle",
      args: [
        circuitId,
        `0x${Buffer.from(bundle.proof).toString("hex")}` as `0x${string}`,
        bundle.publicInputs as `0x${string}`[],
        ciphertexts.map((u) => `0x${Buffer.from(u).toString("hex")}` as `0x${string}`),
      ],
    });
    const { txid } = await this.chain.relay(this.cfg.registryAddr, calldata);
    return txid;
  }

  /** I2: funding EOA USDC → private Cash note for a party. */
  async shield(partyLabel: string, amount: bigint): Promise<{ txid: string; cid: string }> {
    const owner = this.party(partyLabel);
    const note = newNote(TemplateId.Cash, { owner_x: owner.x, amount, salt2: 0n }, [owner.x]);
    const c = commitment(note);

    // public-plane approval from the funding EOA (its own gas — it's public anyway)
    const approveTx = await this.chain.fundingWallet.sendTransaction({
      to: this.cfg.usdcAddr,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [this.cfg.vaultAddr, amount],
      }),
      chain: this.chain.fundingWallet.chain,
      account: this.chain.fundingWallet.account!,
    });
    await this.chain.pub.waitForTransactionReceipt({ hash: approveTx });

    const root = this.chain.tree.root;
    const bundle = await enqueueProof(() =>
      prove("cash_shield", artifact("cash_shield"), {
        root: fieldToHex(root),
        t_bound: "0",
        nullifiers: ["0", "0", "0", "0"],
        commitments: [fieldToHex(c), "0", "0", "0"],
        aux: [fieldToHex(amount), fieldToHex(addressToField(this.chain.fundingAddress)), "0", "0"],
        owner_x: fieldToHex(owner.x),
        amount: amount.toString(),
        salt: fieldToHex(note.salt),
        salt2: fieldToHex(note.fields.salt2),
      }),
    );
    const txid = await this.settleRaw(CircuitId.cash_shield, bundle, encryptNoteFor([this.orgEncPub], note));
    return { txid, cid: fieldToHex(c) };
  }

  /** I3/X1: Cash transfer — same machinery whether the recipient is a desk or another Ring. */
  async transfer(
    fromParty: string,
    toSpec: string,
    amount: bigint,
  ): Promise<{ txid: string; cid: string }> {
    const owner = this.party(fromParty);
    const recipient = await this.resolveRecipient(toSpec);
    const inputs = await selectCash(this.sql, fromParty, amount);
    try {
      return await this.transferInner(owner, recipient, inputs, amount);
    } catch (e) {
      await releaseNotes(this.sql, inputs.map((n) => n.cid));
      throw e;
    }
  }

  private async transferInner(
    owner: PartyKeys,
    recipient: { x: Field; encPub: Uint8Array },
    inputs: SelectedNote[],
    amount: bigint,
  ): Promise<{ txid: string; cid: string }> {
    const inSum = inputs.reduce((s, n) => s + n.amount, 0n);
    const change = inSum - amount;

    const outNote = newNote(TemplateId.Cash, { owner_x: recipient.x, amount, salt2: 0n }, [recipient.x]);
    const changeNote = newNote(TemplateId.Cash, { owner_x: owner.x, amount: change, salt2: 0n }, [owner.x]);
    const c1 = commitment(outNote);
    const c2 = commitment(changeNote);

    const in1 = inputs[0];
    const in2 = inputs.length > 1 ? inputs[1] : undefined;
    const n1 = nullifier(hexToField(in1.cid), in1.noteSecret);
    const n2 = in2 ? nullifier(hexToField(in2.cid), in2.noteSecret) : 0n;

    const root = this.chain.tree.root;
    const sig = signField(owner, transitionMessage(root, [n1, n2], [c1, c2]));
    const zeroPath = Array(32).fill("0");

    const bundle = await enqueueProof(() =>
      prove("cash_transfer", artifact("cash_transfer"), {
        root: fieldToHex(root),
        t_bound: "0",
        nullifiers: [fieldToHex(n1), in2 ? fieldToHex(n2) : "0", "0", "0"],
        commitments: [fieldToHex(c1), fieldToHex(c2), "0", "0"],
        aux: ["0", "0", "0", "0"],
        in1_amount: in1.amount.toString(),
        in1_salt: fieldToHex(in1.salt),
        in1_salt2: in1.fields.salt2,
        in1_secret: fieldToHex(in1.noteSecret),
        in1_index: in1.leafIndex,
        in1_path: this.chain.tree.path(in1.leafIndex).map(fieldToHex),
        in2_real: !!in2,
        in2_amount: in2 ? in2.amount.toString() : "0",
        in2_salt: in2 ? fieldToHex(in2.salt) : "0",
        in2_salt2: in2 ? in2.fields.salt2 : "0",
        in2_secret: in2 ? fieldToHex(in2.noteSecret) : "0",
        in2_index: in2 ? in2.leafIndex : 0,
        in2_path: in2 ? this.chain.tree.path(in2.leafIndex).map(fieldToHex) : zeroPath,
        owner_x: fieldToHex(owner.x),
        owner_y: fieldToHex(owner.y),
        sig: {
          s_lo: fieldToHex(sig.sLo),
          s_hi: fieldToHex(sig.sHi),
          e_lo: fieldToHex(sig.eLo),
          e_hi: fieldToHex(sig.eHi),
        },
        recipient_x: fieldToHex(recipient.x),
        out1_amount: amount.toString(),
        out1_salt: fieldToHex(outNote.salt),
        out1_salt2: fieldToHex(outNote.fields.salt2),
        change_amount: change.toString(),
        change_salt: fieldToHex(changeNote.salt),
        change_salt2: fieldToHex(changeNote.fields.salt2),
      }),
    );

    const cts = [
      ...encryptNoteFor([recipient.encPub], outNote),
      ...encryptNoteFor([this.orgEncPub], changeNote),
    ];
    const txid = await this.settleRaw(CircuitId.cash_transfer, bundle, cts);
    return { txid, cid: fieldToHex(c1) };
  }

  /** B3: Cash note → public USDC to a recipient address. Single-input circuit. */
  async unshield(
    partyLabel: string,
    amount: bigint,
    recipientAddr: `0x${string}`,
  ): Promise<{ txid: string }> {
    const owner = this.party(partyLabel);
    const inputs = await selectCash(this.sql, partyLabel, amount);
    if (inputs.length > 1) {
      await releaseNotes(this.sql, inputs.map((n) => n.cid));
      throw new Error("FRAGMENTED: unshield needs a single covering note; consolidate first");
    }
    const in1 = inputs[0];
    try {
      const change = in1.amount - amount;
      const changeNote = newNote(TemplateId.Cash, { owner_x: owner.x, amount: change, salt2: 0n }, [owner.x]);
      const c1 = commitment(changeNote);
      const n1 = nullifier(hexToField(in1.cid), in1.noteSecret);
      const root = this.chain.tree.root;
      const sig = signField(owner, transitionMessage(root, [n1], [c1]));

      const bundle = await enqueueProof(() =>
        prove("cash_unshield", artifact("cash_unshield"), {
          root: fieldToHex(root),
          t_bound: "0",
          nullifiers: [fieldToHex(n1), "0", "0", "0"],
          commitments: [fieldToHex(c1), "0", "0", "0"],
          aux: [fieldToHex(amount), fieldToHex(addressToField(recipientAddr)), "0", "0"],
          in1_amount: in1.amount.toString(),
          in1_salt: fieldToHex(in1.salt),
          in1_salt2: in1.fields.salt2,
          in1_secret: fieldToHex(in1.noteSecret),
          in1_index: in1.leafIndex,
          in1_path: this.chain.tree.path(in1.leafIndex).map(fieldToHex),
          owner_x: fieldToHex(owner.x),
          owner_y: fieldToHex(owner.y),
          sig: {
            s_lo: fieldToHex(sig.sLo),
            s_hi: fieldToHex(sig.sHi),
            e_lo: fieldToHex(sig.eLo),
            e_hi: fieldToHex(sig.eHi),
          },
          unshield_amount: amount.toString(),
          change_amount: change.toString(),
          change_salt: fieldToHex(changeNote.salt),
          change_salt2: fieldToHex(changeNote.fields.salt2),
        }),
      );
      const txid = await this.settleRaw(
        CircuitId.cash_unshield,
        bundle,
        encryptNoteFor([this.orgEncPub], changeNote),
      );
      return { txid };
    } catch (e) {
      await releaseNotes(this.sql, [in1.cid]);
      throw e;
    }
  }
}
