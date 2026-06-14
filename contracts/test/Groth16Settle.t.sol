// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ShieldVault, IERC20} from "../src/ShieldVault.sol";
import {NoteRegistry, IPoseidon2, IVerifier} from "../src/NoteRegistry.sol";
import {Poseidon2Yul_BN254} from "../src/Poseidon2Yul.sol";
import {Groth16VerifierBase} from "../src/groth16/Groth16VerifierBase.sol";
import {Groth16Verifier} from "../src/groth16/Groth16Verifier.sol";

/// End-to-end: a REAL Groth16 proof (the spike's recursive ProveKit/WHIR -> Groth16
/// proof) is verified ON-CHAIN through Aragorn's normal NoteRegistry.settle() path,
/// routed via the Groth16Verifier IVerifier adapter registered under a new circuitId.
///
/// The proof / commitments / commitmentPok / public signal below are the decoded
/// spike args from spikes/provekit-groth16/ONCHAIN_RESULT.md. They prove the SPIKE
/// circuit (one public signal), NOT a real note transition — see the scope note in
/// Groth16Verifier.sol. The point of this test is to prove the SETTLEMENT SEAM:
/// settle() -> verifiers[circuitId].verify(...) -> gnark Groth16 verify on-chain.
contract Groth16SettleTest is Test {
    uint32 constant CIRCUIT_GROTH16 = 100; // new circuitId for the Groth16-settled path

    MockUSDC usdc;
    ShieldVault vault;
    NoteRegistry registry;
    Groth16VerifierBase base;
    Groth16Verifier adapter;

    bytes32 constant EMPTY_ROOT = 0x0b59baa35b9dc267744f0ccb4e3b0255c1fc512460d91130c6bc19fb2668568d;

    // --- spike Groth16 args (ONCHAIN_RESULT.md) ---
    uint256[8] PROOF = [
        0x2520824d53f8ea662530e0a90c75ce5048945c80816d1e88908e6148e286c1fc,
        0x0eaffb8429fef019e39fb46d5c68678a555cfbb3419b3c28d09cc5d57b7356db,
        0x2bc059f8e0e09804a4e0edb9b51e455c9e5c4dd53403b9947501e00ffaf35528,
        0x2b40999968e47ff09d4bbb58e39fadd7cbce596ace0a7c35e27b6c361365ab9e,
        0x16e8a8df1a6f46844a4925d882abc94aeaacb77e1b9d0d8c49ec26bf1bcbb31a,
        0x240bb26e75971dbca64a584dfc7e37f1090320ccd5d2d8d461d92a78f0745635,
        0x037491f5f2cb2b32382eec9a481b2633ad54edcbb06462afd2e73c02d9d0cd01,
        0x251904a9bab424f6507320dcfeec617c82a39c6216dac6d5915510f9c4eef0be
    ];
    uint256[2] COMMITMENTS = [
        0x22c9d39e18728ce2813421b91fca955f493505b4a6359e01b262f8dd8936fda2,
        0x1cf84ade91b510c4e74d310519c680f19bf0ad7df68e1d042de3d1ecfc021120
    ];
    uint256[2] COMMITMENT_POK = [
        0x24913698821409e90799e2ace24a904f3db297afe50bfed4022f2be35fcffdc4,
        0x1e89caced1a036c53676de0cc15a0c398f0415229b928087f513a5560eb7f0ef
    ];
    uint256 constant INPUT = 8029637766677081141616056164817960417492557901132884771156119727985084767719;

    function setUp() public {
        Poseidon2Yul_BN254 poseidon = new Poseidon2Yul_BN254();
        usdc = new MockUSDC();
        vault = new ShieldVault(IERC20(address(usdc)));
        registry = new NoteRegistry(IPoseidon2(address(poseidon)), vault);
        vault.setRegistry(address(registry));

        base = new Groth16VerifierBase();
        adapter = new Groth16Verifier(base);
        registry.setVerifier(CIRCUIT_GROTH16, IVerifier(address(adapter)));
        registry.freezeVerifiers();
    }

    /// Pack the 13-word proof blob the adapter expects.
    function packProof() internal view returns (bytes memory) {
        return abi.encodePacked(
            PROOF[0], PROOF[1], PROOF[2], PROOF[3], PROOF[4], PROOF[5], PROOF[6], PROOF[7],
            COMMITMENTS[0], COMMITMENTS[1],
            COMMITMENT_POK[0], COMMITMENT_POK[1],
            INPUT
        );
    }

    /// 14 settlement public inputs. Real root so settle() passes its root check;
    /// one fresh nullifier and one fresh commitment so the tree/nullifier logic runs.
    function settlementInputs(bytes32 root, bytes32 nullifier, bytes32 commitment)
        internal
        pure
        returns (bytes32[] memory out)
    {
        out = new bytes32[](14);
        out[0] = root;
        out[2] = nullifier;
        out[6] = commitment;
    }

    /// POSITIVE: real Groth16 proof verifies on-chain through settle().
    function test_settle_routes_through_groth16_and_succeeds() public {
        bytes memory proof = packProof();
        bytes32 nullifier = bytes32(uint256(0xa11ce01));
        bytes32 commitment = bytes32(uint256(0xc0117e01));
        bytes32[] memory pis = settlementInputs(EMPTY_ROOT, nullifier, commitment);

        // Sanity: the adapter itself verifies the real proof.
        assertTrue(adapter.verify(proof, pis), "adapter should verify the real groth16 proof");

        // Full settle() path: routes to verifiers[100].verify -> gnark Groth16 verify.
        registry.settle(CIRCUIT_GROTH16, proof, pis, new bytes[](0));

        // settle() inserted the commitment, advancing the root.
        assertTrue(registry.root() != EMPTY_ROOT, "settle should have inserted commitment");
        assertTrue(registry.isSpent(nullifier), "nullifier should be spent");
    }

    /// NEGATIVE: tampering the Groth16 public signal makes the gnark verify revert,
    /// the adapter returns false, and settle() reverts "registry: invalid proof".
    function test_settle_reverts_on_tampered_public_signal() public {
        // Flip the last word (the Groth16 public signal) -> wrong MSM scalar -> pairing fails.
        bytes memory bad = abi.encodePacked(
            PROOF[0], PROOF[1], PROOF[2], PROOF[3], PROOF[4], PROOF[5], PROOF[6], PROOF[7],
            COMMITMENTS[0], COMMITMENTS[1],
            COMMITMENT_POK[0], COMMITMENT_POK[1],
            INPUT + 1
        );

        bytes32[] memory pis = settlementInputs(EMPTY_ROOT, bytes32(uint256(0xBADBEEF)), bytes32(uint256(0xC2)));
        assertFalse(adapter.verify(bad, pis), "adapter must reject tampered signal");

        vm.expectRevert("registry: invalid proof");
        registry.settle(CIRCUIT_GROTH16, bad, pis, new bytes[](0));
    }

    /// NEGATIVE: flipping a single proof byte (A.x) also fails on-chain.
    function test_settle_reverts_on_tampered_proof_byte() public {
        bytes memory bad = abi.encodePacked(
            PROOF[0] ^ 1, PROOF[1], PROOF[2], PROOF[3], PROOF[4], PROOF[5], PROOF[6], PROOF[7],
            COMMITMENTS[0], COMMITMENTS[1],
            COMMITMENT_POK[0], COMMITMENT_POK[1],
            INPUT
        );
        bytes32[] memory pis = settlementInputs(EMPTY_ROOT, bytes32(uint256(0xFEED)), bytes32(uint256(0xC3)));
        assertFalse(adapter.verify(bad, pis), "adapter must reject tampered proof byte");

        vm.expectRevert("registry: invalid proof");
        registry.settle(CIRCUIT_GROTH16, bad, pis, new bytes[](0));
    }

    /// Report the gas of the Groth16-routed settle for the summary.
    function test_settle_gas_report() public {
        bytes memory proof = packProof();
        bytes32[] memory pis = settlementInputs(EMPTY_ROOT, bytes32(uint256(0x6A5)), bytes32(uint256(0xC4)));
        uint256 g0 = gasleft();
        registry.settle(CIRCUIT_GROTH16, proof, pis, new bytes[](0));
        uint256 used = g0 - gasleft();
        emit log_named_uint("groth16 settle() gas", used);
    }
}
