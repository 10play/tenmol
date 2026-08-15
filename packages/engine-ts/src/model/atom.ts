/**
 * Per-atom record — the fields of PyMOL's `AtomInfoType`
 * (`packages/engine/layer2/AtomInfo.h`) that the covered selections, colouring
 * and representations read. Not the whole struct; every field here is one a
 * ported command or selector actually touches, so parity is auditable.
 */

import { Rep } from '@tenmol/protocol';

export interface AtomInfo {
  /** 1-based index within the object, in load order (PyMOL `cmd.index` / `ID`). */
  id: number;
  /** Atom name, e.g. 'CA', stored space-trimmed as PyMOL does for selection. */
  name: string;
  /** Residue name, e.g. 'ALA'. */
  resn: string;
  /** Residue identifier as text ('resi' can be '52A'); PyMOL keeps the string. */
  resi: string;
  /** Numeric residue value (PyMOL `resv`), for `resi 10-20` ranges. */
  resv: number;
  /** Chain identifier. */
  chain: string;
  /** Segment identifier (`segi`). */
  segi: string;
  /** Alternate-location indicator (`alt`). */
  alt: string;
  /** Canonical element symbol ('C', 'Fe'). */
  elem: string;
  /** True for HETATM records (`flag 1`? no — PyMOL `hetatm`). */
  hetatm: boolean;
  /** B-factor. */
  b: number;
  /** Occupancy. */
  q: number;
  /** Formal (integer) charge — MOL `M  CHG`, PDB cols 79-80. Absent ⇒ 0. */
  formalCharge?: number;
  /** Partial (fractional) charge — MOL2 charge column, `set_charge`. Absent ⇒ 0. */
  partialCharge?: number;
  /** Colour index into the colour table (PyMOL `color`). */
  color: number;
  /** Secondary structure: 'H' (helix), 'S' (strand), or '' (loop/unassigned). */
  ss: string;
  /** Per-atom label text (PyMOL `label`), or undefined when none is set. */
  label?: string;
  /** Explicit vdw radius override (PyMOL `vdw`), e.g. set by `util.b2vdw`;
   *  absent ⇒ the element's default radius. */
  vdwRadius?: number;
  /**
   * Anisotropic displacement (ADP) from an ANISOU record, in Å²:
   * [U11, U22, U33, U12, U13, U23]. Absent for atoms without ANISOU (the
   * `ellipsoids` rep then falls back to an isotropic B-factor sphere).
   */
  u?: readonly [number, number, number, number, number, number];
  /**
   * Per-rep visibility bitmask (PyMOL `visRep`). Bit `1 << rep` set means that
   * rep is shown for this atom. Ported from the `visRep` int in `AtomInfoType`.
   */
  visRep: number;
  /**
   * Modeling flags bitmask (PyMOL `AtomInfoType.flags`). Bit `1 << n` set means
   * the atom carries flag `n` — e.g. focus 0, free 1, restrain 2, fix 3,
   * exclude 4, study 5, ignore 25. Set by the `flag` command and read by the
   * `flag N` selector. Absent ⇒ no flags set.
   */
  flags?: number;
  /**
   * Unpickable flag (PyMOL `AtomInfoType.masked`). Set by the `mask` command
   * and cleared by `unmask`; read by the `masked` selection keyword. Only
   * affects mouse pickability, never command-line selection or transforms.
   * Absent ⇒ not masked.
   */
  masked?: boolean;
  /**
   * Protected flag (PyMOL `AtomInfoType.protekted`). Set by the `protect`
   * command and cleared by `deprotect`; read by the `protected` selection
   * keyword. Protected atoms are held immobile during editing transforms
   * (torsion, drag, sculpt). Absent ⇒ not protected.
   */
  protected?: boolean;
  /**
   * Internal atom-typing index (PyMOL `AtomInfoType.customType`). Assigned by
   * upstream typing passes and read by the experimental `get_bond_print` debug
   * dump; unassigned atoms are `-1` (the upstream default). Absent ⇒ -1.
   */
  customType?: number;
}

/** `1 << rep` — the visRep bit for a representation. */
export function repBit(rep: number): number {
  return 1 << rep;
}

/**
 * PyMOL's default `visRep` for a freshly loaded atom: lines + nonbonded
 * (`RepGetInitialFlags` semantics; a small molecule shows lines, lone atoms
 * show nonbonded). We set the `lines` bit, matching `cmd.load`'s default that a
 * structure appears as lines.
 */
export function defaultVisRep(): number {
  return repBit(Rep.Line);
}
