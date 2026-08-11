/**
 * The `editor.*` build/edit namespace — residue and fragment growth.
 *
 * Ported from `packages/engine/modules/pymol/editor.py`. The headline verb is
 * `attach_amino_acid`, which grows a residue onto a backbone terminus by
 * superposing a library fragment and forming the peptide bond. Registered
 * through the shared {@link RegistrarCtx}; mutations end with `ctx.publish()`.
 *
 * ── Superposition approach (what is exact, what is idealised) ────────────────
 * PyMOL's `attach_amino_acid` loads the plain chempy fragment, `fuse`s one heavy
 * atom onto the terminus, then `set_dihedral`s omega=180 (and phi/psi from the
 * `ss` setting). This port reproduces the *result* geometry directly rather than
 * porting `fuse`/`set_geometry`/`set_dihedral`:
 *
 *   1. From the terminal residue's backbone the connection atom is found — a
 *      backbone `C` (grow toward the C-terminus, new resi = resv+1) or `N` (grow
 *      toward the N-terminus, new resi = resv−1), matching editor.py's element
 *      test.
 *   2. An idealised target for the new residue's `N,CA,C` triple is built in the
 *      terminal residue's frame: the new backbone atom is placed 1.33 Å from the
 *      connection atom along its third sp2 (trigonal) direction — the peptide
 *      C(i)–N(i+1) bond — and the next two atoms fix a planar *trans* peptide
 *      (omega = 180°, chosen by picking the CA–C–N–CA rotamer nearest 180°).
 *   3. {@link rigidFit3} superposes the fragment's own `N,CA,C` onto that target
 *      and the whole fragment is carried along, so every internal bond length /
 *      angle of the library residue is preserved and the C–N bond comes out at
 *      *exactly* 1.33 Å (the frame origin maps exactly).
 *
 * EXACT: the C–N peptide bond length (1.33 Å) and the trans peptide plane.
 * IDEALISED vs editor.py: phi/psi are left at the extended default (the `ss`
 * secondary-structure kwarg is accepted but not applied — no `set_dihedral`
 * phi/psi pass), the amide `H` on the new nitrogen is re-idealised to the trans
 * amide position (editor.py's `h_fix`), and no wholesale hydrogen strip is done
 * (the `hydro`/`auto_remove_hydrogens` path is not modelled). A terminal `OXT`
 * on a C-terminus is removed as it becomes an internal peptide carbonyl.
 */
import type { Json } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import { defaultVisRep } from '../model/atom';
import { makeBondAdder } from '../model/bonding';
import type { ObjectMolecule } from '../model/molecule';
import { ObjectMolecule as ObjectMoleculeCtor } from '../model/molecule';
import {
  getAminoAcidFragment,
  resolveAminoAcidCode,
  type AminoAcidFragment,
} from '../model/aa-fragments';
import { rigidFit3, type Vec3 } from '../model/superpose';
import type { UniverseAtom } from '../select/selector';
import { appendAtoms, removeAtoms, type NewAtom } from './builder';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ vec3 helpers ----------------------------- */

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function unit(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function anyPerp(a: Vec3): Vec3 {
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const az = Math.abs(a[2]);
  const ref: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const p = cross(a, ref);
  return len(p) < 1e-6 ? [0, 1, 0] : unit(p);
}
/** Rotate `v` about a unit `axis` by `ang` radians (Rodrigues). */
function rotateAxis(v: Vec3, axis: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const k = dot(axis, v) * (1 - c);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, k));
}
/** Signed dihedral a–b–c–d in degrees. */
function dihedral(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b1 = sub(b, a);
  const b2 = sub(c, b);
  const b3 = sub(d, c);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, unit(b2));
  const x = dot(n1, n2);
  const y = dot(m1, n2);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/* ------------------------- peptide geometry table ------------------------ */

