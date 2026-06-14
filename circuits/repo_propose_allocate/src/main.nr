// repo_propose_allocate (circuit id 6): dealer locks free collateral against a term sheet.
// Consumes n1 = BondPosition (encumbrance == 0, dealer-owned).
// Creates c1 = RepoProposal, c2 = CollateralAllocation (the allocation pattern: the lender's
// later accept needs no live dealer signature - authority committed up front).
use aragorn_lib::{
    bond_payload, check_sig, collateral_allocation_payload, commitment, merkle_root, nullifier,
    repo_proposal_payload, stakeholders_hash, transition_msg_1x2, two_party_stakeholders, Sig,
    TEMPLATE_BOND_POSITION, TEMPLATE_COLLATERAL_ALLOCATION, TEMPLATE_REPO_PROPOSAL,
};

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    // consumed bond position (free)
    bond_issuer_x: Field,
    bond_isin_hash: Field,
    bond_face: u64,
    bond_salt: Field,
    bond_secret: Field,
    bond_index: u32,
    bond_path: [Field; 32],
    bond_sh: [Field; 4], // stakeholder set of the consumed bond (sorted, zero-padded)
    // dealer
    dealer_x: Field,
    dealer_y: Field,
    sig: Sig,
    // terms
    lender_x: Field,
    cash_amount: u64,
    rate_bps: u64,
    term_days: u64,
    // output salts/secrets
    proposal_salt: Field,
    proposal_secret: Field,
    allocation_salt: Field,
    allocation_secret: Field,
    // sorted two-party stakeholder pair for outputs
    sh_lo: Field,
    sh_hi: Field,
) {
    assert(t_bound == 0);
    for i in 0..4 {
        assert(aux[i] == 0);
    }
    assert(nullifiers[1] == 0);
    assert(nullifiers[2] == 0);
    assert(nullifiers[3] == 0);
    assert(commitments[2] == 0);
    assert(commitments[3] == 0);

    // consumed bond: dealer-owned, UNENCUMBERED, in tree
    let bond_ph = bond_payload(dealer_x, bond_issuer_x, bond_isin_hash, bond_face, 0);
    let bond_c = commitment(TEMPLATE_BOND_POSITION, bond_ph, stakeholders_hash(bond_sh), bond_secret, bond_salt);
    assert(merkle_root(bond_c, bond_index, bond_path) == root);
    assert(nullifiers[0] == nullifier(bond_c, bond_secret));

    // outputs share the dealer+lender stakeholder set
    let pair_sh = two_party_stakeholders(sh_lo, sh_hi, dealer_x, lender_x);

    // c1: RepoProposal (full term sheet)
    let prop_ph = repo_proposal_payload(
        dealer_x, lender_x, bond_isin_hash, bond_face, cash_amount, rate_bps, term_days,
    );
    let proposal_c = commitment(TEMPLATE_REPO_PROPOSAL, prop_ph, pair_sh, proposal_secret, proposal_salt);
    assert(commitments[0] == proposal_c);

    // c2: CollateralAllocation - fields tied to the proposal's collateral terms
    let alloc_ph = collateral_allocation_payload(dealer_x, proposal_c, bond_isin_hash, bond_face);
    assert(commitments[1] == commitment(TEMPLATE_COLLATERAL_ALLOCATION, alloc_ph, pair_sh, allocation_secret, allocation_salt));

    // dealer authorization
    let msg = transition_msg_1x2(root, nullifiers[0], commitments[0], commitments[1]);
    check_sig(dealer_x, dealer_y, sig, msg);
}
