// Ring node boot: one process per institution (BUILD_SPEC §6).
import { x25519 } from "@noble/curves/ed25519.js";
import { initPoseidon, initSchnorr } from "@aragorn/protocol";
import { loadConfig } from "./config.js";
import { connectDb, migrate } from "./db.js";
import { ChainSync } from "./chain.js";
import { Flows } from "./flows.js";
import { buildApi } from "./api.js";

const cfg = loadConfig();
await initPoseidon();
await initSchnorr();

const sql = connectDb(cfg.databaseUrl);
await migrate(sql);

const encKeys = { privateKey: cfg.encPrivKey, publicKey: x25519.getPublicKey(cfg.encPrivKey) };

// Flows derives party pubkeys; ChainSync needs the x→label map for attribution — wire both.
const bootstrapFlows = new Flows(cfg, sql, undefined as unknown as ChainSync, encKeys.publicKey);
const chain = new ChainSync(cfg, sql, encKeys, bootstrapFlows.partyXToLabel);
const flows = new Flows(cfg, sql, chain, encKeys.publicKey);

await chain.start();

const app = buildApi(cfg, sql, chain, flows);
console.log(
  `[ring:${cfg.orgName}] :${cfg.port} | tree=${chain.tree.size} | enc=0x${Buffer.from(encKeys.publicKey).toString("hex").slice(0, 16)}… | funding=${chain.fundingAddress}`,
);

export default { port: cfg.port, fetch: app.fetch, idleTimeout: 120 };
