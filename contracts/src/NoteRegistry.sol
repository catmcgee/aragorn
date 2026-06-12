// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ShieldVault} from "./ShieldVault.sol";

interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

interface IPoseidon2 {
    function hash_2(uint256 x, uint256 y) external view returns (uint256);
}

/// The synchronizer (BUILD_SPEC S5): owns the note tree (incremental Poseidon2 Merkle,
/// depth 32), root ring buffer (64), nullifier set, per-circuit verifier registry, and
/// settle() per S3.8. Public input layout: [root, T, n1..n4, c1..c4, aux1..aux4].
contract NoteRegistry {
    uint32 public constant DEPTH = 32;
    uint32 public constant ROOT_HISTORY = 64;
    uint32 public constant CIRCUIT_CASH_SHIELD = 1;
    uint32 public constant CIRCUIT_CASH_UNSHIELD = 3;
    uint32 public constant CIRCUIT_REPO_CLOSE = 8;

    IPoseidon2 public immutable poseidon;
    ShieldVault public immutable vault;
    address public immutable owner;

    bytes32[DEPTH] public zeros;
    bytes32[DEPTH] public filledSubtrees;
    uint32 public nextIndex;

    bytes32[ROOT_HISTORY] public roots;
    uint32 public currentRootIndex;

    mapping(bytes32 => bool) public isSpent;
    mapping(uint32 => IVerifier) public verifiers;
    bool public verifiersFrozen;
    bool public seeded;

    event Settled(
        uint32 indexed circuitId,
        bytes32[] nullifiers,
        bytes32[] commitments,
        bytes[] ciphertexts,
        uint256 timeBound,
        address txOrigin
    );
    event LeafInserted(uint32 indexed index, bytes32 commitment, bytes32 newRoot);

    constructor(IPoseidon2 _poseidon, ShieldVault _vault) {
        poseidon = _poseidon;
        vault = _vault;
        owner = msg.sender;

        bytes32 z = bytes32(0);
        for (uint32 i = 0; i < DEPTH; i++) {
            zeros[i] = z;
            filledSubtrees[i] = z;
            z = _hash(z, z);
        }
        roots[0] = z; // empty-tree root
    }

    // -- admin (deploy-time only) ---------------------------------------------------------

    function setVerifier(uint32 circuitId, IVerifier verifier) external {
        require(msg.sender == owner && !verifiersFrozen, "registry: frozen");
        verifiers[circuitId] = verifier;
    }

    function freezeVerifiers() external {
        require(msg.sender == owner, "registry: not owner");
        verifiersFrozen = true;
    }

    /// Seed-script-only path for the demo's pre-issued bond position (BUILD_SPEC S10.3).
    /// Owner-gated, single use, narrated honestly in the demo.
    function seedCommitments(bytes32[] calldata commitments) external {
        require(msg.sender == owner && !seeded, "registry: seeded");
        seeded = true;
        for (uint256 i = 0; i < commitments.length; i++) {
            _insert(commitments[i]);
        }
    }

    // -- views -----------------------------------------------------------------------------

    function root() public view returns (bytes32) {
        return roots[currentRootIndex];
    }

    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == bytes32(0)) return false;
        for (uint32 i = 0; i < ROOT_HISTORY; i++) {
            if (roots[i] == _root) return true;
        }
        return false;
    }

    // -- settle (S3.8) -----------------------------------------------------------------------

    function settle(
        uint32 circuitId,
        bytes calldata proof,
        bytes32[] calldata publicInputs,
        bytes[] calldata ciphertexts
    ) external {
        require(publicInputs.length == 14, "registry: bad input count");
        require(isKnownRoot(publicInputs[0]), "registry: unknown root");

        uint256 timeBound = uint256(publicInputs[1]);
        if (circuitId == CIRCUIT_REPO_CLOSE) {
            require(block.timestamp >= timeBound, "registry: too early");
        }

        // nullifiers: slots 2..5, zero = unused
        bytes32[] memory spent = new bytes32[](4);
        uint256 spentCount;
        for (uint256 i = 2; i < 6; i++) {
            bytes32 n = publicInputs[i];
            if (n == bytes32(0)) continue;
            require(!isSpent[n], "registry: nullifier spent");
            isSpent[n] = true;
            spent[spentCount++] = n;
        }

        IVerifier verifier = verifiers[circuitId];
        require(address(verifier) != address(0), "registry: no verifier");
        require(verifier.verify(proof, publicInputs), "registry: invalid proof");

        // commitments: slots 6..9, zero = unused
        bytes32[] memory inserted = new bytes32[](4);
        uint256 insertedCount;
        for (uint256 i = 6; i < 10; i++) {
            bytes32 c = publicInputs[i];
            if (c == bytes32(0)) continue;
            _insert(c);
            inserted[insertedCount++] = c;
        }

        // vault side effects: aux1 = publicInputs[10], aux2 = publicInputs[11]
        if (circuitId == CIRCUIT_CASH_SHIELD) {
            vault.onShield(address(uint160(uint256(publicInputs[11]))), uint256(publicInputs[10]));
        } else if (circuitId == CIRCUIT_CASH_UNSHIELD) {
            vault.onUnshield(address(uint160(uint256(publicInputs[11]))), uint256(publicInputs[10]));
        }

        assembly {
            mstore(spent, spentCount)
            mstore(inserted, insertedCount)
        }
        emit Settled(circuitId, spent, inserted, ciphertexts, timeBound, tx.origin);
    }

    // -- tree ---------------------------------------------------------------------------------

    function _insert(bytes32 leaf) internal {
        uint32 index = nextIndex;
        require(index < type(uint32).max, "registry: tree full");
        nextIndex = index + 1;

        bytes32 node = leaf;
        uint32 idx = index;
        for (uint32 level = 0; level < DEPTH; level++) {
            if (idx % 2 == 0) {
                filledSubtrees[level] = node;
                node = _hash(node, zeros[level]);
            } else {
                node = _hash(filledSubtrees[level], node);
            }
            idx /= 2;
        }

        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY;
        roots[currentRootIndex] = node;
        emit LeafInserted(index, leaf, node);
    }

    function _hash(bytes32 l, bytes32 r) internal view returns (bytes32) {
        return bytes32(poseidon.hash_2(uint256(l), uint256(r)));
    }
}
