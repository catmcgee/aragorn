// Browser-path smoke test: prove + verify the payroll claim via the Verity SDK
// (ProveKit WHIR WASM backend -- the same code path a browser would run).
//
//   bun spikes/provekit-booth/verity-prove.ts   (run from repo root)

import { readFileSync } from "node:fs";
import { Backend, Verity } from "@atheonxyz/verity";

const dir = new URL("./payroll_claim/", import.meta.url).pathname;

const pkp = new Uint8Array(readFileSync(`${dir}app.pkp`));
const pkv = new Uint8Array(readFileSync(`${dir}app.pkv`));
const proverToml = readFileSync(`${dir}Prover.toml`, "utf8");

const t0 = Date.now();
const verity = await Verity.create(Backend.ProveKit);
console.log(`[${Date.now() - t0}ms] backend ready (Verity ${Verity.version})`);

const prover = await verity.loadProver(pkp);
const verifier = await verity.loadVerifier(pkv);
console.log(`[${Date.now() - t0}ms] schemes loaded`);

const t1 = Date.now();
const proof = await prover.prove(proverToml);
console.log(`[${Date.now() - t0}ms] proof generated: ${proof.size} bytes (prove took ${Date.now() - t1}ms)`);

const t2 = Date.now();
const valid = await verifier.verify(proof);
console.log(`[${Date.now() - t0}ms] verify: ${valid} (took ${Date.now() - t2}ms)`);

if (!valid) {
  console.error("proof did not verify");
  process.exit(1);
}
console.log("WASM (browser-path) prove + verify OK");
