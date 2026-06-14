// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ShieldVault, IERC20} from "../src/ShieldVault.sol";
import {NoteRegistry, IPoseidon2, IVerifier} from "../src/NoteRegistry.sol";
import {Poseidon2Yul_BN254} from "../src/Poseidon2Yul.sol";
import {CashShieldVerifier} from "../src/verifiers/CashShieldVerifier.sol";
import {CashTransferVerifier} from "../src/verifiers/CashTransferVerifier.sol";
import {CashUnshieldVerifier} from "../src/verifiers/CashUnshieldVerifier.sol";
import {CashFanoutVerifier} from "../src/verifiers/CashFanoutVerifier.sol";
import {EntitlementClaimVerifier} from "../src/verifiers/EntitlementClaimVerifier.sol";
import {RepoProposeAllocateVerifier} from "../src/verifiers/RepoProposeAllocateVerifier.sol";
import {RepoAcceptVerifier} from "../src/verifiers/RepoAcceptVerifier.sol";
import {RepoCloseVerifier} from "../src/verifiers/RepoCloseVerifier.sol";
import {StrategyOpenVerifier} from "../src/verifiers/StrategyOpenVerifier.sol";
import {StrategyRedeemVerifier} from "../src/verifiers/StrategyRedeemVerifier.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        Poseidon2Yul_BN254 poseidon = new Poseidon2Yul_BN254();
        MockUSDC usdc = new MockUSDC();
        ShieldVault vault = new ShieldVault(IERC20(address(usdc)));
        NoteRegistry registry = new NoteRegistry(IPoseidon2(address(poseidon)), vault);
        vault.setRegistry(address(registry));

        registry.setVerifier(1, IVerifier(address(new CashShieldVerifier())));
        registry.setVerifier(2, IVerifier(address(new CashTransferVerifier())));
        registry.setVerifier(3, IVerifier(address(new CashUnshieldVerifier())));
        registry.setVerifier(4, IVerifier(address(new CashFanoutVerifier())));
        registry.setVerifier(5, IVerifier(address(new EntitlementClaimVerifier())));
        registry.setVerifier(6, IVerifier(address(new RepoProposeAllocateVerifier())));
        registry.setVerifier(7, IVerifier(address(new RepoAcceptVerifier())));
        registry.setVerifier(8, IVerifier(address(new RepoCloseVerifier())));
        registry.setVerifier(9, IVerifier(address(new StrategyOpenVerifier())));
        registry.setVerifier(10, IVerifier(address(new StrategyRedeemVerifier())));

        // Lock the verifier set: after this, setVerifier reverts ("registry: frozen"),
        // so the owner can never swap in a malicious verifier to forge notes. Seeding
        // (seedCommitments) is gated separately by `seeded`, so this does not block the seed.
        registry.freezeVerifiers();

        vm.stopBroadcast();

        string memory json = "deployments";
        vm.serializeAddress(json, "poseidon", address(poseidon));
        vm.serializeAddress(json, "usdc", address(usdc));
        vm.serializeAddress(json, "vault", address(vault));
        string memory out = vm.serializeAddress(json, "registry", address(registry));
        vm.writeJson(out, "./deployments.local.json");
    }
}