const DEG = Math.PI / 180;
const CN_LENGTH = 1.33; // peptide C(i)–N(i+1) bond, Å
const NCA_LENGTH = 1.45; // N–CA (target scaffold only; magnitude does not affect the fit)
const CAC_LENGTH = 1.52; // CA–C (target scaffold only)
const ANCHOR_B_M_ANGLE = 121.7 * DEG; // C–N–CA / N–C–CA
const B_M_E_ANGLE = 111.0 * DEG; // N–CA–C / C–CA–N
const NH_LENGTH = 1.01; // amide N–H

/**
 * Idealised target positions for the incoming residue's three backbone atoms
 * (B = the atom that forms the peptide bond, M = its CA, E = the third backbone
 * atom), given the terminal `anchor` (connection atom) and its two backbone
 * references `r1` (CA of the terminal residue) and `r2` (its carbonyl O, or the
 * amide H when growing backward). Only the *directions* of B,M,E from the anchor
 * matter to {@link rigidFit3}, so the scaffold bond lengths are nominal.
 */
function peptideTargets(anchor: Vec3, r1: Vec3, r2: Vec3): [Vec3, Vec3, Vec3] {
  const dR1 = unit(sub(r1, anchor));
  const dR2 = unit(sub(r2, anchor));
  const bis = add(dR1, dR2);
  const dB = len(bis) > 1e-6 ? neg(unit(bis)) : anyPerp(dR1); // third sp2 direction
  const bt = add(anchor, scale(dB, CN_LENGTH)); // 1.33 Å from the anchor -> the C–N bond
  const nCr = cross(dR1, dR2);
  const nrm = len(nCr) > 1e-6 ? unit(nCr) : anyPerp(dB); // peptide-plane normal

  // M (CA of new residue): anchor–B–M ~121.7°, trans (CA–anchor–B–M ~ 180°).
  const w = unit(sub(anchor, bt));
  const mPlus = add(bt, scale(rotateAxis(w, nrm, ANCHOR_B_M_ANGLE), NCA_LENGTH));
  const mMinus = add(bt, scale(rotateAxis(w, nrm, -ANCHOR_B_M_ANGLE), NCA_LENGTH));
  const transPlus = 180 - Math.abs(dihedral(r1, anchor, bt, mPlus));
  const transMinus = 180 - Math.abs(dihedral(r1, anchor, bt, mMinus));
  const mt = transPlus <= transMinus ? mPlus : mMinus;

  // E (C of new residue): B–M–E ~111°; pick the side that extends away from the
  // existing chain (larger distance to the anchor) to avoid backbone clashes.
  const v = unit(sub(bt, mt));
  const ePlus = add(mt, scale(rotateAxis(v, nrm, B_M_E_ANGLE), CAC_LENGTH));
  const eMinus = add(mt, scale(rotateAxis(v, nrm, -B_M_E_ANGLE), CAC_LENGTH));
  const et = dist(ePlus, anchor) >= dist(eMinus, anchor) ? ePlus : eMinus;

  return [bt, mt, et];
}

/* ------------------------------ topology utils --------------------------- */

const resKey = (a: AtomInfo): string => `${a.segi}|${a.chain}|${a.resi}`;

function indexById(mol: ObjectMolecule, id: number): number {
  for (let i = 0; i < mol.natom; i++) if (mol.atoms[i]!.id === id) return i;
  return -1;
}

/** Bonded-neighbour indices of `idx`. */
function neighbours(mol: ObjectMolecule, idx: number): number[] {
  const out: number[] = [];
  for (const [a, b] of mol.bonds) {
    if (a === idx) out.push(b);
    else if (b === idx) out.push(a);
  }
  return out;
}

/** First atom of `ref`'s residue whose name/elem match, or -1. */
function findInResidue(mol: ObjectMolecule, ref: AtomInfo, name: string, elem: string): number {
  const key = resKey(ref);
  for (let i = 0; i < mol.natom; i++) {
    const a = mol.atoms[i]!;
    if (resKey(a) === key && a.name.toUpperCase() === name && a.elem === elem) return i;
  }
  return -1;
}

