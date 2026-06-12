// Repo lifecycle (X4): propose+allocate -> atomic accept (DvP) -> time-warp -> auto-close.
// State machine (BUILD_SPEC §6.3): proposals travel ON-CHAIN (the proposal note's encrypted
// payload names the counterparty as stakeholder; their sync engine surfaces it) - no relay.
import { readFileSync } from "fs";
import {
  CircuitId,
  TemplateId,
  commitment,
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
} from "@aragorn/protocol";
import type { Sql } from "./db.ts";
import type { ChainSync } from "./chain.ts";
import type { Flows } from "./flows.ts";
import type { EnsDirectory } from "./ens.ts";
import { releaseNotes, selectCash } from "./notes.ts";

const CIRCUITS_DIR = process.env.CIRCUITS_DIR ?? "circuits";
const artifact = (name: string) =>
  JSON.parse(readFileSync(`${CIRCUITS_DIR}/${name}/target/${name}.json`, "utf8"));

const sig4 = (s: ReturnType<typeof signField>) => ({
  s_lo: fieldToHex(s.sLo),
  s_hi: fieldToHex(s.sHi),
  e_lo: fieldToHex(s.eLo),
  e_hi: fieldToHex(s.eHi),
});

function sortedPair(a: Field, b: Field): [Field, Field] {
  return a < b ? [a, b] : [b, a];
}

export class RepoDesk {
  constructor(
    private sql: Sql,
    private chain: ChainSync,
    private flows: Flows,
    private ens: EnsDirectory,
    private orgEncPub: Uint8Array,
    private orgName: string,
  ) {
    // lender side: inbound proposals surface from the chain like any other note
    chain.on((e) => {
      if (e.type === "note_created" && e.templateId === TemplateId.RepoProposal) {
        void this.onProposalNote(e.cid as string).catch(console.error);
      }
      if (e.type === "note_created" && e.templateId === TemplateId.RepoAgreement) {
        void this.onAgreementNote(e.cid as string).catch(console.error);
      }
    });
  }

