// Smoke test for the in-browser claim prover (runs in bun, no DOM):
// fabricates a self-consistent claim-data payload around a 1-leaf merkle tree,
// then runs the EXACT witness-building + proving code the web worker uses.
//
//   bun apps/dashboard/scripts/test-prove.ts

import { readFileSync } from "node:fs";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import {
  buildClaimWitness,
  fieldToHex,
  initPoseidon,
  poseidon2,
  proveClaim,
  type ClaimData,
} from "../lib/claimProver";

const TREE_DEPTH = 32;

async function main() {
  const artifact = JSON.parse(
    readFileSync(
      new URL("../public/circuits/entitlement_claim.json", import.meta.url),
      "utf8",
    ),
  ) as CompiledCircuit;

  await initPoseidon();

  // ── fabricate a self-consistent entitlement note at leaf 0 ────────────────
  const claimSecret = 12345n;
  const amount = 7_500_000_000n; // $7,500.00
  const payerX = 777n;
  const memoHash = 888n;
  const salt = 999n;
  const noteSecret = 1111n;

  const claimHash = poseidon2([claimSecret]);
  const payloadHash = poseidon2([claimHash, amount, payerX, memoHash]);
  const stakeholders = poseidon2([payerX, 0n, 0n, 0n]);
  const nfKeyHash = poseidon2([noteSecret]);
  // commitment(TEMPLATE_ENTITLEMENT=6, VERSION=1, payload, stakeholders, nf_key_hash, salt)
  const entC = poseidon2([6n, 1n, payloadHash, stakeholders, nfKeyHash, salt]);

  // 1-leaf tree: siblings are the zero-subtree chain z0=0, z_{i+1}=H(z_i, z_i)
  const path: bigint[] = [];
  let z = 0n;
  for (let i = 0; i < TREE_DEPTH; i++) {
    path.push(z);
    z = poseidon2([z, z]);
  }
  // leaf at index 0 → always the left child
  let root = entC;
  for (let i = 0; i < TREE_DEPTH; i++) {
    root = poseidon2([root, path[i]]);
  }

  const claimData: ClaimData = {
    entitlementCid: fieldToHex(entC),
    claimSecret: fieldToHex(claimSecret),
    amountMicro: amount.toString(),
    payerX: fieldToHex(payerX),
    memoHash: fieldToHex(memoHash),
    salt: fieldToHex(salt),
    noteSecret: fieldToHex(noteSecret),
    leafIndex: 0,
    merklePath: path.map(fieldToHex),
    root: fieldToHex(root),
  };

  const { inputs, n1, c1 } = buildClaimWitness(claimData);
  console.log("n1:", n1);
  console.log("c1:", c1);

  const t0 = Date.now();
  const bundle = await proveClaim(artifact, inputs, (stage) =>
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] stage: ${stage}`),
  );

  console.log(
    `[${((Date.now() - t0) / 1000).toFixed(1)}s] proof generated:`,
    (bundle.proof.length - 2) / 2,
    "bytes,",
    bundle.publicInputs.length,
    "public inputs",
  );

  // sanity: proof's own public inputs match what we computed
  if (bundle.publicInputs[0] !== fieldToHex(root)) throw new Error("root mismatch");
  if (bundle.publicInputs[2] !== n1) throw new Error("n1 mismatch");
  if (bundle.publicInputs[6] !== c1) throw new Error("c1 mismatch");
  console.log("public inputs match expected root/n1/c1 — OK");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
