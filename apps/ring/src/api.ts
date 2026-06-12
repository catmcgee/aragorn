// Ring REST API (/v1, BUILD_SPEC §6.2). API-first invariant: the dashboard is a pure client;
// every flow here is executable via curl/sdk with a suitably scoped Biscuit.
// Auth: Privy JWT → /auth/exchange → session Biscuit; service Biscuits via /service-tokens;
// the static API_TOKEN env is the bootstrap service credential (gates/CI).
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { RingConfig } from "./config.ts";
import type { Sql } from "./db.ts";
import { audit, wipeProjection } from "./db.ts";
import type { ChainSync } from "./chain.ts";
import type { Flows } from "./flows.ts";
import type { AuthService, Role, SessionUser } from "./auth.ts";
import type { EnsDirectory } from "./ens.ts";
import { balances } from "./notes.ts";

type Vars = { Variables: { user: SessionUser } };

const SERVICE_ADMIN: SessionUser = {
  email: "service-admin",
  role: "admin",
  actAs: ["*"],
  limitMicro: null,
  service: true,
};

export function buildApi(
  cfg: RingConfig,
  sql: Sql,
  chain: ChainSync,
  flows: Flows,
  auth: AuthService,
  ens: EnsDirectory,
): Hono {
  const app = new Hono();
  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true, org: cfg.orgName, treeSize: chain.tree.size }));

  // public feed for the split panel — the world's view: shapes, no content. Unauthenticated.
  app.get("/public-feed", (c) =>
    streamSSE(c, async (stream) => {
      const off = chain.on((e) => {
        if (e.type === "settlement_status") void stream.writeSSE({ data: JSON.stringify(e) });
      });
      stream.onAbort(off);
      while (!stream.aborted) await new Promise((r) => setTimeout(r, 15_000));
    }),
  );

  // Privy JWT → session Biscuit
  app.post("/auth/exchange", async (c) => {
    try {
      const { privyToken } = await c.req.json<{ privyToken: string }>();
      const result = await auth.exchange(privyToken);
      await audit(sql, result.user.email, "login", { role: result.user.role });
      return c.json(result);
    } catch (e: any) {
      return c.json({ error: e.message }, 401);
    }
  });

  const v1 = new Hono<Vars>();
  v1.use("*", async (c, next) => {
    const token = c.req.header("authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "unauthorized" }, 401);
    if (token === cfg.apiToken) {
      c.set("user", SERVICE_ADMIN);
    } else {
      try {
        c.set("user", auth.verify(token));
      } catch {
        return c.json({ error: "invalid or expired session" }, 401);
      }
    }
    await next();
  });

  const requireRole = (c: any, ...roles: Role[]): SessionUser => {
    const user = c.get("user") as SessionUser;
    if (!roles.includes(user.role)) throw Object.assign(new Error("forbidden"), { status: 403 });
    return user;
  };
  const onError = (c: any, e: any) => {
    const code = e.status ?? (e.message?.startsWith("CONTENTION") ? 409 : 400);
    return c.json({ error: e.message }, code);
  };

  // ── session & org ─────────────────────────────────────────────────────────────────
  v1.get("/me", async (c) => {
    const user = c.get("user");
    const enabledModules = cfg.enabledModules ?? [
      "payments",
      "repo",
      "payroll",
      "issuance",
      "strategies",
    ];
    return c.json({
      user: { email: user.email, role: user.role, actAs: user.actAs },
      limitMicro: user.limitMicro?.toString() ?? null,
      org: cfg.orgName,
      ens: process.env.RING_ENS ?? null,
      enabledModules,
      capabilities: capabilitiesFor(user.role),
    });
  });

  // ── admin: users, whitelist, service tokens ───────────────────────────────────────
  v1.post("/users/invite", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { email, role, actAs, limitMicro } = await c.req.json();
      const [row] = await sql`
        INSERT INTO users (email, role, act_as, notional_limit_micro)
        VALUES (${email}, ${role}, ${actAs ?? []}, ${limitMicro ?? null})
        ON CONFLICT (email) DO UPDATE SET role = ${role}, act_as = ${actAs ?? []},
          notional_limit_micro = ${limitMicro ?? null}
        RETURNING *`;
      await audit(sql, admin.email, "invite_user", { email, role, actAs, limitMicro });
      return c.json({ user: row });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.get("/users", async (c) => {
    try {
      requireRole(c, "admin");
      const rows = await sql`SELECT id, email, role, act_as, notional_limit_micro, privy_did IS NOT NULL AS activated, created_at FROM users ORDER BY id`;
      return c.json({ users: rows });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.put("/users/:id", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { role, actAs, limitMicro } = await c.req.json();
      const [row] = await sql`
        UPDATE users SET
          role = COALESCE(${role ?? null}, role),
          act_as = COALESCE(${actAs ?? null}, act_as),
          notional_limit_micro = ${limitMicro === undefined ? sql`notional_limit_micro` : limitMicro}
        WHERE id = ${c.req.param("id")} RETURNING *`;
      await audit(sql, admin.email, "update_user", { id: c.req.param("id"), role, actAs, limitMicro });
      return c.json({ user: row });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.get("/employees", async (c) => {
    try {
      requireRole(c, "admin");
      const rows = await sql`
        SELECT e.id, e.subname_label, e.claim_hash IS NOT NULL AS has_claim, u.email
        FROM employees e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id`;
      return c.json({ employees: rows });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/employees", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { email, subnameLabel } = await c.req.json();
      let userId: number | null = null;
      if (email) {
        const [u] = await sql`SELECT id FROM users WHERE email = ${email}`;
        userId = u?.id ?? null;
      }
      const [row] = await sql`
        INSERT INTO employees (user_id, subname_label) VALUES (${userId}, ${subnameLabel})
        ON CONFLICT (subname_label) DO UPDATE SET user_id = COALESCE(${userId}, employees.user_id)
        RETURNING *`;
      await audit(sql, admin.email, "employee_add", { email, subnameLabel });
      return c.json({ employee: row });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.get("/whitelist", async (c) => c.json({ whitelist: await ens.list() }));

  v1.post("/whitelist", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { ensName } = await c.req.json();
      const resolved = await ens.whitelist(ensName);
      await audit(sql, admin.email, "whitelist_add", resolved);
      return c.json(resolved);
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/service-tokens", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { actAs, maxNotionalMicro, ttlSeconds } = await c.req.json();
      const token = auth.mint(
        {
          email: `service:${Date.now()}`,
          role: "trader",
          actAs: actAs ?? [],
          limitMicro: maxNotionalMicro ? BigInt(maxNotionalMicro) : null,
          service: true,
        },
        ttlSeconds ?? 86400,
      );
      await audit(sql, admin.email, "mint_service_token", { actAs, maxNotionalMicro, ttlSeconds });
      return c.json({ biscuit: token });
    } catch (e) {
      return onError(c, e);
    }
  });

  // ── portfolio & contracts ─────────────────────────────────────────────────────────
  v1.get("/portfolio", async (c) => {
    const b = await balances(sql);
    return c.json({
      org: cfg.orgName,
      balances: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toString()])),
    });
  });

  v1.get("/contracts", async (c) => {
    const template = c.req.query("template");
    const party = c.req.query("party");
    const rows = await sql`
      SELECT cid, template_id, payload, status, owner_party, leaf_index, created_tx, consumed_tx, amount_micro
      FROM notes
      WHERE (${template ?? null}::int IS NULL OR template_id = ${template ?? null}::int)
        AND (${party ?? null}::text IS NULL OR owner_party = ${party ?? null})
      ORDER BY block_num DESC NULLS LAST
      LIMIT 200`;
    return c.json({ contracts: rows });
  });

  v1.get("/contracts/:cid", async (c) => {
    const [row] = await sql`SELECT * FROM notes WHERE cid = ${c.req.param("cid")}`;
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });

  // ── flows: shield / transfers (four-eyes) / unshield ──────────────────────────────
  v1.post("/shield", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { party, amountMicro } = await c.req.json();
      const result = await flows.shield(party, BigInt(amountMicro));
      await audit(sql, user.email, "shield", { party, amountMicro, ...result });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/transfers", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { fromParty, toPartyOrEns, amountMicro } = await c.req.json();
      const amount = BigInt(amountMicro);

      // four-eyes: over-limit actions become a pending approval instead of executing
      if (user.limitMicro !== null && amount > user.limitMicro) {
        const [wf] = await sql`
          INSERT INTO workflows (kind, state, status, created_by)
          VALUES ('transfer', ${sql.json({ fromParty, toPartyOrEns, amountMicro })}, 'pending_approval', ${user.email})
          RETURNING id`;
        const [approval] = await sql`
          INSERT INTO approvals (workflow_id, requested_by, amount)
          VALUES (${wf.id}, ${user.email}, ${amountMicro}) RETURNING id`;
        await audit(sql, user.email, "transfer_pending_approval", {
          workflowId: wf.id,
          approvalId: approval.id,
          fromParty,
          toPartyOrEns,
          amountMicro,
        });
        chain.emitExternal({
          type: "approval_pending",
          approvalId: approval.id,
          workflowId: wf.id,
          requestedBy: user.email,
          amountMicro,
          toPartyOrEns,
        });
        return c.json(
          { status: "pending_approval", approvalId: approval.id, workflowId: wf.id },
          202,
        );
      }

      const result = await flows.transfer(fromParty, toPartyOrEns, amount);
      await audit(sql, user.email, "transfer", { fromParty, toPartyOrEns, amountMicro, ...result });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.get("/approvals", async (c) => {
    try {
      requireRole(c, "approver", "admin");
      const rows = await sql`
        SELECT a.*, w.state AS workflow_state, w.kind AS workflow_kind
        FROM approvals a JOIN workflows w ON w.id = a.workflow_id
        ORDER BY a.ts DESC LIMIT 100`;
      return c.json({ approvals: rows });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/approvals/:id/decide", async (c) => {
    try {
      const approver = requireRole(c, "approver", "admin");
      const { approve, reason } = await c.req.json();
      const [a] = await sql`SELECT a.*, w.state FROM approvals a JOIN workflows w ON w.id = a.workflow_id WHERE a.id = ${c.req.param("id")}`;
      if (!a) return c.json({ error: "not found" }, 404);
      if (a.status !== "pending") return c.json({ error: "already decided" }, 409);
      if (a.requested_by === approver.email && !approver.service)
        return c.json({ error: "cannot approve your own request (four-eyes)" }, 403);

      if (!approve) {
        await sql`UPDATE approvals SET status = 'rejected', approver = ${approver.email}, reason = ${reason ?? null} WHERE id = ${a.id}`;
        await sql`UPDATE workflows SET status = 'rejected' WHERE id = ${a.workflow_id}`;
        await audit(sql, approver.email, "approval_rejected", { approvalId: a.id, reason });
        chain.emitExternal({ type: "approval_decided", approvalId: a.id, approved: false });
        return c.json({ status: "rejected" });
      }

      await sql`UPDATE approvals SET status = 'approved', approver = ${approver.email}, reason = ${reason ?? null} WHERE id = ${a.id}`;
      const params = a.state as { fromParty: string; toPartyOrEns: string; amountMicro: string };
      const result = await flows.transfer(params.fromParty, params.toPartyOrEns, BigInt(params.amountMicro));
      await sql`UPDATE workflows SET status = 'executed', state = state || ${sql.json(result as any)} WHERE id = ${a.workflow_id}`;
      await audit(sql, approver.email, "approval_approved_executed", { approvalId: a.id, ...result });
      chain.emitExternal({ type: "approval_decided", approvalId: a.id, approved: true, ...result });
      return c.json({ status: "approved", ...result });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/unshield", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { party, amountMicro, recipient } = await c.req.json();
      const result = await flows.unshield(party, BigInt(amountMicro), recipient);
      await audit(sql, user.email, "unshield", { party, amountMicro, recipient, ...result });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  // ── ops ───────────────────────────────────────────────────────────────────────────
  v1.post("/resync", async (c) => {
    try {
      requireRole(c, "admin");
      await chain.resync(() => wipeProjection(sql));
      await audit(sql, (c.get("user") as SessionUser).email, "resync", {});
      return c.json({ ok: true, treeSize: chain.tree.size });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const off = chain.on((e) => void stream.writeSSE({ data: JSON.stringify(e) }));
      stream.onAbort(off);
      while (!stream.aborted) await new Promise((r) => setTimeout(r, 15_000));
    }),
  );

  v1.get("/audit/export", async (c) => {
    try {
      requireRole(c, "auditor", "admin");
      const notes = await sql`SELECT * FROM notes ORDER BY block_num`;
      const log = await sql`SELECT * FROM audit_log ORDER BY id`;
      return c.json({ org: cfg.orgName, notes, auditLog: log });
    } catch (e) {
      return onError(c, e);
    }
  });

  app.route("/v1", v1);
  return app;
}

function capabilitiesFor(role: Role): string[] {
  switch (role) {
    case "admin":
      return ["portfolio", "transfer", "shield", "admin", "approvals", "audit", "repo", "payroll", "strategies"];
    case "trader":
      return ["portfolio", "transfer", "repo", "strategies"];
    case "approver":
      return ["portfolio", "approvals"];
    case "viewer":
      return ["portfolio"];
    case "auditor":
      return ["audit"];
    case "employee":
      return ["my-pay"];
  }
}
