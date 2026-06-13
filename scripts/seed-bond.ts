// Seed the Goldman bond (BUILD_SPEC §10.3): a BondPosition inserted via the owner-gated
// seedCommitments path, encrypted to the holder org so its sync engine discovers it
// normally (and resync keeps working). Narrated honestly: "issued pre-demo by Goldman".
import { readFileSync, writeFileSync } from "fs";
import { createPublicClient, createWalletClient, http, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";
import {
  NOTE_REGISTRY_ABI,
  TemplateId,
  commitment,
  derivePartyKeys,
  encryptNoteFor,
  fieldToHex,
  initPoseidon,
  initSchnorr,
  newNote,
  stringHash,
} from "../packages/protocol/src/index.ts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8546";
const OWNER_KEY = (process.env.DEPLOYER_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
const CHAIN = process.env.CHAIN === "sepolia" ? sepolia : foundry;
// UBS::trading party (gate key 0x112) + UBS org enc pubkey
const HOLDER_PARTY_KEY = BigInt(process.env.HOLDER_PARTY_KEY ?? "0x112");
const HOLDER_ENC_PUB = Buffer.from(
  (process.env.HOLDER_ENC_PUB ?? "0x7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13").replace("0x", ""),
  "hex",
);
const FACE = BigInt(process.env.BOND_FACE_MICRO ?? 5_000_000_000_000n); // $5M

await initPoseidon();
await initSchnorr();

const deployments = JSON.parse(readFileSync(process.env.DEPLOYMENTS ?? "contracts/deployments.local.json", "utf8"));
const account = privateKeyToAccount(OWNER_KEY);
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

const holder = derivePartyKeys(HOLDER_PARTY_KEY);
const goldman = derivePartyKeys(0x999n); // illustrative issuer party
const bond = newNote(
  TemplateId.BondPosition,
  {
    owner_x: holder.x,
    issuer_x: goldman.x,
    isin_hash: stringHash("US91282CEZ-DEMO"),
    face_amount: FACE,
    encumbrance: 0n,
  },
  [holder.x, goldman.x],
);
const c = commitment(bond);
const cts = encryptNoteFor([HOLDER_ENC_PUB], bond).map(
  (u) => `0x${Buffer.from(u).toString("hex")}` as `0x${string}`,
);

const registry = getContract({
  address: deployments.registry,
  abi: NOTE_REGISTRY_ABI,
  client: { public: pub, wallet },
});
const hash = await registry.write.seedCommitments([[fieldToHex(c)], cts]);
await pub.waitForTransactionReceipt({ hash });
console.log(`seeded bond ${fieldToHex(c)} (face $${Number(FACE / 1_000_000n).toLocaleString()}, issuer "US Treasury") tx=${hash}`);
