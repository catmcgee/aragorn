// In-browser entitlement_claim proving — DOM-free so the web worker AND the
// bun smoke test (scripts/test-prove.ts) share the exact same witness code.
// Mirrors packages/protocol/src/{field,poseidon,note}.ts and the server-side
// claim in apps/ring/src/payroll.ts.

import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js";
import { Barretenberg, BarretenbergSync, UltraHonkBackend } from "@aztec/bb.js";

// ── field helpers (packages/protocol/src/field.ts) ──────────────────────────

export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type Field = bigint;

export function fieldToU8(x: Field): Uint8Array {
  const b = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

export function u8ToField(u: Uint8Array): Field {
  let v = 0n;
  for (const byte of u) v = (v << 8n) | BigInt(byte);
  return v;
}

export function fieldToHex(x: Field): `0x${string}` {
  return `0x${x.toString(16).padStart(64, "0")}` as `0x${string}`;
}

export function hexToField(h: string): Field {
  return BigInt(h);
}

export function randomField(): Field {
  const u = crypto.getRandomValues(new Uint8Array(32));
  return u8ToField(u) % FIELD_MODULUS;
}

// ── poseidon2 (BarretenbergSync — same params as the circuit, D-002) ─────────

let syncApi: Awaited<ReturnType<typeof BarretenbergSync.initSingleton>> | undefined;

export async function initPoseidon(): Promise<void> {
  syncApi ??= await BarretenbergSync.initSingleton();
}

export function poseidon2(inputs: Field[]): Field {
  if (!syncApi) throw new Error("call initPoseidon() first");
  const { hash } = syncApi.poseidon2Hash({ inputs: inputs.map(fieldToU8) });
  return u8ToField(hash);
}

// ── claim witness construction ───────────────────────────────────────────────

/** Response of POST /v1/payroll/claim-data. */
export interface ClaimData {
  entitlementCid: string;
  claimSecret: string;
  amountMicro: string;
  payerX: string;
  memoHash: string;
  salt: string;
  noteSecret: string;
  leafIndex: number;
  merklePath: string[];
  root: string;
}

export interface ClaimWitness {
  inputs: InputMap;
  /** Expected public values (sanity reference) — submit uses the proof's own publicInputs. */
  n1: `0x${string}`;
  c1: `0x${string}`;
}

/**
 * Build the entitlement_claim witness map. The out cash note is owned by a key
 * derived from the claim secret (poseidon2([claimSecret, 42]) — demo derivation;
 * any owner the claimer chooses works), with a fresh random salt.
 */
export function buildClaimWitness(data: ClaimData): ClaimWitness {
  const claimSecret = hexToField(data.claimSecret);
  const amount = BigInt(data.amountMicro);
  const entC = hexToField(data.entitlementCid);
  const noteSecret = hexToField(data.noteSecret);

  // nullifier of the entitlement note
  const n1 = poseidon2([entC, noteSecret]);

  // out cash note: deterministic demo owner key, fresh salt
  const outOwnerX = poseidon2([claimSecret, 42n]);
  const outSalt = randomField();
  const outSalt2 = 0n;

  // c1 = commitment(Cash=1, version=1, payload, stakeholders, salt)
  const payloadHashCash = poseidon2([outOwnerX, amount, outSalt2]);
  const stakeholdersHash = poseidon2([outOwnerX, 0n, 0n, 0n]);
  const c1 = poseidon2([1n, 1n, payloadHashCash, stakeholdersHash, outSalt]);

  const inputs: InputMap = {
    root: data.root,
    t_bound: "0",
    nullifiers: [fieldToHex(n1), "0", "0", "0"],
    commitments: [fieldToHex(c1), "0", "0", "0"],
    aux: ["0", "0", "0", "0"],
    claim_secret: data.claimSecret,
    ent_amount: data.amountMicro,
    ent_payer_x: data.payerX,
    ent_memo_hash: data.memoHash,
    ent_salt: data.salt,
    ent_secret: data.noteSecret,
    ent_index: data.leafIndex,
    ent_path: data.merklePath,
    out_owner_x: fieldToHex(outOwnerX),
    out_salt: fieldToHex(outSalt),
    out_salt2: fieldToHex(outSalt2),
  };

  return { inputs, n1: fieldToHex(n1), c1: fieldToHex(c1) };
}

// ── proving ──────────────────────────────────────────────────────────────────

export interface ProofBundle {
  /** 0x-prefixed proof bytes. */
  proof: `0x${string}`;
  /** hex bytes32 strings in circuit declaration order — submitted verbatim. */
  publicInputs: string[];
}

export type ProveStage = "executing-witness" | "proving";

let asyncApi: Awaited<ReturnType<typeof Barretenberg.initSingleton>> | undefined;

async function getBarretenberg() {
  if (asyncApi) return asyncApi;
  try {
    asyncApi = await Barretenberg.initSingleton();
  } catch {
    // SharedArrayBuffer unavailable (no cross-origin isolation) — single thread.
    asyncApi = await Barretenberg.initSingleton({ threads: 1 });
  }
  return asyncApi;
}

export async function proveClaim(
  artifact: CompiledCircuit,
  inputs: InputMap,
  onStage?: (stage: ProveStage) => void,
): Promise<ProofBundle> {
  onStage?.("executing-witness");
  const noir = new Noir(artifact);
  const { witness } = await noir.execute(inputs);

  onStage?.("proving");
  const api = await getBarretenberg();
  const backend = new UltraHonkBackend(artifact.bytecode, api);
  const { proof, publicInputs } = await backend.generateProof(witness, {
    verifierTarget: "evm",
  });

  let hex = "";
  for (const b of proof) hex += b.toString(16).padStart(2, "0");
  return { proof: `0x${hex}`, publicInputs };
}
