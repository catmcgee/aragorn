// ENS v2 proposal #1 — a Ring OWNS its name's subregistry; departments are real
// onchain ERC-1155 subname tokens (not wildcard text records).
//
// Verified recipe (gskril/ens-cli + ensdomains/contracts-v2):
//   subregistryImplementation 0x0F99… = UserRegistry (UUPS PermissionedRegistry).
//   ETHRegistrar.REGISTRATION_ROLE_BITMAP already grants the 2LD owner
//   ROLE_SET_SUBREGISTRY + ROLE_SET_RESOLVER (+admins) → no extra grant needed.
//   1. deployProxy(subregistryImpl, salt, initialize(owner, ADMIN_BITMAP)) via VerifiableFactory
//   2. setSubregistry(labelhash(2LD), childRegistry) on the .eth registry
//   3. register(dept, owner, 0, resolver, OWNER_BITMAP, expiry) on childRegistry — mints the token
//   4. setText(namehash(dept.2LD), "aragorn.partykey", x) on the resolver
//   5. verify via getEnsText through UniversalResolverV2
//
// DEMO-SAFE: operates on its OWN dedicated 2LD (default labels below), NOT the live
// `aragornrings.eth` the demo's wildcard resolution depends on. Pointing a subregistry at
// the live demo name on these WIP contracts could change descendant resolution — don't.
//
// Idempotent — safe to rerun. State in ens-subregistry.config.json.
// Sends LIVE funded Sepolia txs from SEPOLIA_DEPLOYER_KEY (the 2LD owner).
// Usage: bun scripts/ens-v2-subregistry.ts
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

// ── ENS v2 Sepolia (confirmed 2026-06-13; cross-checked vs gskril/ens-cli addresses.sepolia.v2)
// all-lowercase: viem accepts non-checksummed addrs but rejects bad mixed-case checksums
const ETH_REGISTRY = "0xdedb92913a25abe1f7bcdd85d8a344a43b398b67" as const; // .eth PermissionedRegistry (parent)
const REGISTRAR = "0x8c2e866b439358c41ae05de9cbe8a00bfefaffca" as const; // ETHRegistrar (commit-reveal)
const PAYMENT_TOKEN = "0x3dfc8b53dafa5ebbb071a8b97678ab534ed838d9" as const; // MockERC20, free public mint
const FACTORY = "0xd2a632d8a8b67c2c4398c255cbd7af8dd7236198" as const; // VerifiableFactory (resolver + registry)
const RESOLVER_IMPL = "0xdce5205a553573ffd47629327dddf36186022ffa" as const; // PermissionedResolver impl
const SUBREGISTRY_IMPL = "0x0f99e7ea74903afcb7224d0354fd7428a6f92917" as const; // UserRegistry (PermissionedRegistry) impl
const UNIVERSAL_RESOLVER = "0xeeeeeeee14d718c2b47d9923deab1335e144eeee" as const; // URv2

// ── RegistryRolesLib bit positions (verified vs contracts-v2)
const ROLE_REGISTRAR = 1n << 0n;
const ROLE_UNREGISTER = 1n << 12n;
const ROLE_RENEW = 1n << 16n;
const ROLE_SET_SUBREGISTRY = 1n << 20n;
const ROLE_SET_RESOLVER = 1n << 24n;
const ADMIN = 128n; // admin variant = role << 128
const withAdmin = (r: bigint) => r | (r << ADMIN);
// admin of the child registry needs to mint (REGISTRAR) + manage subregistry/resolver
const REGISTRY_ADMIN_BITMAP =
  withAdmin(ROLE_REGISTRAR | ROLE_UNREGISTER | ROLE_RENEW | ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER);
// roles granted to the department-token owner (V2_DEFAULT_OWNER_ROLE_BITMAP shape)
const OWNER_BITMAP = withAdmin(ROLE_UNREGISTER | ROLE_RENEW | ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER);
// resolver proxy init: ROLE_SET_ADDR | ROLE_SET_TEXT (+admin) — matches ens-v2-setup.ts
const RESOLVER_ROLE_BITMAP = 0x0000000000000000000000000000001100000000000000000000000000000011n;

// dedicated, demo-safe 2LD candidates (NOT aragornrings.eth)
const CANDIDATE_LABELS = ["aragorn-sovereign", "aragorn-subreg", "aragorn-rings-org"];
// departments minted as onchain tokens under the institution's 2LD, with their settlement party x
const DEPARTMENTS: Record<string, { partyX: string; desk: string }> = {
  treasury: { partyX: "0x17e0796c17481a34e6aa53421dce80dd2e7b2a1d49a48e49880faa8e7dcc97a4", desk: "Treasury" },
  trading: { partyX: "0x0e6888df5c6acfaea4c9e2d31ffd717268abc22f9cba99efe0300295b3ae6e3a", desk: "Trading Desk" },
};

