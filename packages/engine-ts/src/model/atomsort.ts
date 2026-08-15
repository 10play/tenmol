/**
 * Canonical atom ordering — PyMOL's `AtomInfoCompare` and the load-time
 * `ObjectMoleculeSort`.
 *
 * PyMOL stores a molecule's atoms in a canonical order (segi, chain, hetatm,
 * resv, inscode, resn, name-priority, name, alt) rather than raw file order, and
 * `cmd.index` / `iterate` / `get_model` all enumerate in that stored order. The
 * atom `index` is 1-based position in this sorted array. The comparator here was
 * originally private to the PDB exporter; it now also drives the load-time sort
 * so the in-memory atom order matches PyMOL.
 */

import type { AtomInfo } from './atom';
import type { ObjectMolecule } from './molecule';

/** Insertion code of a `resi` string (`'52A'` -> `'A'`), or a space when none. */
export function inscodeOf(resi: string): string {
  const m = resi.match(/^-?\d+(.*)$/);
  const ins = (m?.[1] ?? '').trim();
  return ins ? ins[0]! : ' ';
}

/**
 * Canonical atom-ordering priority (`AtomInfoAssignParameters`, layer2/
 * AtomInfo.cpp) for the default `pdb_standard_order = on`. Lower sorts first:
 * backbone N(1) CA(2) C(3) O(4) then side-chain by Greek letter, with the
 * unconventional-name escape hatch (priority 1000) when the name doesn't start
 * with its element symbol.
 */
function atomPriority(name: string, elem: string): number {
  let i = 0;
  while (i < name.length - 1 && name[i]! >= '0' && name[i]! <= '9') i++;
  const n = name.slice(i);
  const c0 = (n[0] ?? '').toUpperCase();
  const c1 = (n[1] ?? '').toUpperCase();
  const e0 = (elem[0] ?? '').toUpperCase();
  if (c0 !== e0) return 1000; // unconventional atom name — no assignment

  const greek: Record<string, number> = {
    B: 6, G: 7, D: 8, E: 9, Z: 10, H: 11, I: 12, J: 13, K: 14, L: 15, M: 16, N: 17,
  };
  const digitBranch = (): number => {
    let pri = 0;
    for (let k = 1; k < n.length; k++) {
      const ch = n[k]!;
      if (ch === 'P') { pri -= 200; break; }
      if (ch === '*' || ch === "'") { pri = -100 - pri; break; }
      if (ch < '0' || ch > '9') break;
      pri = pri * 10 + (ch.charCodeAt(0) - 48);
    }
    return pri + 300;
  };

  switch (c0) {
    case 'N':
    case 'C':
    case 'O':
    case 'S':
      if (c1 === '') {
        if (c0 === 'N') return 1;
        if (c0 === 'C') return 3;
        if (c0 === 'O') return 4;
        return 1000;
      }
      if (c1 === 'A') return c0 === 'C' ? 2 : 5;
      if (c1 in greek) return greek[c1]!;
      // 'X' has no `break` in the C source: it falls through into the digit
      // branch, so `OXT` etc. are ultimately scored by digitBranch().
      if (c1 === 'X' || (c1 >= '0' && c1 <= '9')) return digitBranch();
      return 500;
    case 'P':
      return 20;
    case 'D':
    case 'H': {
      if (c1 === '') return 1001;
      if (c1 === 'A' || c1 === 'B') return 1003;
      const hgreek: Record<string, number> = {
        G: 1004, D: 1005, E: 1006, Z: 1007, H: 1008, I: 1009, J: 1010, K: 1011,
        L: 1012, M: 1013, N: 1002,
      };
      if (c1 in hgreek) return hgreek[c1]!;
      if (c1 === 'X') return 1999;
      if (c1 >= '0' && c1 <= '9') {
        let pri = 1020;
        for (let k = 1; k < n.length; k++) {
          const ch = n[k]!;
          if (ch < '0' || ch > '9') break;
          pri = pri * 10 + (ch.charCodeAt(0) - 48);
        }
        return pri + 25;
      }
      return 1500;
    }
    default:
      return 1000;
  }
}

