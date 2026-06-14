// strategy_redeem (circuit id 10): 1-in StrategyPosition -> 1-out Cash. Owner auth (Schnorr).
// The position's principal returns to the shielded set as a Cash note (conserved). Yield is
// realized in the public Privy Earn position (Privy custodies the Morpho shares), so the
// circuit mints exactly the principal - no oracle-attested amount needed for soundness.
use aragorn_lib::{cash_commitment, check_sig, merkle_root, nullifier, strategy_commitment, Sig, transition_msg_1x1};

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    // input: the StrategyPosition note being redeemed
    vault_id_hash: Field,
    principal: u64,
    open_ts: Field,
    pos_salt: Field,
    pos_secret: Field,
    pos_index: u32,
    pos_path: [Field; 32],
    // owner
    owner_x: Field,
    owner_y: Field,
    sig: Sig,
    // output: Cash note back to the owner (principal)
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

    // -- input: the position note exists + nullifier
    let pos_c = strategy_commitment(owner_x, vault_id_hash, principal, open_ts, pos_secret, pos_salt);
    assert(merkle_root(pos_c, pos_index, pos_path) == root);
    assert(nullifiers[0] == nullifier(pos_c, pos_secret));

    // -- output: principal returns to a shielded Cash note (conserved)
    assert(commitments[0] == cash_commitment(owner_x, principal, out_salt2, out_secret, out_salt));

    // -- owner authorization over the exact transition
    let msg = transition_msg_1x1(root, nullifiers[0], commitments[0]);
    check_sig(owner_x, owner_y, sig, msg);
}