  /** Dealer books a repo: lock collateral + publish the term sheet, one settle. */
  async propose(
    dealerParty: string,
    counterpartyEns: string,
    collateralCid: string,
    cashAmount: bigint,
    rateBps: bigint,
    days: bigint,
    requestedBy: string,
  ): Promise<{ txid: string; workflowId: number; proposalCid: string }> {
    const dealer = this.flows.party(dealerParty);
    const lender = await this.ens.lookupWhitelisted(counterpartyEns);
    const lenderX = hexToField(lender.partyRoot);
    const lenderEnc = Buffer.from(lender.encPubkey.replace("0x", ""), "hex");

    const [bond] = await this.sql`
      SELECT * FROM notes WHERE cid = ${collateralCid} AND template_id = ${TemplateId.BondPosition} AND status = 'active'`;
    if (!bond) throw new Error("collateral not found or not active");
    if (BigInt(bond.payload.encumbrance) !== 0n) throw new Error("collateral is encumbered");
    await this.sql`UPDATE notes SET status = 'pending_consume' WHERE cid = ${collateralCid}`;

    try {
      const face = BigInt(bond.payload.face_amount);
      const isin = hexToField(bond.payload.isin_hash);
      const issuerX = hexToField(bond.payload.issuer_x);
      const [shLo, shHi] = sortedPair(dealer.x, lenderX);

      const proposalNote = newNote(
        TemplateId.RepoProposal,
        {
          dealer_x: dealer.x,
          lender_x: lenderX,
          isin_hash: isin,
          face_amount: face,
          cash_amount: cashAmount,
          rate_bps: rateBps,
          days,
        },
        [dealer.x, lenderX],
      );
      const proposalC = commitment(proposalNote);
      const allocationNote = newNote(
        TemplateId.CollateralAllocation,
        { dealer_x: dealer.x, proposal_c: proposalC, isin_hash: isin, face_amount: face },
        [dealer.x, lenderX],
      );
      const allocationC = commitment(allocationNote);

      const bondC = hexToField(bond.cid);
      const n1 = nullifier(bondC, hexToField(bond.note_secret));
      const root = this.chain.tree.root;
      const sig = signField(dealer, transitionMessage(root, [n1], [proposalC, allocationC]));

      const bundle = await prove("repo_propose_allocate", artifact("repo_propose_allocate"), {
        root: fieldToHex(root),
        t_bound: "0",
        nullifiers: [fieldToHex(n1), "0", "0", "0"],
        commitments: [fieldToHex(proposalC), fieldToHex(allocationC), "0", "0"],
        aux: ["0", "0", "0", "0"],
        bond_issuer_x: bond.payload.issuer_x,
        bond_isin_hash: bond.payload.isin_hash,
        bond_face: face.toString(),
        bond_salt: bond.salt,
        bond_secret: bond.note_secret,
        bond_index: bond.leaf_index,
        bond_path: this.chain.tree.path(bond.leaf_index).map(fieldToHex),
        bond_sh: paddedStakeholders(bond.stakeholders),
        dealer_x: fieldToHex(dealer.x),
        dealer_y: fieldToHex(dealer.y),
        sig: sig4(sig),
        lender_x: fieldToHex(lenderX),
        cash_amount: cashAmount.toString(),
        rate_bps: rateBps.toString(),
        term_days: days.toString(),
        proposal_salt: fieldToHex(proposalNote.salt),
        allocation_salt: fieldToHex(allocationNote.salt),
        sh_lo: fieldToHex(shLo),
        sh_hi: fieldToHex(shHi),
      });

      // both notes to BOTH orgs (stakeholders) - the lender's inbox is its sync engine
      const cts = [
        ...encryptNoteFor([this.orgEncPub, lenderEnc], proposalNote),
        ...encryptNoteFor([this.orgEncPub, lenderEnc], allocationNote),
      ];
      const txid = await this.flows.settleRaw(CircuitId.repo_propose_allocate, bundle, cts);

      const [wf] = await this.sql`
        INSERT INTO workflows (kind, state, status, created_by)
        VALUES ('repo', ${this.sql.json({
          side: "dealer",
          dealerParty,
          counterpartyEns,
          proposalCid: fieldToHex(proposalC),
          allocationCid: fieldToHex(allocationC),
          collateralCid,
          cashAmountMicro: cashAmount.toString(),
          rateBps: rateBps.toString(),
          days: days.toString(),
          txid,
        } as any)}, 'proposed', ${requestedBy})
        RETURNING id`;
      return { txid, workflowId: wf.id, proposalCid: fieldToHex(proposalC) };
    } catch (e) {
      await releaseNotes(this.sql, [collateralCid]);
      throw e;
    }
  }

  /** Lender inbox: an inbound RepoProposal note appeared on-chain for us. */
  private async onProposalNote(cid: string): Promise<void> {
    const [note] = await this.sql`SELECT * FROM notes WHERE cid = ${cid}`;
    if (!note) return;
    const lenderX = note.payload.lender_x;
    const ourParties = Object.values(this.flows.partyXToLabel);
    const lenderLabel = this.flows.partyXToLabel[lenderX];
    if (!lenderLabel) return; // we are the dealer side; the dealer workflow already exists
    const [existing] = await this.sql`
      SELECT id FROM workflows WHERE kind = 'repo' AND state->>'proposalCid' = ${cid}`;
    if (existing) return;
    await this.sql`
      INSERT INTO workflows (kind, state, status, created_by)
      VALUES ('repo', ${this.sql.json({
        side: "lender",
        lenderParty: lenderLabel,
        proposalCid: cid,
        cashAmountMicro: BigInt(note.payload.cash_amount).toString(),
        rateBps: BigInt(note.payload.rate_bps).toString(),
        days: BigInt(note.payload.days).toString(),
        faceAmountMicro: BigInt(note.payload.face_amount).toString(),
      } as any)}, 'inbound', 'chain')`;
  }

