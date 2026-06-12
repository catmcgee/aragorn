// Payroll (I6): treasury fan-out -> per-employee Entitlements -> private claims.
// Sub-Ring privacy: colleagues cannot see each other's pay (each entitlement is its own
// note; the claim consumes it against a secret only that employee holds).
import { readFileSync } from "fs";
import {
  CircuitId,
  TemplateId,
  commitment,
  derivePartyKeys,
  encryptNoteFor,
  fieldToHex,
  hexToField,
  newNote,
  nullifier,
  poseidon2,
  prove,
  randomField,
  signField,
  stringHash,
  transitionMessage,
  type Note,
} from "@aragorn/protocol";
import type { Sql } from "./db.ts";
import type { ChainSync } from "./chain.ts";
import type { Flows } from "./flows.ts";
import { releaseNotes, selectCash } from "./notes.ts";

const CIRCUITS_DIR = process.env.CIRCUITS_DIR ?? "circuits";
const artifact = (name: string) =>
  JSON.parse(readFileSync(`${CIRCUITS_DIR}/${name}/target/${name}.json`, "utf8"));

export class Payroll {
  constructor(
    private sql: Sql,
    private chain: ChainSync,
    private flows: Flows,
    private orgEncPub: Uint8Array,
  ) {}

  /** Run payroll: one fan-out settle per ≤3 employees. */
  async run(
    payerParty: string,
    payments: { employeeId: number; amountMicro: bigint }[],
    requestedBy: string,
  ): Promise<{ txids: string[]; workflowId: number }> {
    if (payments.length === 0 || payments.length > 3)
      throw new Error("payroll: 1..3 payments per run (PoC fan-out arity)");

    const payer = this.flows.party(payerParty);
    const total = payments.reduce((s, p) => s + p.amountMicro, 0n);
    const inputs = await selectCash(this.sql, payerParty, total);
    if (inputs.length > 1) {
      await releaseNotes(this.sql, inputs.map((n) => n.cid));
      throw new Error("payroll: needs a single covering funding note; consolidate first");
    }
    const funding = inputs[0];

    const [wf] = await this.sql`
      INSERT INTO workflows (kind, state, status, created_by)
      VALUES ('payroll', ${this.sql.json({ payments: payments.map((p) => ({ ...p, amountMicro: p.amountMicro.toString() })) } as any)}, 'running', ${requestedBy})
      RETURNING id`;

    try {
      // entitlement notes + claim secrets
      const memoHash = stringHash(`payroll:${new Date().toISOString().slice(0, 10)}`);
      const items = payments.map((p) => {
        const claimSecret = randomField();
        const claimHash = poseidon2([claimSecret]);
        const note = newNote(
          TemplateId.Entitlement,
          { claim_hash: claimHash, amount: p.amountMicro, payer_x: payer.x, memo_hash: memoHash },
          [payer.x],
        );
        return { ...p, claimSecret, claimHash, note, c: commitment(note) };
      });

      const change = funding.amount - total;
      const changeNote = newNote(TemplateId.Cash, { owner_x: payer.x, amount: change, salt2: 0n }, [payer.x]);
      const cChange = commitment(changeNote);

      const n1 = nullifier(hexToField(funding.cid), funding.noteSecret);
      const root = this.chain.tree.root;
      const cSlots = [items[0]?.c ?? 0n, items[1]?.c ?? 0n, items[2]?.c ?? 0n, cChange];
      const sig = signField(payer, poseidon2([root, n1, ...cSlots]));

      const pad3 = <T>(xs: T[], fill: T): T[] => [...xs, fill, fill, fill].slice(0, 3);
      const bundle = await prove("cash_fanout", artifact("cash_fanout"), {
        root: fieldToHex(root),
        t_bound: "0",
        nullifiers: [fieldToHex(n1), "0", "0", "0"],
        commitments: cSlots.map((c) => (c === 0n ? "0" : fieldToHex(c))),
        aux: ["0", "0", "0", "0"],
        in1_amount: funding.amount.toString(),
        in1_salt: fieldToHex(funding.salt),
        in1_salt2: funding.fields.salt2,
        in1_secret: fieldToHex(funding.noteSecret),
        in1_index: funding.leafIndex,
        in1_path: this.chain.tree.path(funding.leafIndex).map(fieldToHex),
        payer_x: fieldToHex(payer.x),
        payer_y: fieldToHex(payer.y),
        sig: {
          s_lo: fieldToHex(sig.sLo),
          s_hi: fieldToHex(sig.sHi),
          e_lo: fieldToHex(sig.eLo),
          e_hi: fieldToHex(sig.eHi),
        },
        ent_real: pad3(items.map(() => true), false),
        ent_claim_hash: pad3(items.map((i) => fieldToHex(i.claimHash)), "0"),
        ent_amount: pad3(items.map((i) => i.amountMicro.toString()), "0"),
        ent_memo_hash: pad3(items.map(() => fieldToHex(memoHash)), "0"),
        ent_salt: pad3(items.map((i) => fieldToHex(i.note.salt)), "0"),
        change_amount: change.toString(),
        change_salt: fieldToHex(changeNote.salt),
        change_salt2: fieldToHex(changeNote.fields.salt2),
      });

      const cts = [
        ...items.flatMap((i) => encryptNoteFor([this.orgEncPub], i.note)),
        ...encryptNoteFor([this.orgEncPub], changeNote),
      ];
      const txid = await this.flows.settleRaw(CircuitId.cash_fanout, bundle, cts);

      for (const item of items) {
        await this.sql`
          INSERT INTO payroll_items (workflow_id, employee_id, amount_micro, claim_hash, claim_secret, entitlement_cid, status)
          VALUES (${wf.id}, ${item.employeeId}, ${item.amountMicro.toString()}, ${fieldToHex(item.claimHash)},
                  ${fieldToHex(item.claimSecret)}, ${fieldToHex(item.c)}, 'claimable')`;
      }
      await this.sql`UPDATE workflows SET status = 'executed', state = state || ${this.sql.json({ txid } as any)} WHERE id = ${wf.id}`;
      return { txids: [txid], workflowId: wf.id };
    } catch (e) {
      await this.sql`UPDATE workflows SET status = 'failed' WHERE id = ${wf.id}`;
      await releaseNotes(this.sql, [funding.cid]);
      throw e;
    }
  }

