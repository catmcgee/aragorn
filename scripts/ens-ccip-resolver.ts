// Deploy the CCIP OffchainResolver on Sepolia and point ubs.aragorn-rings.eth at it
// (the v1/premigration name — resolvable through UniversalResolverV2; ENSIP-10 wildcard
// routes every employee subname to the Ring's signing gateway). Idempotent via ens-ccip.json.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createPublicClient, createWalletClient, http, namehash, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://127.0.0.1:4001/gateway/{sender}/{data}.json";
const GATEWAY_SIGNER = privateKeyToAccount(
  (process.env.GATEWAY_SIGNER_KEY ?? "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba") as `0x${string}`,
);
const NAME = process.env.CCIP_PARENT ?? "ubs.aragorn-rings.eth";
const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;

const account = privateKeyToAccount(env.SEPOLIA_DEPLOYER_KEY as `0x${string}`);
const pub = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });

const state = existsSync("ens-ccip.json") ? JSON.parse(readFileSync("ens-ccip.json", "utf8")) : {};
let resolver: `0x${string}` | undefined = state.resolver;

if (!resolver) {
  const art = JSON.parse(readFileSync("contracts/out/OffchainResolver.sol/OffchainResolver.json", "utf8"));
  const hash = await wallet.deployContract({
    abi: art.abi,
    bytecode: art.bytecode.object as `0x${string}`,
    args: [GATEWAY_URL, [GATEWAY_SIGNER.address]],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  resolver = receipt.contractAddress!;
  writeFileSync("ens-ccip.json", JSON.stringify({ resolver, gatewayUrl: GATEWAY_URL, signer: GATEWAY_SIGNER.address }, null, 2));
  console.log(`  ✓ OffchainResolver deployed: ${resolver} (signer ${GATEWAY_SIGNER.address})`);
}

const registryAbi = parseAbi([
  "function resolver(bytes32 node) view returns (address)",
  "function setResolver(bytes32 node, address resolver)",
]);
const node = namehash(NAME);
const current = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "resolver", args: [node] });
if (current.toLowerCase() !== resolver.toLowerCase()) {
  const hash = await wallet.writeContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "setResolver",
    args: [node, resolver],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  ✓ ${NAME} resolver → OffchainResolver`);
}

console.log(`\n✅ CCIP wildcard live for *.${NAME} → ${GATEWAY_URL}`);
console.log(`   NOTE: ${NAME}'s own text records now come from the gateway too (it serves org + employee names).`);
