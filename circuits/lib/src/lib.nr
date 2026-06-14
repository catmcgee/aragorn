// aragorn_lib - shared note gadgets (BUILD_SPEC S4). The seed of the template abstraction:
// every circuit conforms to packages/protocol; constants here mirror constants.ts exactly.
use poseidon::poseidon2::Poseidon2;
use std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar};

pub global VERSION: Field = 1;

pub global TEMPLATE_CASH: Field = 1;
pub global TEMPLATE_BOND_POSITION: Field = 2;
pub global TEMPLATE_REPO_PROPOSAL: Field = 3;
pub global TEMPLATE_COLLATERAL_ALLOCATION: Field = 4;
pub global TEMPLATE_REPO_AGREEMENT: Field = 5;
pub global TEMPLATE_ENTITLEMENT: Field = 6;
pub global TEMPLATE_STRATEGY_POSITION: Field = 7;

pub global TREE_DEPTH: u32 = 32;

/// Stakeholder x-coords, sorted ascending then zero-padded to 4 (S3.3).
/// Callers construct the array to match packages/protocol stakeholdersHash.
pub fn stakeholders_hash(xs: [Field; 4]) -> Field {
    Poseidon2::hash(xs, 4)
}

pub fn nullifier_key_hash(note_secret: Field) -> Field {
    Poseidon2::hash([note_secret], 1)
}

pub fn commitment(template_id: Field, payload_hash: Field, stakeholders: Field, note_secret: Field, salt: Field) -> Field {
    Poseidon2::hash([template_id, VERSION, payload_hash, stakeholders, nullifier_key_hash(note_secret), salt], 6)
}

pub fn nullifier(c: Field, note_secret: Field) -> Field {
    Poseidon2::hash([c, note_secret], 2)
}

/// Cash payload (S3.6): [owner_x, amount, salt2]
pub fn cash_payload(owner_x: Field, amount: u64, salt2: Field) -> Field {
    Poseidon2::hash([owner_x, amount as Field, salt2], 3)
}

/// Single-stakeholder Cash commitment.
pub fn cash_commitment(owner_x: Field, amount: u64, salt2: Field, note_secret: Field, salt: Field) -> Field {
    commitment(
        TEMPLATE_CASH,
        cash_payload(owner_x, amount, salt2),
        stakeholders_hash([owner_x, 0, 0, 0]),
        note_secret,
        salt,
    )
}

/// StrategyPosition payload (S3.6): [owner_x, vault_id_hash, amount, open_ts]
pub fn strategy_payload(owner_x: Field, vault_id_hash: Field, amount: u64, open_ts: Field) -> Field {
    Poseidon2::hash([owner_x, vault_id_hash, amount as Field, open_ts], 4)
}

/// Single-stakeholder StrategyPosition commitment (private yield-strategy principal claim).
pub fn strategy_commitment(
    owner_x: Field,
    vault_id_hash: Field,
    amount: u64,
    open_ts: Field,
    note_secret: Field,
    salt: Field,
) -> Field {
    commitment(
        TEMPLATE_STRATEGY_POSITION,
        strategy_payload(owner_x, vault_id_hash, amount, open_ts),
        stakeholders_hash([owner_x, 0, 0, 0]),
        note_secret,
        salt,
    )
}

/// Recompute the root from a leaf + sibling path; index bits select left/right.
pub fn merkle_root(leaf: Field, index: u32, path: [Field; TREE_DEPTH]) -> Field {
    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        let bit = (index >> i) & 1;
        let sibling = path[i];
        let (l, r) = if bit == 1 { (sibling, node) } else { (node, sibling) };
        node = Poseidon2::hash([l, r], 2);
    }
    node
}

pub struct Sig {
    pub s_lo: Field,
    pub s_hi: Field,
    pub e_lo: Field,
    pub e_hi: Field,
}

/// Schnorr over Grumpkin, new (Poseidon2+DST) scheme - noir-lang/schnorr v0.4.0 (D-003).
/// pub_key_y is private witness; binding to owner_x is what matters (x fixes +/-y, both
/// points belong to +/-the same scalar).
pub fn check_sig(pub_key_x: Field, pub_key_y: Field, sig: Sig, msg: Field) {
    let pk = EmbeddedCurvePoint { x: pub_key_x, y: pub_key_y };
    let s = EmbeddedCurveScalar { lo: sig.s_lo, hi: sig.s_hi };
    let e = EmbeddedCurveScalar { lo: sig.e_lo, hi: sig.e_hi };
    schnorr::assert_valid_signature(pk, (s, e), msg);
}

/// Transition message (S3.4): Poseidon2([root, nullifiers..., commitments...]) at the
/// circuit's own arity. Mirrors protocol transitionMessage().
pub fn transition_msg_2x2(root: Field, n1: Field, n2: Field, c1: Field, c2: Field) -> Field {
    Poseidon2::hash([root, n1, n2, c1, c2], 5)
}

