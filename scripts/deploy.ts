// Deterministic chain deploy via viem (replaces forge-script broadcasting, which wedges
// against anvil in this environment). Handles external library linking from Foundry
// artifacts (ZKTranscriptLib per verifier). Writes contracts/deployments.local.json.
import { readFileSync, writeFileSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  getCreateAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";

// Chain-agnostic: defaults to local anvil; for Sepolia set RPC_URL + DEPLOYER_KEY.
// DEPLOY_OUT names the addresses file (deployments.local.json | deployments.sepolia.json).
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8546";
const KEY = (process.env.DEPLOYER_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
const OUT = process.env.DEPLOY_OUT ?? "contracts/deployments.local.json";

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ transport: http(RPC) });
const chainId = await pub.getChainId();
const chain = chainId === 11155111 ? sepolia : foundry;
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

function artifact(file: string, name: string) {
  return JSON.parse(readFileSync(`contracts/out/${file}/${name}.json`, "utf8"));
}

/** Substitute linked library addresses into bytecode via the artifact's linkReferences. */
function link(bytecode: string, linkRefs: any, libs: Record<string, `0x${string}`>): `0x${string}` {
  let code = bytecode;
  for (const [file, refs] of Object.entries(linkRefs ?? {})) {
    for (const [libName, positions] of Object.entries(refs as Record<string, { start: number; length: number }[]>)) {
      const addr = libs[`${file}:${libName}`];
      if (!addr) throw new Error(`missing library ${file}:${libName}`);
      for (const pos of positions) {
        const start = 2 + pos.start * 2;
        code = code.slice(0, start) + addr.slice(2).toLowerCase() + code.slice(start + pos.length * 2);
      }
    }
  }
  return code as `0x${string}`;
}

async function deploy(file: string, name: string, args: unknown[] = [], libs: Record<string, `0x${string}`> = {}) {
  const art = artifact(file, name);
  const bytecode = link(art.bytecode.object, art.bytecode.linkReferences, libs);
  const hash = await wallet.deployContract({ abi: art.abi, bytecode, args: args as any });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deploy failed`);
  console.log(`   ${name} → ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function send(to: `0x${string}`, abi: any, functionName: string, args: unknown[]) {
  const hash = await wallet.sendTransaction({ to, data: encodeFunctionData({ abi, functionName, args }) });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`${functionName} failed`);
}

const deployBlock = Number(await pub.getBlockNumber());
const poseidon = await deploy("Poseidon2Yul.sol", "Poseidon2Yul_BN254");
const usdc = await deploy("MockUSDC.sol", "MockUSDC");
const vault = await deploy("ShieldVault.sol", "ShieldVault", [usdc]);
const registryArt = artifact("NoteRegistry.sol", "NoteRegistry");
const registry = await deploy("NoteRegistry.sol", "NoteRegistry", [poseidon, vault]);
await send(vault, artifact("ShieldVault.sol", "ShieldVault").abi, "setRegistry", [registry]);

const VERIFIERS: [number, string][] = [
  [1, "CashShieldVerifier"],
  [2, "CashTransferVerifier"],
  [3, "CashUnshieldVerifier"],
  [4, "CashFanoutVerifier"],
  [5, "EntitlementClaimVerifier"],
  [6, "RepoProposeAllocateVerifier"],
  [7, "RepoAcceptVerifier"],
  [8, "RepoCloseVerifier"],
];
for (const [id, name] of VERIFIERS) {
  const file = `${name}.sol`;
  const art = artifact(file, name);
  const libs: Record<string, `0x${string}`> = {};
  for (const [refFile, refs] of Object.entries(art.bytecode.linkReferences ?? {})) {
    for (const libName of Object.keys(refs as object)) {
      libs[`${refFile}:${libName}`] = await deploy(file, libName);
    }
  }
  const addr = await deploy(file, name, [], libs);
  await send(registry, registryArt.abi, "setVerifier", [id, addr]);
}

writeFileSync(
  OUT,
  JSON.stringify({ poseidon, usdc, vault, registry, chainId, deployBlock }, null, 2),
);
console.log(`✅ deployed on chain ${chainId} (block ${deployBlock}); addresses → ${OUT}`);
