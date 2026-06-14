// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../NoteRegistry.sol";
import {Groth16VerifierBase} from "./Groth16VerifierBase.sol";

/// @title Groth16Verifier — IVerifier adapter for recursive (ProveKit/WHIR -> Groth16) proofs
///
/// Aragorn's NoteRegistry settles every circuit through the SAME seam:
///   `IVerifier.verify(bytes proof, bytes32[] publicInputs) returns (bool)`
/// and on success inserts commitments / spends nullifiers. Today every registered
/// verifier is a per-circuit UltraHonk (bb.js) verifier. This adapter slots in
/// behind that exact seam so a *Groth16* proof can be verified through the normal
/// `NoteRegistry.settle(...)` path — true on-chain Groth16 settlement, no change to
/// NoteRegistry or any app caller.
///
/// It decodes the registry's `proof` bytes into the uncompressed gnark calldata
/// shape `verifyProof(uint256[8], uint256[2], uint256[2], uint256[1])` and forwards
/// to the vendored {Groth16VerifierBase}. That base reverts on a bad proof, so we
/// wrap the call and return `true` iff it does not revert — matching IVerifier's
/// bool contract.
///
/// =====================  HONESTY / SCOPE  =====================
/// The verifying key embedded in {Groth16VerifierBase} is for the *spike* circuit,
/// which has exactly ONE Groth16 public signal (the WHIR public-input commitment).
/// That single signal is NOT today derived from — nor bound to — the 14 Aragorn
/// settlement public inputs `[root, t, n1..n4, c1..c4, aux1..aux4]`. So this proves
/// "NoteRegistry can and does verify a real Groth16 proof end-to-end through settle()"
/// — it does NOT yet prove a real cash/repo note transition under Groth16.
///
/// Because of that, this adapter deliberately carries the Groth16 public signal
/// INSIDE the `proof` blob (the prover's claim), rather than reconstructing it from
/// the registry's 14 `publicInputs`. In the production design (see
/// GROTH16_SETTLEMENT_PLAN.md) the real settlement circuit must commit to those 14
/// inputs and the adapter must reconstruct/verify that binding here instead of
/// trusting a value inside the proof. Until then this is Anvil-only and is wired in
/// via a deploy *variant* (DeployGroth16.s.sol), never the production Deploy.s.sol.
/// ============================================================
contract Groth16Verifier is IVerifier {
    /// Calldata layout this adapter expects in `settle`'s `proof` argument:
    ///   13 * 32 = 416 bytes, big-endian uint256 words, in this order:
    ///     [0..7]   proof          (G1 Ar, G2 Bs, G1 Krs)            8 words
    ///     [8..9]   commitments    (Pedersen commitment G1)          2 words
    ///     [10..11] commitmentPok  (Pedersen PoK G1)                 2 words
    ///     [12]     input          (the single Groth16 public signal)1 word
    /// This is exactly the spike's decoded args (ONCHAIN_RESULT.md §"Decoding the
    /// 388-byte proof"); the gnark 4-byte slice-length prefix is NOT included here —
    /// callers must pre-decode the 388-byte MarshalSolidity() blob into these 13 words.
    uint256 internal constant EXPECTED_PROOF_BYTES = 13 * 32;

    Groth16VerifierBase public immutable groth16;

    constructor(Groth16VerifierBase _groth16) {
        groth16 = _groth16;
    }

    /// @inheritdoc IVerifier
    /// @param proof 13 packed uint256 words (see EXPECTED_PROOF_BYTES layout above).
    /// @param publicInputs the registry's 14 settlement inputs. NOTE: in this Anvil
    ///        spike integration these are used by NoteRegistry for tree/nullifier
    ///        bookkeeping but are NOT yet bound into the Groth16 statement (see scope
    ///        note above). The Groth16 verify checks the spike's own single signal,
    ///        which is carried in `proof`.
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool) {
        // The registry already enforces publicInputs.length == 14 before calling us;
        // keep a defensive check so this adapter is correct in isolation too.
        if (publicInputs.length != 14) return false;
        if (proof.length != EXPECTED_PROOF_BYTES) return false;

        uint256[8] memory p;
        uint256[2] memory commitments;
        uint256[2] memory commitmentPok;
        uint256[1] memory input;

        // Decode the 13 packed words.
        for (uint256 i = 0; i < 8; i++) {
            p[i] = _word(proof, i);
        }
        commitments[0] = _word(proof, 8);
        commitments[1] = _word(proof, 9);
        commitmentPok[0] = _word(proof, 10);
        commitmentPok[1] = _word(proof, 11);
        input[0] = _word(proof, 12);

        // gnark's verifier is `public view` returning void: it reverts on a bad
        // proof. Wrap in a low-level staticcall so a revert becomes `false` rather
        // than bubbling up — IVerifier callers expect a bool, and NoteRegistry turns
        // a `false` into "registry: invalid proof".
        (bool success,) = address(groth16).staticcall(
            abi.encodeCall(Groth16VerifierBase.verifyProof, (p, commitments, commitmentPok, input))
        );
        return success;
    }

    /// Read the i-th 32-byte big-endian word out of `proof`.
    function _word(bytes calldata proof, uint256 i) private pure returns (uint256 w) {
        uint256 offset = i * 32;
        assembly {
            w := calldataload(add(proof.offset, offset))
        }
    }
}
