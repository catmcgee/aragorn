// Witness execution (noir_js) + UltraHonk proving (bb.js, keccak oracle for the EVM).
// Used by the Ring node's prover queue and by e2e scripts; browser claim reuses the same
// pieces in a web worker.
import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";

export interface ProofBundle {
  proof: Uint8Array;
  /** hex bytes32 strings in circuit declaration order — MUST equal the settle layout. */
  publicInputs: string[];
}

const backends = new Map<string, UltraHonkBackend>();
let bbApi: Awaited<ReturnType<typeof Barretenberg.initSingleton>> | undefined;

export async function prove(
  circuitName: string,
  artifact: CompiledCircuit,
  inputs: InputMap,
): Promise<ProofBundle> {
  const noir = new Noir(artifact);
  const { witness } = await noir.execute(inputs);

  bbApi ??= await Barretenberg.initSingleton();
  let backend = backends.get(circuitName);
  if (!backend) {
    backend = new UltraHonkBackend(artifact.bytecode, bbApi);
    backends.set(circuitName, backend);
  }
  const { proof, publicInputs } = await backend.generateProof(witness, { verifierTarget: 'evm' });
  return { proof, publicInputs };
}
