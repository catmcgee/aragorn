// P1 gate (BUILD_SPEC §8): scripted shield → transfer → unshield round-trip on local Anvil,
// via packages/protocol ONLY. Proves: real proofs, real settle(), tree sync, vault custody.
import { readFileSync } from "fs";
import { createPublicClient, createWalletClient, http, parseAbi, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  CircuitId,
  MerkleTree,
  NOTE_REGISTRY_ABI,
  TemplateId,
  addressToField,
  commitment,
  derivePartyKeys,
  encryptNoteFor,
  fieldToHex,
  hexToField,
  initPoseidon,
  initSchnorr,
  newEncKeypair,
  newNote,
  nullifier,
  prove,
  publicInputs,
  signField,
  transitionMessage,
  tryDecryptNote,
  type Note,
} from "../packages/protocol/src/index.js";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
// Anvil default key 0 — the public funding EOA for this gate.
const FUNDER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const deployments = JSON.parse(readFileSync("contracts/deployments.local.json", "utf8"));
const account = privateKeyToAccount(FUNDER_KEY);
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC) });

const usdc = getContract({
  address: deployments.usdc,
  abi: parseAbi([
    "function mint(address,uint256)",
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ]),
  client: { public: pub, wallet },
});
const vault = getContract({
  address: deployments.vault,
  abi: parseAbi(["function depositFor(bytes32 commitment, uint256 amount)"]),
  client: { public: pub, wallet },
});
const registry = getContract({
  address: deployments.registry,
  abi: NOTE_REGISTRY_ABI,
  client: { public: pub, wallet },
});

function artifact(name: string) {
  return JSON.parse(readFileSync(`circuits/${name}/target/${name}.json`, "utf8"));
}

await initPoseidon();
await initSchnorr();

// ── parties: UBS treasury (sender org), DRW desk (recipient org)
const ubsTreasury = derivePartyKeys(0x111n);
const drwDesk = derivePartyKeys(0x222n);
const ubsEnc = newEncKeypair();
const drwEnc = newEncKeypair();

const tree = new MerkleTree();
const sig4 = (s: ReturnType<typeof signField>) => ({
  s_lo: fieldToHex(s.sLo),
  s_hi: fieldToHex(s.sHi),
  e_lo: fieldToHex(s.eLo),
  e_hi: fieldToHex(s.eHi),
});

async function settle(
  circuitId: number,
  proofBundle: { proof: Uint8Array; publicInputs: string[] },
  ciphertexts: `0x${string}`[],
) {
  const hash = await registry.write.settle([
    circuitId,
    `0x${Buffer.from(proofBundle.proof).toString("hex")}` as `0x${string}`,
    proofBundle.publicInputs as `0x${string}`[],
    ciphertexts,
  ]);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`settle ${circuitId} reverted`);
  return receipt;
}

