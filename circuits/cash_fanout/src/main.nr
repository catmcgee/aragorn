// cash_fanout (circuit id 4): one funded pool -> up to 3 private Entitlements + Cash change.
// Shared shape for payroll runs and bond coupons: one pool, N recipients, zero contention.
// Slots: c1..c3 = Entitlement (ent_real flags), c4 = Cash change back to payer.
use aragorn_lib::{
    cash_commitment, check_sig, commitment, entitlement_payload, merkle_root, nullifier,
    stakeholders_hash, transition_msg_1x4, Sig, TEMPLATE_ENTITLEMENT,
};

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    // funding note (Cash, payer-owned)
    in1_amount: u64,
    in1_salt: Field,
    in1_salt2: Field,
    in1_secret: Field,
    in1_index: u32,
    in1_path: [Field; 32],
    // payer
    payer_x: Field,
    payer_y: Field,
    sig: Sig,
    // entitlements (slot i real iff ent_real[i])
    ent_real: [bool; 3],
    ent_claim_hash: [Field; 3],
    ent_amount: [u64; 3],
    ent_memo_hash: [Field; 3],
    ent_salt: [Field; 3],
    // change
    change_amount: u64,
    change_salt: Field,
    change_salt2: Field,
) {
    assert(t_bound == 0);
    for i in 0..4 {
        assert(aux[i] == 0);
    }
    assert(nullifiers[1] == 0);
    assert(nullifiers[2] == 0);
    assert(nullifiers[3] == 0);

    // funding note: existence + nullifier
    let in1_c = cash_commitment(payer_x, in1_amount, in1_salt2, in1_salt);
    assert(merkle_root(in1_c, in1_index, in1_path) == root);
    assert(nullifiers[0] == nullifier(in1_c, in1_secret));

    // entitlement outputs
    let ent_sh = stakeholders_hash([payer_x, 0, 0, 0]);
    let mut paid: u64 = 0;
    for i in 0..3 {
        let ph = entitlement_payload(ent_claim_hash[i], ent_amount[i], payer_x, ent_memo_hash[i]);
        let c = commitment(TEMPLATE_ENTITLEMENT, ph, ent_sh, ent_salt[i]);
        if ent_real[i] {
            assert(commitments[i] == c);
            paid += ent_amount[i];
        } else {
            assert(commitments[i] == 0);
        }
    }

    // change (always created)
    assert(commitments[3] == cash_commitment(payer_x, change_amount, change_salt2, change_salt));

    // conservation
    assert(in1_amount == paid + change_amount);

    // payer authorization
    let msg = transition_msg_1x4(root, nullifiers[0], commitments);
    check_sig(payer_x, payer_y, sig, msg);
}