  /** Everything an employee's device needs to prove the claim locally (witness inputs). */
  async claimData(employeeId: number): Promise<Record<string, unknown>> {
    const [item] = await this.sql`
      SELECT p.*, e.subname_label FROM payroll_items p JOIN employees e ON e.id = p.employee_id
      WHERE p.employee_id = ${employeeId} AND p.status = 'claimable' ORDER BY p.id DESC LIMIT 1`;
    if (!item) throw new Error("no claimable entitlement");
    const [note] = await this.sql`SELECT * FROM notes WHERE cid = ${item.entitlement_cid}`;
    if (!note || note.status !== "active") throw new Error("entitlement not active on-chain yet");

    return {
      entitlementCid: item.entitlement_cid,
      claimSecret: item.claim_secret,
      amountMicro: item.amount_micro.toString(),
      payerX: note.payload.payer_x,
      memoHash: note.payload.memo_hash,
      salt: note.salt,
      noteSecret: note.note_secret,
      leafIndex: note.leaf_index,
      merklePath: this.chain.tree.path(note.leaf_index).map(fieldToHex),
      root: fieldToHex(this.chain.tree.root),
    };
  }

  /** Server-proved claim (P4 path; browser proving arrives in P5). */
  async claim(employeeId: number): Promise<{ txid: string; cid: string }> {
    const data = await this.claimData(employeeId);
    // employee key: deterministic per employee for the PoC (their device would hold this)
    const employeeKeys = derivePartyKeys(hexToField(data.claimSecret as string));
    const outNote = newNote(
      TemplateId.Cash,
      { owner_x: employeeKeys.x, amount: BigInt(data.amountMicro as string), salt2: 0n },
      [employeeKeys.x],
    );
    const c1 = commitment(outNote);
    const entC = hexToField(data.entitlementCid as string);
    const n1 = nullifier(entC, hexToField(data.noteSecret as string));
    const root = hexToField(data.root as string);

    const bundle = await prove("entitlement_claim", artifact("entitlement_claim"), {
      root: fieldToHex(root),
      t_bound: "0",
      nullifiers: [fieldToHex(n1), "0", "0", "0"],
      commitments: [fieldToHex(c1), "0", "0", "0"],
      aux: ["0", "0", "0", "0"],
      claim_secret: data.claimSecret,
      ent_amount: data.amountMicro,
      ent_payer_x: data.payerX,
      ent_memo_hash: data.memoHash,
      ent_salt: data.salt,
      ent_secret: data.noteSecret,
      ent_index: data.leafIndex,
      ent_path: data.merklePath,
      out_owner_x: fieldToHex(employeeKeys.x),
      out_salt: fieldToHex(outNote.salt),
      out_salt2: fieldToHex(outNote.fields.salt2),
    } as any);

    const txid = await this.flows.settleRaw(
      CircuitId.entitlement_claim,
      bundle,
      encryptNoteFor([this.orgEncPub], outNote),
    );
    await this.sql`UPDATE payroll_items SET status = 'claimed' WHERE entitlement_cid = ${data.entitlementCid}`;
    return { txid, cid: fieldToHex(c1) };
  }

  /** Relay a browser-generated claim proof (P5: the witness never left the device). */
  async submitClaim(proofHex: string, publicInputs: string[]): Promise<{ txid: string }> {
    const txid = await this.flows.settleRaw(
      CircuitId.entitlement_claim,
      { proof: Buffer.from(proofHex.replace("0x", ""), "hex"), publicInputs },
      [],
    );
    const n1 = publicInputs[2];
    await this.sql`
      UPDATE payroll_items SET status = 'claimed'
      WHERE entitlement_cid IN (SELECT cid FROM notes WHERE expected_nullifier = ${n1})`;
    return { txid };
  }
}