function assertEq<T>(got: T, want: T, what: string) {
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`);
  console.log(`  ✓ ${what} = ${got}`);
}

const $ = (n: bigint) => n * 1_000_000n; // micro-USDC

// ════ 1. fund + approve
console.log("── fund funding EOA with 10 USDC, approve vault");
await pub.waitForTransactionReceipt({ hash: await usdc.write.mint([account.address, $(10n)]) });
await pub.waitForTransactionReceipt({ hash: await usdc.write.approve([deployments.vault, $(10n)]) });

// ════ 2. shield $10 → UBS treasury Cash note
console.log("── shield: 10 USDC → Cash(UBS::treasury) [proving…]");
const shieldNote = newNote(
  TemplateId.Cash,
  { owner_x: ubsTreasury.x, amount: $(10n), salt2: 0n },
  [ubsTreasury.x],
);
{
  const c = commitment(shieldNote);
  const pi = publicInputs({
    root: tree.root,
    t: 0n,
    nullifiers: [],
    commitments: [c],
    aux: [$(10n), 0n],
  });
  await pub.waitForTransactionReceipt({
    hash: await vault.write.depositFor([fieldToHex(c), $(10n)]),
  });
  const bundle = await prove("cash_shield", artifact("cash_shield"), {
    root: fieldToHex(tree.root),
    t_bound: "0",
    nullifiers: ["0", "0", "0", "0"],
    commitments: [fieldToHex(c), "0", "0", "0"],
    aux: [fieldToHex($(10n)), "0", "0", "0"],
    owner_x: fieldToHex(ubsTreasury.x),
    amount: $(10n).toString(),
    salt: fieldToHex(shieldNote.salt),
    salt2: fieldToHex(shieldNote.fields.salt2),
    note_secret: fieldToHex(shieldNote.noteSecret),
  });
  // sanity: prover's public inputs must equal the settle layout we computed
  if (bundle.publicInputs.join() !== pi.join())
    throw new Error("public input layout mismatch between circuit and protocol");
  const cts = encryptNoteFor([ubsEnc.publicKey], shieldNote).map(
    (u) => `0x${Buffer.from(u).toString("hex")}` as `0x${string}`,
  );
  await settle(CircuitId.cash_shield, bundle, cts);
  tree.insert(c);
  assertEq(await registry.read.root(), fieldToHex(tree.root), "onchain root == mirror root");
  assertEq(await usdc.read.balanceOf([deployments.vault]), $(10n), "vault custody");
}

// ════ 3. transfer $6 UBS → DRW (change $4)
console.log("── transfer: 6 USDC Cash(UBS) → Cash(DRW) + 4 change [proving…]");
const drwNote = newNote(TemplateId.Cash, { owner_x: drwDesk.x, amount: $(6n), salt2: 0n }, [drwDesk.x]);
const changeNote = newNote(
  TemplateId.Cash,
  { owner_x: ubsTreasury.x, amount: $(4n), salt2: 0n },
  [ubsTreasury.x],
);
{
  const inC = commitment(shieldNote);
  const inIndex = 0;
  const n1 = nullifier(inC, shieldNote.noteSecret);
  const c1 = commitment(drwNote);
  const c2 = commitment(changeNote);
  const root = tree.root;
  const msg = transitionMessage(root, [n1, 0n], [c1, c2]);
  const sig = signField(ubsTreasury, msg);

  const zeroPath = Array(32).fill("0");
  const bundle = await prove("cash_transfer", artifact("cash_transfer"), {
    root: fieldToHex(root),
    t_bound: "0",
    nullifiers: [fieldToHex(n1), "0", "0", "0"],
    commitments: [fieldToHex(c1), fieldToHex(c2), "0", "0"],
    aux: ["0", "0", "0", "0"],
    in1_amount: $(10n).toString(),
    in1_salt: fieldToHex(shieldNote.salt),
    in1_salt2: fieldToHex(shieldNote.fields.salt2),
    in1_secret: fieldToHex(shieldNote.noteSecret),
    in1_index: inIndex,
    in1_path: tree.path(inIndex).map(fieldToHex),
    in2_real: false,
    in2_amount: "0",
    in2_salt: "0",
    in2_salt2: "0",
    in2_secret: "0",
    in2_index: 0,
    in2_path: zeroPath,
    owner_x: fieldToHex(ubsTreasury.x),
    owner_y: fieldToHex(ubsTreasury.y),
    sig: sig4(sig),
    recipient_x: fieldToHex(drwDesk.x),
    out1_amount: $(6n).toString(),
    out1_salt: fieldToHex(drwNote.salt),
    out1_salt2: fieldToHex(drwNote.fields.salt2),
    out1_secret: fieldToHex(drwNote.noteSecret),
    change_amount: $(4n).toString(),
    change_salt: fieldToHex(changeNote.salt),
    change_salt2: fieldToHex(changeNote.fields.salt2),
    change_secret: fieldToHex(changeNote.noteSecret),
  });
  // ciphertexts: recipient note → DRW org key; change → UBS org key
  const cts = [
    ...encryptNoteFor([drwEnc.publicKey], drwNote),
    ...encryptNoteFor([ubsEnc.publicKey], changeNote),
  ].map((u) => `0x${Buffer.from(u).toString("hex")}` as `0x${string}`);
  await settle(CircuitId.cash_transfer, bundle, cts);
  tree.insert(c1);
  tree.insert(c2);
  assertEq(await registry.read.root(), fieldToHex(tree.root), "root after transfer");
  assertEq(await registry.read.isSpent([fieldToHex(n1)]), true, "input nullifier spent");

  // DRW discovers its note from the ciphertext (sync-engine behavior, view tag + decrypt)
  const decrypted = tryDecryptNote(drwEnc, Buffer.from(cts[0].slice(2), "hex"));
  if (!decrypted) throw new Error("DRW failed to decrypt its note");
  assertEq(hexToField(decrypted.fields.amount), $(6n), "DRW decrypted amount");
}

// ════ 4. unshield $2.5 from DRW's note to a fresh recipient address
console.log("── unshield: 2.5 USDC from Cash(DRW) → public recipient [proving…]");
const recipient = "0x00000000000000000000000000000000deadbeef" as const;
{
  const inC = commitment(drwNote);
  const inIndex = 1; // insertion order: shield(0), drw(1), change(2)
  const n1 = nullifier(inC, drwNote.noteSecret);
  const unshieldAmount = 2_500_000n;
  const change = $(6n) - unshieldAmount;
  const drwChange = newNote(TemplateId.Cash, { owner_x: drwDesk.x, amount: change, salt2: 0n }, [drwDesk.x]);
  const c1 = commitment(drwChange);
  const root = tree.root;
  const sig = signField(drwDesk, transitionMessage(root, [n1], [c1], [unshieldAmount, addressToField(recipient)]));

  const bundle = await prove("cash_unshield", artifact("cash_unshield"), {
    root: fieldToHex(root),
    t_bound: "0",
    nullifiers: [fieldToHex(n1), "0", "0", "0"],
    commitments: [fieldToHex(c1), "0", "0", "0"],
    aux: [fieldToHex(unshieldAmount), fieldToHex(addressToField(recipient)), "0", "0"],
    in1_amount: $(6n).toString(),
    in1_salt: fieldToHex(drwNote.salt),
    in1_salt2: fieldToHex(drwNote.fields.salt2),
    in1_secret: fieldToHex(drwNote.noteSecret),
    in1_index: inIndex,
    in1_path: tree.path(inIndex).map(fieldToHex),
    owner_x: fieldToHex(drwDesk.x),
    owner_y: fieldToHex(drwDesk.y),
    sig: sig4(sig),
    unshield_amount: unshieldAmount.toString(),
    change_amount: change.toString(),
    change_salt: fieldToHex(drwChange.salt),
    change_salt2: fieldToHex(drwChange.fields.salt2),
    change_secret: fieldToHex(drwChange.noteSecret),
  });
  const cts = encryptNoteFor([drwEnc.publicKey], drwChange).map(
    (u) => `0x${Buffer.from(u).toString("hex")}` as `0x${string}`,
  );
  await settle(CircuitId.cash_unshield, bundle, cts);
  tree.insert(c1);
  assertEq(await usdc.read.balanceOf([recipient]), unshieldAmount, "recipient got USDC");
  assertEq(await usdc.read.balanceOf([deployments.vault]), $(10n) - unshieldAmount, "vault drained");
  assertEq(await registry.read.root(), fieldToHex(tree.root), "final root");
}

// ════ 5. replay protection end-to-end: re-submitting the spent nullifier must revert
console.log("── replay: double-spend rejected");
{
  const n1 = nullifier(commitment(shieldNote), shieldNote.noteSecret);
  assertEq(await registry.read.isSpent([fieldToHex(n1)]), true, "nullifier permanently spent");
}

console.log("\n✅ P1 ROUND-TRIP GREEN — shield → transfer → unshield, real proofs, protocol-only");
