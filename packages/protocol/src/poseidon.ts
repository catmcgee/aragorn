// Poseidon2 with Barretenberg parameters — the ONLY hash in the protocol (D-002).
// MUST be bb.js's implementation; never a third-party Poseidon (parameter mismatch burn).
import { BarretenbergSync } from "@aztec/bb.js";
import { type Field, fieldToU8, u8ToField } from "./field.js";

let api: Awaited<ReturnType<typeof BarretenbergSync.initSingleton>> | undefined;

/** Must be awaited once at process start before any hashing. */
export async function initPoseidon(): Promise<void> {
  api ??= await BarretenbergSync.initSingleton();
}

export function poseidon2(inputs: Field[]): Field {
  if (!api) throw new Error("call initPoseidon() first");
  const { hash } = api.poseidon2Hash({ inputs: inputs.map(fieldToU8) });
  return u8ToField(hash);
}
