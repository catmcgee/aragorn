import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { readFileSync } from "fs";

const artifact = JSON.parse(readFileSync("noir_fixture/target/poseidon2_fixture.json", "utf8"));
const witness = readFileSync("noir_fixture/target/witness.gz");

const api = await Barretenberg.initSingleton();
const backend = new UltraHonkBackend(artifact.bytecode, api);
const t0 = Date.now();
const proof = await backend.generateProof(new Uint8Array(witness), { keccak: true });
console.log("proved in", Date.now() - t0, "ms; proof bytes:", proof.proof.length, "public inputs:", proof.publicInputs.length);
const ok = await backend.verifyProof(proof, { keccak: true });
console.log("bb.js verify:", ok);
process.exit(ok ? 0 : 1);
