// Ring REST API (/v1, BUILD_SPEC §6.2). API-first invariant: the dashboard is a pure client;
// every flow here is executable via curl/sdk. P2 auth = static bearer token; P3 swaps in
// Privy → Biscuit exchange on the same routes.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RingConfig } from "./config.js";
import type { Sql } from "./db.js";
import { audit, wipeProjection } from "./db.js";
import type { ChainSync } from "./chain.js";
import type { Flows } from "./flows.js";
import { balances } from "./notes.js";

export function buildApi(
  cfg: RingConfig,
  sql: Sql,
  chain: ChainSync,
  flows: Flows,
): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, org: cfg.orgName, treeSize: chain.tree.size, root: undefined }),
  );

  // public feed for the split panel — raw settlement shapes only, no auth (it IS public)
  app.get("/public-feed", (c) =>
    streamSSE(c, async (stream) => {
      const off = chain.on((e) => {
        if (e.type === "settlement_status") void stream.writeSSE({ data: JSON.stringify(e) });
      });
      stream.onAbort(off);
      while (!stream.aborted) await new Promise((r) => setTimeout(r, 15_000));
    }),
  );

  const v1 = new Hono();
  v1.use("*", async (c, next) => {
    const token = c.req.header("authorization")?.replace("Bearer ", "");
    if (token !== cfg.apiToken) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

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
      SELECT cid, template_id, payload, status, owner_party, leaf_index, created_tx, consumed_tx
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

  v1.post("/shield", async (c) => {
    const { party, amountMicro } = await c.req.json<{ party: string; amountMicro: string }>();
    const result = await flows.shield(party, BigInt(amountMicro));
    await audit(sql, "api", "shield", { party, amountMicro, ...result });
    return c.json(result);
  });

  v1.post("/transfers", async (c) => {
    const { fromParty, toPartyOrEns, amountMicro } = await c.req.json<{
      fromParty: string;
      toPartyOrEns: string;
      amountMicro: string;
    }>();
    try {
      const result = await flows.transfer(fromParty, toPartyOrEns, BigInt(amountMicro));
      await audit(sql, "api", "transfer", { fromParty, toPartyOrEns, amountMicro, ...result });
      return c.json(result);
    } catch (e: any) {
      const code = e.message?.startsWith("CONTENTION") ? 409 : 400;
      return c.json({ error: e.message }, code);
    }
  });

  v1.post("/unshield", async (c) => {
    const { party, amountMicro, recipient } = await c.req.json<{
      party: string;
      amountMicro: string;
      recipient: `0x${string}`;
    }>();
    const result = await flows.unshield(party, BigInt(amountMicro), recipient);
    await audit(sql, "api", "unshield", { party, amountMicro, recipient, ...result });
    return c.json(result);
  });

  // disposable-cache invariant, demo-able: wipe the projection and rebuild it from chain
  v1.post("/resync", async (c) => {
    await chain.resync(() => wipeProjection(sql));
    await audit(sql, "api", "resync", {});
    return c.json({ ok: true, treeSize: chain.tree.size });
  });

  v1.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const off = chain.on((e) => void stream.writeSSE({ data: JSON.stringify(e) }));
      stream.onAbort(off);
      while (!stream.aborted) await new Promise((r) => setTimeout(r, 15_000));
    }),
  );

  v1.get("/audit/export", async (c) => {
    const notes = await sql`SELECT * FROM notes ORDER BY block_num`;
    const log = await sql`SELECT * FROM audit_log ORDER BY id`;
    return c.json({ org: cfg.orgName, notes, auditLog: log });
  });

  app.route("/v1", v1);
  return app;
}
