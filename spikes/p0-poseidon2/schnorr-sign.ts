// Sign with the NEW scheme (bb.js >= nightly.20260519) for schnorr v0.4.0 in-circuit verify.
import { BarretenbergSync } from "bbsign";

const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");
const api = await BarretenbergSync.initSingleton();

const privateKey = new Uint8Array(32);
privateKey[31] = 0x42; // deterministic test key

const { publicKey } = api.schnorrComputePublicKey({ privateKey });
const message = new Uint8Array(32);
message[31] = 7; // message field = 7

const { s, e } = api.schnorrConstructSignature({ messageField: message, privateKey });
const { verified } = api.schnorrVerifySignature({ messageField: message, publicKey, s, e });
console.log("ts-roundtrip:", verified);

const split = (u: Uint8Array) => ({
  lo: hex(u.slice(16)),
  hi: hex(u.slice(0, 16)),
});
const out = {
  pub_key_x: hex(publicKey.x ?? publicKey.slice(0, 32)),
  pub_key_y: hex(publicKey.y ?? publicKey.slice(32, 64)),
  s: split(s),
  e: split(e),
};
console.log(JSON.stringify(out, null, 2));
