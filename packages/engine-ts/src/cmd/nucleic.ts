/**
 * The nucleic-acid builder — `fnab`, `attach_nuc_acid`, `extend_nuc_acid`,
 * `bond_single_stranded`, `bond_double_stranded` (ref `pymol/editor.py`).
 *
 * Grows an object one nucleotide per one-letter code by placing the vendored
 * chempy monomer fragment (`model/nucleic-fragments.json`, the pickled
 * `atpB`/`ttpB`/`gtpB`/`ctpB`/`utpA` … geometries) as a residue and linking the
 * phosphodiester backbone O3'(i)→P(i+1). With `dbl_helix` it also builds the
 * antiparallel complement strand.
 */
import type { Json } from '@tenmol/protocol';

import { defaultVisRep, type AtomInfo } from '../model/atom';
import { ObjectMolecule } from '../model/molecule';
import raw from '../model/nucleic-fragments.json';
import type { RegistrarCtx } from './registrar';

interface NucFragment {
  atoms: Array<{ name: string; elem: string; x: number; y: number; z: number }>;
  bonds: Array<[number, number, number]>;
}
const FRAGMENTS = raw as unknown as Record<string, NucFragment>;

/** one-letter base ↔ fragment prefix ↔ Watson–Crick complement. */
const PREFIX_OF: Readonly<Record<string, string>> = { A: 'atp', T: 'ttp', G: 'gtp', C: 'ctp', U: 'utp' };
const LETTER_OF: Readonly<Record<string, string>> = { atp: 'A', ttp: 'T', gtp: 'G', ctp: 'C', utp: 'U' };
const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', T: 'A', G: 'C', C: 'G', U: 'A' };

/** Residue name for a base: DNA → `D`+letter (DA/DT/…), RNA → the bare letter. */
function resnFor(letter: string, nucType: string): string {
  const l = letter.toUpperCase();
  return nucType.toUpperCase() === 'RNA' ? l : 'D' + l;
}

/** The best fragment key for a base letter + form (fall back to B, then A). */
function fragKeyFor(letter: string, form: string): string {
  const p = PREFIX_OF[letter.toUpperCase()];
  if (!p) return '';
  for (const k of [p + form.toUpperCase(), p + 'B', p + 'A']) if (FRAGMENTS[k]) return k;
  return '';
}

/** Append a monomer fragment to `mol` as one residue (translated by `dz` along
 *  z so successive residues don't coincide). Returns its atom-name → index map. */
function appendNucleotide(
  mol: ObjectMolecule,
  fragKey: string,
  resn: string,
  resv: number,
  chain: string,
  dz: number,
): Map<string, number> {
  const frag = FRAGMENTS[fragKey]!;
  const base = mol.atoms.length;
  const idxByName = new Map<string, number>();
  const coords: number[] = [];
  frag.atoms.forEach((fa, i) => {
    idxByName.set(fa.name, base + i);
    const atom: AtomInfo = {
      id: base + i + 1,
      name: fa.name,
      resn,
      resi: String(resv),
      resv,
      chain,
      segi: '',
      alt: '',
      elem: fa.elem,
      hetatm: false,
      b: 0,
      q: 1,
      color: 0,
      ss: '',
      visRep: defaultVisRep(),
    };
    mol.atoms.push(atom);
    coords.push(fa.x, fa.y, fa.z + dz);
  });
  const old = mol.states[0] ?? new Float32Array(0);
  const merged = new Float32Array(old.length + coords.length);
  merged.set(old, 0);
  merged.set(coords, old.length);
  mol.states[0] = merged;
  for (const [i, j] of frag.bonds) {
    const a = base + i;
    const b = base + j;
    mol.bonds.push(a < b ? [a, b] : [b, a]);
  }
  return idxByName;
}

/** Index of the named atom in (chain, resv), or -1. */
function findAtom(mol: ObjectMolecule, chain: string, resv: number, name: string): number {
  return mol.atoms.findIndex((a) => a.chain === chain && a.resv === resv && a.name === name);
}

