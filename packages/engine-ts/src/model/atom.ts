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
  /** Colour index into the colour table (PyMOL `color`). */
  color: number;
  /**
   * Per-rep visibility bitmask (PyMOL `visRep`). Bit `1 << rep` set means that
   * rep is shown for this atom. Ported from the `visRep` int in `AtomInfoType`.
   */
  visRep: number;
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
