// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Poseidon2Yul_BN254} from "../src/Poseidon2Yul.sol";

interface IP2 {
    function hash_1(uint256) external view returns (uint256);
    function hash_2(uint256, uint256) external view returns (uint256);
    function hash_3(uint256, uint256, uint256) external view returns (uint256);
}

// P0 three-way fixture: these constants are the outputs of
// noir-lang/poseidon v0.3.0 Poseidon2::hash (nargo test, spikes/p0-poseidon2/noir_fixture)
// and must equal bb.js poseidon2Hash and this Solidity implementation.
contract Poseidon2EqualityTest is Test {
    IP2 p2;

    function setUp() public {
        p2 = IP2(address(new Poseidon2Yul_BN254()));
    }

    function test_hash1_matches_noir() public view {
        assertEq(
            p2.hash_1(1),
            0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373
        );
    }

    function test_hash2_matches_noir() public view {
        assertEq(
            p2.hash_2(1, 2),
            0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383
        );
    }

    function test_hash3_matches_noir() public view {
        assertEq(
            p2.hash_3(1, 2, 3),
            0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8
        );
    }
}
