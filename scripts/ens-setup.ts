// ENS Sepolia one-time setup (BUILD_SPEC §6.6, D-005): register the parent name,
// create org subnames, set text records. Idempotent — safe to rerun.
// Usage: bun scripts/ens-setup.ts
import { readFileSync, writeFileSync, existsSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  labelhash,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

function env(name: string): string {
  const fromFile = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`));
  const v = process.env[name] ?? fromFile?.slice(name.length + 1).trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

const RPC = env("SEPOLIA_RPC_URL");
const KEY = env("SEPOLIA_DEPLOYER_KEY") as `0x${string}`;

// D-005 verified addresses (Sepolia)
const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
// the ACTUALLY-authorized Sepolia controller (docs' 0xfb3c… is not yet authorized on the
// BaseRegistrar — verified by trace 2026-06-12). Free registrations, no commit-reveal.
const CONTROLLER = "0xdf60C561Ca35AD3C89D24BbA854654b1c3477078" as const;
const REGISTRATION_RESOLVER = "0x422484c2d51f92830bfb563fa5e172aa2d8b884b" as const; // set by controller
// subname records live on the CLASSIC PublicResolver (the modern one rejects setText for
// registry-owned subnodes — verified 2026-06-12)
const PUBLIC_RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;

const CANDIDATE_LABELS = ["aragorn-rings", "aragornrings", "aragorn-demo-rings"];
const DURATION = 31_536_000n; // 1y
const SECRET = ("0x" + "a1".repeat(32)) as `0x${string}`;

const controllerAbi = parseAbi([
  "struct Registration { string label; address owner; uint256 duration; bytes32 secret; address resolver; bytes[] data; uint8 reverseRecord; bytes32 referrer; }",
  "function available(string label) view returns (bool)",
  "function rentPrice(string label, uint256 duration) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(Registration registration) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(Registration registration) payable",
]);
const registryAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
  "function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)",
  "function setResolver(bytes32 node, address resolver)",
]);
const resolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
  "function setText(bytes32 node, string key, string value)",
  "function setAddr(bytes32 node, address a)",
]);

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

async function send(tx: Promise<`0x${string}`>, what: string) {
  const hash = await tx;
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${what} reverted (${hash})`);
  console.log(`  ✓ ${what} (${hash.slice(0, 18)}…)`);
}

// ── 1. parent name
const stateFile = "ens.config.json";
let parentLabel: string | undefined = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, "utf8")).parentLabel
  : undefined;

if (parentLabel) {
  const owner = await pub.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "owner",
    args: [namehash(`${parentLabel}.eth`)],
  });
  if (owner.toLowerCase() !== account.address.toLowerCase()) parentLabel = undefined;
}

if (!parentLabel) {
  for (const label of CANDIDATE_LABELS) {
    const currentOwner = await pub.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "owner",
      args: [namehash(`${label}.eth`)],
    });
    if (currentOwner === zeroAddress) {
      parentLabel = label;
      break;
    }
    console.log(`  ${label}.eth unavailable, trying next`);
  }
  if (!parentLabel) throw new Error("no candidate label available");

  console.log(`── registering ${parentLabel}.eth on Sepolia`);
  const registration = {
    label: parentLabel,
    owner: account.address,
    duration: DURATION,
    secret: SECRET,
    resolver: REGISTRATION_RESOLVER,
    data: [],
    reverseRecord: 0,
    referrer: ("0x" + "0".repeat(64)) as `0x${string}`,
  } as const;
  await send(
    wallet.writeContract({
      address: CONTROLLER,
      abi: controllerAbi,
      functionName: "register",
      args: [registration],
      value: 0n, // free on this testnet controller
    }),
    `register ${parentLabel}.eth`,
  );
  writeFileSync(stateFile, JSON.stringify({ parentLabel, parent: `${parentLabel}.eth` }, null, 2));
}

const parent = `${parentLabel}.eth`;
console.log(`── parent: ${parent} (owner ${account.address})`);

// ── 2. org subnames + text records
// org → {encPubkey, endpoint, partyroot} — must match the P2 directory values
const ORGS: Record<string, { encpubkey: string; endpoint: string; partyroot: string }> = {
  ubs: {
    encpubkey: "0x7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
    endpoint: "http://127.0.0.1:4001",
    partyroot: "0x17e0796c17481a34e6aa53421dce80dd2e7b2a1d49a48e49880faa8e7dcc97a4",
  },
  drw: {
    encpubkey: "0x0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20",
    endpoint: "http://127.0.0.1:4002",
    partyroot: "0x0e6888df5c6acfaea4c9e2d31ffd717268abc22f9cba99efe0300295b3ae6e3a",
  },
};

const parentNode = namehash(parent);
for (const [org, records] of Object.entries(ORGS)) {
  const node = namehash(`${org}.${parent}`);
  const owner = await pub.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "owner",
    args: [node],
  });
  if (owner === zeroAddress) {
    await send(
      wallet.writeContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "setSubnodeRecord",
        args: [parentNode, labelhash(org), account.address, PUBLIC_RESOLVER, 0n],
      }),
      `create ${org}.${parent}`,
    );
  } else {
    const currentResolver = await pub.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "resolver",
      args: [node],
    });
    if (currentResolver.toLowerCase() !== PUBLIC_RESOLVER.toLowerCase()) {
      await send(
        wallet.writeContract({
          address: REGISTRY,
          abi: registryAbi,
          functionName: "setResolver",
          args: [node, PUBLIC_RESOLVER],
        }),
        `setResolver ${org}.${parent}`,
      );
    }
  }
  for (const [key, value] of Object.entries(records)) {
    const fullKey = `aragorn.${key}`;
    let current = "";
    try {
      current = await pub.readContract({
        address: PUBLIC_RESOLVER,
        abi: resolverAbi,
        functionName: "text",
        args: [node, fullKey],
      });
    } catch {
      // this resolver reverts on unset records
    }
    if (current !== value) {
      await send(
        wallet.writeContract({
          address: PUBLIC_RESOLVER,
          abi: resolverAbi,
          functionName: "setText",
          args: [node, fullKey, value],
        }),
        `setText ${org}.${parent} ${fullKey}`,
      );
    }
  }
}

console.log(`\n✅ ENS ready: ${Object.keys(ORGS).map((o) => `${o}.${parent}`).join(", ")}`);
