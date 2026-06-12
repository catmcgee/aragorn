import { readFileSync } from "fs";
import { createPublicClient, http, parseAbi, decodeErrorResult } from "viem";
import { sepolia } from "viem/chains";

const envFile = readFileSync("/Users/catmcgee/Documents/projects/canton-on-mainnet/.env.local", "utf8");
const RPC = envFile.split("\n").find(l => l.startsWith("SEPOLIA_RPC_URL="))!.slice(16).trim();
const CONTROLLER = "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968";
const abi = parseAbi([
  "struct Registration { string label; address owner; uint256 duration; bytes32 secret; address resolver; bytes[] data; uint8 reverseRecord; bytes32 referrer; }",
  "function register(Registration registration) payable",
  "function rentPrice(string label, uint256 duration) view returns (uint256 base, uint256 premium)",
  "function available(string label) view returns (bool)",
  "function commitments(bytes32) view returns (uint256)",
  "function makeCommitment(Registration registration) pure returns (bytes32)",
  "function minCommitmentAge() view returns (uint256)",
  "error CommitmentTooNew(bytes32,uint256,uint256)",
  "error CommitmentTooOld(bytes32,uint256,uint256)",
  "error UnexpiredCommitmentExists(bytes32)",
  "error InsufficientValue()",
  "error NameNotAvailable(string)",
  "error DurationTooShort(uint256)",
  "error ResolverRequiredWhenDataSupplied()",
]);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const reg = {
  label: "aragorn-rings",
  owner: "0x4Fce3107816f5a56c367905FC60D5122bE33589e",
  duration: 31536000n,
  secret: ("0x" + "a1".repeat(32)) as `0x${string}`,
  resolver: "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5",
  data: [],
  reverseRecord: 0,
  referrer: ("0x" + "0".repeat(64)) as `0x${string}`,
} as const;

console.log("available:", await pub.readContract({ address: CONTROLLER, abi, functionName: "available", args: ["aragorn-rings"] }));
console.log("minCommitmentAge:", await pub.readContract({ address: CONTROLLER, abi, functionName: "minCommitmentAge" }));
const ch = await pub.readContract({ address: CONTROLLER, abi, functionName: "makeCommitment", args: [reg] });
console.log("commitment ts:", await pub.readContract({ address: CONTROLLER, abi, functionName: "commitments", args: [ch] }));
console.log("now:", Math.floor(Date.now() / 1000));
const [base, premium] = await pub.readContract({ address: CONTROLLER, abi, functionName: "rentPrice", args: ["aragorn-rings", 31536000n] });
console.log("price:", base, premium);
try {
  await pub.simulateContract({
    address: CONTROLLER, abi, functionName: "register", args: [reg],
    value: ((base + premium) * 105n) / 100n,
    account: "0x4Fce3107816f5a56c367905FC60D5122bE33589e",
  });
  console.log("simulation OK");
} catch (e: any) {
  console.log("revert:", e.cause?.data?.errorName ?? e.shortMessage, e.cause?.data?.args ?? "");
}
