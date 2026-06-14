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
// A small book of unencumbered Treasury positions so multiple repos can be booked
// (one bond = one repo until it closes; more free collateral = no "nothing to pledge" wall).
// The first stays $5M (the demo repo books $5M cash against it); env override applies to it.
const BONDS: Array<{ isin: string; face: bigint; label: string }> = [
  { isin: "US91282CEZ-2Y", face: BigInt(process.env.BOND_FACE_MICRO ?? 5_000_000_000_000n), label: "UST 2Y" },
  { isin: "US91282CFA-5Y", face: 10_000_000_000_000n, label: "UST 5Y" },
  { isin: "US91282CFB-10Y", face: 7_500_000_000_000n, label: "UST 10Y" },
];

// Pre-deployed private strategy positions (Privy Earn principal claims), owned by Treasury,
// so the Strategies page shows the private side populated next to the live vault stats.
const TREASURY_PARTY_KEY = BigInt(process.env.TREASURY_PARTY_KEY ?? "0x111");
const STRATEGY_VAULT = process.env.STRATEGY_VAULT_LABEL ?? "privy-earn";
const STRATEGY_POSITIONS: bigint[] = [25_000_000_000n, 12_000_000_000n]; // $25k, $12k deployed

await initPoseidon();
await initSchnorr();

const deployments = JSON.parse(readFileSync(process.env.DEPLOYMENTS ?? "contracts/deployments.local.json", "utf8"));
const account = privateKeyToAccount(OWNER_KEY);
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

const holder = derivePartyKeys(HOLDER_PARTY_KEY);
const treasury = derivePartyKeys(TREASURY_PARTY_KEY);
const goldman = derivePartyKeys(0x999n); // illustrative issuer party

const commitmentsHex: `0x${string}`[] = [];
const ciphertexts: `0x${string}`[] = [];
const summary: string[] = [];
for (const b of BONDS) {
  const bond = newNote(
    TemplateId.BondPosition,
    {
      owner_x: holder.x,
      issuer_x: goldman.x,
      isin_hash: stringHash(b.isin),
      face_amount: b.face,
      encumbrance: 0n,
    },
    [holder.x, goldman.x],
  );
  const c = commitment(bond);
  commitmentsHex.push(fieldToHex(c));
  // each note's ciphertext(s); sync matches by recomputed commitment, so order is flexible
  for (const u of encryptNoteFor([HOLDER_ENC_PUB], bond)) {
    ciphertexts.push(`0x${Buffer.from(u).toString("hex")}` as `0x${string}`);
  }
  summary.push(`${b.label} $${Number(b.face / 1_000_000n).toLocaleString()} → ${fieldToHex(c).slice(0, 12)}…`);
}

// Strategy positions (private Privy Earn principal claims) → Treasury
const openTs = BigInt(Math.floor(Date.now() / 1000));
for (const amount of STRATEGY_POSITIONS) {
  const pos = newNote(
    TemplateId.StrategyPosition,
    { owner_x: treasury.x, vault_id_hash: stringHash(STRATEGY_VAULT), amount, open_ts: openTs },
    [treasury.x],
  );
  const c = commitment(pos);
  commitmentsHex.push(fieldToHex(c));
  for (const u of encryptNoteFor([HOLDER_ENC_PUB], pos)) {
    ciphertexts.push(`0x${Buffer.from(u).toString("hex")}` as `0x${string}`);
  }
  summary.push(`Strategy $${Number(amount / 1_000_000n).toLocaleString()} (Privy Earn) → ${fieldToHex(c).slice(0, 12)}…`);
}

const registry = getContract({
  address: deployments.registry,
  abi: NOTE_REGISTRY_ABI,
  client: { public: pub, wallet },
});
const hash = await registry.write.seedCommitments([commitmentsHex, ciphertexts]);
await pub.waitForTransactionReceipt({ hash });
console.log(`seeded ${BONDS.length} bond positions + ${STRATEGY_POSITIONS.length} strategy positions tx=${hash}`);
for (const s of summary) console.log(`  · ${s}`);