/** Case-insensitive word comparison returning sign, mirroring `WordCompare`. */
function wordCmp(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `AtomInfoNameCompare`: strip a single leading digit, compare, tie-break on
 *  the full name (so `1HB` sorts near `HB`, and `ND2` < `OD1`). */
function nameCmp(a: string, b: string): number {
  const n1 = /^[0-9]/.test(a) ? a.slice(1) : a;
  const n2 = /^[0-9]/.test(b) ? b.slice(1) : b;
  const c = wordCmp(n1, n2);
  return c !== 0 ? c : wordCmp(a, b);
}

/**
 * `AtomInfoCompare` (defaults) restricted to a single object: segi, chain,
 * hetatm, resv, inscode, resn, priority, name, alt, then rank (load order) as
 * the stable tie-break. Reproduces PyMOL's stored/exported atom order.
 */
export function atomOrderCmp(
  a: { atom: AtomInfo; index: number },
  b: { atom: AtomInfo; index: number },
): number {
  const x = a.atom;
  const y = b.atom;
  let c = wordCmp(x.segi, y.segi);
  if (c) return c;
  c = wordCmp(x.chain, y.chain);
  if (c) return c;
  if (x.hetatm !== y.hetatm) return x.hetatm ? 1 : -1;
  if (x.resv !== y.resv) return x.resv < y.resv ? -1 : 1;
  const ia = inscodeOf(x.resi);
  const ib = inscodeOf(y.resi);
  if (ia !== ib) return ia < ib ? -1 : 1;
  c = wordCmp(x.resn, y.resn);
  if (c) return c;
  const pa = atomPriority(x.name, x.elem);
  const pb = atomPriority(y.name, y.elem);
  if (pa !== pb) return pa < pb ? -1 : 1;
  c = nameCmp(x.name, y.name);
  if (c) return c;
  const aa = x.alt || '';
  const ab = y.alt || '';
  if (aa !== ab) return aa < ab ? -1 : 1;
  return a.index - b.index; // rank: original load order
}

/**
 * Sort a freshly-loaded molecule's atoms into PyMOL's canonical order in place
 * (`ObjectMoleculeSort`), remapping the per-state coordinate sets and the bond
 * endpoints to the new atom positions. After this, `cmd.index`/`iterate`/
 * `get_model` enumerate atoms in the same order real PyMOL does.
 */
export function sortAtomsInPlace(mol: ObjectMolecule): void {
  const n = mol.atoms.length;
  if (n < 2) return;
  const order = mol.atoms.map((atom, index) => ({ atom, index }));
  order.sort(atomOrderCmp);

  // Already canonical? Nothing to remap (common for exporter round-trips).
  let changed = false;
  for (let i = 0; i < n; i++) {
    if (order[i]!.index !== i) { changed = true; break; }
  }
  if (!changed) return;

  // old atom position -> new atom position
  const remap = new Int32Array(n);
  const newAtoms = new Array<AtomInfo>(n);
  for (let newI = 0; newI < n; newI++) {
    const oldI = order[newI]!.index;
    newAtoms[newI] = mol.atoms[oldI]!;
    remap[oldI] = newI;
  }
  for (let i = 0; i < n; i++) mol.atoms[i] = newAtoms[i]!;

  // Reorder each state's Float32 coordinate set to match the new atom order.
  for (let s = 0; s < mol.states.length; s++) {
    const old = mol.states[s]!;
    const next = new Float32Array(old.length);
    for (let newI = 0; newI < n; newI++) {
      const oldI = order[newI]!.index;
      next[newI * 3] = old[oldI * 3] ?? 0;
      next[newI * 3 + 1] = old[oldI * 3 + 1] ?? 0;
      next[newI * 3 + 2] = old[oldI * 3 + 2] ?? 0;
    }
    mol.states[s] = next;
  }

  // Remap bond endpoints, keeping the (low, high) ordering convention.
  for (const bond of mol.bonds) {
    const a = remap[bond[0]]!;
    const b = remap[bond[1]]!;
    bond[0] = a < b ? a : b;
    bond[1] = a < b ? b : a;
  }
}