/** The most C-terminal backbone `C` (max resv), or null. */
function cTerminus(mol: ObjectMolecule): AtomInfo | null {
  let best: AtomInfo | null = null;
  for (const a of mol.atoms) {
    if (a.name.toUpperCase() !== 'C' || a.elem !== 'C') continue;
    if (!best || a.resv > best.resv || (a.resv === best.resv && a.id > best.id)) best = a;
  }
  return best;
}

/** The most N-terminal backbone `N` (min resv), or null. */
function nTerminus(mol: ObjectMolecule): AtomInfo | null {
  let best: AtomInfo | null = null;
  for (const a of mol.atoms) {
    if (a.name.toUpperCase() !== 'N' || a.elem !== 'N') continue;
    if (!best || a.resv < best.resv || (a.resv === best.resv && a.id < best.id)) best = a;
  }
  return best;
}

interface Connection {
  objName: string;
  atomId: number;
  forward: boolean; // true: grow the C-terminus (connect at C); false: connect at N
  resv: number;
}

function safeMatch(ctx: RegistrarCtx, sel: string): UniverseAtom[] {
  try {
    return ctx.executive.atomsMatching(sel);
  } catch {
    return [];
  }
}

/**
 * Resolve the backbone terminus to grow from. A single-atom selection named `N`
 * or `C` sets the direction by element (as editor.py does); a broader selection
 * grows onto its highest-resv residue's `C`; an empty/no-match selection falls
 * back to the last object's C-terminus. Throws when nothing is attachable.
 */
function resolveConnection(ctx: RegistrarCtx, selection: string): Connection {
  const trimmed = selection.trim();
  const uas = trimmed !== '' ? safeMatch(ctx, trimmed) : [];

  if (uas.length === 1) {
    const ua = uas[0]!;
    const nm = ua.atom.name.toUpperCase();
    if (nm === 'N' && ua.atom.elem === 'N') {
      return { objName: ua.objName, atomId: ua.atom.id, forward: false, resv: ua.atom.resv };
    }
    if (nm === 'C' && ua.atom.elem === 'C') {
      return { objName: ua.objName, atomId: ua.atom.id, forward: true, resv: ua.atom.resv };
    }
  }

  if (uas.length > 0) {
    let best = uas[0]!;
    for (const ua of uas) if (ua.atom.resv > best.atom.resv) best = ua;
    const mol = ctx.executive.molecule(best.objName);
    if (mol) {
      const c = findInResidue(mol, best.atom, 'C', 'C');
      if (c >= 0) {
        const a = mol.atoms[c]!;
        return { objName: best.objName, atomId: a.id, forward: true, resv: a.resv };
      }
      const nn = findInResidue(mol, best.atom, 'N', 'N');
      if (nn >= 0) {
        const a = mol.atoms[nn]!;
        return { objName: best.objName, atomId: a.id, forward: false, resv: a.resv };
      }
    }
    throw new Error(
      `attach_amino_acid: selection '${selection}' has no backbone C or N to attach to`,
    );
  }

  const mol = ctx.executive.moleculesInOrder().at(-1);
  if (!mol) {
    throw new Error('attach_amino_acid: no object to attach to (selection matched nothing)');
  }
  const c = cTerminus(mol);
  if (c) return { objName: mol.name, atomId: c.id, forward: true, resv: c.resv };
  const nn = nTerminus(mol);
  if (nn) return { objName: mol.name, atomId: nn.id, forward: false, resv: nn.resv };
  throw new Error(
    `attach_amino_acid: object '${mol.name}' has no attachable backbone terminus (need a backbone N or C)`,
  );
}

/** The connection atom's backbone references + an optional OXT to strip. */
interface Refs {
  caIdx: number;
  r2Idx: number; // O (forward) or amide H (backward); -1 -> synthesise
  oxtIdx: number; // C-terminal OXT to remove, or -1
}