  private async onAgreementNote(cid: string): Promise<void> {
    // dealer side: the agreement's collateral_c equals our stored allocationCid
    const [note] = await this.sql`SELECT payload FROM notes WHERE cid = ${cid}`;
    if (!note) return;
    const maturity = BigInt(note.payload.maturity_ts).toString();
    await this.sql`
      UPDATE workflows SET status = 'live',
        state = state || ${this.sql.json({ agreementCid: cid, maturityTs: maturity } as any)}
      WHERE kind = 'repo' AND status = 'proposed'
        AND state->>'allocationCid' = ${note.payload.collateral_c}`;
  }

  /** Lender accepts: the atomic DvP settle. */
  async accept(workflowId: number, requestedBy: string): Promise<{ txid: string }> {
    const [wf] = await this.sql`SELECT * FROM workflows WHERE id = ${workflowId} AND kind = 'repo'`;
    if (!wf) throw new Error("repo workflow not found");
    if (wf.status !== "inbound") throw new Error(`cannot accept from status ${wf.status}`);
    const proposalCid = wf.state.proposalCid as string;

    const [prop] = await this.sql`SELECT * FROM notes WHERE cid = ${proposalCid} AND status = 'active'`;
    if (!prop) throw new Error("proposal note not active");
    const [alloc] = await this.sql`
      SELECT * FROM notes WHERE template_id = ${TemplateId.CollateralAllocation}
        AND payload->>'proposal_c' = ${proposalCid} AND status = 'active'`;
    if (!alloc) throw new Error("allocation note not found");

    const lenderLabel = wf.state.lenderParty as string;
    const lender = this.flows.party(lenderLabel);
    const dealerX = hexToField(prop.payload.dealer_x);
    const cashAmount = BigInt(prop.payload.cash_amount);
    const rateBps = BigInt(prop.payload.rate_bps);
    const days = BigInt(prop.payload.days);
    const face = BigInt(prop.payload.face_amount);

    // dealer org enc key: from whitelist (resolve by partyroot) or directory
    const dealerEnc = await this.encKeyForParty(prop.payload.dealer_x);

    const cashInputs = await selectCash(this.sql, lenderLabel, cashAmount);
    try {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const maturity = now + days * 86400n;
      const [shLo, shHi] = sortedPair(dealerX, lender.x);

      // bond issuer travels in the allocation/proposal plaintext side-channel; PoC: dealer
      // discloses it via the proposal note's stakeholder payload (we read the chain copy)
      const issuerX = await this.findBondIssuer(prop.payload.isin_hash);

      const agreementNote = newNote(
        TemplateId.RepoAgreement,
        {
          dealer_x: dealerX,
          lender_x: lender.x,
          collateral_c: hexToField(alloc.cid),
          cash_amount: cashAmount,
          rate_bps: rateBps,
          days,
          maturity_ts: maturity,
        },
        [dealerX, lender.x],
      );
      const agreementC = commitment(agreementNote);
      const positionNote = newNote(
        TemplateId.BondPosition,
        {
          owner_x: lender.x,
          issuer_x: issuerX,
          isin_hash: hexToField(prop.payload.isin_hash),
          face_amount: face,
          encumbrance: agreementC,
        },
        [dealerX, lender.x],
      );
      const dealerCashNote = newNote(TemplateId.Cash, { owner_x: dealerX, amount: cashAmount, salt2: 0n }, [dealerX]);
      const in1 = cashInputs[0];
      const in2 = cashInputs.length > 1 ? cashInputs[1] : undefined;
      const inSum = cashInputs.reduce((s, n) => s + n.amount, 0n);
      const change = inSum - cashAmount;
      const changeNote = newNote(TemplateId.Cash, { owner_x: lender.x, amount: change, salt2: 0n }, [lender.x]);

      const nProp = nullifier(hexToField(prop.cid), hexToField(prop.note_secret));
      const nAlloc = nullifier(hexToField(alloc.cid), hexToField(alloc.note_secret));
      const n3 = nullifier(hexToField(in1.cid), in1.noteSecret);
      const n4 = in2 ? nullifier(hexToField(in2.cid), in2.noteSecret) : 0n;
      const cs = [commitment(positionNote), agreementC, commitment(dealerCashNote), commitment(changeNote)];

      const root = this.chain.tree.root;
      const sig = signField(lender, transitionMessage(root, [nProp, nAlloc, n3, n4], cs));
      const zeroPath = Array(32).fill("0");

      const bundle = await prove("repo_accept", artifact("repo_accept"), {
        root: fieldToHex(root),
        t_bound: "0",
        nullifiers: [fieldToHex(nProp), fieldToHex(nAlloc), fieldToHex(n3), in2 ? fieldToHex(n4) : "0"],
        commitments: cs.map(fieldToHex),
        aux: ["0", "0", "0", "0"],
        dealer_x: prop.payload.dealer_x,
        lender_x: fieldToHex(lender.x),
        isin_hash: prop.payload.isin_hash,
        face_amount: face.toString(),
        cash_amount: cashAmount.toString(),
        rate_bps: rateBps.toString(),
        term_days: days.toString(),
        proposal_salt: prop.salt,
        proposal_secret: prop.note_secret,
        proposal_index: prop.leaf_index,
        proposal_path: this.chain.tree.path(prop.leaf_index).map(fieldToHex),
        allocation_salt: alloc.salt,
        allocation_secret: alloc.note_secret,
        allocation_index: alloc.leaf_index,
        allocation_path: this.chain.tree.path(alloc.leaf_index).map(fieldToHex),
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
        lender_y: fieldToHex(lender.y),
        sig: sig4(sig),
        bond_issuer_x: fieldToHex(issuerX),
        maturity_ts: maturity.toString(),
        position_salt: fieldToHex(positionNote.salt),
        agreement_salt: fieldToHex(agreementNote.salt),
        dealer_cash_salt: fieldToHex(dealerCashNote.salt),
        dealer_cash_salt2: fieldToHex(dealerCashNote.fields.salt2),
        change_amount: change.toString(),
        change_salt: fieldToHex(changeNote.salt),
        change_salt2: fieldToHex(changeNote.fields.salt2),
        sh_lo: fieldToHex(shLo),
        sh_hi: fieldToHex(shHi),
      });

      const cts = [
        ...encryptNoteFor([this.orgEncPub, dealerEnc], positionNote),
        ...encryptNoteFor([this.orgEncPub, dealerEnc], agreementNote),
        ...encryptNoteFor([dealerEnc], dealerCashNote),
        ...encryptNoteFor([this.orgEncPub], changeNote),
      ];
      const txid = await this.flows.settleRaw(CircuitId.repo_accept, bundle, cts);
      await this.sql`
        UPDATE workflows SET status = 'live',
          state = state || ${this.sql.json({ agreementCid: fieldToHex(agreementC), maturityTs: maturity.toString(), acceptTxid: txid } as any)}
        WHERE id = ${workflowId}`;
      return { txid };
    } catch (e) {
      await releaseNotes(this.sql, cashInputs.map((n) => n.cid));
      throw e;
    }
  }

