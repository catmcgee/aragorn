// cash_transfer (circuit id 2): n-in/2-out Cash. Owner auth (Schnorr), conservation.
// Inputs: n1 mandatory, n2 optional (in2_real). Outputs: c1 -> recipient, c2 -> change to owner
// (always created, possibly zero-amount, for uniform shape).
use aragorn_lib::{cash_commitment, check_sig, merkle_root, nullifier, Sig, transition_msg_2x2};

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    // input note 1 (mandatory)
    in1_amount: u64,
    in1_salt: Field,
    in1_salt2: Field,
    in1_secret: Field,
    in1_index: u32,
    in1_path: [Field; 32],
    // input note 2 (optional)
    in2_real: bool,
    in2_amount: u64,
    in2_salt: Field,
    in2_salt2: Field,
    in2_secret: Field,
    in2_index: u32,
    in2_path: [Field; 32],
    // owner (both inputs owned by the same party)
    owner_x: Field,
    owner_y: Field,
    sig: Sig,
    // outputs
    recipient_x: Field,
    out1_amount: u64,
    out1_salt: Field,
    out1_salt2: Field,
    change_amount: u64,
    change_salt: Field,
    change_salt2: Field,
) {
    assert(t_bound == 0);
    for i in 0..4 {
        assert(aux[i] == 0);
    }
    assert(nullifiers[2] == 0);
    assert(nullifiers[3] == 0);
    assert(commitments[2] == 0);
    assert(commitments[3] == 0);

    // -- input 1: existence + nullifier
    let in1_c = cash_commitment(owner_x, in1_amount, in1_salt2, in1_salt);
    assert(merkle_root(in1_c, in1_index, in1_path) == root);
    assert(nullifiers[0] == nullifier(in1_c, in1_secret));

    // -- input 2: optional
    let in2_c = cash_commitment(owner_x, in2_amount, in2_salt2, in2_salt);
    if in2_real {
        assert(merkle_root(in2_c, in2_index, in2_path) == root);
        assert(nullifiers[1] == nullifier(in2_c, in2_secret));
        // distinct notes (same-note double-input would otherwise conserve twice)
        assert(nullifiers[0] != nullifiers[1]);
    } else {
        assert(nullifiers[1] == 0);
    }
    let in_sum = in1_amount + (if in2_real { in2_amount } else { 0 });

    // -- outputs
    assert(commitments[0] == cash_commitment(recipient_x, out1_amount, out1_salt2, out1_salt));
    assert(commitments[1] == cash_commitment(owner_x, change_amount, change_salt2, change_salt));

    // -- conservation (u64 arithmetic: overflow checked by Noir)
    assert(in_sum == out1_amount + change_amount);

    // -- owner authorization over the exact transition
    let msg = transition_msg_2x2(root, nullifiers[0], nullifiers[1], commitments[0], commitments[1]);
    check_sig(owner_x, owner_y, sig, msg);
}