function backboneRefs(mol: ObjectMolecule, cIdx: number, forward: boolean): Refs {
  const anchor = mol.atoms[cIdx]!;
  const nbrs = neighbours(mol, cIdx);
  let caIdx = -1;
  let r2Idx = -1;
  let oxtIdx = -1;
  for (const nb of nbrs) {
    const a = mol.atoms[nb]!;
    const nm = a.name.toUpperCase();
    if (a.elem === 'C' && (caIdx < 0 || nm === 'CA')) caIdx = nb;
    else if (forward && a.elem === 'O') {
      if (nm === 'OXT') oxtIdx = nb;
      else if (r2Idx < 0) r2Idx = nb;
    } else if (!forward && a.elem === 'H' && r2Idx < 0) r2Idx = nb;
  }
  if (caIdx < 0) caIdx = findInResidue(mol, anchor, 'CA', 'C');
  if (forward && r2Idx < 0) r2Idx = findInResidue(mol, anchor, 'O', 'O');
  if (oxtIdx < 0) oxtIdx = findInResidue(mol, anchor, 'OXT', 'O');
  return { caIdx, r2Idx, oxtIdx };
}

/* --------------------------- fragment placement -------------------------- */

const fragIndex = (frag: AminoAcidFragment, name: string): number =>
  frag.atoms.findIndex((a) => a.name.toUpperCase() === name);

const fragCoord = (frag: AminoAcidFragment, i: number): Vec3 => {
  const a = frag.atoms[i]!;
  return [a.x, a.y, a.z];
};

/**
 * Grow `code` onto the terminus given by `conn`, mutating the object in place.
 * Returns the object name. (Does not publish — callers do.)
 */
