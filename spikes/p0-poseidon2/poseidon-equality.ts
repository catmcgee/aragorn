import { BarretenbergSync } from "@aztec/bb.js";

const NOIR_VECTORS: [bigint[], string][] = [
  [[1n], "0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373"],
  [[1n, 2n], "0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383"],
  [[1n, 2n, 3n], "0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8"],
  [[1n, 2n, 3n, 4n], "0x130bf204a32cac1f0ace56c78b731aa3809f06df2731ebcf6b3464a15788b1b9"],
  [[1n, 2n, 3n, 4n, 5n], "0x2247be7014a54d17342a7ef677f58d28877780d203860396967f5d0a18d259db"],
];

const toU8 = (x: bigint) => {
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
};
const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");

const api = await BarretenbergSync.initSingleton();
let allOk = true;
for (const [inputs, expected] of NOIR_VECTORS) {
  const { hash } = api.poseidon2Hash({ inputs: inputs.map(toU8) });
  const got = hex(hash);
  const ok = got === expected;
  allOk &&= ok;
  console.log(ok ? "OK " : "MISMATCH", JSON.stringify(inputs.map(String)), got);
}
process.exit(allOk ? 0 : 1);
