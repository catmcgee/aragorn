// Note structure (§3.3): payload_hash, stakeholders_hash, commitment C, nullifier N.
import {
  MAX_STAKEHOLDERS,
  PAYLOAD_FIELDS,
  PROTOCOL_VERSION,
  type TemplateId,
} from "./constants.js";
import { type Field, assertField, fieldToHex, packBytesToFields, randomField } from "./field.js";
import { poseidon2 } from "./poseidon.js";

export type PayloadFields = Record<string, Field>;

export interface Note {
  templateId: TemplateId;
  /** Template payload in §3.6 field order. */
  fields: PayloadFields;
  /** Commitment salt. */
  salt: Field;
  /** Nullifier secret — shipped encrypted to ALL stakeholders (authority-from-contract). */
  noteSecret: Field;
  /** Party pubkey x-coordinates of every stakeholder (≤ 4). */
  stakeholders: Field[];
}

export function payloadHash(templateId: TemplateId, fields: PayloadFields): Field {
  const order = PAYLOAD_FIELDS[templateId];
  const inputs = order.map((name) => {
    const v = fields[name];
    if (v === undefined) throw new Error(`missing payload field ${name} for template ${templateId}`);
    return assertField(v);
  });
  return poseidon2(inputs);
}

/** Sorted-ascending party x-coords, zero-padded to 4 (§3.3). */
export function stakeholdersHash(stakeholders: Field[]): Field {
  if (stakeholders.length === 0 || stakeholders.length > MAX_STAKEHOLDERS)
    throw new Error(`stakeholder count must be 1..${MAX_STAKEHOLDERS}`);
  const sorted = [...stakeholders].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  while (sorted.length < MAX_STAKEHOLDERS) sorted.push(0n);
  return poseidon2(sorted);
}

export function commitment(note: Note): Field {
  return poseidon2([
    BigInt(note.templateId),
    PROTOCOL_VERSION,
    payloadHash(note.templateId, note.fields),
    stakeholdersHash(note.stakeholders),
    note.salt,
  ]);
}

export function nullifier(c: Field, noteSecret: Field): Field {
  return poseidon2([c, noteSecret]);
}

/** Contract ID at the API layer: cid = "0x" + hex(C). */
export function cid(note: Note): `0x${string}` {
  return fieldToHex(commitment(note));
}

/** Poseidon2 of UTF-8 bytes packed 31-per-field (isin_hash, memo_hash). */
export function stringHash(s: string): Field {
  return poseidon2(packBytesToFields(s));
}

export function newNote(
  templateId: TemplateId,
  fields: PayloadFields,
  stakeholders: Field[],
): Note {
  return { templateId, fields, salt: randomField(), noteSecret: randomField(), stakeholders };
}
