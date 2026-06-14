// entitlement_claim (circuit id 5): recipient consumes an Entitlement -> Cash note.
// POSEIDON-ONLY by design (S3.4): secret-knowledge auth (claim_hash = Poseidon2(claim_secret)),
// no curve ops -> portable to any R1CS backend; the in-browser proving target (World Track D).
use aragorn_lib::{
    cash_commitment, commitment, entitlement_payload, merkle_root, nullifier,
    stakeholders_hash, TEMPLATE_ENTITLEMENT,
};
use poseidon::poseidon2::Poseidon2;

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
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
    out_secret: Field,
) {
    assert(t_bound == 0);
    for i in 0..4 {
        assert(aux[i] == 0);
    }
    assert(nullifiers[1] == 0);
    assert(nullifiers[2] == 0);
    assert(nullifiers[3] == 0);
    assert(commitments[1] == 0);
    assert(commitments[2] == 0);
    assert(commitments[3] == 0);

    // authorization: knowledge of the claim secret behind the entitlement's claim_hash
    let claim_hash = Poseidon2::hash([claim_secret], 1);

    // entitlement existence + nullifier
    let ph = entitlement_payload(claim_hash, ent_amount, ent_payer_x, ent_memo_hash);
    let ent_c = commitment(
        TEMPLATE_ENTITLEMENT,
        ph,
        stakeholders_hash([ent_payer_x, 0, 0, 0]),
        ent_secret,
        ent_salt,
    );
    assert(merkle_root(ent_c, ent_index, ent_path) == root);
    assert(nullifiers[0] == nullifier(ent_c, ent_secret));

    // cash out: amount preserved exactly
    assert(commitments[0] == cash_commitment(out_owner_x, ent_amount, out_salt2, out_secret, out_salt));
}