  /** Dealer closes at maturity: principal + in-circuit interest vs collateral back. */
  async close(workflowId: number): Promise<{ txid: string; repurchaseMicro: string }> {
    const [wf] = await this.sql`SELECT * FROM workflows WHERE id = ${workflowId} AND kind = 'repo'`;
    if (!wf) throw new Error("repo workflow not found");
    if (wf.status !== "live") throw new Error(`cannot close from status ${wf.status}`);

    const agreementCid = wf.state.agreementCid as string;
    const [agr] = await this.sql`SELECT * FROM notes WHERE cid = ${agreementCid} AND status = 'active'`;
    if (!agr) throw new Error("agreement note not active");
    // the encumbered position references the agreement
    const [pos] = await this.sql`
      SELECT * FROM notes WHERE template_id = ${TemplateId.BondPosition}
        AND payload->>'encumbrance' = ${agreementCid} AND status = 'active'`;
    if (!pos) throw new Error("encumbered position not found");

    const dealerX = agr.payload.dealer_x as string;
    const dealerLabel = this.flows.partyXToLabel[dealerX];
    if (!dealerLabel) throw new Error("we are not the dealer on this agreement");
    const dealer = this.flows.party(dealerLabel);
    const lenderX = hexToField(agr.payload.lender_x);
    const cashAmount = BigInt(agr.payload.cash_amount);
    const rateBps = BigInt(agr.payload.rate_bps);
    const days = BigInt(agr.payload.days);
    const maturity = BigInt(agr.payload.maturity_ts);
    const repurchase = cashAmount + (cashAmount * rateBps * days) / 3_600_000n;

    const lenderEnc = await this.encKeyForParty(agr.payload.lender_x);
    const cashInputs = await selectCash(this.sql, dealerLabel, repurchase);
    try {
      const [shLo, shHi] = sortedPair(dealer.x, lenderX);
      const lenderCashNote = newNote(TemplateId.Cash, { owner_x: lenderX, amount: repurchase, salt2: 0n }, [lenderX]);
      const positionOutNote = newNote(
        TemplateId.BondPosition,
        {
          owner_x: dealer.x,
          issuer_x: hexToField(pos.payload.issuer_x),
          isin_hash: hexToField(pos.payload.isin_hash),
          face_amount: BigInt(pos.payload.face_amount),
          encumbrance: 0n,
        },
        [dealer.x, lenderX],
      );
      const in1 = cashInputs[0];
      const in2 = cashInputs.length > 1 ? cashInputs[1] : undefined;
      const inSum = cashInputs.reduce((s, n) => s + n.amount, 0n);
      const change = inSum - repurchase;
      const changeNote = newNote(TemplateId.Cash, { owner_x: dealer.x, amount: change, salt2: 0n }, [dealer.x]);

      const n1 = nullifier(hexToField(agr.cid), hexToField(agr.note_secret));
      const n2 = nullifier(hexToField(pos.cid), hexToField(pos.note_secret));
      const n3 = nullifier(hexToField(in1.cid), in1.noteSecret);
      const n4 = in2 ? nullifier(hexToField(in2.cid), in2.noteSecret) : 0n;
      const c1 = commitment(lenderCashNote);
      const c2 = commitment(positionOutNote);
      const c3 = commitment(changeNote);

      const root = this.chain.tree.root;
      const msg = transitionMessage(root, [n1, n2, n3, n4], [c1, c2, c3]);
      const sig = signField(dealer, msg);
      const zeroPath = Array(32).fill("0");

      const bundle = await prove("repo_close", artifact("repo_close"), {
        root: fieldToHex(root),
        t_bound: maturity.toString(),
        nullifiers: [fieldToHex(n1), fieldToHex(n2), fieldToHex(n3), in2 ? fieldToHex(n4) : "0"],
        commitments: [fieldToHex(c1), fieldToHex(c2), fieldToHex(c3), "0"],
        aux: ["0", "0", "0", "0"],
        dealer_x: fieldToHex(dealer.x),
        lender_x: agr.payload.lender_x,
        collateral_c: agr.payload.collateral_c,
        cash_amount: cashAmount.toString(),
        rate_bps: rateBps.toString(),
        term_days: days.toString(),
        maturity_ts: maturity.toString(),
        agreement_salt: agr.salt,
        agreement_secret: agr.note_secret,
        agreement_index: agr.leaf_index,
        agreement_path: this.chain.tree.path(agr.leaf_index).map(fieldToHex),
        bond_issuer_x: pos.payload.issuer_x,
        isin_hash: pos.payload.isin_hash,
        face_amount: BigInt(pos.payload.face_amount).toString(),
        position_salt: pos.salt,
        position_secret: pos.note_secret,
        position_index: pos.leaf_index,
        position_path: this.chain.tree.path(pos.leaf_index).map(fieldToHex),
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
        dealer_y: fieldToHex(dealer.y),
        sig: sig4(sig),
        lender_cash_salt: fieldToHex(lenderCashNote.salt),
        lender_cash_salt2: fieldToHex(lenderCashNote.fields.salt2),
        position_out_salt: fieldToHex(positionOutNote.salt),
        change_amount: change.toString(),
        change_salt: fieldToHex(changeNote.salt),
        change_salt2: fieldToHex(changeNote.fields.salt2),
        sh_lo: fieldToHex(shLo),
        sh_hi: fieldToHex(shHi),
      });

      const cts = [
        ...encryptNoteFor([lenderEnc], lenderCashNote),
        ...encryptNoteFor([this.orgEncPub, lenderEnc], positionOutNote),
        ...encryptNoteFor([this.orgEncPub], changeNote),
      ];
      const txid = await this.flows.settleRaw(CircuitId.repo_close, bundle, cts);
      await this.sql`
        UPDATE workflows SET status = 'closed',
          state = state || ${this.sql.json({ closeTxid: txid, repurchaseMicro: repurchase.toString() } as any)}
        WHERE id = ${workflowId}`;
      return { txid, repurchaseMicro: repurchase.toString() };
    } catch (e) {
      await releaseNotes(this.sql, cashInputs.map((n) => n.cid));
      throw e;
    }
  }