/** Bond O3'(prevResv) → P(newResv) on a strand's backbone. */
function bondBackbone(mol: ObjectMolecule, chain: string, prevResv: number, newResv: number): void {
  const o3 = findAtom(mol, chain, prevResv, "O3'");
  const p = findAtom(mol, chain, newResv, 'P');
  if (o3 >= 0 && p >= 0) mol.bonds.push(o3 < p ? [o3, p] : [p, o3]);
}

const RESV_RISE = 3.4; // Å per base (rough B-form rise)

export function registerNucleic(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const str = ctx.str;

  /** Grow (or start) a single strand: append one nucleotide + backbone bond. */
  const grow = (
    mol: ObjectMolecule,
    letter: string,
    nucType: string,
    form: string,
    chain: string,
    dzBase: number,
  ): boolean => {
    const key = fragKeyFor(letter, form);
    if (!key) return false;
    const resv = mol.atoms.filter((a) => a.chain === chain).length === 0
      ? 1
      : Math.max(0, ...mol.atoms.filter((a) => a.chain === chain).map((a) => a.resv)) + 1;
    appendNucleotide(mol, key, resnFor(letter, nucType), resv, chain, dzBase + (resv - 1) * RESV_RISE);
    if (resv > 1) bondBackbone(mol, chain, resv - 1, resv);
    return true;
  };

  const ensureObject = (name: string): ObjectMolecule => {
    let mol = ex.molecule(name);
    if (!mol) {
      mol = new ObjectMolecule(name);
      mol.states.push(new Float32Array(0));
      ex.addMolecule(mol);
    }
    return mol;
  };

  // attach_nuc_acid(selection, nuc_acid, nuc_type, object, form, dbl_helix) —
  // add one nucleotide to `object` (creating it on first call), backbone-linking
  // to the previous residue. `nuc_acid` is a fragment prefix ('atp') or letter.
  ctx.command('attach_nuc_acid', (args, kwargs): Json => {
    const nucAcid = str(args[1] ?? kwargs.nuc_acid, '');
    const nucType = str(args[2] ?? kwargs.nuc_type, 'DNA');
    const objName = str(args[3] ?? kwargs.object, '') || 'obj';
    const form = str(args[4] ?? kwargs.form, 'B') || 'B';
    const letter = LETTER_OF[nucAcid.toLowerCase()] ?? nucAcid.toUpperCase();
    const mol = ensureObject(objName);
    if (!grow(mol, letter, nucType, form, 'A', 0)) return null;
    ctx.publish();
    return objName;
  });

  // extend_nuc_acid routes through attach_nuc_acid (same growth path).
  ctx.command('extend_nuc_acid', (args, kwargs) => ctx.call('attach_nuc_acid', args, kwargs));

  // bond_single_stranded / bond_double_stranded — no-op stitchers here; fnab does
  // the backbone/complement bonding inline as it builds. Registered so scripts
  // that call them directly resolve (returning the object).
  ctx.command('bond_single_stranded', (args, kwargs): Json => str(args[0] ?? kwargs.object, '') || null);
  ctx.command('bond_double_stranded', (args, kwargs): Json => str(args[0] ?? kwargs.object, '') || null);

  // fnab(input, name, mode, form, dbl_helix) — build a nucleic-acid object from a
  // one-letter sequence; with dbl_helix, also build the antiparallel complement.
  ctx.command('fnab', (args, kwargs): Json => {
    const input = str(args[0] ?? kwargs.input, '');
    const nameArg = str(args[1] ?? kwargs.name, '');
    const nucType = str(args[2] ?? kwargs.mode, 'DNA') || 'DNA';
    const form = str(args[3] ?? kwargs.form, 'B') || 'B';
    const dblHelix = Number(args[4] ?? kwargs.dbl_helix ?? 1) !== 0;

    const letters = input
      .toUpperCase()
      .split('')
      .filter((l) => PREFIX_OF[l]);
    if (letters.length === 0) return null;

    const objName = ex.uniqueName(nameArg || 'obj');
    const mol = ensureObject(objName);
    for (const l of letters) grow(mol, l, nucType, form, 'A', 0);
    if (dblHelix) {
      // Antiparallel complement on chain B.
      for (const l of letters.map((x) => COMPLEMENT[x]!).reverse()) {
        grow(mol, l, nucType, form, 'B', 12);
      }
    }
    ctx.publish();
    return objName;
  });
}
