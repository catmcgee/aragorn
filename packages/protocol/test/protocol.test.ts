import { beforeAll, expect, test } from "bun:test";
import {
  TemplateId,
  commitment,
  derivePartyKeys,
  encryptNoteFor,
  initPoseidon,
  initSchnorr,
  MerkleTree,
  newEncKeypair,
  newNote,
  nullifier,
  poseidon2,
  publicInputs,
  signField,
  stakeholdersHash,
  stringHash,
  transitionMessage,
  tryDecryptNote,
} from "../src/index.js";

beforeAll(async () => {
  await initPoseidon();
  await initSchnorr();
});

test("poseidon2 matches P0 fixture vectors", () => {
  expect(poseidon2([1n])).toBe(
    0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373n,
  );
  expect(poseidon2([1n, 2n])).toBe(
    0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383n,
  );
});

test("commitment & nullifier are well-formed and deterministic", () => {
  const note = newNote(TemplateId.Cash, { owner_x: 5n, amount: 1_000_000n, salt2: 9n }, [5n]);
  const c1 = commitment(note);
  const c2 = commitment(note);
  expect(c1).toBe(c2);
  expect(nullifier(c1, note.noteSecret)).not.toBe(nullifier(c1, note.noteSecret + 1n));
});

test("stakeholders hash sorts and pads", () => {
  expect(stakeholdersHash([3n, 1n])).toBe(poseidon2([1n, 3n, 0n, 0n]));
});

test("envelope round-trip + wrong-key rejection", () => {
  const alice = newEncKeypair();
  const bob = newEncKeypair();
  const note = newNote(TemplateId.Cash, { owner_x: 7n, amount: 42n, salt2: 1n }, [7n]);
  const [envA] = encryptNoteFor([alice.publicKey], note);
  const got = tryDecryptNote(alice, envA);
  expect(got?.fields.amount).toBe("0x" + (42n).toString(16).padStart(64, "0"));
  expect(tryDecryptNote(bob, envA)).toBeNull();
});

test("merkle insert/path/root consistency", () => {
  const t = new MerkleTree();
  const i0 = t.insert(11n);
  t.insert(22n);
  const path = t.path(i0);
  // recompute root from path
  let node = 11n;
  let idx = i0;
  for (const sib of path) {
    node = idx % 2 === 0 ? poseidon2([node, sib]) : poseidon2([sib, node]);
    idx = Math.floor(idx / 2);
  }
  expect(node).toBe(t.root);
});

test("schnorr sign over transition message", () => {
  const keys = derivePartyKeys(0x42n);
  const msg = transitionMessage(1n, [2n, 3n], [4n, 5n]);
  const sig = signField(keys, msg);
  expect(sig.sLo).toBeGreaterThan(0n);
});

test("public input layout is 14 zero-padded", () => {
  const pi = publicInputs({ root: 1n, t: 0n, nullifiers: [9n], commitments: [8n], aux: [] });
  expect(pi.length).toBe(14);
  expect(pi[2]).toContain("09");
  expect(pi[3]).toBe("0x" + "0".repeat(64));
});

test("stringHash packs utf8", () => {
  expect(stringHash("US38141G1040-DEMO")).toBe(stringHash("US38141G1040-DEMO"));
  expect(stringHash("a")).not.toBe(stringHash("b"));
});