const DURATION = 31_536_000n; // 1y
const SECRET = ("0x" + "b2".repeat(32)) as `0x${string}`;
const ZERO32 = ("0x" + "0".repeat(64)) as `0x${string}`;

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
const ethRegistryAbi = parseAbi([
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource) state)",
  "function getSubregistry(string label) view returns (address)",
  "function setSubregistry(uint256 anyId, address registry)",
]);
const childRegistryAbi = parseAbi([
  "function initialize(address rootAccount, uint256 roleBitmap)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function setResolver(uint256 anyId, address resolver)",
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource) state)",
]);
const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const txHashes: Record<string, `0x${string}`> = {};
async function send(tx: Promise<`0x${string}`>, what: string) {
  const hash = await tx;
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${what} reverted (${hash})`);
  console.log(`  ✓ ${what} (${hash})`);
  txHashes[what] = hash;
  return r;
}

const stateFile = "ens-subregistry.config.json";
type State = { label?: string; name?: string; childRegistry?: `0x${string}`; resolver?: `0x${string}` };
let state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

const labelId = (label: string) => hexToBigInt(labelhash(label));
async function ownedByUs(label: string): Promise<boolean> {
  const s = await pub.readContract({ address: ETH_REGISTRY, abi: ethRegistryAbi, functionName: "getState", args: [labelId(label)] });
  return s.status !== 0 && s.latestOwner.toLowerCase() === account.address.toLowerCase();
}

// deterministic salt → idempotent proxy address per (purpose, owner)
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
async function deployProxy(impl: `0x${string}`, salt: bigint, initData: `0x${string}`, what: string): Promise<`0x${string}`> {
  const existing = await findProxy(salt);
  if (existing) {
    console.log(`  · ${what} already deployed: ${existing}`);
    return existing;
  }
  const receipt = await send(
    wallet.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "deployProxy", args: [impl, salt, initData] }),
    `deployProxy ${what}`,
  );
  const ev = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" })[0];
  return ev.args.proxyAddress;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. acquire a dedicated 2LD (demo-safe — not the live aragornrings.eth)
let label = state.label && (await ownedByUs(state.label)) ? state.label : undefined;
let needsReg = false;
if (!label) {
  for (const cand of CANDIDATE_LABELS) {
    if (await ownedByUs(cand)) { label = cand; break; }
    const free = await pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "isAvailable", args: [cand] });
    if (free) { label = cand; needsReg = true; break; }
    console.log(`  ${cand}.eth unavailable, next`);
  }
}
if (!label) throw new Error("no candidate label available");
const name = `${label}.eth`;
state.label = label; state.name = name; save();

if (needsReg) {
  console.log(`── registering ${name} (commit-reveal)`);
  const [base, premium] = await pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "getRegisterPrice", args: [label, DURATION, PAYMENT_TOKEN] });
  const price = base + premium;
  const bal = await pub.readContract({ address: PAYMENT_TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
  if (bal < price) await send(wallet.writeContract({ address: PAYMENT_TOKEN, abi: tokenAbi, functionName: "mint", args: [account.address, price * 2n - bal] }), "mint payment token");
  const allow = await pub.readContract({ address: PAYMENT_TOKEN, abi: tokenAbi, functionName: "allowance", args: [account.address, REGISTRAR] });
  if (allow < price) await send(wallet.writeContract({ address: PAYMENT_TOKEN, abi: tokenAbi, functionName: "approve", args: [REGISTRAR, price * 2n] }), "approve registrar");

  const commitment = await pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "makeCommitment", args: [label, account.address, SECRET, zeroAddress, zeroAddress, DURATION, ZERO32] });
  const [minAge, maxAge, committedAt] = await Promise.all([
    pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "MIN_COMMITMENT_AGE" }),
    pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "MAX_COMMITMENT_AGE" }),
    pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "commitmentAt", args: [commitment] }),
  ]);
  const now = (await pub.getBlock()).timestamp;
  let commitTs = BigInt(committedAt);
  if (commitTs === 0n || now - commitTs >= BigInt(maxAge)) {
    await send(wallet.writeContract({ address: REGISTRAR, abi: registrarAbi, functionName: "commit", args: [commitment] }), "commit");
    commitTs = (await pub.getBlock()).timestamp;
  }
  const waitFor = Number(minAge) + 5 - Number((await pub.getBlock()).timestamp - commitTs);
  if (waitFor > 0) { console.log(`  waiting ${waitFor}s for MIN_COMMITMENT_AGE…`); await sleep(waitFor * 1000); }
  await send(
    wallet.writeContract({ address: REGISTRAR, abi: registrarAbi, functionName: "register", args: [label, account.address, SECRET, zeroAddress, zeroAddress, DURATION, PAYMENT_TOKEN, ZERO32] }),
    `register ${name}`,
  );
}
console.log(`── institution 2LD: ${name} (owner ${account.address})`);

// 2. resolver proxy (reuse deterministic one for this owner)
const resolver = state.resolver ?? (await deployProxy(
  RESOLVER_IMPL,
  proxySalt("AragornResolver"),
  encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [account.address, RESOLVER_ROLE_BITMAP] }),
  "resolver",
));
state.resolver = resolver; save();
console.log(`── resolver: ${resolver}`);

// 3. deploy the institution's OWN subregistry (UserRegistry proxy) and attach under the 2LD
const childRegistry = state.childRegistry ?? (await deployProxy(
  SUBREGISTRY_IMPL,
  proxySalt(`AragornSubregistry:${label}`),
  encodeFunctionData({ abi: childRegistryAbi, functionName: "initialize", args: [account.address, REGISTRY_ADMIN_BITMAP] }),
  "subregistry",
));
state.childRegistry = childRegistry; save();
console.log(`── subregistry (Ring-owned): ${childRegistry}`);

const attached = await pub.readContract({ address: ETH_REGISTRY, abi: ethRegistryAbi, functionName: "getSubregistry", args: [label] });
if (attached.toLowerCase() !== childRegistry.toLowerCase()) {
  await send(
    wallet.writeContract({ address: ETH_REGISTRY, abi: ethRegistryAbi, functionName: "setSubregistry", args: [labelId(label), childRegistry] }),
    `setSubregistry ${name} → ${childRegistry.slice(0, 10)}…`,
  );
}

// 4. mint each department as an onchain subname token + write its party key record
const expiry = BigInt(Math.floor(Date.now() / 1000)) + DURATION;
for (const [dept, { partyX, desk }] of Object.entries(DEPARTMENTS)) {
  const st = await pub.readContract({ address: childRegistry, abi: childRegistryAbi, functionName: "getState", args: [labelId(dept)] }).catch(() => null);
  if (!st || st.status === 0) {
    await send(
      wallet.writeContract({ address: childRegistry, abi: childRegistryAbi, functionName: "register", args: [dept, account.address, zeroAddress, resolver, OWNER_BITMAP, expiry] }),
      `mint ${dept}.${name}`,
    );
  } else {
    console.log(`  · ${dept}.${name} token already minted`);
  }
  const node = namehash(`${dept}.${name}`);
  for (const [key, value] of [["aragorn.partykey", partyX], ["aragorn.desk", desk]] as const) {
    let cur = "";
    try { cur = await pub.readContract({ address: resolver, abi: resolverAbi, functionName: "text", args: [node, key] }); } catch {}
    if (cur !== value) await send(wallet.writeContract({ address: resolver, abi: resolverAbi, functionName: "setText", args: [node, key, value] }), `setText ${dept} ${key}`);
  }
}

// 5. verify the onchain subname tokens resolve through UniversalResolverV2
console.log("── verifying department subnames via UniversalResolver");
let ok = true;
for (const [dept, { partyX }] of Object.entries(DEPARTMENTS)) {
  const got = await pub.getEnsText({ name: `${dept}.${name}`, key: "aragorn.partykey", universalResolverAddress: UNIVERSAL_RESOLVER });
  const good = got === partyX;
  ok &&= good;
  console.log(`  ${good ? "✓" : "✗"} getEnsText(${dept}.${name}, aragorn.partykey) = ${got}`);
}
if (!ok) throw new Error("UniversalResolver verification failed — subregistry traversal not resolving");

save();
console.log(`\n✅ ENS v2 #1 done: ${name} owns subregistry ${childRegistry}`);
console.log(`   departments minted as onchain tokens: ${Object.keys(DEPARTMENTS).map((d) => `${d}.${name}`).join(", ")}`);
console.log(`   tx hashes:`);
for (const [what, hash] of Object.entries(txHashes)) console.log(`     ${what}: ${hash}`);
