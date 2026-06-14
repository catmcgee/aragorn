// Wire the REAL ENS v2 registry hierarchy on the live `aragornrings.eth`, so
// `jpmorgan.aragornrings.eth` and `trading/treasury.jpmorgan.aragornrings.eth`
// resolve through the canonical chain (eth → aragornrings → jpmorgan → desk),
// not just flat wildcard records. This is the fix for ENS's feedback:
// "aragornrings.eth has no subregistry; for trading.jpmorgan.* to exist,
//  jpmorgan.aragornrings.eth must exist."
//
// Hierarchy built:
//   aragornrings.eth        ── .eth registry → setSubregistry → ORG registry (deployed here)
//     jpmorgan              ── ORG registry → register(jpmorgan, subregistry=INST, resolver=RES)
//       treasury            ── INST registry → register(treasury, resolver=RES)
//       trading             ── INST registry → register(trading,  resolver=RES)
//
// RES = the EXISTING PermissionedResolver 0xC909… that already holds the
// aragorn.* records (encpubkey/partyroot/partykey) keyed by full-name namehash,
// so canonical traversal reaches the records we already wrote — no re-seed.
//
// Idempotent. Sends LIVE Sepolia txs from SEPOLIA_DEPLOYER_KEY (the 2LD owner).
//   bun scripts/ens-v2-aragornrings.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
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
  const fromFile = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
    : undefined;
  const v = process.env[name] ?? fromFile?.slice(name.length + 1).trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

const RPC = env("SEPOLIA_RPC_URL");
const KEY = env("SEPOLIA_DEPLOYER_KEY") as `0x${string}`;

// ENS v2 Sepolia (same set as ens-v2-subregistry.ts, confirmed 2026-06-13)
const ETH_REGISTRY = "0xdedb92913a25abe1f7bcdd85d8a344a43b398b67" as const; // .eth PermissionedRegistry (parent)
const FACTORY = "0xd2a632d8a8b67c2c4398c255cbd7af8dd7236198" as const; // VerifiableFactory
const SUBREGISTRY_IMPL = "0x0f99e7ea74903afcb7224d0354fd7428a6f92917" as const; // UserRegistry (PermissionedRegistry) impl
const UNIVERSAL_RESOLVER = "0xeeeeeeee14d718c2b47d9923deab1335e144eeee" as const; // URv2
// reuse the resolver that already holds the aragornrings records
const RESOLVER = "0xC909a297A23e9Fa567E78D5F6a95C311531694F8" as const;

const ORG_LABEL = "aragornrings"; // the live 2LD we own
const INSTITUTION = "jpmorgan"; // org subname under aragornrings.eth
const DEPARTMENTS = ["treasury", "trading"]; // desk subnames under jpmorgan.aragornrings.eth

// RegistryRolesLib bit positions (verified vs contracts-v2)
const ROLE_REGISTRAR = 1n << 0n;
const ROLE_UNREGISTER = 1n << 12n;
const ROLE_RENEW = 1n << 16n;
const ROLE_SET_SUBREGISTRY = 1n << 20n;
const ROLE_SET_RESOLVER = 1n << 24n;
const ADMIN = 128n;
const withAdmin = (r: bigint) => r | (r << ADMIN);
const REGISTRY_ADMIN_BITMAP =
  withAdmin(ROLE_REGISTRAR | ROLE_UNREGISTER | ROLE_RENEW | ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER);
const OWNER_BITMAP = withAdmin(ROLE_UNREGISTER | ROLE_RENEW | ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER);

const ethRegistryAbi = parseAbi([
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource) state)",
  "function getSubregistry(string label) view returns (address)",
  "function setSubregistry(uint256 anyId, address registry)",
]);
const childRegistryAbi = parseAbi([
  "function initialize(address rootAccount, uint256 roleBitmap)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function getSubregistry(string label) view returns (address)",
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource) state)",
]);
const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
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

const labelId = (label: string) => hexToBigInt(labelhash(label));
function proxySalt(purpose: string): bigint {
  return hexToBigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [keccak256(toBytes(purpose)), account.address, 0n],
      ),
    ),
  );
}
async function findProxy(salt: bigint): Promise<`0x${string}` | undefined> {
  const topic0 = "0x0a2c575ff341b41da136c9ccae74ec230a927a024d18f0dccf46d123f28f5f54"; // ProxyDeployed
  const topic1 = `0x${account.address.slice(2).toLowerCase().padStart(64, "0")}`;
  const url =
    `https://eth-sepolia.blockscout.com/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest` +
    `&address=${FACTORY}&topic0=${topic0}&topic1=${topic1}&topic0_1_opr=and`;
  const res = (await (await fetch(url)).json()) as { result?: Array<{ topics: string[]; data: string }> };
  for (const log of res.result ?? []) {
    if (hexToBigInt(log.data.slice(0, 66) as `0x${string}`) === salt) return ("0x" + log.topics[2].slice(26)) as `0x${string}`;
  }
  return undefined;
}
async function deployProxy(salt: bigint, what: string): Promise<`0x${string}`> {
  const existing = await findProxy(salt);
  if (existing) {
    console.log(`  · ${what} already deployed: ${existing}`);
    return existing;
  }
  const initData = encodeFunctionData({ abi: childRegistryAbi, functionName: "initialize", args: [account.address, REGISTRY_ADMIN_BITMAP] });
  const receipt = await send(
    wallet.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "deployProxy", args: [SUBREGISTRY_IMPL, salt, initData] }),
    `deployProxy ${what}`,
  );
  const ev = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" })[0];
  return ev.args.proxyAddress;
}

