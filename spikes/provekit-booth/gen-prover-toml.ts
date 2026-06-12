// Generates a self-consistent Prover.toml for the payroll_claim booth circuit.
// Mirrors apps/dashboard/scripts/test-prove.ts: 1-leaf merkle tree (leaf at index 0,
// siblings are the zero-subtree chain z0=0, z_{i+1}=H2([z_i, z_i])).
//
//   bun spikes/provekit-booth/gen-prover-toml.ts   (run from repo root)

import { writeFileSync } from "node:fs";
import {
  fieldToHex,
  initPoseidon,
  poseidon2,
} from "../../packages/protocol/src/index.ts";

const TREE_DEPTH = 32;

await initPoseidon();

// ── fabricate a self-consistent entitlement note at leaf 0 ──────────────────
const claimSecret = 12345n;
const amount = 7_500_000_000n; // $7,500.00 in micro-units
const payerX = 777n;
const memoHash = 888n;
const salt = 999n;
const noteSecret = 1111n;
const entIndex = 0;

const claimHash = poseidon2([claimSecret]);
const payloadHash = poseidon2([claimHash, amount, payerX, memoHash]);
const stakeholders = poseidon2([payerX, 0n, 0n, 0n]);
// commitment(TEMPLATE_ENTITLEMENT=6, VERSION=1, payload, stakeholders, salt)
const entC = poseidon2([6n, 1n, payloadHash, stakeholders, salt]);

// 1-leaf tree: siblings are the zero-subtree chain
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

// nullifier + output cash note
const nullifierOut = poseidon2([entC, noteSecret]);
const outOwnerX = poseidon2([claimSecret, 42n]); // demo owner derivation
const outSalt = 2222n;
const outSalt2 = 3333n;
const cashPayload = poseidon2([outOwnerX, amount, outSalt2]);
const cashStakeholders = poseidon2([outOwnerX, 0n, 0n, 0n]);
const cashC = poseidon2([1n, 1n, cashPayload, cashStakeholders, outSalt]);

// ── Prover.toml: Fields as 0x-hex strings, u64/u32 as decimal strings ───────
const lines = [
  `root = "${fieldToHex(root)}"`,
  `nullifier_out = "${fieldToHex(nullifierOut)}"`,
  `cash_commitment_out = "${fieldToHex(cashC)}"`,
  `claim_secret = "${fieldToHex(claimSecret)}"`,
  `ent_amount = "${amount.toString()}"`,
  `ent_payer_x = "${fieldToHex(payerX)}"`,
  `ent_memo_hash = "${fieldToHex(memoHash)}"`,
  `ent_salt = "${fieldToHex(salt)}"`,
  `ent_secret = "${fieldToHex(noteSecret)}"`,
  `ent_index = "${entIndex}"`,
  `ent_path = [${path.map((p) => `"${fieldToHex(p)}"`).join(", ")}]`,
  `out_owner_x = "${fieldToHex(outOwnerX)}"`,
  `out_salt = "${fieldToHex(outSalt)}"`,
  `out_salt2 = "${fieldToHex(outSalt2)}"`,
  "",
];

const out = new URL("./payroll_claim/Prover.toml", import.meta.url).pathname;
writeFileSync(out, lines.join("\n"));
console.log("wrote", out);
console.log("root            =", fieldToHex(root));
console.log("nullifier_out   =", fieldToHex(nullifierOut));
console.log("cash_commitment =", fieldToHex(cashC));
