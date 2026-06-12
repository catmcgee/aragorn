// Note manager (BUILD_SPEC §6.3): coin selection (largest-first), pending_consume locking,
// contention release. Institutions never see any of this — the API speaks contracts.
import { hexToField, type Field } from "@aragorn/protocol";
import type { Sql } from "./db.js";

export interface SelectedNote {
  cid: string;
  fields: Record<string, string>;
  salt: Field;
  noteSecret: Field;
  leafIndex: number;
  amount: bigint;
}

/** Largest-first selection of active Cash notes for `party` covering `amount` (≤2 inputs). */
export async function selectCash(
  sql: Sql,
  party: string,
  amount: bigint,
): Promise<SelectedNote[]> {
  const rows = await sql`
    SELECT cid, payload, salt, note_secret, leaf_index, amount_micro
    FROM notes
    WHERE status = 'active' AND template_id = 1 AND owner_party = ${party}
    ORDER BY amount_micro DESC NULLS LAST`;
  const notes: SelectedNote[] = rows.map((r) => ({
    cid: r.cid,
    fields: r.payload,
    salt: hexToField(r.salt),
    noteSecret: hexToField(r.note_secret),
    leafIndex: r.leaf_index,
    amount: BigInt(r.amount_micro),
  }));

  const picked: SelectedNote[] = [];
  let sum = 0n;
  for (const n of notes) {
    if (sum >= amount) break;
    picked.push(n);
    sum += n.amount;
  }
  if (sum < amount) throw new Error(`INSUFFICIENT_FUNDS: ${party} holds ${sum}, needs ${amount}`);
  if (picked.length > 2)
    throw new Error(`FRAGMENTED: needs ${picked.length} notes; 2-input circuit (consolidate first)`);

  const locked = await sql`
    UPDATE notes SET status = 'pending_consume'
    WHERE cid IN ${sql(picked.map((n) => n.cid))} AND status = 'active'
    RETURNING cid`;
  if (locked.length !== picked.length) {
    // contention: another workflow grabbed an input between select and lock (Canton-style)
    await sql`UPDATE notes SET status = 'active' WHERE cid IN ${sql(locked.map((r) => r.cid))}`;
    throw new Error("CONTENTION: contract archived by concurrent transaction, retry");
  }
  return picked;
}

export async function releaseNotes(sql: Sql, cids: string[]): Promise<void> {
  if (cids.length)
    await sql`UPDATE notes SET status = 'active' WHERE cid IN ${sql(cids)} AND status = 'pending_consume'`;
}

export async function balances(sql: Sql): Promise<Record<string, bigint>> {
  const rows = await sql`
    SELECT owner_party, SUM(amount_micro) AS total
    FROM notes
    WHERE status IN ('active','pending_consume') AND template_id = 1 AND owner_party IS NOT NULL
    GROUP BY owner_party`;
  return Object.fromEntries(rows.map((r) => [r.owner_party, BigInt(r.total)]));
}
