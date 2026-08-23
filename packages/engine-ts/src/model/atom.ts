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
  /**
   * Custom per-atom string field (PyMOL `AtomInfoType.custom`). A free-form
   * text tag set through `alter sele, custom='...'` and read by the `custom`
   * selection keyword. Absent ⇒ empty string.
   */
  custom?: string;
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
  /** Perceived H-bond donor flag (PyMOL `AtomInfoType.hb_donor`,
   *  `ObjectMoleculeInferHBondFromChem`). Read by the `donor`/`don.` selector.
   *  Absent ⇒ not perceived / false. */
  hbDonor?: boolean;
  /** Perceived H-bond acceptor flag (PyMOL `AtomInfoType.hb_acceptor`). Read by
   *  the `acceptor`/`acc.` selector. Absent ⇒ false. */
  hbAcceptor?: boolean;
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
   * Internal atom-typing index (PyMOL `AtomInfoType.customType`). This is also
   * the atom's `numeric_type`: set via `alter sele, numeric_type=N` (P.cpp
   * ATOM_PROP_NUMERIC_TYPE) and matched by the `numeric_type`/`nt.` selector
   * (Selector.cpp SELE_NTYs → `WordMatchInteger`). Unassigned atoms are
   * {@link NO_NUMERIC_TYPE} (`cAtomInfoNoType`, -9999). Absent ⇒ that sentinel.
   */
  customType?: number;
  /**
   * MOL2/Tripos "text type" (PyMOL `AtomInfoType.textType`). Set via
   * `alter sele, text_type='C.ar'` (P.cpp ATOM_PROP_TEXT_TYPE) and matched by the
   * `text_type`/`tt.` selector (Selector.cpp SELE_TTYs → alpha/wildcard list).
   * Absent ⇒ empty string.
   */
  textType?: string;
  /**
   * Custom atom-level properties (PyMOL's per-atom `Property` list in
   * `layer2/AtomInfo.h`). Set via `cmd.set_atom_property` and reached in
   * `iterate`/`alter` through the `p` object (e.g. `p.myprop`). Absent ⇒ no
   * properties set.
   */
  properties?: Record<string, string | number | boolean>;
  /**
   * Per-atom setting overrides (PyMOL's `AtomInfoType.setting` /
   * `AtomSettingGetIfDefined`). A `set <name>, <val>, <sele>` for an atom-level
   * setting (e.g. `cartoon_color`, `ribbon_color`) stores the value here on each
   * matched atom, keyed by setting name. Colour-typed settings hold a colour
   * INDEX. A key present means the atom has a *defined* override for that
   * setting; absent ⇒ unset (the `<setting> -1` selector then does not match it).
   */
  atomSettings?: Record<string, number | string>;
}

/** `cAtomInfoNoType` (AtomInfo.h:214) — the sentinel for an unset `numeric_type`. */
export const NO_NUMERIC_TYPE = -9999;

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
