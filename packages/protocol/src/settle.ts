// settle() ABI & public input layout (§3.8).
import { PUBLIC_INPUT_COUNT, type CircuitId } from "./constants.ts";
import { type Field, fieldToHex } from "./field.ts";

export interface SettleInputs {
  root: Field;
  /** Claimed time bound; 0 = unchecked (all circuits except repo_close). */
  t: Field;
  nullifiers: Field[]; // ≤ 4, zero-padded by builder
  commitments: Field[]; // ≤ 4
  aux: Field[]; // ≤ 4
}

/** FIXED order, all circuits: [root, T, n1..n4, c1..c4, aux1..aux4] — 14 inputs. */
export function publicInputs(i: SettleInputs): `0x${string}`[] {
  const pad = (xs: Field[]) => [...xs, 0n, 0n, 0n, 0n].slice(0, 4);
  const all = [i.root, i.t, ...pad(i.nullifiers), ...pad(i.commitments), ...pad(i.aux)];
  if (all.length !== PUBLIC_INPUT_COUNT) throw new Error("bad public input count");
  return all.map(fieldToHex);
}

export function addressToField(addr: `0x${string}`): Field {
  return BigInt(addr);
}

export const NOTE_REGISTRY_ABI = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "circuitId", type: "uint32" },
      { name: "proof", type: "bytes" },
      { name: "publicInputs", type: "bytes32[]" },
      { name: "ciphertexts", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "root",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "isKnownRoot",
    stateMutability: "view",
    inputs: [{ name: "_root", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isSpent",
    stateMutability: "view",
    inputs: [{ name: "_nullifier", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "seedCommitments",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitments", type: "bytes32[]" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "circuitId", type: "uint32", indexed: true },
      { name: "nullifiers", type: "bytes32[]", indexed: false },
      { name: "commitments", type: "bytes32[]", indexed: false },
      { name: "ciphertexts", type: "bytes[]", indexed: false },
      { name: "timeBound", type: "uint256", indexed: false },
      { name: "txOrigin", type: "address", indexed: false },
    ],
  },
] as const;

export type { CircuitId };
