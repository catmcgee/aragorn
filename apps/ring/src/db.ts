// Projection store — a DISPOSABLE CACHE of chain state + org keys (PLAN §5.2 invariant).
// Everything in `notes`/`leaves` is rebuildable from Settled events; `resync` proves it.
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

export function connectDb(url: string): Sql {
  return postgres(url, { max: 5, onnotice: () => {} });
}

export async function migrate(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS leaves (
      idx INTEGER PRIMARY KEY,
      commitment TEXT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS notes (
      cid TEXT PRIMARY KEY,
      template_id INTEGER NOT NULL,
      payload JSONB NOT NULL,
      salt TEXT NOT NULL,
      note_secret TEXT NOT NULL,
      stakeholders TEXT[] NOT NULL,
      expected_nullifier TEXT NOT NULL,
      amount_micro BIGINT,
      status TEXT NOT NULL DEFAULT 'active',          -- active | pending_consume | consumed
      owner_party TEXT,
      encumbrance_cid TEXT,
      leaf_index INTEGER,
      created_tx TEXT,
      consumed_tx TEXT,
      block_num BIGINT
    )`;
  await sql`CREATE INDEX IF NOT EXISTS notes_status_idx ON notes(status, template_id, owner_party)`;
  await sql`
    CREATE TABLE IF NOT EXISTS sync_cursor (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_block BIGINT NOT NULL DEFAULT 0
    )`;
  await sql`INSERT INTO sync_cursor (id, last_block) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`;
  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail JSONB NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      privy_did TEXT UNIQUE,
      role TEXT NOT NULL,
      act_as TEXT[] NOT NULL DEFAULT '{}',
      read_as TEXT[] NOT NULL DEFAULT '{}',
      notional_limit_micro BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS workflows (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,                              -- transfer | payroll | repo
      state JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS approvals (
      id SERIAL PRIMARY KEY,
      workflow_id INTEGER REFERENCES workflows(id),
      requested_by TEXT NOT NULL,
      amount BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected
      approver TEXT,
      reason TEXT,
      ts TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      subname_label TEXT UNIQUE NOT NULL,
      claim_hash TEXT,
      x25519_pub TEXT
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS payroll_items (
      id SERIAL PRIMARY KEY,
      workflow_id INTEGER REFERENCES workflows(id),
      employee_id INTEGER REFERENCES employees(id),
      amount_micro BIGINT NOT NULL,
      claim_hash TEXT NOT NULL,
      claim_secret TEXT NOT NULL,
      entitlement_cid TEXT,
      status TEXT NOT NULL DEFAULT 'pending',          -- pending | claimable | claimed
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS ens_whitelist (
      ens_name TEXT PRIMARY KEY,
      resolved_encpubkey TEXT,
      resolved_endpoint TEXT,
      resolved_partyroot TEXT,
      resolved_modules TEXT,
      resolved_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    )`;
}

export async function audit(sql: Sql, actor: string, action: string, detail: unknown): Promise<void> {
  await sql`INSERT INTO audit_log (actor, action, detail) VALUES (${actor}, ${action}, ${sql.json(detail as any)})`;
}

/** resync --from-zero: drop the disposable cache, keep users/policy (node-side state). */
export async function wipeProjection(sql: Sql): Promise<void> {
  await sql`TRUNCATE leaves, notes`;
  await sql`UPDATE sync_cursor SET last_block = 0 WHERE id = 1`;
}
