// ENSv2 Sepolia one-time setup: register a 2LD on the v2 .eth PermissionedRegistry via the
// real commit-reveal ETHRegistrar (paid in free-mint MockERC20), deploy a PermissionedResolver
// proxy, point the 2LD at it, and set org text records on the 2LD + ubs/drw child nodes
// (v2 wildcard: the 2LD resolver answers for descendants; records live per-node on it).
// Idempotent — safe to rerun. State in ens-v2.config.json.
// Usage (from repo root): bun scripts/ens-v2-setup.ts
import { readFileSync, writeFileSync, existsSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  hexToBigInt,
  http,
  keccak256,
  labelhash,
  namehash,
  parseAbi,
  parseEventLogs,
  toBytes,
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

// ENSv2 Sepolia addresses (verified onchain 2026-06-12)
const ETH_REGISTRY = "0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67" as const; // v2 PermissionedRegistry for .eth
const REGISTRAR = "0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA" as const; // ETHRegistrar (commit-reveal)
const PAYMENT_TOKEN = "0x3DfC8b53dAFa5eBbb071a8B97678Ab534Ed838D9" as const; // MockERC20, free public mint
const FACTORY = "0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198" as const; // VerifiableFactory
const RESOLVER_IMPL = "0xdcE5205A553573FFd47629327DDdf36186022FfA" as const; // PermissionedResolver impl
const UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" as const; // URv2

const CANDIDATE_LABELS = ["aragornrings", "aragorn-rings-v2", "aragornringsv2"];
const DURATION = 31_536_000n; // 1y (uint64)
const SECRET = ("0x" + "a1".repeat(32)) as `0x${string}`;
const ZERO32 = ("0x" + "0".repeat(64)) as `0x${string}`;
// ROLE_SET_ADDR | ROLE_SET_TEXT + their admin counterparts (<<128)
const ROLE_BITMAP = 0x0000000000000000000000000000001100000000000000000000000000000011n;

// ABIs verified against Blockscout-verified sources 2026-06-12
const registrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function MAX_COMMITMENT_AGE() view returns (uint64)",
]);
const registryAbi = parseAbi([
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource) state)",
  "function getResolver(string label) view returns (address)",
  "function setResolver(uint256 anyId, address resolver)",
]);
const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes initData) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
const resolverAbi = parseAbi([
  "function initialize(address admin, uint256 roleBitmap)",
  "function setText(bytes32 node, string key, string value)",
  "function text(bytes32 node, string key) view returns (string)",
]);

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const txHashes: Record<string, `0x${string}`> = {};
async function send(tx: Promise<`0x${string}`>, what: string) {
  const hash = await tx;
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${what} reverted (${hash})`);
  console.log(`  ✓ ${what} (${hash})`);
  txHashes[what] = hash;
  return r;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── state file
const stateFile = "ens-v2.config.json";
type State = { label?: string; name?: string; resolver?: `0x${string}` };
let state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const saveState = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

const tokenIdOf = (label: string) => hexToBigInt(labelhash(label));
async function ownedByUs(label: string): Promise<boolean> {
  const s = await pub.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getState",
    args: [tokenIdOf(label)],
  });
  return s.status !== 0 && s.latestOwner.toLowerCase() === account.address.toLowerCase();
}

// ── 1. pick / recover the 2LD label
let label: string | undefined;
if (state.label && (await ownedByUs(state.label))) {
  label = state.label;
  console.log(`── ${label}.eth already registered by us (from ${stateFile})`);
}
let needsRegistration = false;
if (!label) {
  for (const cand of CANDIDATE_LABELS) {
    if (await ownedByUs(cand)) {
      label = cand; // registered by us in a previous (partial) run
      console.log(`── ${cand}.eth already owned by deployer, reusing`);
      break;
    }
    const free = await pub.readContract({
      address: REGISTRAR,
      abi: registrarAbi,
      functionName: "isAvailable",
      args: [cand],
    });
    if (free) {
      label = cand;
      needsRegistration = true;
      break;
    }
    console.log(`  ${cand}.eth unavailable, trying next`);
  }
}
if (!label) throw new Error("no candidate label available");
const name = `${label}.eth`;
state.label = label;
state.name = name;
saveState();

// ── 2. register via commit-reveal (paid in free-mint MockERC20)
if (needsRegistration) {
  console.log(`── registering ${name} (ENSv2 commit-reveal)`);
  const [base, premium] = await pub.readContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "getRegisterPrice",
    args: [label, DURATION, PAYMENT_TOKEN],
  });
  const price = base + premium;
  console.log(`  price: ${price} token units (base ${base} + premium ${premium})`);

  const balance = await pub.readContract({
    address: PAYMENT_TOKEN,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance < price) {
    await send(
      wallet.writeContract({
        address: PAYMENT_TOKEN,
        abi: tokenAbi,
        functionName: "mint",
        args: [account.address, price * 2n - balance],
      }),
      "mint payment token",
    );
  }
  const allowance = await pub.readContract({
    address: PAYMENT_TOKEN,
    abi: tokenAbi,
    functionName: "allowance",
    args: [account.address, REGISTRAR],
  });
  if (allowance < price) {
    await send(
      wallet.writeContract({
        address: PAYMENT_TOKEN,
        abi: tokenAbi,
        functionName: "approve",
        args: [REGISTRAR, price * 2n],
      }),
      "approve registrar",
    );
  }

  // commitment — subregistry/resolver = 0 at registration time (resolver set later)
  const commitment = await pub.readContract({
    address: REGISTRAR,
    abi: registrarAbi,
    functionName: "makeCommitment",
    args: [label, account.address, SECRET, zeroAddress, zeroAddress, DURATION, ZERO32],
  });
  const [minAge, maxAge, committedAt] = await Promise.all([
    pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "MIN_COMMITMENT_AGE" }),
    pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "MAX_COMMITMENT_AGE" }),
    pub.readContract({
      address: REGISTRAR,
      abi: registrarAbi,
      functionName: "commitmentAt",
      args: [commitment],
    }),
  ]);
  const now = (await pub.getBlock()).timestamp;
  let commitTs = BigInt(committedAt);
  const stale = commitTs > 0n && now - commitTs >= BigInt(maxAge);
  if (commitTs === 0n || stale) {
    await send(
      wallet.writeContract({
        address: REGISTRAR,
        abi: registrarAbi,
        functionName: "commit",
        args: [commitment],
      }),
      "commit",
    );
    commitTs = (await pub.getBlock()).timestamp;
  } else {
    console.log(`  reusing existing commitment from ${commitTs}`);
  }
  const age = Number((await pub.getBlock()).timestamp - commitTs);
  const waitFor = Number(minAge) + 5 - age;
  if (waitFor > 0) {
    console.log(`  waiting ${waitFor}s for MIN_COMMITMENT_AGE (${minAge}s)…`);
    await sleep(waitFor * 1000);
  }

  await send(
    wallet.writeContract({
      address: REGISTRAR,
      abi: registrarAbi,
      functionName: "register",
      args: [
        label,
        account.address,
        SECRET,
        zeroAddress, // subregistry
        zeroAddress, // resolver (set in step 4)
        DURATION,
        PAYMENT_TOKEN,
        ZERO32, // referrer
      ],
    }),
    `register ${name}`,
  );
}
console.log(`── 2LD: ${name} (owner ${account.address})`);

// ── 3. PermissionedResolver proxy via VerifiableFactory (deterministic salt → idempotent)
const salt = hexToBigInt(
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [keccak256(toBytes("OwnedResolver")), account.address, 0n],
    ),
  ),
);
const initData = encodeFunctionData({
  abi: resolverAbi,
  functionName: "initialize",
  args: [account.address, ROLE_BITMAP],
});

async function findExistingProxy(): Promise<`0x${string}` | undefined> {
  // Alchemy free tier caps eth_getLogs ranges, so use Blockscout's logs API instead.
  const topic0 = "0x0a2c575ff341b41da136c9ccae74ec230a927a024d18f0dccf46d123f28f5f54"; // ProxyDeployed
  const topic1 = `0x${account.address.slice(2).toLowerCase().padStart(64, "0")}`;
  const url =
    `https://eth-sepolia.blockscout.com/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest` +
    `&address=${FACTORY}&topic0=${topic0}&topic1=${topic1}&topic0_1_opr=and`;
  const res = (await (await fetch(url)).json()) as { result?: Array<{ topics: string[]; data: string }> };
  for (const log of res.result ?? []) {
    const logSalt = hexToBigInt(log.data.slice(0, 66) as `0x${string}`);
    if (logSalt === salt) return ("0x" + log.topics[2].slice(26)) as `0x${string}`;
  }
  return undefined;
}