const stateFile = "ens-aragornrings.config.json";
type State = { orgRegistry?: `0x${string}`; instRegistry?: `0x${string}` };
let state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

const expiry = BigInt(Math.floor(Date.now() / 1000)) + 31_536_000n; // 1y

// 0. sanity: we must own aragornrings.eth
const orgState = await pub.readContract({ address: ETH_REGISTRY, abi: ethRegistryAbi, functionName: "getState", args: [labelId(ORG_LABEL)] });
if (orgState.latestOwner.toLowerCase() !== account.address.toLowerCase())
  throw new Error(`${ORG_LABEL}.eth not owned by ${account.address} (owner ${orgState.latestOwner})`);
console.log(`── ${ORG_LABEL}.eth owned by us (${account.address})`);

// 1. ORG registry — aragornrings.eth's own subregistry
const orgRegistry = state.orgRegistry ?? (await deployProxy(proxySalt(`AragornOrgReg:${ORG_LABEL}`), "org registry"));
state.orgRegistry = orgRegistry; save();
console.log(`── org registry (aragornrings.eth subtree): ${orgRegistry}`);

const attachedOrg = await pub.readContract({ address: ETH_REGISTRY, abi: ethRegistryAbi, functionName: "getSubregistry", args: [ORG_LABEL] });
if (attachedOrg.toLowerCase() !== orgRegistry.toLowerCase()) {
  await send(
    wallet.writeContract({ address: ETH_REGISTRY, abi: ethRegistryAbi, functionName: "setSubregistry", args: [labelId(ORG_LABEL), orgRegistry] }),
    `setSubregistry aragornrings.eth → ${orgRegistry.slice(0, 10)}…`,
  );
}

// 2. INSTITUTION registry — jpmorgan.aragornrings.eth's own subregistry (holds the desks)
const instRegistry = state.instRegistry ?? (await deployProxy(proxySalt(`AragornInstReg:${INSTITUTION}`), "institution registry"));
state.instRegistry = instRegistry; save();
console.log(`── institution registry (jpmorgan subtree): ${instRegistry}`);

// 3. register jpmorgan in the ORG registry → attach its subregistry + point at the existing resolver
const instState = await pub.readContract({ address: orgRegistry, abi: childRegistryAbi, functionName: "getState", args: [labelId(INSTITUTION)] }).catch(() => null);
if (!instState || instState.status === 0) {
  await send(
    wallet.writeContract({ address: orgRegistry, abi: childRegistryAbi, functionName: "register", args: [INSTITUTION, account.address, instRegistry, RESOLVER, OWNER_BITMAP, expiry] }),
    `register ${INSTITUTION}.${ORG_LABEL}.eth (subreg ${instRegistry.slice(0, 10)}…)`,
  );
} else {
  console.log(`  · ${INSTITUTION}.${ORG_LABEL}.eth already registered`);
  const sub = await pub.readContract({ address: orgRegistry, abi: childRegistryAbi, functionName: "getSubregistry", args: [INSTITUTION] }).catch(() => zeroAddress);
  if (sub.toLowerCase() !== instRegistry.toLowerCase())
    console.log(`    ⚠ subregistry is ${sub}, expected ${instRegistry} — may need a manual setSubregistry`);
}

// 4. register each desk in the INSTITUTION registry, pointing at the existing resolver
for (const dept of DEPARTMENTS) {
  const st = await pub.readContract({ address: instRegistry, abi: childRegistryAbi, functionName: "getState", args: [labelId(dept)] }).catch(() => null);
  if (!st || st.status === 0) {
    await send(
      wallet.writeContract({ address: instRegistry, abi: childRegistryAbi, functionName: "register", args: [dept, account.address, zeroAddress, RESOLVER, OWNER_BITMAP, expiry] }),
      `register ${dept}.${INSTITUTION}.${ORG_LABEL}.eth`,
    );
  } else {
    console.log(`  · ${dept}.${INSTITUTION}.${ORG_LABEL}.eth already registered`);
  }
}

// 5. verify canonical resolution through UniversalResolverV2
console.log("── verifying canonical resolution via UniversalResolverV2");
const checks: Array<[string, string]> = [
  [`${INSTITUTION}.${ORG_LABEL}.eth`, "aragorn.encpubkey"],
  [`treasury.${INSTITUTION}.${ORG_LABEL}.eth`, "aragorn.partykey"],
  [`trading.${INSTITUTION}.${ORG_LABEL}.eth`, "aragorn.partykey"],
];
let ok = true;
for (const [name, key] of checks) {
  let got = "";
  try {
    got = await pub.getEnsText({ name, key, universalResolverAddress: UNIVERSAL_RESOLVER });
  } catch (e) {
    got = `<error: ${(e as Error).message.split("\n")[0]}>`;
  }
  const good = got.startsWith("0x") && got.length > 10;
  ok &&= good;
  console.log(`  ${good ? "✓" : "✗"} getEnsText(${name}, ${key}) = ${got}`);
}

save();
console.log(`\n${ok ? "✅" : "⚠️ "} hierarchy wired on ${ORG_LABEL}.eth`);
console.log(`   org registry:         ${orgRegistry}`);
console.log(`   institution registry: ${instRegistry}`);
console.log(`   resolver (reused):    ${RESOLVER}`);
for (const [what, hash] of Object.entries(txHashes)) console.log(`     ${what}: ${hash}`);
if (!ok) console.log("\n   (records may take a block or two; re-run to re-verify — it's idempotent)");
