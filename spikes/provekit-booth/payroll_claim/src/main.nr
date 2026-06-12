// payroll_claim -- standalone beta.11-compatible port of circuits/entitlement_claim
// for the World Track D (ProveKit) booth demo. Poseidon-only by design; the public
// input shape is simplified to (root, nullifier_out, cash_commitment_out) -- the booth
// demo does not need the on-chain 14-slot layout.
//
// Hashing: Poseidon2 (Barretenberg parameters) via noir-lang/poseidon v0.1.1
// (the bundled beta.11 stdlib marks std::hash::poseidon2 private) -- matches
// @aztec/bb.js poseidon2Hash.

use poseidon::poseidon2::Poseidon2;

global TREE_DEPTH: u32 = 32;
global VERSION: Field = 1;
global TEMPLATE_CASH: Field = 1;
global TEMPLATE_ENTITLEMENT: Field = 6;

fn main(
    root: pub Field,
    nullifier_out: pub Field,
    cash_commitment_out: pub Field,
    // the entitlement being claimed
    claim_secret: Field,
    ent_amount: u64,
    ent_payer_x: Field,
    ent_memo_hash: Field,
    ent_salt: Field,
    ent_secret: Field,
    ent_index: u32,
    ent_path: [Field; 32],
    // the cash note the claimer mints to themselves
    out_owner_x: Field,
    out_salt: Field,
    out_salt2: Field,
) {
    // authorization: knowledge of the claim secret behind the entitlement's claim_hash
    let claim_hash = Poseidon2::hash([claim_secret], 1);

    // entitlement payload: [claim_hash, amount, payer_x, memo_hash]
    let payload_hash = Poseidon2::hash(
        [claim_hash, ent_amount as Field, ent_payer_x, ent_memo_hash],
        4,
    );
    let ent_stakeholders = Poseidon2::hash([ent_payer_x, 0, 0, 0], 4);
    // commitment = H5([template_id, version, payload, stakeholders, salt])
    let ent_c = Poseidon2::hash(
        [TEMPLATE_ENTITLEMENT, VERSION, payload_hash, ent_stakeholders, ent_salt],
        5,
    );

    // merkle root recompute over 32 levels: bit i of ent_index picks left/right
    let mut node = ent_c;
    let mut idx = ent_index;
    for i in 0..TREE_DEPTH {
        let bit = idx & 1;
        let sibling = ent_path[i];
        let (l, r) = if bit == 1 { (sibling, node) } else { (node, sibling) };
        node = Poseidon2::hash([l, r], 2);
        idx = idx / 2;
    }
    assert(node == root);

    // nullifier = H2([commitment, note_secret])
    assert(nullifier_out == Poseidon2::hash([ent_c, ent_secret], 2));

    // cash out: amount preserved exactly
    let cash_payload = Poseidon2::hash([out_owner_x, ent_amount as Field, out_salt2], 3);
    let cash_stakeholders = Poseidon2::hash([out_owner_x, 0, 0, 0], 4);
    let cash_c = Poseidon2::hash(
        [TEMPLATE_CASH, VERSION, cash_payload, cash_stakeholders, out_salt],
        5,
    );
    assert(cash_commitment_out == cash_c);
}