pub fn transition_msg_1x1(root: Field, n1: Field, c1: Field) -> Field {
    Poseidon2::hash([root, n1, c1], 3)
}

pub fn transition_msg_1x1_aux2(root: Field, n1: Field, c1: Field, a1: Field, a2: Field) -> Field {
    Poseidon2::hash([root, n1, c1, a1, a2], 5)
}

// -- P4 template payloads (S3.6 field orders) ------------------------------------

/// Entitlement payload: [claim_hash, amount, payer_x, memo_hash]
pub fn entitlement_payload(claim_hash: Field, amount: u64, payer_x: Field, memo_hash: Field) -> Field {
    Poseidon2::hash([claim_hash, amount as Field, payer_x, memo_hash], 4)
}

/// BondPosition payload: [owner_x, issuer_x, isin_hash, face_amount, encumbrance]
pub fn bond_payload(owner_x: Field, issuer_x: Field, isin_hash: Field, face_amount: u64, encumbrance: Field) -> Field {
    Poseidon2::hash([owner_x, issuer_x, isin_hash, face_amount as Field, encumbrance], 5)
}

/// RepoProposal payload: [dealer_x, lender_x, isin_hash, face_amount, cash_amount, rate_bps, days]
pub fn repo_proposal_payload(
    dealer_x: Field,
    lender_x: Field,
    isin_hash: Field,
    face_amount: u64,
    cash_amount: u64,
    rate_bps: u64,
    days: u64,
) -> Field {
    Poseidon2::hash(
        [dealer_x, lender_x, isin_hash, face_amount as Field, cash_amount as Field, rate_bps as Field, days as Field],
        7,
    )
}

/// CollateralAllocation payload: [dealer_x, proposal_c, isin_hash, face_amount]
pub fn collateral_allocation_payload(dealer_x: Field, proposal_c: Field, isin_hash: Field, face_amount: u64) -> Field {
    Poseidon2::hash([dealer_x, proposal_c, isin_hash, face_amount as Field], 4)
}

/// RepoAgreement payload: [dealer_x, lender_x, collateral_c, cash_amount, rate_bps, days, maturity_ts]
pub fn repo_agreement_payload(
    dealer_x: Field,
    lender_x: Field,
    collateral_c: Field,
    cash_amount: u64,
    rate_bps: u64,
    days: u64,
    maturity_ts: u64,
) -> Field {
    Poseidon2::hash(
        [dealer_x, lender_x, collateral_c, cash_amount as Field, rate_bps as Field, days as Field, maturity_ts as Field],
        7,
    )
}

/// Two-party stakeholder hash: prover supplies the sorted pair; the circuit enforces SET
/// equality (either order). Counterparties recompute the canonical sorted commitment at
/// sync, so a maliciously swapped order simply fails discovery.
pub fn two_party_stakeholders(sh_lo: Field, sh_hi: Field, a: Field, b: Field) -> Field {
    let straight = (sh_lo == a) & (sh_hi == b);
    let swapped = (sh_lo == b) & (sh_hi == a);
    assert(straight | swapped);
    Poseidon2::hash([sh_lo, sh_hi, 0, 0], 4)
}

/// Repo interest (S3.5, integer math, ACT/360):
/// repurchase = P + (P * rate_bps * days) / (10_000 * 360), floor division.
pub fn repurchase_amount(principal: u64, rate_bps: u64, days: u64) -> u64 {
    let p = principal as u128;
    let interest = (p * (rate_bps as u128) * (days as u128)) / 3_600_000;
    principal + (interest as u64)
}

// transition messages at the remaining circuit arities
pub fn transition_msg_1x4(root: Field, n1: Field, c: [Field; 4]) -> Field {
    Poseidon2::hash([root, n1, c[0], c[1], c[2], c[3]], 6)
}

pub fn transition_msg_1x2(root: Field, n1: Field, c1: Field, c2: Field) -> Field {
    Poseidon2::hash([root, n1, c1, c2], 4)
}

pub fn transition_msg_4x4(root: Field, n: [Field; 4], c: [Field; 4]) -> Field {
    Poseidon2::hash([root, n[0], n[1], n[2], n[3], c[0], c[1], c[2], c[3]], 9)
}

pub fn transition_msg_4x3(root: Field, n: [Field; 4], c1: Field, c2: Field, c3: Field) -> Field {
    Poseidon2::hash([root, n[0], n[1], n[2], n[3], c1, c2, c3], 8)
}

#[test]
fn test_strategy_commitment_matches_protocol() {
    // Cross-language check: the value below is computed by packages/protocol commitment()
    // for a StrategyPosition note {owner_x:1, vault_id_hash:2, amount:1000, open_ts:3, note_secret:4, salt:5}.
    // If this assert fails, the TS and Noir commitment encodings have diverged.
    assert(
        strategy_commitment(1, 2, 1000, 3, 4, 5)
            == 0x195bd4c7b6e324ca06a236719475af550c9a0f165ef00edaa33a9f7474912f10,
    );
}
