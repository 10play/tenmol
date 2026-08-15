/**
 * `ObjectMolecule` — a named molecular object with per-state coordinates.
 *
 * Ports the shape of `packages/engine/layer2/ObjectMolecule` + `CoordSet`: an
 * atom table shared across states, and one Float32 coordinate set per state.
 * Coordinates are stored as **Float32** on purpose — PyMOL stores coords as C
 * `float` (`CoordSet::Coord`), and `cmd.get_model`/`get_coords` therefore hand
 * back float32-rounded values. Storing float64 here would make coordinate
 * parity fail in the last few decimal places.
 */

import type { AtomInfo } from './atom';
import { vdwForElement } from './element';

export interface Extent {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
}

/**
 * Crystallographic unit-cell parameters (from the PDB `CRYST1` record). Lengths
 * `a,b,c` are in Ångström, angles `alpha,beta,gamma` in degrees — the same six
 * numbers PyMOL stores in `CCrystal` (`packages/engine/layer2/Crystal.h`).
 */
export interface CrystalCell {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export class ObjectMolecule {
  readonly kind = 'object:molecule' as const;
  /** Atom table, shared across states, in load order. */
  readonly atoms: AtomInfo[] = [];
  /** One Float32Array (natom*3) per state; `states[0]` is state 1. */
  readonly states: Float32Array[] = [];
  /** Per-state title strings (`CoordSet::Name`); `titles[0]` is state 1. A slot
   *  is `undefined` when no title was ever attached to that state. Written by
   *  `set_title`, read by `get_title`. */
  readonly titles: (string | undefined)[] = [];
  /** Undirected bonds: 0-based atom-index pair, plus an optional bond order
   *  (1 single, 2 double, 3 triple, 4 aromatic); absent order ⇒ single. */
  readonly bonds: Array<[number, number, number?]> = [];
  /** Per-state reference coordinates (PyMOL `CoordSet::RefPos`). Outer index is
   *  the state index (0-based, parallel to {@link states}); the inner map keys
   *  are atom indices and its presence marks a slot "specified". Managed by the
   *  `reference` command (store/recall/validate/swap). Absent slots ⇒ no
   *  reference stored for that atom. */
  readonly refPos: Array<Map<number, [number, number, number]>> = [];
  /** Whether the object is enabled (shown) in the executive. */
  enabled = true;
  /** Row-major homogeneous 4×4 recorded by `transform_object` (PyMOL's object
   *  state matrix); absent ⇒ identity. Read by `get_object_matrix`. */
  objectMatrix?: number[];
  /** PyMOL's TTT (transient) 4×4 display matrix — the transform applied by
   *  camera/mouse manipulation before the object matrix. Stored row-major with
   *  the translation in the 4th column (indices 3/7/11), matching PyMOL's
   *  `CObject::TTT`. Absent ⇒ no TTT set (`TTTFlag` false). Written by
   *  `translate object=…`; read by `get_object_ttt`. */
  ttt?: number[];
  /**
   * Unit-cell parameters from `CRYST1`, or `undefined` when the file carried no
   * crystal record. Read by the symmetry commands (`get_symmetry`, `symexp`).
   */
  cell?: CrystalCell;
  /** Space-group symbol from `CRYST1` (e.g. `'P 21 21 21'`), or `undefined`. */
  spacegroup?: string;
  /** `CRYST1` Z-value (`CSymmetry::PDBZValue`) — molecules per unit cell. PyMOL
   *  reads it from a 3-char field (cols 67-69) so a `…30` record yields `3`
   *  (`ObjectMolecule2.cpp` `ncopy(cc, p, 3)`). Re-emitted by the PDB exporter's
   *  CRYST1 line; absent ⇒ PyMOL's default of `1`. */
  pdbZValue?: number;
  /** Biological-assembly ids from the mmCIF `_pdbx_struct_assembly.id` array
   *  (e.g. `['1', '2']`), or `undefined` when the file carried no such data.
   *  Read by `get_assembly_ids`. */
  assemblyIds?: string[];
  /** PyMOL's `DiscreteFlag`: set when the object was loaded/created with
   *  `discrete=1` (each state may carry a distinct atom set). Observable via
   *  `count_discrete`; toggled by `set_discrete`. */
  discrete = false;

  constructor(readonly name: string) {}

  get natom(): number {
    return this.atoms.length;
  }

  get nstate(): number {
    return this.states.length;
  }

  /** Coordinate triplet for atom `i` (0-based) in `state` (1-based). */
  coord(i: number, state = 1): [number, number, number] {
    const set = this.states[state - 1];
    if (!set) return [0, 0, 0];
    const o = i * 3;
    return [set[o] ?? 0, set[o + 1] ?? 0, set[o + 2] ?? 0];
  }

  /**
   * Axis-aligned bounding box + geometric centre over `state` (1-based); when
   * `state === 0` (all states) the union across every state. Mirrors
   * `ObjectMoleculeGetExtent`, used by `zoom`/`orient`.
   */
  extent(state = 0): Extent {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const sets = state === 0 ? this.states : [this.states[state - 1]];
    for (const set of sets) {
      if (!set) continue;
      for (let o = 0; o < set.length; o += 3) {
        for (let k = 0; k < 3; k++) {
          const v = set[o + k] ?? 0;
          if (v < (min[k] as number)) min[k] = v;
          if (v > (max[k] as number)) max[k] = v;
        }
      }
    }
    if (!Number.isFinite(min[0])) {
      min[0] = min[1] = min[2] = 0;
      max[0] = max[1] = max[2] = 0;
    }
    return {
      min,
      max,
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    };
  }

  vdw(i: number): number {
    const a = this.atoms[i];
    if (!a) return 1.8;
    return a.vdwRadius ?? vdwForElement(a.elem);
  }
}
