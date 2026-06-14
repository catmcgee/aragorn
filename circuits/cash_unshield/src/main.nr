// cash_unshield (circuit id 3): Cash note burned -> public USDC release.
// Public aux: [amount, recipient_addr, 0, 0] - the contract pays `amount` to `recipient_addr`.
// c1 = change note back to owner (always created, possibly zero-amount).
use aragorn_lib::{cash_commitment, check_sig, merkle_root, nullifier, Sig, transition_msg_1x1_aux2};

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    // input note
    in1_amount: u64,
    in1_salt: Field,
    in1_salt2: Field,
    in1_secret: Field,
    in1_index: u32,
    in1_path: [Field; 32],
    // owner
    owner_x: Field,
    owner_y: Field,
    sig: Sig,
    // public release + change
    unshield_amount: u64,
    change_amount: u64,
    change_salt: Field,
    change_salt2: Field,
    change_secret: Field,
) {
    assert(t_bound == 0);
    assert(nullifiers[1] == 0);
    assert(nullifiers[2] == 0);
    assert(nullifiers[3] == 0);
    assert(commitments[1] == 0);
    assert(commitments[2] == 0);
    assert(commitments[3] == 0);
    assert(aux[2] == 0);
    assert(aux[3] == 0);

    // input existence + nullifier
    let in1_c = cash_commitment(owner_x, in1_amount, in1_salt2, in1_secret, in1_salt);
    assert(merkle_root(in1_c, in1_index, in1_path) == root);
    assert(nullifiers[0] == nullifier(in1_c, in1_secret));

    // aux.amount + change == input amount
    assert(aux[0] == unshield_amount as Field);
    assert(in1_amount == unshield_amount + change_amount);
    // aux[1] = recipient address: contract-consumed.

    // change note
    assert(commitments[0] == cash_commitment(owner_x, change_amount, change_salt2, change_secret, change_salt));

    // owner authorization
    let msg = transition_msg_1x1_aux2(root, nullifiers[0], commitments[0], aux[0], aux[1]);
    check_sig(owner_x, owner_y, sig, msg);
}
