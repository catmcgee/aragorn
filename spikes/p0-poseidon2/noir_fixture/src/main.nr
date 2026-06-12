// P0 fixture: Poseidon2 vectors for three-way byte-equality (Noir / bb.js-TS / Solidity).
// The same constants are asserted in spikes/p0-poseidon2/poseidon-equality.ts (bb.js)
// and spikes/p0-provekit/onchain/test/Poseidon2Equality.t.sol (zemse Poseidon2Yul).
use poseidon::poseidon2::Poseidon2;

fn main(x: pub Field) -> pub Field {
    Poseidon2::hash([x], 1)
}

#[test]
fn fixture_vectors() {
    assert_eq(Poseidon2::hash([1], 1), 0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373);
    assert_eq(Poseidon2::hash([1, 2], 2), 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383);
    assert_eq(Poseidon2::hash([1, 2, 3], 3), 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8);
    assert_eq(Poseidon2::hash([1, 2, 3, 4], 4), 0x130bf204a32cac1f0ace56c78b731aa3809f06df2731ebcf6b3464a15788b1b9);
    assert_eq(Poseidon2::hash([1, 2, 3, 4, 5], 5), 0x2247be7014a54d17342a7ef677f58d28877780d203860396967f5d0a18d259db);
}
