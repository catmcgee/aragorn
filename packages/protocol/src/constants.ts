// THE canonical protocol constants (BUILD_SPEC §3). Nothing here may be redefined elsewhere:
// circuits, contracts, and apps all conform to this file.

/** BN254 scalar field modulus. All protocol values are field elements unless stated. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const PROTOCOL_VERSION = 1n;

/** Template IDs (§3.2) — typed into every commitment. */
export const TemplateId = {
  Cash: 1,
  BondPosition: 2,
  RepoProposal: 3,
  CollateralAllocation: 4,
  RepoAgreement: 5,
  Entitlement: 6,
  // A private yield-strategy position: shielded cash deployed to Privy Earn, represented
  // as a ZK-redeemable note (the principal claim). `amount` = principal so the projection
  // picks it up like any other balance.
  StrategyPosition: 7,
} as const;
export type TemplateId = (typeof TemplateId)[keyof typeof TemplateId];

/** Circuit IDs (§3.8) — key the onchain verifier registry, NOT template ids. */
export const CircuitId = {
  cash_shield: 1,
  cash_transfer: 2,
  cash_unshield: 3,
  cash_fanout: 4,
  entitlement_claim: 5,
  repo_propose_allocate: 6,
  repo_accept: 7,
  repo_close: 8,
  strategy_open: 9,
  strategy_redeem: 10,
} as const;
export type CircuitName = keyof typeof CircuitId;
export type CircuitId = (typeof CircuitId)[keyof typeof CircuitId];

/** Public input layout (§3.8): [root, T, n1..n4, c1..c4, aux1..aux4] — 14, zero-padded. */
export const PUBLIC_INPUT_COUNT = 14;

/** Merkle tree depth (NoteRegistry). */
export const TREE_DEPTH = 32;
/** Root history ring buffer size. */
export const ROOT_HISTORY = 64;

/** Stakeholder set padded arity (§3.3). */
export const MAX_STAKEHOLDERS = 4;

/** Amounts are u64 micro-USDC (6 decimals): $1 = 1_000_000n. */
export const MICRO = 1_000_000n;

/** View tag domain separator (§3.7). */
export const VIEW_TAG_DOMAIN = "aragorn-tag";
/** View tag length in bytes. */
export const VIEW_TAG_BYTES = 4;

/** Payload field orders per template (§3.6) — exact Poseidon2 input order. */
export const PAYLOAD_FIELDS: Record<TemplateId, readonly string[]> = {
  [TemplateId.Cash]: ["owner_x", "amount", "salt2"],
  [TemplateId.BondPosition]: ["owner_x", "issuer_x", "isin_hash", "face_amount", "encumbrance"],
  [TemplateId.RepoProposal]: [
    "dealer_x",
    "lender_x",
    "isin_hash",
    "face_amount",
    "cash_amount",
    "rate_bps",
    "days",
  ],
  [TemplateId.CollateralAllocation]: ["dealer_x", "proposal_c", "isin_hash", "face_amount"],
  [TemplateId.RepoAgreement]: [
    "dealer_x",
    "lender_x",
    "collateral_c",
    "cash_amount",
    "rate_bps",
    "days",
    "maturity_ts",
  ],
  [TemplateId.Entitlement]: ["claim_hash", "amount", "payer_x", "memo_hash"],
  [TemplateId.StrategyPosition]: ["owner_x", "vault_id_hash", "amount", "open_ts"],
} as const;