function growResidue(
  ctx: RegistrarCtx,
  conn: Connection,
  code: string,
  frag: AminoAcidFragment,
): string {
  const ex = ctx.executive;
  const mol = ex.molecule(conn.objName);
  if (!mol) throw new Error(`attach_amino_acid: object '${conn.objName}' vanished`);

  // Fragment backbone atoms: B forms the peptide bond, M=CA, E=the third atom.
  const bLocal = fragIndex(frag, conn.forward ? 'N' : 'C');
  const mLocal = fragIndex(frag, 'CA');
  const eLocal = fragIndex(frag, conn.forward ? 'C' : 'N');
  if (bLocal < 0 || mLocal < 0 || eLocal < 0) {
    throw new Error(`attach_amino_acid: fragment '${code}' lacks a complete N,CA,C backbone`);
  }

  // Strip a C-terminal OXT before placing (it becomes an internal carbonyl).
  const refs0 = backboneRefs(mol, indexById(mol, conn.atomId), conn.forward);
  if (conn.forward && refs0.oxtIdx >= 0) {
    // removeAtoms reindexes atoms/bonds/orders; the connection atom is re-found
    // below by its stable id.
    removeAtoms(mol, new Set([refs0.oxtIdx]));
  }

  const cIdx = indexById(mol, conn.atomId);
  if (cIdx < 0) throw new Error('attach_amino_acid: connection atom lost during edit');
  const refs = backboneRefs(mol, cIdx, conn.forward);
  if (refs.caIdx < 0) {
    throw new Error('attach_amino_acid: connection residue has no CA to define the peptide plane');
  }
  if (conn.forward && refs.r2Idx < 0) {
    throw new Error(
      'attach_amino_acid: connection carbon has no carbonyl O to define the peptide plane',
    );
  }

  const src: [Vec3, Vec3, Vec3] = [
    fragCoord(frag, bLocal),
    fragCoord(frag, mLocal),
    fragCoord(frag, eLocal),
  ];

  const nstate = Math.max(1, mol.nstate);
  const placed: Vec3[][] = frag.atoms.map(() => []);
  for (let s = 1; s <= nstate; s++) {
    const anchor = mol.coord(cIdx, s);
    const r1 = mol.coord(refs.caIdx, s);
    // r2: carbonyl O (forward) or amide H (backward); synthesise a perpendicular
    // if it is absent (e.g. hydrogens were removed on a backward growth).
    const r2 =
      refs.r2Idx >= 0
        ? mol.coord(refs.r2Idx, s)
        : add(anchor, scale(anyPerp(unit(sub(r1, anchor))), 1.0));
    const targets = peptideTargets(anchor, r1, r2);
    const xf = rigidFit3(src, targets);
    for (let a = 0; a < frag.atoms.length; a++) {
      const fa = frag.atoms[a]!;
      placed[a]!.push(xf([fa.x, fa.y, fa.z]));
    }
  }

  const connAtom = mol.atoms[cIdx]!;
  const newResv = conn.forward ? conn.resv + 1 : conn.resv - 1;
  const specs: NewAtom[] = frag.atoms.map((fa, a) => ({
    atom: {
      id: 0,
      name: fa.name,
      resn: code,
      resi: String(newResv),
      resv: newResv,
      chain: connAtom.chain,
      segi: connAtom.segi,
      alt: '',
      elem: fa.elem,
      hetatm: false,
      b: 0,
      q: 1,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    },
    coords: placed[a]!,
    bondTo: -1,
    order: 1,
  }));
  const base = appendAtoms(mol, specs);

  // Bonds: fragment-internal + the new peptide bond.
  const addBond = makeBondAdder(mol);
  for (const [i, j] of frag.bonds) addBond(base + i, base + j);
  addBond(cIdx, base + bLocal); // peptide C(i)–N(i+1) (or C(i−1)–N(i))

  // Re-idealise the amide H on the new nitrogen to the trans amide position
  // (editor.py's h_fix), keeping it clear of the carbonyl it faces.
  if (conn.forward) {
    const nNew = base + bLocal;
    const caNew = base + mLocal;
    let hNew = -1;
    for (const [i, j] of frag.bonds) {
      if (i === bLocal && frag.atoms[j]!.elem === 'H') hNew = base + j;
      else if (j === bLocal && frag.atoms[i]!.elem === 'H') hNew = base + i;
      if (hNew >= 0) break;
    }
    if (hNew >= 0) {
      for (let s = 0; s < mol.states.length; s++) {
        const set = mol.states[s]!;
        const np = mol.coord(nNew, s + 1);
        const cp = mol.coord(cIdx, s + 1);
        const cap = mol.coord(caNew, s + 1);
        const dh = neg(unit(add(unit(sub(cp, np)), unit(sub(cap, np)))));
        const hp = add(np, scale(dh, NH_LENGTH));
        set[hNew * 3] = hp[0];
        set[hNew * 3 + 1] = hp[1];
        set[hNew * 3 + 2] = hp[2];
      }
    }
  }

  return conn.objName;
}

/* ---------------------------- new-object build --------------------------- */

/** Build a stand-alone object holding one library residue (numbered `resv`). */
function buildResidueObject(
  code: string,
  frag: AminoAcidFragment,
  name: string,
  resv: number,
): ObjectMolecule {
  const mol = new ObjectMoleculeCtor(name);
  mol.states.push(new Float32Array(frag.atoms.length * 3));
  const set = mol.states[0]!;
  frag.atoms.forEach((fa, i) => {
    mol.atoms.push({
      id: i + 1,
      name: fa.name,
      resn: code,
      resi: String(resv),
      resv,
      chain: 'A',
      segi: '',
      alt: '',
      elem: fa.elem,
      hetatm: false,
      b: 0,
      q: 1,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    });
    set[i * 3] = fa.x;
    set[i * 3 + 1] = fa.y;
    set[i * 3 + 2] = fa.z;
  });
  const addBond = makeBondAdder(mol);
  for (const [i, j] of frag.bonds) addBond(i, j);
  return mol;
}

/* -------------------------------- registrar ------------------------------ */

