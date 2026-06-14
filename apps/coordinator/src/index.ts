// Coordinator (BUILD_SPEC §6.4) — deliberately tiny: the relayer. Pays gas so Rings never
// hold ETH; the chain never links settlements to an institution's wallet.
// Directory = ENS; proposals travel onchain. No other responsibilities.
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  http,
  isAddress,
  isHex,
  namehash,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  CircuitId,
  NOTE_REGISTRY_ABI,
  PUBLIC_INPUT_COUNT,
  initSchnorr,
  derivePartyKeys,
  randomField,
  fieldToHex,
} from "@aragorn/protocol";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import postgres from "postgres";
const CHAIN = process.env.CHAIN === "sepolia" ? sepolia : foundry;

// Hosted create-ring: spawned rings live in THIS container, reverse-proxied on the coordinator's
// public URL, with their DBs created on a shared Postgres. Bounded so the container can't OOM.
const MAX_RINGS = Number(process.env.MAX_RINGS ?? 5);
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, ""); // coordinator's public URL
const PROVISION_DB = process.env.PROVISION_DATABASE_URL; // shared PG for dynamically-created ring DBs

await initSchnorr();

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const RELAYER_KEY = (process.env.RELAYER_PRIVATE_KEY ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as `0x${string}`; // anvil[1]
const PORT = Number(process.env.PORT ?? 4900);
/** org token → org name; static service tokens for the demo. */
const TOKENS: Record<string, string> = JSON.parse(
  process.env.RELAYER_TOKENS ?? '{"ubs-relay-token":"UBS","drw-relay-token":"DRW"}',
);
const deployFile =
  process.env.CHAIN === "sepolia"
    ? "contracts/deployments.sepolia.json"
    : "contracts/deployments.local.json";
let deployRegistry: string | undefined;
try {
  deployRegistry = (JSON.parse(readFileSync(deployFile, "utf8")) as { registry?: string }).registry;
} catch {}
const NOTE_REGISTRY_ADDR = process.env.NOTE_REGISTRY_ADDR ?? deployRegistry;
const ALLOWED_CIRCUITS = new Set<number>(Object.values(CircuitId).map(Number));
const MAX_RELAY_CALLDATA_BYTES = Number(process.env.MAX_RELAY_CALLDATA_BYTES ?? 500_000);
const MAX_RELAY_PROOF_BYTES = Number(process.env.MAX_RELAY_PROOF_BYTES ?? 250_000);
const MAX_RELAY_CIPHERTEXTS = Number(process.env.MAX_RELAY_CIPHERTEXTS ?? 16);

const account = privateKeyToAccount(RELAYER_KEY);
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

// crude per-org rate limit: max 30 relays / 10s window
const windows = new Map<string, number[]>();
function rateLimited(org: string): boolean {
  const now = Date.now();
  const w = (windows.get(org) ?? []).filter((t) => now - t < 10_000);
  w.push(now);
  windows.set(org, w);
  return w.length > 30;
}

function hexByteLength(hex: string): number {
  return hex.startsWith("0x") ? (hex.length - 2) / 2 : hex.length / 2;
}

function relayError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function validateRelay(to: string, calldata: string): void {
  if (!NOTE_REGISTRY_ADDR) throw relayError("note registry address not configured", 500);
  if (!isAddress(to)) throw relayError("bad relay target", 400);
  if (to.toLowerCase() !== NOTE_REGISTRY_ADDR.toLowerCase()) {
    throw relayError("relay target not allowed", 403);
  }
  if (!isHex(calldata) || hexByteLength(calldata) > MAX_RELAY_CALLDATA_BYTES) {
    throw relayError("bad relay calldata", 400);
  }
  const decoded = decodeFunctionData({ abi: NOTE_REGISTRY_ABI, data: calldata });
  if (decoded.functionName !== "settle") throw relayError("only NoteRegistry.settle may be relayed", 403);
  const [circuitId, proof, publicInputs, ciphertexts] = decoded.args as readonly [
    number | bigint,
    `0x${string}`,
    readonly `0x${string}`[],
    readonly `0x${string}`[],
  ];
  if (!ALLOWED_CIRCUITS.has(Number(circuitId))) throw relayError("unsupported circuit id", 400);
  if (publicInputs.length !== PUBLIC_INPUT_COUNT) throw relayError("bad public input count", 400);
  if (hexByteLength(proof) > MAX_RELAY_PROOF_BYTES) throw relayError("proof too large", 400);
  if (ciphertexts.length > MAX_RELAY_CIPHERTEXTS) throw relayError("too many ciphertexts", 400);
}

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, relayer: account.address }));

