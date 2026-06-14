// Give internal desks ENS subnames: write `aragorn.partykey` for treasury/trading under
// the org name, so a counterparty can address a specific desk (e.g.
// treasury.jpmorgan.aragornrings.eth) and the ring resolves it via resolveDepartment().
// Wildcard path: setText on the org's PermissionedResolver for the desk subnode (no token mint).
//   SEPOLIA_RPC_URL=… SEPOLIA_DEPLOYER_KEY=… bun scripts/seed-desk-ens.ts
import { createWalletClient, createPublicClient, http, namehash, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { initSchnorr, derivePartyKeys, fieldToHex } from "../packages/protocol/src/index.ts";

await initSchnorr();

const RPC = process.env.SEPOLIA_RPC_URL!;
const KEY = process.env.SEPOLIA_DEPLOYER_KEY as `0x${string}`;
const RESOLVER = "0xC909a297A23e9Fa567E78D5F6a95C311531694F8" as const; // aragornrings.eth PermissionedResolver
const ORG = "jpmorgan.aragornrings.eth";

// JP Morgan desks (PARTY_KEYS in demo-up: treasury 0x111, trading 0x112)
const DESKS: Record<string, bigint> = { treasury: 0x111n, trading: 0x112n };

const account = privateKeyToAccount(KEY);
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const abi = parseAbi(["function setText(bytes32 node, string key, string value)"]);

for (const [desk, priv] of Object.entries(DESKS)) {
  const name = `${desk}.${ORG}`;
  const partyX = fieldToHex(derivePartyKeys(priv).x);
  const hash = await wallet.writeContract({
    address: RESOLVER,
    abi,
    functionName: "setText",
    args: [namehash(name), "aragorn.partykey", partyX],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  set aragorn.partykey for ${name} = ${partyX.slice(0, 14)}… (tx ${hash.slice(0, 14)}…)`);
}
console.log("done — desks now resolvable by ENS");
