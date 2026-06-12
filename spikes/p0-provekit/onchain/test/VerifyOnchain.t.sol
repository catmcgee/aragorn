// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {HonkVerifier} from "../src/Verifier.sol";

// P0 gate: a bb UltraHonk (keccak oracle) proof of the Poseidon2 fixture circuit
// verifies inside the EVM via the bb-generated Solidity verifier.
contract VerifyOnchainTest is Test {
    function test_verify_honk_proof() public {
        HonkVerifier verifier = new HonkVerifier();

        bytes memory proof = vm.parseBytes(vm.readFile("test/proof.hex"));
        bytes memory piRaw = vm.parseBytes(vm.readFile("test/public_inputs.hex"));

        bytes32[] memory publicInputs = new bytes32[](piRaw.length / 32);
        for (uint256 i = 0; i < publicInputs.length; i++) {
            bytes32 word;
            assembly {
                word := mload(add(add(piRaw, 0x20), mul(i, 0x20)))
            }
            publicInputs[i] = word;
        }

        bool ok = verifier.verify(proof, publicInputs);
        assertTrue(ok, "honk proof must verify on-chain");
    }
}
