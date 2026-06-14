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
import type { Payroll } from "./payroll.ts";
import type { RepoDesk } from "./repo.ts";
import type { EarnService } from "./earn.ts";
import { balances } from "./notes.ts";

type Vars = { Variables: { user: SessionUser } };

const SERVICE_ADMIN: SessionUser = {
  email: "service-admin",
  role: "admin",
  limitMicro: null,
  allowedParties: null,
  service: true,
};

export function buildApi(
  cfg: RingConfig,
  sql: Sql,
  chain: ChainSync,
  flows: Flows,
  auth: AuthService,
  ens: EnsDirectory,
  payroll: Payroll,
  repo: RepoDesk,
  earn: EarnService,
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
      return c.json({
        biscuit: result.biscuit,
        user: {
          email: result.user.email,
          role: result.user.role,
          limitMicro: result.user.limitMicro?.toString() ?? null,
          allowedParties: result.user.allowedParties,
        },
      });
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
  const defaultAllowedParties = (role: Role, allowedParties: unknown): string[] | null => {
    if (Array.isArray(allowedParties)) return allowedParties.map(String).filter(Boolean);
    if (role === "trader") return [Object.keys(cfg.partyKeys)[0] ?? "treasury"];
    return null;
  };
  const requireParty = (user: SessionUser, party: string | null | undefined): void => {
    if (!party || user.allowedParties === null) return;
    if (!user.allowedParties.includes(party)) {
      throw Object.assign(new Error(`forbidden for party ${party}`), { status: 403 });
    }
  };
  const onError = (c: any, e: any) => {
    const code = e.status ?? (e.message?.startsWith("CONTENTION") ? 409 : 400);
    if (code === 202) return c.json({ status: e.kind ?? "pending", error: e.message }, 202);
    return c.json({ error: e.message }, code);
  };

  const pendingApproval = async (
    kind: string,
    state: Record<string, unknown>,
    requestedBy: string,
    amountMicro: string,
  ) => {
    const [wf] = await sql`
      INSERT INTO workflows (kind, state, status, created_by)
      VALUES (${kind}, ${sql.json(state as any)}, 'pending_approval', ${requestedBy})
      RETURNING id`;
    const [approval] = await sql`
      INSERT INTO approvals (workflow_id, requested_by, amount)
      VALUES (${wf.id}, ${requestedBy}, ${amountMicro}) RETURNING id`;
    chain.emitExternal({
      type: "approval_pending",
      approvalId: approval.id,
      workflowId: wf.id,
      kind,
      requestedBy,
      amountMicro,
    });
    return { status: "pending_approval", approvalId: approval.id, workflowId: wf.id };
  };

  const executeStrategyDeposit = async (
    actor: SessionUser,
    amountMicro: string,
    fromParty?: string,
  ): Promise<any> => {
    const party = fromParty ?? "treasury";
    requireParty(actor, party);
    const amount = BigInt(amountMicro);
    const openTs = BigInt(Math.floor(Date.now() / 1000));
    const [op] = await sql`
      INSERT INTO strategy_ops (kind, amount_micro, status, requested_by)
      VALUES ('deposit', ${amountMicro}, 'opening_private_note', ${actor.email})
      RETURNING id`;
    let position: { txid: string; cid: string } | undefined;
    try {
      position = await flows.openStrategy(party, earn.vaultLabel, amount, openTs);
      await sql`
        UPDATE strategy_ops SET position_cid = ${position.cid}, status = 'private_note_opened',
          result = result || ${sql.json({ openTxid: position.txid } as any)}, updated_at = now()
        WHERE id = ${op.id}`;
      try {
        const result = await earn.deposit(amount);
        await sql`
          UPDATE strategy_ops SET status = 'deployed',
            result = result || ${sql.json({ earn: result } as any)}, updated_at = now()
          WHERE id = ${op.id}`;
        await audit(sql, actor.email, "earn_deposit", { amountMicro, fromParty: party, cid: position.cid, txid: position.txid });
        chain.emitExternal({ type: "workflow_updated", kind: "strategy", state: "deployed" });
        return { ...result, position };
      } catch (e) {
        try {
          const compensation = await flows.redeemStrategy(party, position.cid);
          await sql`
            UPDATE strategy_ops SET status = 'compensated_after_earn_failure',
              result = result || ${sql.json({ compensation } as any)}, updated_at = now()
            WHERE id = ${op.id}`;
        } catch (compensationError: any) {
          await sql`
            UPDATE strategy_ops SET status = 'earn_failed_compensation_failed',
              result = result || ${sql.json({ error: String((e as Error).message), compensationError: String(compensationError?.message ?? compensationError) } as any)},
              updated_at = now()
            WHERE id = ${op.id}`;
        }
        throw e;
      }
    } catch (e: any) {
      await sql`
        UPDATE strategy_ops SET status = CASE
            WHEN status IN ('compensated_after_earn_failure','earn_failed_compensation_failed') THEN status
            ELSE 'failed'
          END,
          result = result || ${sql.json({ error: String(e?.message ?? e) } as any)}, updated_at = now()
        WHERE id = ${op.id}`;
      throw e;
    }
  };

  const executeStrategyWithdraw = async (actor: SessionUser, positionCid: string): Promise<any> => {
    const [existing] = await sql`
      SELECT * FROM strategy_ops
      WHERE kind = 'withdraw' AND position_cid = ${positionCid}
        AND status IN ('withdrawing_from_earn', 'withdrawn_pending_redeem')
      ORDER BY id DESC LIMIT 1`;
    if (existing?.status === "withdrawing_from_earn") {
      throw Object.assign(new Error("strategy withdraw already in progress"), { status: 409 });
    }
    const [pos] = await sql`
      SELECT owner_party, amount_micro FROM notes
      WHERE cid = ${positionCid} AND template_id = 7 AND status = 'active'`;
    if (!pos && !existing) throw Object.assign(new Error("no active strategy position with that id"), { status: 404 });
    const ownerParty = pos?.owner_party ?? existing.result.owner;
    requireParty(actor, ownerParty);
    const amount = BigInt(pos?.amount_micro ?? existing.amount_micro);
    let op = existing;
    if (!op) {
      try {
        op = (await sql`
          INSERT INTO strategy_ops (kind, position_cid, amount_micro, status, requested_by)
          VALUES ('withdraw', ${positionCid}, ${amount.toString()}, 'withdrawing_from_earn', ${actor.email})
          RETURNING *`)[0];
      } catch (e: any) {
        if (e?.code === "23505") {
          throw Object.assign(new Error("strategy withdraw already in progress"), { status: 409 });
        }
        throw e;
      }
    }
    let result = existing?.result?.earn ?? { resumed: true };
    if (!existing) {
      try {
        result = await earn.withdraw(amount);
      } catch (e: any) {
        await sql`
          UPDATE strategy_ops SET status = 'failed',
            result = result || ${sql.json({ withdrawError: String(e?.message ?? e), owner: ownerParty } as any)},
            updated_at = now()
          WHERE id = ${op.id}`;
        throw e;
      }
      await sql`
        UPDATE strategy_ops SET status = 'withdrawn_pending_redeem',
          result = result || ${sql.json({ earn: result, owner: ownerParty } as any)}, updated_at = now()
        WHERE id = ${op.id}`;
    }
    try {
      const redeemed = await flows.redeemStrategy(ownerParty, positionCid);
      await sql`
        UPDATE strategy_ops SET status = 'redeemed',
          result = result || ${sql.json({ redeemed } as any)}, updated_at = now()
        WHERE id = ${op.id}`;
      await audit(sql, actor.email, "earn_withdraw", { positionCid, owner: ownerParty, txid: redeemed.txid });
      chain.emitExternal({ type: "workflow_updated", kind: "strategy", state: "redeemed" });
      return { ...result, redeemed };
    } catch (e: any) {
      await sql`
        UPDATE strategy_ops SET status = 'withdrawn_pending_redeem',
          result = result || ${sql.json({ redeemError: String(e?.message ?? e), owner: ownerParty } as any)}, updated_at = now()
        WHERE id = ${op.id}`;
      throw Object.assign(new Error(`earn withdrawn; private redeem pending retry: ${e?.message ?? e}`), {
        status: 202,
        kind: "pending_redeem",
      });
    }
  };

  // ── session & org ─────────────────────────────────────────────────────────────────
  v1.get("/me", async (c) => {
    const user = c.get("user");
    return c.json({
      user: { email: user.email, role: user.role },
      limitMicro: user.limitMicro?.toString() ?? null,
      allowedParties: user.allowedParties,
      org: cfg.orgName,
      ens: process.env.RING_ENS ?? null,
      // Explorer links are valid only when SETTLEMENT runs on the chain the explorer serves.
      // Settlement-on-local-Anvil tx hashes don't exist on any public explorer, so suppress the
      // link there (otherwise a tx chip → sepolia.etherscan.io 404s). Set EXPLORER_BASE only on
      // the public-settlement path (demo-up-sepolia.sh, where RPC_URL is a real testnet).
      explorerBase: /127\.0\.0\.1|localhost/.test(cfg.rpcUrl) ? null : (process.env.EXPLORER_BASE ?? null),
      enabledModules,
      capabilities: capabilitiesFor(user.role),
    });
  });

  // ── settings: module model (PLAN §6) ──────────────────────────────────────────────
  const MODULE_CATALOG: { key: string; status: "live" | "partial" | "roadmap" }[] = [
    { key: "payments", status: "live" },
    { key: "repo", status: "live" },
    { key: "payroll", status: "live" },
    { key: "issuance", status: "partial" },
    { key: "strategies", status: "live" },
    { key: "lending", status: "roadmap" },
    { key: "fx", status: "roadmap" },
    { key: "compliance", status: "roadmap" },
    { key: "reports", status: "roadmap" },
  ];
  let enabledModules = [...cfg.enabledModules];

  v1.get("/settings/modules", async (c) => {
    try {
      requireRole(c, "admin");
      return c.json({
        modules: MODULE_CATALOG.map((m) => ({ ...m, enabled: enabledModules.includes(m.key) })),
      });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.put("/settings/modules", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { module, enabled } = await c.req.json();
      if (!MODULE_CATALOG.some((m) => m.key === module)) return c.json({ error: "unknown module" }, 400);
      enabledModules = enabled
        ? [...new Set([...enabledModules, module])]
        : enabledModules.filter((m) => m !== module);
      await audit(sql, admin.email, "module_toggle", { module, enabled });
      return c.json({ enabledModules });
    } catch (e) {
      return onError(c, e);
    }
  });

  // ── admin: users, whitelist, service tokens ───────────────────────────────────────
  v1.post("/users/invite", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { email, role, limitMicro, allowedParties } = await c.req.json();
      const allowed = defaultAllowedParties(role as Role, allowedParties);
      const [row] = await sql`
        INSERT INTO users (email, role, allowed_parties, notional_limit_micro)
        VALUES (${email}, ${role}, ${allowed as any}, ${limitMicro ?? null})
        ON CONFLICT (email) DO UPDATE SET role = ${role},
          allowed_parties = ${allowed as any},
          notional_limit_micro = ${limitMicro ?? null}
        RETURNING *`;
      await audit(sql, admin.email, "invite_user", { email, role, limitMicro, allowedParties: allowed });
      return c.json({ user: row });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.get("/users", async (c) => {
    try {
      requireRole(c, "admin");
      const rows = await sql`SELECT id, email, role, allowed_parties, notional_limit_micro, privy_did IS NOT NULL AS activated, created_at FROM users ORDER BY id`;
      return c.json({ users: rows });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.put("/users/:id", async (c) => {
    try {
      const admin = requireRole(c, "admin");
      const { role, limitMicro, allowedParties } = await c.req.json();
      const allowed =
        allowedParties === undefined
          ? undefined
          : defaultAllowedParties((role ?? "trader") as Role, allowedParties);
      const [row] = await sql`
        UPDATE users SET
          role = COALESCE(${role ?? null}, role),
          allowed_parties = ${allowed === undefined ? sql`allowed_parties` : (allowed as any)},
          notional_limit_micro = ${limitMicro === undefined ? sql`notional_limit_micro` : limitMicro}
        WHERE id = ${c.req.param("id")} RETURNING *`;
      await audit(sql, admin.email, "update_user", { id: c.req.param("id"), role, limitMicro, allowedParties: allowed });
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
      const { maxNotionalMicro, ttlSeconds, role, allowedParties } = await c.req.json();
      const serviceRole = (role ?? "trader") as Role;
      const allowed = allowedParties === undefined ? null : defaultAllowedParties(serviceRole, allowedParties);
      const token = auth.mint(
        {
          email: `service:${Date.now()}`,
          role: serviceRole,
          limitMicro: maxNotionalMicro ? BigInt(maxNotionalMicro) : null,
          allowedParties: allowed,
          service: true,
        },
        ttlSeconds ?? 86400,
      );
      await audit(sql, admin.email, "mint_service_token", { maxNotionalMicro, ttlSeconds, role, allowedParties: allowed });
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
    const user = c.get("user");
    const template = c.req.query("template");
    const party = c.req.query("party");
    if (party) requireParty(user, party);
    const parties = user.allowedParties;
    const publicProjection = sql`
      SELECT cid, template_id, payload, status, owner_party, leaf_index, created_tx, consumed_tx, amount_micro
      FROM notes`;
    const rows =
      parties === null
        ? await sql`
            ${publicProjection}
            WHERE (${template ?? null}::int IS NULL OR template_id = ${template ?? null}::int)
              AND (${party ?? null}::text IS NULL OR owner_party = ${party ?? null})
            ORDER BY block_num DESC NULLS LAST
            LIMIT 200`
        : await sql`
            ${publicProjection}
            WHERE (${template ?? null}::int IS NULL OR template_id = ${template ?? null}::int)
              AND (${party ?? null}::text IS NULL OR owner_party = ${party ?? null})
              AND (owner_party IS NULL OR owner_party IN ${sql(parties.length ? parties : ["__no_party__"])})
            ORDER BY block_num DESC NULLS LAST
            LIMIT 200`;
    return c.json({ contracts: rows });
  });

  v1.get("/contracts/:cid", async (c) => {
    const user = c.get("user");
    const [row] = await sql`
      SELECT cid, template_id, payload, status, owner_party, leaf_index, created_tx, consumed_tx, amount_micro
      FROM notes WHERE cid = ${c.req.param("cid")}`;
    if (row?.owner_party) requireParty(user, row.owner_party);
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });

  // ── flows: shield / transfers (four-eyes) / unshield ──────────────────────────────
  v1.post("/shield", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { party, amountMicro } = await c.req.json();
      requireParty(user, party);
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
      requireParty(user, fromParty);
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
      const [a] = await sql`SELECT a.*, w.kind AS workflow_kind, w.state AS workflow_state FROM approvals a JOIN workflows w ON w.id = a.workflow_id WHERE a.id = ${c.req.param("id")}`;
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

      // Execute the approved workflow. Workflow kinds carry different state shapes, so
      // branch on the kind — never assume a transfer (an over-limit repo lands here too).
      let result: any;
      if (a.workflow_kind === "repo") {
        const p = (a.workflow_state as any).pending as {
          dealerParty?: string; counterpartyEns: string; collateralCid: string;
          cashAmountMicro: string; rateBps: number; days: number;
        };
        requireParty(approver, p.dealerParty ?? "trading");
        result = await repo.propose(
          p.dealerParty ?? "trading",
          p.counterpartyEns,
          p.collateralCid,
          BigInt(p.cashAmountMicro),
          BigInt(p.rateBps),
          BigInt(p.days),
          approver.email,
        );
      } else if (a.workflow_kind === "transfer") {
        const params = a.workflow_state as { fromParty: string; toPartyOrEns: string; amountMicro: string };
        requireParty(approver, params.fromParty);
        result = await flows.transfer(params.fromParty, params.toPartyOrEns, BigInt(params.amountMicro));
      } else if (a.workflow_kind === "strategy_deposit") {
        const params = a.workflow_state as { amountMicro: string; fromParty?: string };
        result = await executeStrategyDeposit(approver, params.amountMicro, params.fromParty);
      } else if (a.workflow_kind === "strategy_withdraw") {
        const params = a.workflow_state as { positionCid: string };
        result = await executeStrategyWithdraw(approver, params.positionCid);
      } else {
        throw Object.assign(new Error(`unknown workflow kind ${a.workflow_kind}`), { status: 400 });
      }
      await sql`UPDATE approvals SET status = 'approved', approver = ${approver.email}, reason = ${reason ?? null} WHERE id = ${a.id}`;
      await sql`UPDATE workflows SET status = 'executed', state = state || ${sql.json(result as any)} WHERE id = ${a.workflow_id}`;
      await audit(sql, approver.email, "approval_approved_executed", { approvalId: a.id, kind: a.workflow_kind, ...result });
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
      requireParty(user, party);
      const result = await flows.unshield(party, BigInt(amountMicro), recipient);
      await audit(sql, user.email, "unshield", { party, amountMicro, recipient, ...result });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  // ── payroll (I6) ──────────────────────────────────────────────────────────────────
  v1.post("/payroll/run", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { payerParty, payments } = await c.req.json();
      requireParty(user, payerParty ?? "treasury");
      const result = await payroll.run(
        payerParty ?? "treasury",
        payments.map((p: any) => ({ employeeId: p.employeeId, amountMicro: BigInt(p.amountMicro) })),
        user.email,
      );
      await audit(sql, user.email, "payroll_run", { payments, ...result });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.get("/payroll/items", async (c) => {
    try {
      requireRole(c, "admin", "trader");
      const rows = await sql`
        SELECT p.id, p.employee_id, p.amount_micro, p.status, p.entitlement_cid, e.subname_label
        FROM payroll_items p JOIN employees e ON e.id = p.employee_id ORDER BY p.id DESC LIMIT 50`;
      return c.json({ items: rows });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/payroll/claim-data", async (c) => {
    try {
      const user = requireRole(c, "employee");
      const { employeeId } = await c.req.json();
      return c.json(await payroll.claimData(user.email, Number(employeeId)));
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/payroll/claim", async (c) => {
    try {
      const user = requireRole(c, "employee");
      const { employeeId } = await c.req.json();
      const result = await payroll.claim(user.email, Number(employeeId));
      await audit(sql, user.email, "payroll_claim", { employeeId, ...result });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/payroll/submit-claim", async (c) => {
    try {
      const user = requireRole(c, "employee");
      const { proof, publicInputs } = await c.req.json();
      const result = await payroll.submitClaim(user.email, proof, publicInputs);
      await audit(sql, user.email, "payroll_submit_claim", result);
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  // ── repo (X4) ─────────────────────────────────────────────────────────────────────
  v1.get("/repos", async (c) => {
    const rows = await sql`SELECT * FROM workflows WHERE kind = 'repo' ORDER BY id DESC LIMIT 50`;
    return c.json({ repos: rows });
  });

  v1.post("/repos", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { dealerParty, counterpartyEns, collateralCid, cashAmountMicro, rateBps, days } = await c.req.json();
      requireParty(user, dealerParty ?? "trading");
      const amount = BigInt(cashAmountMicro);
      // four-eyes folds into the booking: over-limit repos route to an approver
      if (user.limitMicro !== null && amount > user.limitMicro) {
        const [wf] = await sql`
          INSERT INTO workflows (kind, state, status, created_by)
          VALUES ('repo', ${sql.json({ side: "dealer", pending: { dealerParty, counterpartyEns, collateralCid, cashAmountMicro, rateBps, days } } as any)}, 'pending_approval', ${user.email})
          RETURNING id`;
        const [approval] = await sql`
          INSERT INTO approvals (workflow_id, requested_by, amount)
          VALUES (${wf.id}, ${user.email}, ${cashAmountMicro}) RETURNING id`;
        chain.emitExternal({ type: "approval_pending", approvalId: approval.id, workflowId: wf.id, kind: "repo", requestedBy: user.email, amountMicro: cashAmountMicro });
        await audit(sql, user.email, "repo_pending_approval", { workflowId: wf.id });
        return c.json({ status: "pending_approval", approvalId: approval.id, workflowId: wf.id }, 202);
      }
      const result = await repo.propose(
        dealerParty ?? "trading",
        counterpartyEns,
        collateralCid,
        amount,
        BigInt(rateBps),
        BigInt(days),
        user.email,
      );
      await audit(sql, user.email, "repo_propose", { counterpartyEns, cashAmountMicro, rateBps, days, ...result });
      chain.emitExternal({ type: "workflow_updated", kind: "repo", id: result.workflowId, state: "proposed" });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/repos/:id/accept", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const result = await repo.accept(Number(c.req.param("id")), user.email);
      await audit(sql, user.email, "repo_accept", { id: c.req.param("id"), ...result });
      chain.emitExternal({ type: "workflow_updated", kind: "repo", id: Number(c.req.param("id")), state: "live" });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/repos/:id/close", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const result = await repo.close(Number(c.req.param("id")));
      await audit(sql, user.email, "repo_close", { id: c.req.param("id"), ...result });
      chain.emitExternal({ type: "workflow_updated", kind: "repo", id: Number(c.req.param("id")), state: "closed" });
      return c.json(result);
    } catch (e) {
      return onError(c, e);
    }
  });

  // ── strategies (B2: Privy Earn, real chain) ───────────────────────────────────────
  v1.get("/strategies", async (c) => {
    try {
      const [status, dep] = await Promise.all([
        earn.status(),
        sql`SELECT COALESCE(SUM(amount_micro), 0)::text AS total FROM notes WHERE status = 'active' AND template_id = 7`,
      ]);
      // Private principal currently deployed = sum of active StrategyPosition notes (template
      // 7). Each is a ZK-redeemable claim on the Earn position, reconstructed from chain.
      const deployedMicro = String(dep[0]?.total ?? "0");
      return c.json({
        earn: status,
        deployedMicro,
        roadmap: {
          privateStrategies: {
            title: "Fully private strategies",
            blurb: "Today the principal is a shielded note; next, the vault position itself becomes a note with its own nullifier (Morpho/Aave/Uniswap direct).",
            status: "roadmap",
          },
        },
      });
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/strategies/earn/deposit", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { amountMicro, fromParty } = await c.req.json();
      requireParty(user, fromParty ?? "treasury");
      const amount = BigInt(amountMicro);
      if (user.limitMicro !== null && amount > user.limitMicro) {
        const pending = await pendingApproval("strategy_deposit", { amountMicro, fromParty }, user.email, amountMicro);
        await audit(sql, user.email, "strategy_deposit_pending_approval", pending);
        return c.json(pending, 202);
      }
      return c.json(await executeStrategyDeposit(user, amountMicro, fromParty));
    } catch (e) {
      return onError(c, e);
    }
  });

  v1.post("/strategies/earn/withdraw", async (c) => {
    try {
      const user = requireRole(c, "admin", "trader");
      const { positionCid } = await c.req.json();
      const [pos] = await sql`
        SELECT owner_party, amount_micro FROM notes
        WHERE cid = ${positionCid} AND template_id = 7 AND status = 'active'`;
      if (!pos) return c.json({ error: "no active strategy position with that id" }, 404);
      requireParty(user, pos.owner_party);
      const amount = BigInt(pos.amount_micro);
      if (user.limitMicro !== null && amount > user.limitMicro) {
        const pending = await pendingApproval("strategy_withdraw", { positionCid }, user.email, amount.toString());
        await audit(sql, user.email, "strategy_withdraw_pending_approval", pending);
        return c.json(pending, 202);
      }
      return c.json(await executeStrategyWithdraw(user, positionCid));
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