let resolver = state.resolver;
if (resolver && (await pub.getCode({ address: resolver })) === undefined) resolver = undefined;
if (!resolver) {
  console.log("── deploying PermissionedResolver proxy");
  try {
    const receipt = await send(
      wallet.writeContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "deployProxy",
        args: [RESOLVER_IMPL, salt, initData],
      }),
      "deployProxy",
    );
    const ev = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" })[0];
    resolver = ev.args.proxyAddress;
  } catch (e) {
    console.log(`  deployProxy failed (${(e as Error).message.split("\n")[0]}), recovering existing proxy`);
    resolver = await findExistingProxy();
    if (!resolver) throw e;
  }
  state.resolver = resolver;
  saveState();
}
console.log(`── resolver proxy: ${resolver}`);

// ── 4. point the 2LD at the proxy (registration granted us ROLE_SET_RESOLVER)
const currentResolver = await pub.readContract({
  address: ETH_REGISTRY,
  abi: registryAbi,
  functionName: "getResolver",
  args: [label],
});
if (currentResolver.toLowerCase() !== resolver.toLowerCase()) {
  await send(
    wallet.writeContract({
      address: ETH_REGISTRY,
      abi: registryAbi,
      functionName: "setResolver",
      args: [tokenIdOf(label), resolver],
    }),
    `setResolver ${name}`,
  );
}

