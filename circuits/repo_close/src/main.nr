// repo_close (circuit id 8): the off-leg. Dealer returns principal + in-circuit interest;
// the lender's encumbered collateral releases because the governing agreement is exercised
// correctly (authority-from-contract) - the lender does nothing and needs to do nothing.
// Time-gated: circuit asserts maturity_ts <= T; the contract enforces block.timestamp >= T.
use aragorn_lib::{
    bond_payload, cash_commitment, check_sig, commitment, merkle_root, nullifier,
    repo_agreement_payload, repurchase_amount, transition_msg_4x3, two_party_stakeholders, Sig,
    TEMPLATE_BOND_POSITION, TEMPLATE_REPO_AGREEMENT,
};

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    // agreement terms (witness, validated against the consumed agreement commitment)
    dealer_x: Field,
    lender_x: Field,
    collateral_c: Field,
    cash_amount: u64,
    rate_bps: u64,
    term_days: u64,
    maturity_ts: u64,
    // n1: agreement
    agreement_salt: Field,
    agreement_secret: Field,
    agreement_index: u32,
    agreement_path: [Field; 32],
    // n2: encumbered bond position (lender-owned, encumbrance = agreement C)
    bond_issuer_x: Field,
    isin_hash: Field,
    face_amount: u64,
    position_salt: Field,
    position_secret: Field,
    position_index: u32,
    position_path: [Field; 32],
    // n3/n4: dealer cash for P + interest
    in1_amount: u64,
    in1_salt: Field,
    in1_salt2: Field,
    in1_secret: Field,
    in1_index: u32,
    in1_path: [Field; 32],
    in2_real: bool,
    in2_amount: u64,
    in2_salt: Field,
    in2_salt2: Field,
    in2_secret: Field,
    in2_index: u32,
    in2_path: [Field; 32],
    // dealer auth
    dealer_y: Field,
    sig: Sig,
    // outputs
    lender_cash_salt: Field,
    lender_cash_salt2: Field,
    position_out_salt: Field,
    change_amount: u64,
    change_salt: Field,
    change_salt2: Field,
    // sorted stakeholder pair
    sh_lo: Field,
    sh_hi: Field,
) {
    for i in 0..4 {
        assert(aux[i] == 0);
    }
    assert(commitments[3] == 0);

    // time gate: this transition is valid for any time >= T claimed publicly
    assert(maturity_ts as Field == t_bound); // PoC: T == maturity (contract checks now >= T)

    let pair_sh = two_party_stakeholders(sh_lo, sh_hi, dealer_x, lender_x);

    // n1: the governing agreement
    let agr_ph = repo_agreement_payload(
        dealer_x, lender_x, collateral_c, cash_amount, rate_bps, term_days, maturity_ts,
    );
    let agreement_c = commitment(TEMPLATE_REPO_AGREEMENT, agr_ph, pair_sh, agreement_salt);
    assert(merkle_root(agreement_c, agreement_index, agreement_path) == root);
    assert(nullifiers[0] == nullifier(agreement_c, agreement_secret));

    // n2: encumbered position - its encumbrance field MUST equal the agreement being
    // exercised (authority-from-contract, the abstraction repo forces; EXPLORATION S6.1)
    let pos_ph = bond_payload(lender_x, bond_issuer_x, isin_hash, face_amount, agreement_c);
    let pos_c = commitment(TEMPLATE_BOND_POSITION, pos_ph, pair_sh, position_salt);
    assert(merkle_root(pos_c, position_index, position_path) == root);
    assert(nullifiers[1] == nullifier(pos_c, position_secret));

    // n3/n4: dealer cash
    let in1_c = cash_commitment(dealer_x, in1_amount, in1_salt2, in1_salt);
    assert(merkle_root(in1_c, in1_index, in1_path) == root);
    assert(nullifiers[2] == nullifier(in1_c, in1_secret));
    let in2_c = cash_commitment(dealer_x, in2_amount, in2_salt2, in2_salt);
    if in2_real {
        assert(merkle_root(in2_c, in2_index, in2_path) == root);
        assert(nullifiers[3] == nullifier(in2_c, in2_secret));
        assert(nullifiers[2] != nullifiers[3]);
    } else {
        assert(nullifiers[3] == 0);
    }
    let in_sum = in1_amount + (if in2_real { in2_amount } else { 0 });

    // c1: repurchase price to the lender - computed IN-CIRCUIT; a wrong number cannot verify
    let repurchase = repurchase_amount(cash_amount, rate_bps, term_days);
    assert(commitments[0] == cash_commitment(lender_x, repurchase, lender_cash_salt2, lender_cash_salt));

    // c2: collateral back to the dealer, unencumbered
    let pos_out_ph = bond_payload(dealer_x, bond_issuer_x, isin_hash, face_amount, 0);
    assert(commitments[1] == commitment(TEMPLATE_BOND_POSITION, pos_out_ph, pair_sh, position_out_salt));

    // c3: dealer change
    assert(commitments[2] == cash_commitment(dealer_x, change_amount, change_salt2, change_salt));
    assert(in_sum == repurchase + change_amount);

    // dealer authorization
    let msg = transition_msg_4x3(root, nullifiers, commitments[0], commitments[1], commitments[2]);
    check_sig(dealer_x, dealer_y, sig, msg);
}
