// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ShieldVault, IERC20} from "../src/ShieldVault.sol";
import {NoteRegistry, IPoseidon2, IVerifier} from "../src/NoteRegistry.sol";
import {Poseidon2Yul_BN254} from "../src/Poseidon2Yul.sol";
import {Groth16VerifierBase} from "../src/groth16/Groth16VerifierBase.sol";
import {Groth16Verifier} from "../src/groth16/Groth16Verifier.sol";

/// Deploy VARIANT for the local-Anvil Groth16 settlement demo.
///
/// This is intentionally NOT the production Deploy.s.sol. It stands up a fresh
/// NoteRegistry and registers a single Groth16 verifier (the spike circuit) under
/// circuitId 100, then freezes. It exists to prove that NoteRegistry.settle() can
/// route a REAL Groth16 proof through its normal IVerifier seam and verify it
/// on-chain. The Groth16 verifying key here is the SPIKE circuit's (one public
/// signal) — see Groth16Verifier.sol and GROTH16_SETTLEMENT_PLAN.md. Do not use
/// this for any real deployment.
contract DeployGroth16 is Script {
    uint32 constant CIRCUIT_GROTH16 = 100;

    function run() external {
        vm.startBroadcast();

        Poseidon2Yul_BN254 poseidon = new Poseidon2Yul_BN254();
        MockUSDC usdc = new MockUSDC();
        ShieldVault vault = new ShieldVault(IERC20(address(usdc)));
        NoteRegistry registry = new NoteRegistry(IPoseidon2(address(poseidon)), vault);
        vault.setRegistry(address(registry));

        Groth16VerifierBase base = new Groth16VerifierBase();
        Groth16Verifier adapter = new Groth16Verifier(base);
        registry.setVerifier(CIRCUIT_GROTH16, IVerifier(address(adapter)));

        // Freeze: mirrors production. Because the set is frozen, swapping verifiers
        // (e.g. to add more Groth16-settled circuits later) requires a fresh deploy.
        registry.freezeVerifiers();

        vm.stopBroadcast();

        string memory json = "deployments";
        vm.serializeAddress(json, "poseidon", address(poseidon));
        vm.serializeAddress(json, "usdc", address(usdc));
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeAddress(json, "groth16Base", address(base));
        vm.serializeAddress(json, "groth16Verifier", address(adapter));
        string memory out = vm.serializeAddress(json, "registry", address(registry));
        vm.writeJson(out, "./deployments.groth16.local.json");
    }
}
