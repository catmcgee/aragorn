import { FIELD_MODULUS } from "./constants.ts";

export type Field = bigint;

export function assertField(x: bigint): Field {
  if (x < 0n || x >= FIELD_MODULUS) throw new Error(`value out of field range: ${x}`);
  return x;
}

export function fieldToU8(x: Field): Uint8Array {
  assertField(x);
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
  return `0x${assertField(x).toString(16).padStart(64, "0")}` as `0x${string}`;
}

export function hexToField(h: string): Field {
  return assertField(BigInt(h));
}

export function randomField(): Field {
  const u = crypto.getRandomValues(new Uint8Array(32));
  return u8ToField(u) % FIELD_MODULUS;
}

/** Pack UTF-8 bytes into fields, 31 bytes per field (§3.6 isin_hash/memo_hash input). */
export function packBytesToFields(s: string): Field[] {
  const bytes = new TextEncoder().encode(s);
  const fields: Field[] = [];
  for (let i = 0; i < bytes.length; i += 31) {
    const chunk = bytes.slice(i, i + 31);
    let v = 0n;
    for (const byte of chunk) v = (v << 8n) | BigInt(byte);
    fields.push(v);
  }
  return fields.length ? fields : [0n];
}
