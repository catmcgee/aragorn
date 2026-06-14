// Full ENSIP-10 + ERC-3668 path: viem resolves cat.ubs.aragorn-rings.eth through the REAL
// Sepolia OffchainResolver, which CCIP-reverts to the Ring's local gateway; the signed
// response is verified by resolveWithProof ONCHAIN. Requires the UBS ring on :4001.
import { readFileSync } from "fs";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const pub = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });

const name = process.env.CCIP_NAME ?? "cat.ubs.aragorn-rings.eth";
const value = await pub.getEnsText({ name, key: "description" });
if (!value || !value.includes("Employee")) {
  throw new Error(`CCIP resolution failed: ${name} description = ${JSON.stringify(value)}`);
}
console.log(`   ${name} → "${value}" (ENSIP-10 wildcard → ERC-3668 gateway → onchain sig check) ✓`);
