// Party signatures (§3.4): Schnorr over Grumpkin, NEW scheme (Poseidon2+DST, D-003).
// Signing uses the bbsign alias (bb.js nightly ≥ 20260519); the circuit verifies via
// noir-lang/schnorr v0.4.0. Signed message: msg = Poseidon2([root, nullifiers..., commitments...]).
import { BackendType, BarretenbergSync as SignApi } from "bbsign";
import { type Field, fieldToU8, u8ToField } from "./field.js";
import { poseidon2 } from "./poseidon.js";

let api: Awaited<ReturnType<typeof SignApi.initSingleton>> | undefined;

export async function initSchnorr(): Promise<void> {
  // Force the bundled WASM: auto-detection finds the system bb binary (March nightly,
  // OLD schnorr scheme) via NativeSharedMemory and signs incompatibly (D-003).
  api ??= await SignApi.initSingleton({ backend: BackendType.Wasm });
}

export interface PartyKeys {
  privateKey: Field; // Grumpkin scalar
  x: Field;
  y: Field;
}

export interface Signature {
  sLo: Field;
  sHi: Field;
  eLo: Field;
  eHi: Field;
}

function split128(u: Uint8Array): { lo: Field; hi: Field } {
  return { lo: u8ToField(u.slice(16)), hi: u8ToField(u.slice(0, 16)) };
}

export function derivePartyKeys(privateKey: Field): PartyKeys {
  if (!api) throw new Error("call initSchnorr() first");
  const { publicKey } = api.schnorrComputePublicKey({ privateKey: fieldToU8(privateKey) });
  return { privateKey, x: u8ToField(publicKey.x), y: u8ToField(publicKey.y) };
}

export function signField(keys: PartyKeys, messageField: Field): Signature {
  if (!api) throw new Error("call initSchnorr() first");
  const { s, e } = api.schnorrConstructSignature({
    messageField: fieldToU8(messageField),
    privateKey: fieldToU8(keys.privateKey),
  });
  const sParts = split128(s);
  const eParts = split128(e);
  return { sLo: sParts.lo, sHi: sParts.hi, eLo: eParts.lo, eHi: eParts.hi };
}

/** Transition message (§3.4): Poseidon2([root, all nullifiers..., all commitments...]),
 *  at each circuit's own arity (unpadded slots excluded by the circuit's fixed shape). */
export function transitionMessage(root: Field, nullifiers: Field[], commitments: Field[]): Field {
  return poseidon2([root, ...nullifiers, ...commitments]);
}
