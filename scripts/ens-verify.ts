import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { readFileSync } from "fs";
const RPC = readFileSync("/Users/catmcgee/Documents/projects/canton-on-mainnet/.env.local","utf8").split("\n").find(l=>l.startsWith("SEPOLIA_RPC_URL="))!.slice(16).trim();
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
for (const name of ["ubs.aragorn-rings.eth", "drw.aragorn-rings.eth"]) {
  const enc = await pub.getEnsText({ name, key: "aragorn.encpubkey" });
  console.log(name, "→", enc);
}