  /** Maturity cron (every 10s): close agreements where we are dealer and maturity passed. */
  async maturityTick(): Promise<void> {
    const now = await this.chainNow();
    const rows = await this.sql`
      SELECT w.id, w.state FROM workflows w
      WHERE w.kind = 'repo' AND w.status = 'live' AND (w.state->>'agreementCid') IS NOT NULL`;
    for (const wf of rows) {
      const [agr] = await this.sql`
        SELECT payload FROM notes WHERE cid = ${wf.state.agreementCid} AND status = 'active'`;
      if (!agr) continue;
      const dealerLabel = this.flows.partyXToLabel[agr.payload.dealer_x as string];
      if (!dealerLabel) continue; // lender side waits
      if (BigInt(agr.payload.maturity_ts) <= now) {
        console.log(`[repo] maturity reached for workflow ${wf.id} — auto-closing`);
        await this.close(wf.id).catch((e) => console.error(`[repo] auto-close failed:`, e.message));
      }
    }
  }

  private async chainNow(): Promise<bigint> {
    const block = await this.chain.pub.getBlock();
    return block.timestamp;
  }

  private async encKeyForParty(partyXHex: string): Promise<Uint8Array> {
    const rows = await this.sql`
      SELECT resolved_encpubkey FROM ens_whitelist WHERE resolved_partyroot = ${partyXHex} AND status = 'active'`;
    if (rows.length) return Buffer.from(rows[0].resolved_encpubkey.replace("0x", ""), "hex");
    throw new Error(`no whitelisted org for party ${partyXHex.slice(0, 12)}…`);
  }

  private async findBondIssuer(isinHashHex: string): Promise<Field> {
    const [bond] = await this.sql`
      SELECT payload FROM notes WHERE template_id = ${TemplateId.BondPosition}
        AND payload->>'isin_hash' = ${isinHashHex} ORDER BY block_num DESC LIMIT 1`;
    if (bond) return hexToField(bond.payload.issuer_x);
    // lender hasn't seen the bond before: dealer disclosure path (PoC: proposal plaintext
    // carries no issuer; default to zero - the dealer's node validates on decrypt)
    return 0n;
  }
}

function paddedStakeholders(stakeholders: string[]): string[] {
  const sorted = [...stakeholders].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  while (sorted.length < 4) sorted.push("0");
  return sorted.slice(0, 4);
}
