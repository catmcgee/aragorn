// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ShieldVault, IERC20} from "../src/ShieldVault.sol";
import {NoteRegistry, IPoseidon2, IVerifier} from "../src/NoteRegistry.sol";
import {Poseidon2Yul_BN254} from "../src/Poseidon2Yul.sol";

contract MockVerifier is IVerifier {
    bool public ok = true;

    function set(bool v) external {
        ok = v;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return ok;
    }
}

contract NoteRegistryTest is Test {
    MockUSDC usdc;
    ShieldVault vault;
    NoteRegistry registry;
    MockVerifier mock;
    address alice = address(0xA11CE);

    // vectors from packages/protocol MerkleTree (bun, /tmp/tree-vectors.ts)
    bytes32 constant EMPTY_ROOT = 0x0b59baa35b9dc267744f0ccb4e3b0255c1fc512460d91130c6bc19fb2668568d;
    bytes32 constant ROOT_AFTER_111 = 0x070c9f247e576056a954645c2eaf629736050dfcd6ffe287af9842d051223899;
    bytes32 constant ROOT_AFTER_222 = 0x00d4b6b359c4b23d975b4bb4ef10cae56318461a901d1807a5730bf532815512;

    function setUp() public {
        Poseidon2Yul_BN254 poseidon = new Poseidon2Yul_BN254();
        usdc = new MockUSDC();
        vault = new ShieldVault(IERC20(address(usdc)));
        registry = new NoteRegistry(IPoseidon2(address(poseidon)), vault);
        vault.setRegistry(address(registry));
        mock = new MockVerifier();
        for (uint32 i = 1; i <= 8; i++) registry.setVerifier(i, mock);
    }

    function pi(bytes32 root, uint256 t, bytes32 n1, bytes32 c1, uint256 aux1, uint256 aux2)
        internal
        pure
        returns (bytes32[] memory out)
    {
        out = new bytes32[](14);
        out[0] = root;
        out[1] = bytes32(t);
        out[2] = n1;
        out[6] = c1;
        out[10] = bytes32(aux1);
        out[11] = bytes32(aux2);
    }

    function test_tree_matches_protocol_mirror() public {
        assertEq(registry.root(), EMPTY_ROOT, "empty root");
        registry.settle(2, "", pi(EMPTY_ROOT, 0, bytes32(uint256(1)), bytes32(uint256(111)), 0, 0), new bytes[](0));
        assertEq(registry.root(), ROOT_AFTER_111, "root after 111");
        registry.settle(2, "", pi(EMPTY_ROOT, 0, bytes32(uint256(2)), bytes32(uint256(222)), 0, 0), new bytes[](0));
        assertEq(registry.root(), ROOT_AFTER_222, "root after 222");
        assertTrue(registry.isKnownRoot(EMPTY_ROOT), "history keeps old roots");
        assertTrue(registry.isKnownRoot(ROOT_AFTER_111));
    }

    function test_nullifier_replay_reverts() public {
        bytes32 n = bytes32(uint256(42));
        registry.settle(2, "", pi(EMPTY_ROOT, 0, n, bytes32(uint256(1)), 0, 0), new bytes[](0));
        bytes32 currentRoot = registry.root();
        vm.expectRevert("registry: nullifier spent");
        registry.settle(2, "", pi(currentRoot, 0, n, bytes32(uint256(2)), 0, 0), new bytes[](0));
    }

    function test_unknown_root_reverts() public {
        vm.expectRevert("registry: unknown root");
        registry.settle(2, "", pi(bytes32(uint256(0xdead)), 0, bytes32(uint256(1)), 0, 0, 0), new bytes[](0));
    }

    function test_invalid_proof_reverts() public {
        mock.set(false);
        vm.expectRevert("registry: invalid proof");
        registry.settle(2, "", pi(EMPTY_ROOT, 0, bytes32(uint256(1)), 0, 0, 0), new bytes[](0));
    }

    function test_shield_pulls_usdc_and_unshield_pays() public {
        usdc.mint(alice, 10e6);
        vm.prank(alice);
        usdc.approve(address(vault), 10e6);

        registry.settle(1, "", pi(EMPTY_ROOT, 0, bytes32(0), bytes32(uint256(7)), 10e6, uint256(uint160(alice))), new bytes[](0));
        assertEq(usdc.balanceOf(address(vault)), 10e6, "vault holds shielded USDC");
        assertEq(usdc.balanceOf(alice), 0);

        registry.settle(
            3, "", pi(registry.root(), 0, bytes32(uint256(9)), bytes32(uint256(8)), 4e6, uint256(uint160(alice))), new bytes[](0)
        );
        assertEq(usdc.balanceOf(alice), 4e6, "unshield pays recipient");
        assertEq(usdc.balanceOf(address(vault)), 6e6);
    }

    function test_repo_close_time_gate() public {
        uint256 t = block.timestamp + 1 days;
        vm.expectRevert("registry: too early");
        registry.settle(8, "", pi(EMPTY_ROOT, t, bytes32(uint256(1)), 0, 0, 0), new bytes[](0));
        vm.warp(t);
        registry.settle(8, "", pi(EMPTY_ROOT, t, bytes32(uint256(1)), 0, 0, 0), new bytes[](0));
    }

    function test_seed_commitments_once() public {
        bytes32[] memory cs = new bytes32[](1);
        cs[0] = bytes32(uint256(111));
        registry.seedCommitments(cs);
        assertEq(registry.root(), ROOT_AFTER_111);
        vm.expectRevert("registry: seeded");
        registry.seedCommitments(cs);
    }

    function test_vault_only_registry() public {
        vm.expectRevert("vault: not registry");
        vault.onUnshield(alice, 1);
    }
}