// ── 5. text records — per-node on the SAME resolver (v2 wildcard answers for descendants)
const RECORDS: Record<string, Record<string, string>> = {
  [name]: { "aragorn.project": "Aragorn" },
  [`ubs.${name}`]: {
    "aragorn.encpubkey": "0x7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13",
    "aragorn.endpoint": "http://127.0.0.1:4001",
    "aragorn.partyroot": "0x17e0796c17481a34e6aa53421dce80dd2e7b2a1d49a48e49880faa8e7dcc97a4",
  },
  [`drw.${name}`]: {
    "aragorn.encpubkey": "0x0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20",
    "aragorn.endpoint": "http://127.0.0.1:4002",
    "aragorn.partyroot": "0x0e6888df5c6acfaea4c9e2d31ffd717268abc22f9cba99efe0300295b3ae6e3a",
  },
};
for (const [fqdn, records] of Object.entries(RECORDS)) {
  const node = namehash(fqdn);
  for (const [key, value] of Object.entries(records)) {
    let current = "";
    try {
      current = await pub.readContract({
        address: resolver,
        abi: resolverAbi,
        functionName: "text",
        args: [node, key],
      });
    } catch {
      // unset records may revert
    }
    if (current !== value) {
      await send(
        wallet.writeContract({
          address: resolver,
          abi: resolverAbi,
          functionName: "setText",
          args: [node, key, value],
        }),
        `setText ${fqdn} ${key}`,
      );
    }
  }
}

// ── 6. end-to-end verification via UniversalResolver (URv2)
console.log("── verifying via UniversalResolver");
const checks: Array<[string, string, string]> = [
  [`ubs.${name}`, "aragorn.encpubkey", RECORDS[`ubs.${name}`]["aragorn.encpubkey"]],
  [`ubs.${name}`, "aragorn.endpoint", RECORDS[`ubs.${name}`]["aragorn.endpoint"]],
  [`drw.${name}`, "aragorn.encpubkey", RECORDS[`drw.${name}`]["aragorn.encpubkey"]],
  [`drw.${name}`, "aragorn.partyroot", RECORDS[`drw.${name}`]["aragorn.partyroot"]],
  [name, "aragorn.project", RECORDS[name]["aragorn.project"]],
];
let allOk = true;
for (const [n, key, expected] of checks) {
  const got = await pub.getEnsText({
    name: n,
    key,
    universalResolverAddress: UNIVERSAL_RESOLVER,
  });
  const ok = got === expected;
  allOk &&= ok;
  console.log(`  ${ok ? "✓" : "✗"} getEnsText(${n}, ${key}) = ${got}`);
}
if (!allOk) throw new Error("UniversalResolver verification failed");

state = { label, name, resolver };
saveState();
console.log(`\n✅ ENSv2 ready: ${name} → resolver ${resolver}`);
console.log(`   nodes: ${name}, ubs.${name}, drw.${name}`);
console.log(`   tx hashes:`);
for (const [what, hash] of Object.entries(txHashes)) console.log(`     ${what}: ${hash}`);
