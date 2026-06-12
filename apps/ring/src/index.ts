// Ring node boot: one process per institution (BUILD_SPEC §6).
import { serve } from "@hono/node-server";
import { x25519 } from "@noble/curves/ed25519.js";
import { initPoseidon, initSchnorr } from "@aragorn/protocol";
import { loadConfig } from "./config.ts";
import { connectDb, migrate } from "./db.ts";
import { ChainSync } from "./chain.ts";
import { Flows } from "./flows.ts";
import { AuthService } from "./auth.ts";
import { EnsDirectory } from "./ens.ts";
import { buildApi } from "./api.ts";
import { buildGateway } from "./gateway.ts";
import { Payroll } from "./payroll.ts";
import { RepoDesk } from "./repo.ts";
import { EarnService } from "./earn.ts";

const cfg = loadConfig();
await initPoseidon();
await initSchnorr();

const sql = connectDb(cfg.databaseUrl);
await migrate(sql);

const encKeys = { privateKey: cfg.encPrivKey, publicKey: x25519.getPublicKey(cfg.encPrivKey) };

// Flows derives party pubkeys; ChainSync needs the x→label map for attribution — wire both.
const bootstrapFlows = new Flows(cfg, sql, undefined as unknown as ChainSync, encKeys.publicKey);
const chain = new ChainSync(cfg, sql, encKeys, bootstrapFlows.partyXToLabel);
const ens = new EnsDirectory(cfg.sepoliaRpcUrl, sql);
const flows = new Flows(cfg, sql, chain, encKeys.publicKey, ens);
const auth = new AuthService(
  sql,
  cfg.biscuitRootPriv,
  cfg.privyAppId,
  cfg.privyAppSecret,
  cfg.emailDomainAllowlist,
);

const payroll = new Payroll(sql, chain, flows, encKeys.publicKey);
const repo = new RepoDesk(sql, chain, flows, ens, encKeys.publicKey, cfg.orgName);
const earn = new EarnService(
  cfg.privyAppId,
  cfg.privyAppSecret,
  process.env.PRIVY_EARN_WALLET_ID,
  process.env.PRIVY_EARN_VAULT_ID,
);

await chain.start();

// maturity cron (BUILD_SPEC §6.3): every 10s
setInterval(() => void repo.maturityTick().catch(() => {}), 10_000);

const app = buildApi(cfg, sql, chain, flows, auth, ens, payroll, repo, earn);
if (process.env.GATEWAY_SIGNER_KEY) {
  app.route("/", buildGateway(sql, process.env.GATEWAY_SIGNER_KEY as `0x${string}`, process.env.RING_ENS));
}
console.log(
  `[ring:${cfg.orgName}] :${cfg.port} | tree=${chain.tree.size} | enc=0x${Buffer.from(encKeys.publicKey).toString("hex").slice(0, 16)}… | funding=${chain.fundingAddress}`,
);

serve({ fetch: app.fetch, port: cfg.port });