// ── Provisioning (Create a Ring) ─────────────────────────────────────────────
// Spin up a REAL sovereign Ring node: own process + Postgres DB + party/enc keys +
// ENS metadata under the parent name. Localhost-only (a hosted deploy needs a tunnel
// to reach the spawned node) — that's expected for the local/Sepolia demo stack.
interface ProvisionedRing {
  port: number;
  orgName: string;
  ens: string;
  apiToken: string;
  relayToken: string;
  proc: ReturnType<typeof Bun.spawn>;
}
const provisioned = new Map<string, ProvisionedRing>();
const usedPorts = new Set<number>([4001, 4002]); // the static demo rings

const resolverAbi = parseAbi(["function setText(bytes32 node, string key, string value)"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

app.post("/provision", async (c) => {
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let slug = "";
  try {
    const { orgName, founderEmail } = await c.req.json<{
      orgName: string;
      founderEmail: string;
    }>();
    if (!orgName || !orgName.trim()) return c.json({ error: "orgName required" }, 400);

    slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!slug) return c.json({ error: "orgName has no usable [a-z0-9] characters" }, 400);
    if (provisioned.has(slug)) return c.json({ error: `Ring "${slug}" already provisioned` }, 409);
    if (provisioned.size >= MAX_RINGS)
      return c.json({ error: `ring limit reached (${MAX_RINGS}); remove one to add more` }, 429);

    // ── keys: party (Grumpkin/Schnorr) + org encryption (x25519) ──
    const partyPriv = fieldToHex(randomField());
    const partyX = fieldToHex(derivePartyKeys(BigInt(partyPriv)).x);
    const encPriv = "0x" + crypto.randomBytes(32).toString("hex");
    const encPub =
      "0x" +
      Buffer.from(x25519.getPublicKey(Buffer.from(encPriv.slice(2), "hex"))).toString("hex");

    // ── port allocation ──
    const port = 4003 + provisioned.size;
    if (usedPorts.has(port)) return c.json({ error: `port ${port} taken` }, 409);

    // ── onchain config from disk (coordinator cwd = repo root) ──
    const deployFile =
      process.env.CHAIN === "sepolia"
        ? "contracts/deployments.sepolia.json"
        : "contracts/deployments.local.json";
    const deploy = JSON.parse(readFileSync(deployFile, "utf8")) as {
      registry: string;
      vault: string;
      usdc: string;
      deployBlock?: number;
    };
    const ensCfg = JSON.parse(readFileSync("ens-v2.config.json", "utf8")) as {
      resolver: `0x${string}`;
      name: string;
    };
    const parent = ensCfg.name;
    const ens = `${slug}.${parent}`;
    const sepoliaRpc = process.env.SEPOLIA_RPC_URL;

    // ── create the ring's Postgres database (idempotent) ──
    // One path for hosted and local: connect to the admin DB over TCP via the postgres client
    // and CREATE DATABASE. No `docker exec`, so it works whether Postgres runs in Docker or
    // natively — and fails with a clear message if it simply isn't reachable. Admin URL is
    // PROVISION_DATABASE_URL (hosted) or LOCAL_ADMIN_DATABASE_URL / the 5434 default (local).
    const ringDbName = `ring_${slug}`;
    const baseDbUrl =
      PROVISION_DB ??
      process.env.LOCAL_ADMIN_DATABASE_URL ??
      "postgres://aragorn:aragorn@127.0.0.1:5434/postgres";
    const adminUrl = new URL(baseDbUrl);
    adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 8 });
    try {
      await admin.unsafe(`CREATE DATABASE "${ringDbName}"`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/already exists/i.test(msg)) {
        throw new Error(
          `db create failed (is Postgres reachable at ${adminUrl.host}? start it, or set PROVISION_DATABASE_URL / LOCAL_ADMIN_DATABASE_URL): ${msg}`,
        );
      }
    } finally {
      await admin.end();
    }
    const ringUrlObj = new URL(baseDbUrl);
    ringUrlObj.pathname = `/${ringDbName}`;
    const ringDbUrl = ringUrlObj.toString();

    // ── ENS: publish the org's resolution metadata on the PermissionedResolver ──
    if (sepoliaRpc) {
      const ensWallet = createWalletClient({
        account,
        chain: sepolia,
        transport: http(sepoliaRpc),
      });
      const ensPub = createPublicClient({ chain: sepolia, transport: http(sepoliaRpc) });
      const node = namehash(ens);
      const records: [string, string][] = [
        ["aragorn.encpubkey", encPub],
        ["aragorn.endpoint", PUBLIC_BASE ? `${PUBLIC_BASE}/r/${slug}` : `http://127.0.0.1:${port}`],
        ["aragorn.partyroot", partyX],
        ["aragorn.modules", "payments,repo,strategies"],
      ];
      for (const [key, value] of records) {
        const hash = await ensWallet.writeContract({
          address: ensCfg.resolver,
          abi: resolverAbi,
          functionName: "setText",
          args: [node, key, value],
        });
        await ensPub.waitForTransactionReceipt({ hash });
        console.log(`[provision:${slug}] ENS ${key} (${hash.slice(0, 14)}…)`);
      }
    } else {
      console.warn(`[provision:${slug}] SEPOLIA_RPC_URL unset — skipping ENS records`);
    }

    // ── spawn the sovereign Ring node ──
    const relayToken = `${slug}-relay-token`;
    const apiToken = `${slug}-api-token`;
    const ringEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      RING_ORG_NAME: orgName,
      RING_ENS: ens,
      PORT: String(port),
      DATABASE_URL: ringDbUrl,
      NOTE_REGISTRY_ADDR: deploy.registry,
      USDC_ADDR: deploy.usdc,
      SHIELD_VAULT_ADDR: deploy.vault,
      RELAYER_URL: `http://127.0.0.1:${PORT}`,
      RELAYER_TOKEN: relayToken,
      API_TOKEN: apiToken,
      ORG_ENC_PRIV: encPriv,
      PARTY_KEYS: JSON.stringify({ treasury: partyPriv }),
      FUNDING_EOA_PRIVATE_KEY: RELAYER_KEY,
      SYNC_LOG_RANGE: process.env.SYNC_LOG_RANGE ?? "9",
      ENABLED_MODULES: "payments,repo,strategies",
    };
    if (process.env.RPC_URL) ringEnv.RPC_URL = process.env.RPC_URL;
    if (process.env.CHAIN) ringEnv.CHAIN = process.env.CHAIN;
    if (deploy.deployBlock != null) ringEnv.SYNC_START_BLOCK = String(deploy.deployBlock);
    if (process.env.EXPLORER_BASE) ringEnv.EXPLORER_BASE = process.env.EXPLORER_BASE;
    if (sepoliaRpc) ringEnv.SEPOLIA_RPC_URL = sepoliaRpc;
    if (process.env.PRIVY_APP_ID) ringEnv.PRIVY_APP_ID = process.env.PRIVY_APP_ID;
    if (process.env.PRIVY_APP_SECRET) ringEnv.PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

    proc = Bun.spawn(
      [
        "node",
        "--experimental-wasm-modules",
        "--experimental-transform-types",
        "--no-warnings",
        "apps/ring/src/index.ts",
      ],
      { cwd: process.cwd(), env: ringEnv, stdout: "inherit", stderr: "inherit" },
    );

    // let the new ring relay through this coordinator
    TOKENS[relayToken] = orgName;

    // ── wait for the node to come up ──
    const ringUrl = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${ringUrl}/health`);
        if (r.ok) {
          healthy = true;
          break;
        }
      } catch {
        // not up yet
      }
      await sleep(500);
    }
    if (!healthy) throw new Error("ring node failed to become healthy in time");

    // ── invite the founder as an admin acting for treasury ──
    const inviteRes = await fetch(`${ringUrl}/v1/users/invite`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ email: founderEmail, role: "admin" }),
    });
    if (!inviteRes.ok) {
      const t = await inviteRes.text();
      throw new Error(`founder invite failed (${inviteRes.status}): ${t}`);
    }

    usedPorts.add(port);
    provisioned.set(slug, { port, orgName, ens, apiToken, relayToken, proc });
    const publicRingUrl = PUBLIC_BASE ? `${PUBLIC_BASE}/r/${slug}` : ringUrl;
    console.log(`[provision:${slug}] up on :${port} as ${ens} → ${publicRingUrl}`);
    return c.json({ ringUrl: publicRingUrl, ens, apiToken });
  } catch (e: any) {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
    if (slug) provisioned.delete(slug);
    const msg = e?.shortMessage ?? e?.message ?? String(e);
    console.error(`[provision] failed:`, msg);
    return c.json({ error: msg }, 500);
  }
});

// Reverse-proxy dynamically-created rings (which live in this container on internal ports)
// so the browser can reach them on the coordinator's public URL: /r/<slug>/v1/... → ring:port/v1/...
// Streams the upstream body through, so SSE (/v1/events, /public-feed) works too.
app.all("/r/:slug/*", async (c) => {
  const slug = c.req.param("slug");
  const entry = provisioned.get(slug);
  if (!entry) return c.json({ error: `unknown ring "${slug}"` }, 404);
  const path = c.req.path.slice(`/r/${slug}`.length) || "/";
  const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?").slice(1).join("?") : "";
  const method = c.req.method;
  try {
    const upstream = await fetch(`http://127.0.0.1:${entry.port}${path}${qs}`, {
      method,
      headers: c.req.raw.headers,
      body: method === "GET" || method === "HEAD" ? undefined : c.req.raw.body,
      // @ts-expect-error Node fetch streaming request body
      duplex: "half",
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch (e: any) {
    return c.json({ error: `ring proxy failed: ${e?.message ?? e}` }, 502);
  }
});

app.post("/relay", async (c) => {
  const org = TOKENS[c.req.header("authorization")?.replace("Bearer ", "") ?? ""];
  if (!org) return c.json({ error: "unauthorized" }, 401);
  if (rateLimited(org)) return c.json({ error: "rate limited" }, 429);

  const { to, calldata } = await c.req.json<{ to: `0x${string}`; calldata: `0x${string}` }>();
  try {
    validateRelay(to, calldata);
    const hash = await wallet.sendTransaction({ to, data: calldata });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return c.json({ txid: hash, status: receipt.status, blockNumber: Number(receipt.blockNumber) });
  } catch (e: any) {
    console.error(`[relay:${org}]`, e.shortMessage ?? e.message);
    return c.json({ error: e.shortMessage ?? e.message ?? "relay failed" }, e.status ?? 400);
  }
});

console.log(`[coordinator] relayer ${account.address} on :${PORT} → ${RPC}`);
export default { port: PORT, fetch: app.fetch };
