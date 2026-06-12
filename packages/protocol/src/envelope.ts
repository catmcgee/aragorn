// Encryption envelope & discovery (§3.7).
// Per-recipient ECIES: ephemeral X25519 → shared secret → XChaCha20-Poly1305.
// Envelope: ephPub(32) ‖ viewTag(4) ‖ nonce(24) ‖ ciphertext.
import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { VIEW_TAG_BYTES, VIEW_TAG_DOMAIN, type TemplateId } from "./constants.ts";
import type { Note } from "./note.ts";
import { type Field, fieldToHex, hexToField } from "./field.ts";

export interface OrgEncKeys {
  publicKey: Uint8Array; // 32
  privateKey: Uint8Array; // 32
}

export function newEncKeypair(): OrgEncKeys {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

function viewTag(sharedSecret: Uint8Array): Uint8Array {
  const domain = new TextEncoder().encode(VIEW_TAG_DOMAIN);
  const buf = new Uint8Array(domain.length + sharedSecret.length);
  buf.set(domain);
  buf.set(sharedSecret, domain.length);
  return sha256(buf).slice(0, VIEW_TAG_BYTES);
}

/** Plaintext (§3.7): JSON — cache, not consensus; the commitment binds canonical values. */
export interface NotePlaintext {
  templateId: TemplateId;
  version: 1;
  fields: Record<string, string>; // hex fields
  salt: string;
  note_secret: string;
  stakeholders: string[]; // party x hex
}

export function notePlaintext(note: Note): NotePlaintext {
  return {
    templateId: note.templateId,
    version: 1,
    fields: Object.fromEntries(
      Object.entries(note.fields).map(([k, v]) => [k, fieldToHex(v)]),
    ),
    salt: fieldToHex(note.salt),
    note_secret: fieldToHex(note.noteSecret),
    stakeholders: note.stakeholders.map(fieldToHex),
  };
}

export function plaintextToNote(p: NotePlaintext): Note {
  return {
    templateId: p.templateId,
    fields: Object.fromEntries(
      Object.entries(p.fields).map(([k, v]) => [k, hexToField(v)]),
    ) as Record<string, Field>,
    salt: hexToField(p.salt),
    noteSecret: hexToField(p.note_secret),
    stakeholders: p.stakeholders.map(hexToField),
  };
}

export function encryptEnvelope(recipientPub: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, recipientPub);
  const tag = viewTag(shared);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const key = sha256(shared); // KDF: sha256(shared) → 32-byte key
  const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(32 + VIEW_TAG_BYTES + 24 + ct.length);
  out.set(ephPub, 0);
  out.set(tag, 32);
  out.set(nonce, 32 + VIEW_TAG_BYTES);
  out.set(ct, 32 + VIEW_TAG_BYTES + 24);
  return out;
}

/** Cheap discovery: recompute the expected tag with our key; null = not for us. */
export function tryDecryptEnvelope(
  keys: OrgEncKeys,
  envelope: Uint8Array,
): Uint8Array | null {
  if (envelope.length < 32 + VIEW_TAG_BYTES + 24 + 16) return null;
  const ephPub = envelope.slice(0, 32);
  const tag = envelope.slice(32, 32 + VIEW_TAG_BYTES);
  const shared = x25519.getSharedSecret(keys.privateKey, ephPub);
  const expected = viewTag(shared);
  if (!expected.every((b, i) => b === tag[i])) return null;
  const nonce = envelope.slice(32 + VIEW_TAG_BYTES, 32 + VIEW_TAG_BYTES + 24);
  const ct = envelope.slice(32 + VIEW_TAG_BYTES + 24);
  try {
    return xchacha20poly1305(sha256(shared), nonce).decrypt(ct);
  } catch {
    return null;
  }
}

export function encryptNoteFor(recipientPubs: Uint8Array[], note: Note): Uint8Array[] {
  const pt = new TextEncoder().encode(JSON.stringify(notePlaintext(note)));
  return recipientPubs.map((pub) => encryptEnvelope(pub, pt));
}

export function tryDecryptNote(keys: OrgEncKeys, envelope: Uint8Array): NotePlaintext | null {
  const pt = tryDecryptEnvelope(keys, envelope);
  if (!pt) return null;
  try {
    return JSON.parse(new TextDecoder().decode(pt)) as NotePlaintext;
  } catch {
    return null;
  }
}
