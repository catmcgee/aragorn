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

pub global TREE_DEPTH: u32 = 32;

/// Stakeholder x-coords, sorted ascending then zero-padded to 4 (S3.3).
/// Callers construct the array to match packages/protocol stakeholdersHash.
pub fn stakeholders_hash(xs: [Field; 4]) -> Field {
    Poseidon2::hash(xs, 4)
}

pub fn commitment(template_id: Field, payload_hash: Field, stakeholders: Field, salt: Field) -> Field {
    Poseidon2::hash([template_id, VERSION, payload_hash, stakeholders, salt], 5)
}

pub fn nullifier(c: Field, note_secret: Field) -> Field {
    Poseidon2::hash([c, note_secret], 2)
}

/// Cash payload (S3.6): [owner_x, amount, salt2]
pub fn cash_payload(owner_x: Field, amount: u64, salt2: Field) -> Field {
    Poseidon2::hash([owner_x, amount as Field, salt2], 3)
}

/// Single-stakeholder Cash commitment.
pub fn cash_commitment(owner_x: Field, amount: u64, salt2: Field, salt: Field) -> Field {
    commitment(
        TEMPLATE_CASH,
        cash_payload(owner_x, amount, salt2),
        stakeholders_hash([owner_x, 0, 0, 0]),
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
