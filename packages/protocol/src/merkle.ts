// Client-side mirror of NoteRegistry's incremental Poseidon2 Merkle tree (depth 32).
// Used for witness generation (paths) and root checking; rebuilt from chain events.
import { TREE_DEPTH } from "./constants.js";
import type { Field } from "./field.js";
import { poseidon2 } from "./poseidon.js";

export class MerkleTree {
  readonly depth = TREE_DEPTH;
  private readonly zeros: Field[] = [];
  /** levels[d] = nodes at depth-from-leaves d; level 0 = leaves. Sparse maps. */
  private readonly levels: Map<number, Field>[] = [];
  private nextIndex = 0;

  constructor() {
    let z: Field = 0n;
    for (let i = 0; i <= this.depth; i++) {
      this.zeros.push(z);
      this.levels.push(new Map());
      z = poseidon2([z, z]);
    }
  }

  get size(): number {
    return this.nextIndex;
  }

  get root(): Field {
    return this.node(this.depth, 0);
  }

  private node(level: number, index: number): Field {
    return this.levels[level].get(index) ?? this.zeros[level];
  }

  insert(leaf: Field): number {
    const index = this.nextIndex++;
    this.levels[0].set(index, leaf);
    let idx = index;
    for (let level = 1; level <= this.depth; level++) {
      idx = Math.floor(idx / 2);
      const left = this.node(level - 1, idx * 2);
      const right = this.node(level - 1, idx * 2 + 1);
      this.levels[level].set(idx, poseidon2([left, right]));
    }
    return index;
  }

  /** Sibling path from leaf to root for circuit witness. */
  path(index: number): Field[] {
    if (index >= this.nextIndex) throw new Error(`no leaf at index ${index}`);
    const siblings: Field[] = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(this.node(level, idx ^ 1));
      idx = Math.floor(idx / 2);
    }
    return siblings;
  }
}
