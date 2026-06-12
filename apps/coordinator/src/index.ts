// Coordinator (BUILD_SPEC §6.4) — deliberately tiny: the relayer. Pays gas so Rings never
// hold ETH; the chain never links settlements to an institution's wallet.
// Directory = ENS; proposals travel on-chain. No other responsibilities.
import { Hono } from "hono";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const RELAYER_KEY = (process.env.RELAYER_PRIVATE_KEY ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as `0x${string}`; // anvil[1]
const PORT = Number(process.env.PORT ?? 4900);
/** org token → org name; static service tokens for the demo. */
const TOKENS: Record<string, string> = JSON.parse(
  process.env.RELAYER_TOKENS ?? '{"ubs-relay-token":"UBS","drw-relay-token":"DRW"}',
);

const account = privateKeyToAccount(RELAYER_KEY);
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC) });

// crude per-org rate limit: max 30 relays / 10s window
const windows = new Map<string, number[]>();
function rateLimited(org: string): boolean {
  const now = Date.now();
  const w = (windows.get(org) ?? []).filter((t) => now - t < 10_000);
  w.push(now);
  windows.set(org, w);
  return w.length > 30;
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, relayer: account.address }));

app.post("/relay", async (c) => {
  const org = TOKENS[c.req.header("authorization")?.replace("Bearer ", "") ?? ""];
  if (!org) return c.json({ error: "unauthorized" }, 401);
  if (rateLimited(org)) return c.json({ error: "rate limited" }, 429);

  const { to, calldata } = await c.req.json<{ to: `0x${string}`; calldata: `0x${string}` }>();
  try {
    const hash = await wallet.sendTransaction({ to, data: calldata });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return c.json({ txid: hash, status: receipt.status, blockNumber: Number(receipt.blockNumber) });
  } catch (e: any) {
    console.error(`[relay:${org}]`, e.shortMessage ?? e.message);
    return c.json({ error: e.shortMessage ?? "relay failed" }, 400);
  }
});

console.log(`[coordinator] relayer ${account.address} on :${PORT} → ${RPC}`);
export default { port: PORT, fetch: app.fetch };
