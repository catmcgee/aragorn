// cash_shield (circuit id 1): USDC deposited at the boundary -> Cash note minted.
// Public aux: [amount, depositor, 0, 0] - the contract pulls `amount` USDC from `depositor`.
// Fixed public layout (S3.8): [root, T, n1..n4, c1..c4, aux1..aux4].
use aragorn_lib::cash_commitment;

fn main(
    root: pub Field,
    t_bound: pub Field,
    nullifiers: pub [Field; 4],
    commitments: pub [Field; 4],
    aux: pub [Field; 4],
    owner_x: Field,
    amount: u64,
    salt: Field,
    salt2: Field,
    note_secret: Field,
) {
    // No consumed notes; root is contract-checked only.
    let _ = root;
    assert(t_bound == 0);
    for i in 0..4 {
        assert(nullifiers[i] == 0);
    }

    // aux.amount == payload.amount (the contract pulls exactly aux[0])
    assert(aux[0] == amount as Field);
    // aux[1] = depositor address: contract-consumed, circuit-agnostic.
    assert(aux[2] == 0);
    assert(aux[3] == 0);

    let c = cash_commitment(owner_x, amount, salt2, note_secret, salt);
    assert(commitments[0] == c);
    assert(commitments[1] == 0);
    assert(commitments[2] == 0);
    assert(commitments[3] == 0);
}

#[test]
fn shield_happy() {
    let owner_x = 77;
    let amount: u64 = 5_000_000;
    let c = cash_commitment(owner_x, amount, 11, 33, 22);
    main(
        0,
        0,
        [0, 0, 0, 0],
        [c, 0, 0, 0],
        [amount as Field, 0xabcd, 0, 0],
        owner_x,
        amount,
        22,
        11,
        33,
    );
}

#[test(should_fail)]
fn shield_wrong_amount() {
    let c = cash_commitment(77, 5_000_000, 11, 33, 22);
    main(0, 0, [0, 0, 0, 0], [c, 0, 0, 0], [999 as Field, 0xabcd, 0, 0], 77, 5_000_000, 22, 11, 33);
}
