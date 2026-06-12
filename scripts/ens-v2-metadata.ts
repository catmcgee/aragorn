// ENSv2 as the org metadata layer (user direction): departments as resolvable entities,
// org capability metadata, auditor disclosure key — all per-node records on the org's
// PermissionedResolver, resolved through v2 wildcard. Idempotent.
import { readFileSync } from "fs";
import { createPublicClient, createWalletClient, http, namehash, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ROOT = process.cwd();
const env = Object.fromEntries(
  readFileSync(`${ROOT}/.env.local`, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const cfg = JSON.parse(readFileSync(`${ROOT}/ens-v2.config.json`, "utf8"));
const RESOLVER = cfg.resolver as `0x${string}`;
const PARENT = cfg.name as string; // aragornrings.eth

const resolverAbi = parseAbi([
  "function setText(bytes32 node, string key, string value)",
  "function text(bytes32 node, string key) view returns (string)",
]);

const account = privateKeyToAccount(env.SEPOLIA_DEPLOYER_KEY as `0x${string}`);
const pub = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });

// THE METADATA MODEL
// org node:        aragorn.modules, aragorn.auditorkey (+ existing encpubkey/endpoint/partyroot)
// department node: aragorn.partykey (settlement pubkey x), aragorn.desk (human label)
const RECORDS: Record<string, Record<string, string>> = {
  [`ubs.${PARENT}`]: {
    "aragorn.modules": "payments,repo,payroll,issuance,strategies",
    "aragorn.auditorkey": "0x7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
  },
  [`treasury.ubs.${PARENT}`]: {
    "aragorn.partykey": "0x17e0796c17481a34e6aa53421dce80dd2e7b2a1d49a48e49880faa8e7dcc97a4",
    "aragorn.desk": "Group Treasury",
  },
  [`trading.ubs.${PARENT}`]: {
    "aragorn.partykey": "0x2e72bde3d5a518a1945bf2dc7630464974201f6bddd9f7a3d465cb46be3f003e",
    "aragorn.desk": "Repo & Collateral Desk",
  },
  [`drw.${PARENT}`]: {
    "aragorn.modules": "payments,repo,strategies",
    "aragorn.auditorkey": "0x0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20",
  },
  [`desk.drw.${PARENT}`]: {
    "aragorn.partykey": "0x0e6888df5c6acfaea4c9e2d31ffd717268abc22f9cba99efe0300295b3ae6e3a",
    "aragorn.desk": "Principal Trading",
  },
};

for (const [name, records] of Object.entries(RECORDS)) {
  const node = namehash(name);
  for (const [key, value] of Object.entries(records)) {
    let current = "";
    try {
      current = await pub.readContract({
        address: RESOLVER,
        abi: resolverAbi,
        functionName: "text",
        args: [node, key],
      });
    } catch {}
    if (current === value) continue;
    const hash = await wallet.writeContract({
      address: RESOLVER,
      abi: resolverAbi,
      functionName: "setText",
      args: [node, key, value],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  ✓ ${name} ${key} (${hash.slice(0, 14)}…)`);
  }
}

// verify through the UniversalResolver (the real resolution path)
for (const [name, records] of Object.entries(RECORDS)) {
  for (const key of Object.keys(records)) {
    const got = await pub.getEnsText({ name, key });
    if (got !== records[key]) throw new Error(`verify failed: ${name} ${key} = ${got}`);
  }
}
console.log(`\n✅ ENSv2 metadata layer live: departments, modules, auditor keys on ${PARENT}`);