export function registerEditor(ctx: RegistrarCtx): void {
  const str = ctx.str;
  const arg = (
    args: unknown[],
    kwargs: Record<string, unknown>,
    i: number,
    name: string,
  ): unknown => {
    const a = args[i];
    if (a !== undefined && a !== null && a !== '') return a;
    return kwargs[name];
  };

  /* -------------------------- attach_amino_acid ------------------------- */
  // attach_amino_acid(selection, amino_acid, ...) — grow a residue onto the
  // backbone terminus that `selection` picks (a single N/C atom, a residue, or
  // — when empty — the last object's C-terminus). Returns the object name.
  ctx.command('editor.attach_amino_acid', (args, kwargs): Json => {
    const selection = str(arg(args, kwargs, 0, 'selection'), '');
    const aa = str(arg(args, kwargs, 1, 'amino_acid'), '');
    const frag = getAminoAcidFragment(aa);
    if (!frag) {
      throw new Error(
        `attach_amino_acid: unknown amino acid '${aa}' (expected a 1- or 3-letter residue code)`,
      );
    }
    const conn = resolveConnection(ctx, selection);
    const objName = growResidue(ctx, conn, resolveAminoAcidCode(aa) ?? aa.toUpperCase(), frag);
    ctx.publish();
    return objName;
  });

  /* --------------------------- attach_fragment -------------------------- */
  // attach_fragment(selection, fragment, hydrogen=0, anchor=0) — the lower-level
  // grow verb. When `selection` matches a terminus the fragment is grown onto it
  // (same superposition as attach_amino_acid); otherwise it is loaded as a new
  // object. `hydrogen`/`anchor` are accepted for signature parity. Returns name.
  ctx.command('editor.attach_fragment', (args, kwargs): Json => {
    const selection = str(arg(args, kwargs, 0, 'selection'), '');
    const fragTok = str(arg(args, kwargs, 1, 'fragment'), '');
    const frag = getAminoAcidFragment(fragTok);
    if (!frag) {
      throw new Error(`attach_fragment: unknown fragment '${fragTok}'`);
    }
    const code = resolveAminoAcidCode(fragTok) ?? fragTok.toUpperCase();
    const hasSel = selection.trim() !== '' && safeMatch(ctx, selection.trim()).length > 0;
    if (hasSel) {
      const conn = resolveConnection(ctx, selection);
      const objName = growResidue(ctx, conn, code, frag);
      ctx.publish();
      return objName;
    }
    const name = ctx.executive.uniqueName(code.toLowerCase());
    ctx.executive.addMolecule(buildResidueObject(code, frag, name, 1));
    ctx.publish();
    return name;
  });

  /* ---------------------------- build_peptide -------------------------- */
  // build_peptide(sequence) — grow a peptide from a one-letter sequence ("AG")
  // or whitespace-separated 3-letter codes ("ala gly"). Seeds the first residue
  // as a new object, then attaches the rest onto its growing C-terminus. Returns
  // the new object name.
  ctx.command('editor.build_peptide', (args, kwargs): Json => {
    const sequence = str(arg(args, kwargs, 0, 'sequence'), '');
    const raw = sequence.trim();
    const tokens = /\s/.test(raw) ? raw.split(/\s+/) : raw.split('');
    const codes: string[] = [];
    for (const t of tokens) {
      if (t === '') continue;
      const code = resolveAminoAcidCode(t);
      if (!code) throw new Error(`build_peptide: unknown residue '${t}' in sequence`);
      codes.push(code);
    }
    if (codes.length === 0) throw new Error('build_peptide: empty sequence');

    const name = ctx.executive.uniqueName('pept');
    const first = getAminoAcidFragment(codes[0]!)!;
    ctx.executive.addMolecule(buildResidueObject(codes[0]!, first, name, 1));
    for (let i = 1; i < codes.length; i++) {
      const conn = resolveConnection(ctx, `${name} and name C`);
      growResidue(ctx, conn, codes[i]!, getAminoAcidFragment(codes[i]!)!);
    }
    ctx.publish();
    return name;
  });
}
