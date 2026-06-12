// P3 helper: query the Ring's CCIP gateway directly the way an on-chain OffchainResolver
// callback would, and verify the signed response (off-chain leg of ENSIP-10).
// The on-chain resolver leg is exercised separately once deployed on Sepolia.
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  namehash,
  parseAbi,
  recoverAddress,
} from "viem";

const RING = process.env.RING_URL ?? "http://127.0.0.1:4001";
const NAME = process.env.CCIP_NAME ?? "cat.ubs.aragornrings.eth";
const SENDER = "0x000000000000000000000000000000000000c01d"; // placeholder resolver addr

function dnsEncode(name: string): `0x${string}` {
  const parts = name.split(".");
  const bytes: number[] = [];
  for (const p of parts) {
    const b = new TextEncoder().encode(p);
    bytes.push(b.length, ...b);
  }
  bytes.push(0);
  return `0x${Buffer.from(bytes).toString("hex")}` as `0x${string}`;
}

const inner = encodeFunctionData({
  abi: parseAbi(["function text(bytes32 node, string key) view returns (string)"]),
  args: [namehash(NAME), "description"],
});
const callData = encodeFunctionData({
  abi: parseAbi([
    "function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes sig)",
  ]),
  args: [dnsEncode(NAME), inner],
});

const res = await fetch(`${RING}/gateway/${SENDER}/${callData}.json`);
const body = (await res.json()) as { data?: `0x${string}`; message?: string };
if (!res.ok || !body.data) throw new Error(`gateway error: ${body.message}`);

const [result, expires, sig] = decodeAbiParameters(
  [{ type: "bytes" }, { type: "uint64" }, { type: "bytes" }],
  body.data,
);
const [value] = decodeAbiParameters([{ type: "string" }], result as `0x${string}`);

// verify the signature the way SignatureVerifier.sol does
const hash = keccak256(
  encodePacked(
    ["bytes2", "address", "uint64", "bytes32", "bytes32"],
    ["0x1900", SENDER, expires as bigint, keccak256(callData), keccak256(result as `0x${string}`)],
  ),
);
const signer = await recoverAddress({ hash, signature: sig as `0x${string}` });

const health = (await (await fetch(`${RING}/gateway/health`)).json()) as { signer: string };
if (signer.toLowerCase() !== health.signer.toLowerCase())
  throw new Error(`signer mismatch: ${signer} vs ${health.signer}`);

console.log(`   CCIP gateway: text(${NAME}, description) = "${value}", signed by ${signer.slice(0, 10)}… ✓`);
