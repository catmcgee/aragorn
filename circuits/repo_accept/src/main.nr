// repo_accept (circuit id 7): the atomic on-leg DvP. One settle, no moment where one side
// holds both legs. Consumes [proposal, allocation, lender cash x2(optional)]; creates
// [encumbered BondPosition -> lender, RepoAgreement, Cash -> dealer, lender change].
// The dealer signs nothing here: their authority was committed at allocation (S6.1).
use aragorn_lib::{
    bond_payload, cash_commitment, check_sig, collateral_allocation_payload, commitment,
    merkle_root, nullifier, repo_agreement_payload, repo_proposal_payload, transition_msg_4x4,
    two_party_stakeholders, Sig, TEMPLATE_BOND_POSITION, TEMPLATE_COLLATERAL_ALLOCATION,
    TEMPLATE_REPO_AGREEMENT, TEMPLATE_REPO_PROPOSAL,
};

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    // terms (private witness, validated against consumed proposal commitment)
    dealer_x: Field,
    lender_x: Field,
    isin_hash: Field,
    face_amount: u64,
    cash_amount: u64,
    rate_bps: u64,
    term_days: u64,
    // n1: proposal
    proposal_salt: Field,
    proposal_secret: Field,
    proposal_index: u32,
    proposal_path: [Field; 32],
    // n2: allocation
    allocation_salt: Field,
    allocation_secret: Field,
    allocation_index: u32,
    allocation_path: [Field; 32],
    // n3/n4: lender cash (n4 optional)
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
    // lender auth
    lender_y: Field,
    sig: Sig,
    // outputs
    bond_issuer_x: Field, // carried from the dealer's disclosed bond data (PoC: not circuit-bound)
    maturity_ts: u64,     // set by lender at accept = now + days*86400 (dealer validates on decrypt)
    position_salt: Field,
    agreement_salt: Field,
    dealer_cash_salt: Field,
    dealer_cash_salt2: Field,
    change_amount: u64,
    change_salt: Field,
    change_salt2: Field,
    // sorted stakeholder pair (dealer, lender)
    sh_lo: Field,
    sh_hi: Field,
) {
    assert(t_bound == 0);
    for i in 0..4 {
        assert(aux[i] == 0);
    }

    let pair_sh = two_party_stakeholders(sh_lo, sh_hi, dealer_x, lender_x);

    // n1: proposal exists and binds ALL economic terms
    let prop_ph = repo_proposal_payload(
        dealer_x, lender_x, isin_hash, face_amount, cash_amount, rate_bps, term_days,
    );
    let proposal_c = commitment(TEMPLATE_REPO_PROPOSAL, prop_ph, pair_sh, proposal_salt);
    assert(merkle_root(proposal_c, proposal_index, proposal_path) == root);
    assert(nullifiers[0] == nullifier(proposal_c, proposal_secret));

    // n2: allocation tied to that proposal (authority-from-contract: the lender may consume
    // the dealer's locked collateral because the proposal's logic approves it)
    let alloc_ph = collateral_allocation_payload(dealer_x, proposal_c, isin_hash, face_amount);
    let alloc_c = commitment(TEMPLATE_COLLATERAL_ALLOCATION, alloc_ph, pair_sh, allocation_salt);
    assert(merkle_root(alloc_c, allocation_index, allocation_path) == root);
    assert(nullifiers[1] == nullifier(alloc_c, allocation_secret));

    // n3/n4: lender cash
    let in1_c = cash_commitment(lender_x, in1_amount, in1_salt2, in1_salt);
    assert(merkle_root(in1_c, in1_index, in1_path) == root);
    assert(nullifiers[2] == nullifier(in1_c, in1_secret));
    let in2_c = cash_commitment(lender_x, in2_amount, in2_salt2, in2_salt);
    if in2_real {
        assert(merkle_root(in2_c, in2_index, in2_path) == root);
        assert(nullifiers[3] == nullifier(in2_c, in2_secret));
        assert(nullifiers[2] != nullifiers[3]);
    } else {
        assert(nullifiers[3] == 0);
    }
    let in_sum = in1_amount + (if in2_real { in2_amount } else { 0 });

    // c2 first (c1 references it): RepoAgreement born from the proposal's exact terms
    let agr_ph = repo_agreement_payload(
        dealer_x, lender_x, alloc_c, cash_amount, rate_bps, term_days, maturity_ts,
    );
    let agreement_c = commitment(TEMPLATE_REPO_AGREEMENT, agr_ph, pair_sh, agreement_salt);
    assert(commitments[1] == agreement_c);

    // c1: BondPosition -> lender, ENCUMBERED to the agreement (spendable only by exercising it)
    let pos_ph = bond_payload(lender_x, bond_issuer_x, isin_hash, face_amount, agreement_c);
    assert(commitments[0] == commitment(TEMPLATE_BOND_POSITION, pos_ph, pair_sh, position_salt));

    // c3: cash to dealer == proposal.cash_amount exactly (a wrong number cannot verify)
    assert(commitments[2] == cash_commitment(dealer_x, cash_amount, dealer_cash_salt2, dealer_cash_salt));

    // c4: lender change
    assert(commitments[3] == cash_commitment(lender_x, change_amount, change_salt2, change_salt));
    assert(in_sum == cash_amount + change_amount);

    // lender authorization over the whole transition
    let msg = transition_msg_4x4(root, nullifiers, commitments);
    check_sig(lender_x, lender_y, sig, msg);
}
