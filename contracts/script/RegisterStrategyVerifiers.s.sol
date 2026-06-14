// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Register the strategy circuits (9/10) on an ALREADY-DEPLOYED, non-frozen registry —
// e.g. the live Sepolia registry — without redeploying everything. Owner-gated by setVerifier.
//   REGISTRY=0x... forge script script/RegisterStrategyVerifiers.s.sol \
//     --rpc-url $SEPOLIA_RPC_URL --private-key $SEPOLIA_DEPLOYER_KEY --broadcast --slow
import {Script} from "forge-std/Script.sol";
import {NoteRegistry, IVerifier} from "../src/NoteRegistry.sol";
import {StrategyOpenVerifier} from "../src/verifiers/StrategyOpenVerifier.sol";
import {StrategyRedeemVerifier} from "../src/verifiers/StrategyRedeemVerifier.sol";

contract RegisterStrategyVerifiers is Script {
    function run() external {
        NoteRegistry registry = NoteRegistry(vm.envAddress("REGISTRY"));
        vm.startBroadcast();
        registry.setVerifier(9, IVerifier(address(new StrategyOpenVerifier())));
        registry.setVerifier(10, IVerifier(address(new StrategyRedeemVerifier())));
        vm.stopBroadcast();
    }
}
