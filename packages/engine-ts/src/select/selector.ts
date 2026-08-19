/**
 * Selection algebra — the subset of PyMOL's selection language the slice needs.
 *
 * Ports the operators of `packages/engine/layer3/Selector.cpp` /
 * `packages/engine/modules/pymol/parsing.py` that appear in the covered corpus:
 *
 *   property selectors : name/n.  elem/e.  chain/c.  resn/r.  resi/i. (+ ranges)
 *                        index/idx.  id  segi/s.  alt
 *   keyword selectors  : all  none  hetatm  hydro/hydrogens/h.  polymer  solvent
 *   set operators      : and (&)   or (|)   not (!)   ( )   implicit-and
 *   references         : a bare object name, or a previously named selection
 *
 * Multi-valued property specs use PyMOL's `+` grouping (`name CA+CB`) and `resi`
 * accepts ranges (`resi 10-20`). Wildcards, `within`, `byres` etc. are out of
 * this slice's scope and raise a parse error rather than silently mis-select.
 */

import { REP_NAMES } from '@tenmol/protocol';
import type { AtomInfo } from '../model/atom';
import { NO_NUMERIC_TYPE } from '../model/atom';
import type { ObjectMolecule } from '../model/molecule';
import { getColorIndex } from '../exec/color';

/** One atom in the global universe: which object, and its 0-based local index. */
export interface UniverseAtom {
  objName: string;
  index: number;
  atom: AtomInfo;
}

/** What the selector resolves names against. */
export interface SelectorContext {
  /** Objects in creation order. */
  objects(): ObjectMolecule[];
  /** A previously stored named selection -> the stable atom identities it holds. */
  namedSelection(name: string): Set<string> | undefined;
  /**
   * If `name` is a group object, the set of molecule-object names it transitively
   * contains (nested groups flattened); `undefined` when `name` is not a group.
   * Used so a group name spans all its members' atoms when used as a selection.
   */
  groupMembers?(name: string): Set<string> | undefined;
}

/** Stable identity of an atom across edits: object name + PyMOL atom id. The
 * `|` separator matches this file's other composite keys ({@link resKey},
 * {@link chainKey}); the id is numeric so the boundary is unambiguous. */
export function atomKey(objName: string, atom: AtomInfo): string {
  return `${objName}|${atom.id}`;
}

/** Compile a PyMOL object-name glob (`*` = any run, `?` = one char) into an
 * anchored, case-sensitive RegExp. All other characters are matched literally. */
function globToRegExp(pattern: string): RegExp {
  let re = '^';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

export class SelectionError extends Error {
  override name = 'SelectionError';
}

type Node =
  | { t: 'all' }
  | { t: 'none' }
  | { t: 'prop'; key: PropKey; values: string[]; ranges: Array<[number, number]> }
  | { t: 'keyword'; kw: KeywordKey }
  | { t: 'cmp'; field: CmpField; op: CmpOp; value: number }
  // `p.<name> <cmp> <value>` / `property.<name> <cmp> <value>` — matches atoms
  // whose user-defined property `name` (set via `alter`, read as a float)
  // satisfies the comparison. PyMOL's SELE_PROP.
  | { t: 'propcmp'; name: string; op: CmpOp; value: number }
  // `state N` — atoms present in coordinate state N (PyMOL SELE_STAs). An atom
  // matches when its object has a coordset for that 1-based state; -1 means the
  // object's current state.
  | { t: 'stateSel'; state: number }
  | { t: 'ref'; name: string }
  | { t: 'not'; a: Node }
  | { t: 'and'; a: Node; b: Node }
  | { t: 'or'; a: Node; b: Node }
  // `A in B` — atoms of A whose identity (resi/chain/name/resn/segi) matches an
  // atom of B (cross-object identity match, not coordinates). PyMOL's SELE_IN_2.
  | { t: 'in'; a: Node; b: Node }
  // `A like B` — atoms of A whose identity (name + resv + inscode) matches an
  // atom of B, IGNORING chain/segi/resn (this is the difference from `in`).
  // PyMOL's SELE_LIK2.
  | { t: 'like'; a: Node; b: Node }
  // Set operators (need the whole matched set, not a per-atom predicate):
  | { t: 'byres'; a: Node }
  | { t: 'bycalpha'; a: Node }
  | { t: 'byring'; a: Node }
  | { t: 'pepseq'; seq: string }
  | { t: 'bymol'; a: Node }
  | { t: 'byobject'; a: Node }
  | { t: 'bychain'; a: Node }
  | { t: 'bysegment'; a: Node }
  | { t: 'first'; a: Node }
  | { t: 'last'; a: Node }
  | { t: 'neighbor'; a: Node; includeSelf?: boolean }
  // Proximity operators. `within` returns everything within `dist` of `a`;
  // `binwithin`/`nearto`/`beyond` are the binary forms `A op N of B`.
  | { t: 'within'; dist: number; a: Node }
  | { t: 'around'; dist: number; a: Node }
  | { t: 'expand'; dist: number; a: Node }
  | { t: 'extend'; dist: number; a: Node }
  | { t: 'gap'; dist: number; a: Node }
  | { t: 'binwithin'; dist: number; a: Node; b: Node }
  | { t: 'nearto'; dist: number; a: Node; b: Node }
  | { t: 'beyond'; dist: number; a: Node; b: Node };

type CmpField = 'b' | 'q' | 'pc' | 'fc' | 'x' | 'y' | 'z';
type CmpOp = '<' | '<=' | '>' | '>=' | '=' | '!=';

type PropKey =
  | 'name'
  | 'elem'
  | 'chain'
  | 'resn'
  | 'resi'
  | 'index'
  | 'id'
  | 'rank'
  | 'segi'
  | 'alt'
  | 'custom'
  | 'color'
  | 'cartoon_color'
  | 'ribbon_color'
  | 'rep'
  | 'flag'
  | 'label'
  | 'numeric_type'
  | 'text_type'
  | 'ss';
type KeywordKey =
  | 'hetatm'
  | 'hydro'
  | 'polymer'
  | 'polymerProtein'
  | 'polymerNucleic'
  | 'solvent'
  | 'organic'
  | 'inorganic'
  | 'backbone'
  | 'sidechain'
  | 'visible'
  | 'enabled'
  | 'present'
  | 'bonded'
  | 'donor'
  | 'acceptor'
  | 'metals'
  | 'masked'
  | 'protected'
  | 'fixed'
  | 'restrained'
  | 'guide';

const PROP_ALIASES: Readonly<Record<string, PropKey>> = {
  name: 'name',
  'n.': 'name',
  elem: 'elem',
  'e.': 'elem',
  chain: 'chain',
  'c.': 'chain',
  resn: 'resn',
  'r.': 'resn',
  resi: 'resi',
  'i.': 'resi',
  index: 'index',
  'idx.': 'index',
  id: 'id',
  rank: 'rank',
  segi: 'segi',
  's.': 'segi',
  alt: 'alt',
  altloc: 'alt',
  custom: 'custom',
  color: 'color',
  cartoon_color: 'cartoon_color',
  ribbon_color: 'ribbon_color',
  rep: 'rep',
  flag: 'flag',
  'f.': 'flag',
  label: 'label',
  'lab.': 'label',
  numeric_type: 'numeric_type',
  'nt.': 'numeric_type',
  'nt;': 'numeric_type',
  text_type: 'text_type',
  'tt.': 'text_type',
  'tt;': 'text_type',
  ss: 'ss',
};

/** Numeric atom fields comparable with `<`, `>`, `=`, … (`b > 50`, `q = 1`).
 *  `x`/`y`/`z` compare the atom's Cartesian coordinate (same operator grammar;
 *  PyMOL rejects `in`/`within` on them, so only the comparison operators apply). */
const NUMERIC_FIELDS: Readonly<Record<string, CmpField>> = {
  b: 'b',
  q: 'q',
  pc: 'pc',
  'pc.': 'pc',
  partial_charge: 'pc',
  fc: 'fc',
  'fc.': 'fc',
  formal_charge: 'fc',
  x: 'x',
  y: 'y',
  z: 'z',
};
const CMP_OPS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', '=', '==', '!=']);

/** Representation name -> RepId, for the `rep <name>` selector. */
const REP_BY_NAME = new Map<string, number>();
for (const [id, name] of Object.entries(REP_NAMES)) REP_BY_NAME.set(name, Number(id));
REP_BY_NAME.set('wire', REP_BY_NAME.get('lines') ?? 7);

const KEYWORDS: Readonly<Record<string, KeywordKey>> = {
  hetatm: 'hetatm',
  hydro: 'hydro',
  hydrogens: 'hydro',
  'h.': 'hydro',
  polymer: 'polymer',
  'pol.': 'polymer',
  // Dotted polymer sub-classes (PyMOL SELE_PROz / SELE_NUCz). This open-source
  // build only accepts the dotted forms; the bare `protein`/`nucleic`/`pro.`/
  // `nuc.` aliases are `#if 0`-disabled and raise "Invalid selection name".
  'polymer.protein': 'polymerProtein',
  'polymer.nucleic': 'polymerNucleic',
  solvent: 'solvent',
  organic: 'organic',
  'org.': 'organic',
  inorganic: 'inorganic',
  'ino.': 'inorganic',
  backbone: 'backbone',
  'bb.': 'backbone',
  sidechain: 'sidechain',
  'sc.': 'sidechain',
  visible: 'visible',
  'v.': 'visible',
  enabled: 'enabled',
  present: 'present',
  bonded: 'bonded',
  donor: 'donor',
  acceptor: 'acceptor',
  metals: 'metals',
  masked: 'masked',
  'msk.': 'masked',
  protected: 'protected',
  fixed: 'fixed',
  'fxd.': 'fixed',
  restrained: 'restrained',
  'rst.': 'restrained',
  guide: 'guide',
};

/** Atom modeling-flag bit set by `flag fix` — the `fixed`/`fxd.` selector. */
const ATOM_FLAG_FIX = 3;
/** Atom modeling-flag bit set by `flag restrain` — the `restrained`/`rst.` selector. */
const ATOM_FLAG_RESTRAIN = 2;

/** Metal elements for the `metals` keyword (element heuristic). */
const METAL_ELEMENTS = new Set([
  'Li', 'Be', 'Na', 'Mg', 'Al', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe',
  'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru',
  'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Cs', 'Ba', 'La', 'Ce', 'Pt', 'Au', 'Hg',
  'Pb', 'W', 'Re', 'Os', 'Ir',
]);
/** Potential H-bond donor / acceptor elements (element heuristic). */
const DONOR_ELEMENTS = new Set(['N', 'O']);
const ACCEPTOR_ELEMENTS = new Set(['N', 'O', 'S']);

const SOLVENT_RESN = new Set(['HOH', 'WAT', 'H2O', 'TIP', 'SOL']);
/** Known protein residue names — PyMOL's `AtomInfoKnownProteinResName`
 *  (`layer2/AtomInfo.cpp`). Compared uppercase. */
const PROTEIN_RESN = new Set([
  'ALA', 'ARG', 'ASP', 'ASN', 'CYS', 'CYX', 'GLN', 'GLU', 'GLY', 'HIS', 'HID',
  'HIE', 'HIP', 'ILE', 'LEU', 'LYS', 'MET', 'MSE', 'PHE', 'PRO', 'PTR', 'SER',
  'THR', 'TRP', 'TYR', 'VAL',
]);
/** PNA residue names — PyMOL's `AtomInfoKnownPNAResName`; these count as nucleic
 *  even on HETATM records. */
const PNA_RESN = new Set(['APN', 'CPN', 'GPN', 'TPN', 'IPN']);
/** Protein/nucleic backbone atom names (`bb.`). */
const BACKBONE_NAMES = new Set([
  'N', 'CA', 'C', 'O', 'OXT', // protein
  'P', 'OP1', 'OP2', "O5'", "C5'", "C4'", "C3'", "O3'", // nucleic
]);

/* ------------------------------- tokenizer ------------------------------- */

function tokenize(input: string): string[] {
  // Give ( ) the symbol operators and the numeric comparison operators their own
  // tokens; leave words intact so `CA+CB` and `10-20` survive as single value
  // tokens. Multi-char operators (`<=`, `!=`, …) come first in the alternation
  // so they win over their single-char prefixes (`<`, `!`).
  const spaced = input.replace(/(<=|>=|!=|==|<|>|=|[()&|!])/g, ' $1 ');
  return spaced.trim().length === 0 ? [] : spaced.trim().split(/\s+/);
}

/* -------------------------------- parser --------------------------------- */

class Parser {
  private pos = 0;
  constructor(private readonly toks: string[]) {}

  parse(): Node {
    if (this.toks.length === 0) return { t: 'all' }; // empty selection == all (PyMOL)
    const node = this.parseOr();
    if (this.pos < this.toks.length) {
      throw new SelectionError(`unexpected token '${this.toks[this.pos]}'`);
    }
    return node;
  }

  private peek(): string | undefined {
    return this.toks[this.pos];
  }
  private next(): string {
    const t = this.toks[this.pos++];
    if (t === undefined) throw new SelectionError('unexpected end of selection');
    return t;
  }
  private isOp(t: string | undefined, ...ops: string[]): boolean {
    return t !== undefined && ops.includes(t.toLowerCase());
  }

  private parseOr(): Node {
    let a = this.parseAnd();
    // `or`/`|` and the `in` identity operator share PyMOL's priority (0x40),
    // below `and` (0x60), so both bind at this level, left-associatively.
    for (;;) {
      if (this.isOp(this.peek(), 'or', '|')) {
        this.next();
        a = { t: 'or', a, b: this.parseAnd() };
      } else if (this.isOp(this.peek(), 'in')) {
        this.next();
        a = { t: 'in', a, b: this.parseAnd() };
      } else if (this.isOp(this.peek(), 'like', 'l.')) {
        this.next();
        a = { t: 'like', a, b: this.parseAnd() };
      } else {
        break;
      }
    }
    return a;
  }

  private parseAnd(): Node {
    let a = this.parseNot();
    // explicit `and`/`&`, plus PyMOL implicit-and when another term starts.
    for (;;) {
      if (this.isOp(this.peek(), 'and', '&')) {
        this.next();
        a = { t: 'and', a, b: this.parseNot() };
        continue;
      }
      const t = this.peek();
      if (t !== undefined && t !== ')' && !this.isOp(t, 'or', '|', 'in', 'like', 'l.')) {
        a = { t: 'and', a, b: this.parseNot() };
        continue;
      }
      break;
    }
    return a;
  }

  private parseNot(): Node {
    const t = this.peek();
    if (this.isOp(t, 'not', '!')) {
      this.next();
      return { t: 'not', a: this.parseNot() };
    }
    // A primary (prefix set-ops / term) followed by any postfix proximity ops.
    return this.parsePostfix(this.parsePrefix());
  }

  /** Read a distance argument for a proximity operator. */
  private parseDist(op: string): number {
    const dist = Number(this.next());
    if (!Number.isFinite(dist)) throw new SelectionError(`${op} expects a distance`);
    return dist;
  }
  /** Consume the mandatory `of` keyword of an `<op> N of <sel>` form. */
  private expectOf(op: string): void {
    if (this.next().toLowerCase() !== 'of') throw new SelectionError(`${op} expects 'of'`);
  }

  /** Prefix set operators (higher precedence than and/or). */
  private parsePrefix(): Node {
    const t = this.peek();
    // Whole-group expanders: byres / bymolecule / byobject / bychain.
    if (this.isOp(t, 'byres', 'br.')) {
      this.next();
      return { t: 'byres', a: this.parseNot() };
    }
    if (this.isOp(t, 'bymol', 'bymolecule', 'bm.', 'byfragment')) {
      this.next();
      return { t: 'bymol', a: this.parseNot() };
    }
    if (this.isOp(t, 'byobject', 'byobj', 'bo.')) {
      this.next();
      return { t: 'byobject', a: this.parseNot() };
    }
    if (this.isOp(t, 'bychain')) {
      this.next();
      return { t: 'bychain', a: this.parseNot() };
    }
    if (this.isOp(t, 'bysegment', 'byseg', 'bs.')) {
      this.next();
      return { t: 'bysegment', a: this.parseNot() };
    }
    // bycalpha / bca. — the C-alpha of every residue the operand touches.
    if (this.isOp(t, 'bycalpha', 'bca.')) {
      this.next();
      return { t: 'bycalpha', a: this.parseNot() };
    }
    // byring — atoms on a ring (SSSR, ring size ≤ 7) containing the operand.
    if (this.isOp(t, 'byring')) {
      this.next();
      return { t: 'byring', a: this.parseNot() };
    }
    // pepseq / ps. — a one-letter peptide-sequence motif (consumes the pattern
    // word, not a sub-selection, mirroring PyMOL's SELE_PEPs).
    if (this.isOp(t, 'pepseq', 'ps.')) {
      this.next();
      return { t: 'pepseq', seq: this.next() };
    }
    if (this.isOp(t, 'first')) {
      this.next();
      return { t: 'first', a: this.parseNot() };
    }
    if (this.isOp(t, 'last')) {
      this.next();
      return { t: 'last', a: this.parseNot() };
    }
    if (this.isOp(t, 'neighbor', 'neighbour', 'nbr.')) {
      this.next();
      return { t: 'neighbor', a: this.parseNot() };
    }
    // `bound_to` (bto.) is like `neighbor` but does NOT exclude the input
    // selection: members of the selection that are bonded to other members are
    // kept (e.g. disulfide SG..SG pairs). PyMOL's SELE_BONs vs SELE_NGHs.
    if (this.isOp(t, 'bound_to', 'bto.')) {
      this.next();
      return { t: 'neighbor', a: this.parseNot(), includeSelf: true };
    }
    // Prefix proximity forms `<op> N of <sel>` (implicit left operand = all).
    if (this.isOp(t, 'within', 'w.')) {
      this.next();
      const dist = this.parseDist('within');
      this.expectOf('within');
      return { t: 'within', dist, a: this.parseNot() };
    }
    if (this.isOp(t, 'around', 'a.')) {
      this.next();
      const dist = this.parseDist('around');
      this.expectOf('around');
      return { t: 'around', dist, a: this.parseNot() };
    }
    if (this.isOp(t, 'expand')) {
      this.next();
      const dist = this.parseDist('expand');
      this.expectOf('expand');
      return { t: 'expand', dist, a: this.parseNot() };
    }
    if (this.isOp(t, 'extend', 'xt.')) {
      this.next();
      const dist = this.parseDist('extend');
      this.expectOf('extend');
      return { t: 'extend', dist, a: this.parseNot() };
    }
    if (this.isOp(t, 'gap')) {
      this.next();
      const dist = this.parseDist('gap');
      this.expectOf('gap');
      return { t: 'gap', dist, a: this.parseNot() };
    }
    if (this.isOp(t, 'near_to', 'nto.')) {
      this.next();
      const dist = this.parseDist('near_to');
      this.expectOf('near_to');
      return { t: 'nearto', dist, a: { t: 'all' }, b: this.parseNot() };
    }
    if (this.isOp(t, 'beyond', 'be.')) {
      this.next();
      const dist = this.parseDist('beyond');
      this.expectOf('beyond');
      return { t: 'beyond', dist, a: { t: 'all' }, b: this.parseNot() };
    }
    return this.parseTerm();
  }

  /** Postfix proximity operators binding to the preceding primary `node`. */
  private parsePostfix(node: Node): Node {
    for (;;) {
      const t = this.peek();
      if (this.isOp(t, 'around', 'a.')) {
        this.next();
        node = { t: 'around', dist: this.parseDist('around'), a: node };
      } else if (this.isOp(t, 'expand')) {
        this.next();
        node = { t: 'expand', dist: this.parseDist('expand'), a: node };
      } else if (this.isOp(t, 'extend', 'xt.')) {
        this.next();
        node = { t: 'extend', dist: this.parseDist('extend'), a: node };
      } else if (this.isOp(t, 'gap')) {
        this.next();
        node = { t: 'gap', dist: this.parseDist('gap'), a: node };
      } else if (this.isOp(t, 'within', 'w.')) {
        this.next();
        const dist = this.parseDist('within');
        this.expectOf('within');
        node = { t: 'binwithin', dist, a: node, b: this.parseNot() };
      } else if (this.isOp(t, 'near_to', 'nto.')) {
        this.next();
        const dist = this.parseDist('near_to');
        this.expectOf('near_to');
        node = { t: 'nearto', dist, a: node, b: this.parseNot() };
      } else if (this.isOp(t, 'beyond', 'be.')) {
        this.next();
        const dist = this.parseDist('beyond');
        this.expectOf('beyond');
        node = { t: 'beyond', dist, a: node, b: this.parseNot() };
      } else {
        return node;
      }
    }
  }

  private parseTerm(): Node {
    const t = this.next();
    if (t === '(') {
      const inner = this.parseOr();
      const close = this.next();
      if (close !== ')') throw new SelectionError("expected ')'");
      return inner;
    }
    const low = t.toLowerCase();
    if (low === 'all' || t === '*') return { t: 'all' };
    if (low === 'none') return { t: 'none' };
    // Slash macro `/object/segi/chain/resi/name` (any token containing '/').
    if (t.includes('/')) return parseSlashMacro(t);
    // `model X` / `m. X` object qualifier.
    if (low === 'model' || low === 'm.') return { t: 'ref', name: this.next() };
    // `state N` — coordinate-state membership (SELE_STAs).
    if (low === 'state') {
      const v = Number(this.next());
      if (!Number.isFinite(v)) throw new SelectionError("'state' expects a state number");
      return { t: 'stateSel', state: v };
    }
    // Numeric property comparison `b > 50`, `q = 1`, `fc. != 0`.
    if (low in NUMERIC_FIELDS && CMP_OPS.has(this.peek() ?? '')) {
      const raw = this.next();
      const op: CmpOp = raw === '==' ? '=' : (raw as CmpOp);
      const value = Number(this.next());
      if (!Number.isFinite(value)) throw new SelectionError(`'${low}' comparison expects a number`);
      return { t: 'cmp', field: NUMERIC_FIELDS[low]!, op, value };
    }
    if (low in KEYWORDS) return { t: 'keyword', kw: KEYWORDS[low]! };
    if (low in PROP_ALIASES) {
      const key = PROP_ALIASES[low]!;
      const spec = this.next();
      return this.buildProp(key, spec);
    }
    // Custom-property comparison `p.<name> <cmp> <value>` /
    // `property.<name> <cmp> <value>` (PyMOL SELE_PROP). The property name is
    // glued onto the `p.`/`property.` prefix; a comparison operator + numeric
    // value must follow, else the token falls through to a bare reference.
    let propName: string | null = null;
    if (low.startsWith('p.') && t.length > 2) propName = t.slice(2);
    else if (low.startsWith('property.') && t.length > 9) propName = t.slice(9);
    if (propName !== null && CMP_OPS.has(this.peek() ?? '')) {
      const raw = this.next();
      const op: CmpOp = raw === '==' ? '=' : (raw as CmpOp);
      const value = Number(this.next());
      if (!Number.isFinite(value)) {
        throw new SelectionError(`property '${propName}' comparison expects a number`);
      }
      return { t: 'propcmp', name: propName, op, value };
    }
    // Otherwise a bare reference: object name or named selection. A leading `?`
    // marks the name as optional — `?name` resolves to the named object/selection
    // if it exists and to the empty set otherwise (no error), which is exactly how
    // a plain unknown `ref` already behaves here, so we just strip the prefix.
    return { t: 'ref', name: t.startsWith('?') ? t.slice(1) : t };
  }

  private buildProp(key: PropKey, spec: string): Node {
    return buildProp(key, spec);
  }
}

/** Strip a single pair of matching enclosing quotes (`'x'`/`"x"`) from a token. */
function stripEnclosingQuotes(s: string): string {
  if (s.length >= 2 && (s[0] === "'" || s[0] === '"') && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}

/** `+`-grouped value spec into a prop node; numeric ranges for resi/index/id. */
function buildProp(key: PropKey, spec: string): Node {
  const values: string[] = [];
  const ranges: Array<[number, number]> = [];
  for (const rawPart of spec.split('+')) {
    // Skip empties from adjacent `+` (`CA+`), but keep an explicitly quoted empty
    // value (`alt ''`) — that selects atoms with an empty altloc.
    if (rawPart === '') continue;
    const part = stripEnclosingQuotes(rawPart);
    const m = /^(-?\d+)-(-?\d+)$/.exec(part);
    if (
      m &&
      (key === 'resi' || key === 'index' || key === 'id' || key === 'rank' ||
        key === 'numeric_type')
    ) {
      ranges.push([parseInt(m[1]!, 10), parseInt(m[2]!, 10)]);
    } else {
      values.push(part);
    }
  }
  return { t: 'prop', key, values, ranges };
}

/**
 * PyMOL slash-notation macro. With a leading `/` the fields are left-aligned as
 * `/object/segi/chain/resi/name`; without one they are right-aligned ending at
 * `name` (`chain/resi/name`, `resi/name`, …). Empty segments and `*` are
 * wildcards (no constraint). The result is the AND of the present fields.
 */
function parseSlashMacro(tok: string): Node {
  const leading = tok.startsWith('/');
  const parts = leading ? tok.slice(1).split('/') : tok.split('/');
  const fields: Partial<Record<'object' | 'segi' | 'chain' | 'resi' | 'name', string>> = {};
  const LEFT = ['object', 'segi', 'chain', 'resi', 'name'] as const;
  if (leading) {
    for (let i = 0; i < parts.length && i < LEFT.length; i++) {
      const v = parts[i]!;
      if (v !== '' && v !== '*') fields[LEFT[i]!] = v;
    }
  } else {
    // Right-aligned: rightmost field is `name`, then resi, chain, segi, object.
    const RIGHT = ['name', 'resi', 'chain', 'segi', 'object'] as const;
    for (let k = 0; k < parts.length && k < RIGHT.length; k++) {
      const v = parts[parts.length - 1 - k]!;
      if (v !== '' && v !== '*') fields[RIGHT[k]!] = v;
    }
  }
  const nodes: Node[] = [];
  if (fields.object !== undefined) nodes.push({ t: 'ref', name: fields.object });
  if (fields.segi !== undefined) nodes.push(buildProp('segi', fields.segi));
  if (fields.chain !== undefined) nodes.push(buildProp('chain', fields.chain));
  if (fields.resi !== undefined) nodes.push(buildProp('resi', fields.resi));
  if (fields.name !== undefined) nodes.push(buildProp('name', fields.name));
  if (nodes.length === 0) return { t: 'all' };
  return nodes.reduce((a, b) => ({ t: 'and', a, b }));
}

/* ------------------------------- evaluator ------------------------------- */

/** Case-insensitive match with `*`/`?` glob support (`name CA*`, `resn A?A`). */
function fieldMatch(pattern: string, field: string): boolean {
  const p = pattern.toLowerCase();
  const f = field.toLowerCase();
  if (!p.includes('*') && !p.includes('?')) return p === f;
  const rx = new RegExp(
    '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return rx.test(f);
}

function matchProp(node: Extract<Node, { t: 'prop' }>, ua: UniverseAtom): boolean {
  const a = ua.atom;
  const eq = fieldMatch;
  switch (node.key) {
    case 'name':
      return node.values.some((v) => eq(v, a.name));
    case 'elem':
      return node.values.some((v) => eq(v, a.elem));
    case 'chain':
      return node.values.some((v) => eq(v, a.chain));
    case 'resn':
      return node.values.some((v) => eq(v, a.resn));
    case 'segi':
      return node.values.some((v) => eq(v, a.segi));
    case 'alt':
      return node.values.some((v) => eq(v, a.alt) || (v === '' && a.alt === ''));
    case 'custom':
      // `custom` is the free-form per-atom string set by `alter`; unset ⇒ ''.
      return node.values.some((v) => eq(v, a.custom ?? '') || (v === '' && (a.custom ?? '') === ''));
    case 'label':
      // `label <text>` (SELE_LABs) matches atoms whose per-atom label text fits
      // the wildcard pattern; an unset label ⇒ ''.
      return node.values.some((v) => eq(v, a.label ?? '') || (v === '' && (a.label ?? '') === ''));
    case 'resi':
      return (
        node.values.some((v) => v === a.resi || Number(v) === a.resv) ||
        node.ranges.some(([lo, hi]) => a.resv >= lo && a.resv <= hi)
      );
    case 'index':
      return (
        node.values.some((v) => Number(v) === ua.index + 1) ||
        node.ranges.some(([lo, hi]) => ua.index + 1 >= lo && ua.index + 1 <= hi)
      );
    case 'id':
      return (
        node.values.some((v) => Number(v) === a.id) ||
        node.ranges.some(([lo, hi]) => a.id >= lo && a.id <= hi)
      );
    case 'rank':
      // `rank N` — 0-based atom load order (PyMOL's `rank`), whereas `index` is
      // 1-based. The universe index is 0-based per-object load order.
      return (
        node.values.some((v) => Number(v) === ua.index) ||
        node.ranges.some(([lo, hi]) => ua.index >= lo && ua.index <= hi)
      );
    case 'color':
      return node.values.some((v) => {
        const idx = /^-?\d+$/.test(v) ? Number(v) : getColorIndex(v);
        return idx === a.color;
      });
    case 'cartoon_color':
    case 'ribbon_color':
      // Per-atom colour setting (PyMOL SELE_CCLs / SELE_RCLs, read via
      // AtomSettingGetIfDefined): an atom matches only when it has a *defined*
      // per-atom override for this setting whose colour index equals the query
      // (`cartoon_color -1` therefore never matches an unset atom).
      return node.values.some((v) => {
        const idx = /^-?\d+$/.test(v) ? Number(v) : getColorIndex(v);
        const set = a.atomSettings?.[node.key];
        return set !== undefined && Number(set) === idx;
      });
    case 'rep':
      return node.values.some((v) => {
        const id = REP_BY_NAME.get(v.toLowerCase());
        return id !== undefined && (a.visRep & (1 << id)) !== 0;
      });
    case 'flag':
      // `flag N` matches atoms whose modeling-flags bitmask has bit N set.
      return node.values.some((v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 && n < 32 && ((a.flags ?? 0) & (1 << n)) !== 0;
      });
    case 'numeric_type': {
      // `numeric_type N` / `nt. N` — integer-list match on customType (PyMOL
      // SELE_NTYs → WordMatchInteger). Unset atoms carry NO_NUMERIC_TYPE and
      // match nothing.
      const nt = a.customType ?? NO_NUMERIC_TYPE;
      return (
        node.values.some((v) => Number(v) === nt) ||
        node.ranges.some(([lo, hi]) => nt >= lo && nt <= hi)
      );
    }
    case 'text_type':
      // `text_type S` / `tt. S` — alpha/wildcard list match on textType
      // (SELE_TTYs); unset ⇒ ''.
      return node.values.some(
        (v) => eq(v, a.textType ?? '') || (v === '' && (a.textType ?? '') === ''),
      );
    case 'ss':
      // 'H' helix, 'S' strand; 'L' (or empty) is loop/unassigned.
      return node.values.some((v) => {
        const u = v.toUpperCase();
        const s = a.ss.toUpperCase();
        return u === 'L' ? s === '' || s === 'L' : s === u;
      });
  }
}

/** Apply a comparison operator; `=`/`!=` use a small tolerance (float fields). */
function compareOp(lhs: number, op: CmpOp, value: number): boolean {
  switch (op) {
    case '<':
      return lhs < value;
    case '<=':
      return lhs <= value;
    case '>':
      return lhs > value;
    case '>=':
      return lhs >= value;
    case '=':
      return Math.abs(lhs - value) < 1e-4;
    case '!=':
      return Math.abs(lhs - value) >= 1e-4;
  }
}

/** Numeric comparison on a per-atom field (`b`, `q`, `pc`, `fc`). The Cartesian
 *  `x`/`y`/`z` fields are handled in {@link evalSet} where coordinates live. */
function matchCmp(node: Extract<Node, { t: 'cmp' }>, a: AtomInfo): boolean {
  const lhs =
    node.field === 'b'
      ? a.b
      : node.field === 'q'
        ? a.q
        : node.field === 'pc'
          ? a.partialCharge ?? 0
          : a.formalCharge ?? 0;
  return compareOp(lhs, node.op, node.value);
}

function matchKeyword(kw: KeywordKey, ua: UniverseAtom): boolean {
  const a = ua.atom;
  switch (kw) {
    case 'hetatm':
      return a.hetatm;
    case 'hydro':
      return a.elem === 'H' || a.elem === 'D';
    case 'solvent':
      return SOLVENT_RESN.has(a.resn.toUpperCase());
    case 'polymer':
      // Protein/nucleic backbone heuristic: standard residue, not solvent/het.
      return !a.hetatm && !SOLVENT_RESN.has(a.resn.toUpperCase());
    case 'backbone':
      return isPolymer(a) && BACKBONE_NAMES.has(a.name.toUpperCase());
    case 'sidechain':
      return isPolymer(a) && !BACKBONE_NAMES.has(a.name.toUpperCase());
    case 'visible':
      // Any representation bit set (`cmd`'s per-atom visibility).
      return a.visRep !== 0;
    case 'present':
      // Atoms with coordinates present; every loaded atom qualifies here.
      return true;
    case 'donor':
      return DONOR_ELEMENTS.has(a.elem);
    case 'acceptor':
      return ACCEPTOR_ELEMENTS.has(a.elem);
    case 'metals':
      return METAL_ELEMENTS.has(a.elem);
    case 'masked':
      // Atoms flagged unpickable by `mask` (cleared by `unmask`).
      return a.masked === true;
    case 'protected':
      // Atoms flagged immobile-during-editing by `protect` (cleared by `deprotect`).
      return a.protected === true;
    case 'fixed':
      // `fixed`/`fxd.` — atoms carrying the fix flag (flag bit 3), set by
      // `flag fix, <sele>, set`. Equivalent to `flag 3`.
      return ((a.flags ?? 0) & (1 << ATOM_FLAG_FIX)) !== 0;
    case 'restrained':
      // `restrained`/`rst.` — atoms carrying the restrain flag (flag bit 2), set
      // by `flag restrain, <sele>, set`. Equivalent to `flag 2`.
      return ((a.flags ?? 0) & (1 << ATOM_FLAG_RESTRAIN)) !== 0;
    case 'enabled':
    case 'bonded':
    case 'guide':
    case 'organic':
    case 'inorganic':
    case 'polymerProtein':
    case 'polymerNucleic':
      // Handled in evalSet (need object/residue/bond context); unreachable here.
      return false;
  }
}

/**
 * `guide` — the cartoon/ribbon trace atoms: exactly one guide atom per polymer
 * residue. Mirrors PyMOL's guide-atom assignment (cAtomFlag_guide, Selector.cpp):
 * within each polymer residue pick the first carbon named `CA` (protein
 * C-alpha), else `C4'`/`C4*` (nucleic-acid guide), else `C3'`/`C3*` as a nucleic
 * fallback for residues lacking C4' (e.g. PNA).
 */
function guideAtoms(env: EvalEnv): Set<number> {
  const out = new Set<number>();
  for (const idxs of env.byRes.values()) {
    // Residue is polymer when its atoms are polymer (non-het, non-solvent).
    if (!isPolymer(env.universe[idxs[0]!]!.atom)) continue;
    let primary = -1;
    let fallback = -1;
    for (const j of idxs) {
      const at = env.universe[j]!.atom;
      if (at.elem.toUpperCase() !== 'C') continue;
      const name = at.name.toUpperCase();
      if (name === 'CA' || name === "C4'" || name === 'C4*') {
        primary = j;
        break; // first CA / C4' wins, matching PyMOL's atom-order scan
      }
      if (fallback < 0 && (name === "C3'" || name === 'C3*')) fallback = j;
    }
    const guide = primary >= 0 ? primary : fallback;
    if (guide >= 0) out.add(guide);
  }
  return out;
}

function isPolymer(a: AtomInfo): boolean {
  return !a.hetatm && !SOLVENT_RESN.has(a.resn.toUpperCase());
}

/** PyMOL's `AtomInfoKnownNucleicResName`: a PNA name, or (after an optional
 *  leading `D` for deoxyribonucleotides) a single base letter A/C/G/I/T/U. */
function isKnownNucleicResName(resn: string): boolean {
  if (PNA_RESN.has(resn)) return true;
  const r = resn[0] === 'D' ? resn.slice(1) : resn;
  return r.length === 1 && 'ACGITU'.includes(r);
}

/**
 * Classify a residue as polymer `protein`/`nucleic` (or `null` when neither),
 * mirroring `SelectorClassifyAtoms` (`layer3/Selector.cpp`): first by residue
 * name against the protein/nucleic tables, then — for unrecognised residues —
 * by canonical backbone-atom perception (Cα/N/C/O + peptide bond for protein;
 * O3'/C3'/C4'/C5'/O5' + phosphodiester/phosphate bond for nucleic).
 */
function classifyPolymerResidue(idxs: number[], env: EvalEnv): 'protein' | 'nucleic' | null {
  const rep = env.universe[idxs[0]!]!.atom;
  const resn = rep.resn.toUpperCase();
  const het = rep.hetatm;
  if (!het && PROTEIN_RESN.has(resn)) return 'protein';
  if ((!het || PNA_RESN.has(resn)) && isKnownNucleicResName(resn)) return 'nucleic';
  if (SOLVENT_RESN.has(resn)) return null;

  // Unrecognised residue: perceive polymer class from its atoms + bonds.
  const bondedToName = (uidx: number, target: string): boolean => {
    const tt = target.toUpperCase();
    for (const j of env.adj[uidx] ?? []) {
      if (env.universe[j]!.atom.name.toUpperCase() === tt) return true;
    }
    return false;
  };
  let ca = false, n = false, c = false, o = false;
  let c3 = false, c4 = false, c5 = false, o3 = false, o5 = false;
  let cnBond = false, ncBond = false, o3Bond = false, pBond = false;
  for (const uidx of idxs) {
    const at = env.universe[uidx]!.atom;
    const el = at.elem.toUpperCase();
    const name = at.name.toUpperCase();
    if (el === 'C') {
      if (name === 'C') { c = true; if (bondedToName(uidx, 'N')) cnBond = true; }
      else if (name === 'CA') ca = true;
      else if (name === "C3'" || name === 'C3*') c3 = true;
      else if (name === "C4'" || name === 'C4*') c4 = true;
      else if (name === "C5'" || name === 'C5*') c5 = true;
    } else if (el === 'N') {
      if (name === 'N') { n = true; if (bondedToName(uidx, 'C')) ncBond = true; }
    } else if (el === 'O') {
      if (name === 'O') o = true;
      else if (name === "O3'" || name === 'O3*') { o3 = true; if (bondedToName(uidx, 'P')) o3Bond = true; }
      else if (name === "O5'" || name === 'O5*') o5 = true;
    } else if (el === 'P') {
      if (name === 'P' && (bondedToName(uidx, 'O3*') || bondedToName(uidx, "O3'"))) pBond = true;
    }
  }
  if (ca && n && c && o && (cnBond || ncBond)) return 'protein';
  if (o3 && c3 && c4 && c5 && o5 && (o3Bond || pBond)) return 'nucleic';
  return null;
}

/** `polymer.protein` / `polymer.nucleic` — polymer atoms whose residue
 *  classifies as protein / nucleic (see {@link classifyPolymerResidue}). */
function polymerClassAtoms(kw: 'polymerProtein' | 'polymerNucleic', env: EvalEnv): Set<number> {
  const want = kw === 'polymerProtein' ? 'protein' : 'nucleic';
  const out = new Set<number>();
  for (const idxs of env.byRes.values()) {
    if (classifyPolymerResidue(idxs, env) === want) for (const j of idxs) out.add(j);
  }
  return out;
}

/**
 * `organic` / `inorganic` — the two non-polymer, non-solvent chemical classes
 * (PyMOL's cAtomFlag_organic / cAtomFlag_inorganic). Classification is per
 * residue and applies to every atom of that residue, mirroring
 * `SelectorClassifyAtoms`: among residues that are neither polymer nor solvent,
 * a residue containing a carbon atom is `organic` (small-molecule ligand); one
 * with no carbon that is not all-hydrogen is `inorganic` (metal ion, etc.).
 */
function orgInoAtoms(kw: 'organic' | 'inorganic', env: EvalEnv): Set<number> {
  const out = new Set<number>();
  for (const idxs of env.byRes.values()) {
    const first = env.universe[idxs[0]!]!.atom;
    if (isPolymer(first) || SOLVENT_RESN.has(first.resn.toUpperCase())) continue;
    let hasCarbon = false;
    let allHydrogen = true;
    for (const j of idxs) {
      const el = env.universe[j]!.atom.elem.toUpperCase();
      if (el === 'C') hasCarbon = true;
      if (el !== 'H' && el !== 'D') allHydrogen = false;
    }
    const match = kw === 'organic' ? hasCarbon : !hasCarbon && !allHydrogen;
    if (match) for (const j of idxs) out.add(j);
  }
  return out;
}

/** Identity tuple used by the `in` operator: the atom's resi/chain/name/resn/segi
 *  (PyMOL compares resv+inscode — captured together by the `resi` text — plus
 *  chain, name, resn and segi), compared case-insensitively. */
function identityKey(ua: UniverseAtom): string {
  const a = ua.atom;
  return [a.resi, a.chain, a.name, a.resn, a.segi]
    .map((s) => s.toLowerCase())
    .join('');
}

/** Identity tuple used by the `like` operator: name + resv + inscode only
 *  (PyMOL's SELE_LIK2), IGNORING chain/segi/resn. The `resi` text carries
 *  resv+inscode together; compared case-insensitively. */
function likeKey(ua: UniverseAtom): string {
  const a = ua.atom;
  return `${a.name.toLowerCase()}|${a.resi.toLowerCase()}`;
}

/** Everything the set evaluator needs precomputed once per selection. */
interface EvalEnv {
  universe: UniverseAtom[];
  ctx: SelectorContext;
  /** [x,y,z] per universe atom (for `within`). */
  coords: Array<[number, number, number]>;
  /** residue key -> universe indices (for `byres`). */
  byRes: Map<string, number[]>;
  /** object|chain key -> universe indices (for `bychain`). */
  byChain: Map<string, number[]>;
  /** object|segi key -> universe indices (for `bysegment`). */
  bySegment: Map<string, number[]>;
  /** objName -> universe indices (for `byobject`). */
  byObject: Map<string, number[]>;
  /** connected-component id per universe atom (for `bymol`). */
  component: Int32Array;
  /** component id -> universe indices. */
  byComponent: Map<number, number[]>;
  /** bonded neighbours (universe indices) per universe atom. */
  adj: number[][];
  /** VDW radius per universe atom (for `gap`). */
  vdw: number[];
  /** Names of enabled objects (for `enabled`). */
  enabled: Set<string>;
}

/** Atoms within `dist` (centre-to-centre) of any atom in `set`. */
function withinSet(dist: number, set: Set<number>, env: EvalEnv): Set<number> {
  const d2 = dist * dist;
  const out = new Set<number>();
  const n = env.universe.length;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = env.coords[i]!;
    for (const j of set) {
      const [jx, jy, jz] = env.coords[j]!;
      const dx = x - jx, dy = y - jy, dz = z - jz;
      if (dx * dx + dy * dy + dz * dz <= d2) {
        out.add(i);
        break;
      }
    }
  }
  return out;
}

/** Union of `by`-group members (residue/chain/object/component) touched by `a`. */
function expandGroups(a: Set<number>, keyOf: (i: number) => number[]): Set<number> {
  const s = new Set<number>();
  for (const i of a) for (const j of keyOf(i)) s.add(j);
  return s;
}

/** PyMOL's ring-finder cap: rings up to 7 members (SelectorRingFinder). */
const MAX_RING_SIZE = 7;

/**
 * `byring` — every atom on a ring (size ≤ 7) that contains a seed atom. Mirrors
 * PyMOL's SelectorRingFinder: enumerate the smallest cycle through each bond,
 * then keep the rings touched by the operand.
 */
function ringAtoms(seeds: Set<number>, env: EvalEnv): Set<number> {
  const adj = env.adj;
  const rings: number[][] = [];
  const seenKey = new Set<string>();
  for (let u = 0; u < adj.length; u++) {
    for (const v of adj[u] ?? []) {
      if (v <= u) continue; // each edge once
      const path = shortestCyclePath(u, v, adj, MAX_RING_SIZE);
      if (!path) continue;
      const key = [...path].sort((a, b) => a - b).join(',');
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      rings.push(path);
    }
  }
  const out = new Set<number>();
  for (const ring of rings) {
    if (ring.some((i) => seeds.has(i))) for (const i of ring) out.add(i);
  }
  return out;
}

/**
 * Shortest cycle through edge (u,v): a BFS from u to v that forbids the direct
 * u→v edge, so the returned node path closed by that edge is the smallest ring.
 * Bounded to `maxNodes` so only rings ≤ that size are found.
 */
function shortestCyclePath(
  u: number,
  v: number,
  adj: number[][],
  maxNodes: number,
): number[] | null {
  const prev = new Map<number, number>();
  const visited = new Set<number>([u]);
  let frontier = [u];
  let nodes = 1;
  while (frontier.length > 0 && nodes < maxNodes) {
    const next: number[] = [];
    for (const x of frontier) {
      for (const y of adj[x] ?? []) {
        if (x === u && y === v) continue; // forbid the direct edge
        if (visited.has(y)) continue;
        visited.add(y);
        prev.set(y, x);
        if (y === v) {
          const path = [v];
          let c = v;
          while (c !== u) {
            c = prev.get(c)!;
            path.push(c);
          }
          return path.reverse();
        }
        next.push(y);
      }
    }
    frontier = next;
    nodes++;
  }
  return null;
}

/** Three-letter → one-letter residue codes for `pepseq` matching. */
const AA3TO1: Readonly<Record<string, string>> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E',
  GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F',
  PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  MSE: 'M', SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z',
};

/**
 * `pepseq <motif>` — select every atom of each residue in a consecutive stretch
 * whose one-letter codes match `motif`. Residues are walked per object in
 * load (table) order, matching PyMOL's SELE_PEPs.
 */
function pepseqAtoms(pattern: string, env: EvalEnv): Set<number> {
  const out = new Set<number>();
  const pat = pattern.toUpperCase();
  if (pat === '') return out;
  const perObj = new Map<string, string[]>(); // objName → ordered resKeys
  const seen = new Set<string>();
  for (const ua of env.universe) {
    const rk = resKey(ua);
    if (seen.has(rk)) continue;
    seen.add(rk);
    let arr = perObj.get(ua.objName);
    if (!arr) perObj.set(ua.objName, (arr = []));
    arr.push(rk);
  }
  for (const resKeys of perObj.values()) {
    const seq = resKeys
      .map((rk) => {
        const idxs = env.byRes.get(rk) ?? [];
        const resn = idxs.length ? env.universe[idxs[0]!]!.atom.resn : '';
        return AA3TO1[resn.toUpperCase()] ?? 'X';
      })
      .join('');
    for (let start = 0; start + pat.length <= seq.length; start++) {
      if (!seq.startsWith(pat, start)) continue;
      for (let k = start; k < start + pat.length; k++) {
        for (const j of env.byRes.get(resKeys[k]!) ?? []) out.add(j);
      }
    }
  }
  return out;
}

function resKey(ua: UniverseAtom): string {
  return `${ua.objName}|${ua.atom.chain}|${ua.atom.segi}|${ua.atom.resi}`;
}

function chainKey(ua: UniverseAtom): string {
  return `${ua.objName}|${ua.atom.chain}`;
}

function segKey(ua: UniverseAtom): string {
  return `${ua.objName}|${ua.atom.segi}`;
}

/** Evaluate a node to the SET of matching universe indices. */
function evalSet(node: Node, env: EvalEnv): Set<number> {
  const n = env.universe.length;
  const filter = (pred: (ua: UniverseAtom) => boolean): Set<number> => {
    const s = new Set<number>();
    for (let i = 0; i < n; i++) if (pred(env.universe[i]!)) s.add(i);
    return s;
  };
  switch (node.t) {
    case 'all':
      return filter(() => true);
    case 'none':
      return new Set();
    case 'prop':
      return filter((ua) => matchProp(node, ua));
    case 'cmp': {
      // `x`/`y`/`z` compare the atom's Cartesian coordinate (from env.coords);
      // all other numeric fields read straight off the AtomInfo record.
      if (node.field === 'x' || node.field === 'y' || node.field === 'z') {
        const axis = node.field === 'x' ? 0 : node.field === 'y' ? 1 : 2;
        const s = new Set<number>();
        for (let i = 0; i < n; i++) {
          if (compareOp(env.coords[i]![axis]!, node.op, node.value)) s.add(i);
        }
        return s;
      }
      return filter((ua) => matchCmp(node, ua.atom));
    }
    case 'propcmp':
      // Only atoms carrying the named property qualify (PyMOL skips atoms with
      // no prop_id); the value is read as a float, matching PropertyGetAsFloat.
      return filter((ua) => {
        const raw = ua.atom.properties?.[node.name];
        if (raw === undefined) return false;
        const lhs = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
        return Number.isFinite(lhs) && compareOp(lhs, node.op, node.value);
      });
    case 'stateSel': {
      // `state N` (SELE_STAs): an atom matches when its object owns a coordset
      // for the 1-based state N (present in that state). engine-ts coordsets are
      // dense, so presence reduces to `N <= nstate`. `-1` = current state.
      const st = node.state;
      const nstateByObj = new Map<string, number>();
      for (const o of env.ctx.objects()) nstateByObj.set(o.name, o.nstate);
      return filter((ua) => {
        const ns = nstateByObj.get(ua.objName) ?? 0;
        if (st === -1) return ns >= 1; // current state
        return st >= 1 && st <= ns;
      });
    }
    case 'keyword': {
      const kw = node.kw;
      if (kw === 'enabled') return filter((ua) => env.enabled.has(ua.objName));
      if (kw === 'bonded') {
        const s = new Set<number>();
        for (let i = 0; i < n; i++) if ((env.adj[i]?.length ?? 0) > 0) s.add(i);
        return s;
      }
      if (kw === 'guide') return guideAtoms(env);
      if (kw === 'organic' || kw === 'inorganic') return orgInoAtoms(kw, env);
      if (kw === 'polymerProtein' || kw === 'polymerNucleic') return polymerClassAtoms(kw, env);
      return filter((ua) => matchKeyword(kw, ua));
    }
    case 'ref': {
      const sel = env.ctx.namedSelection(node.name);
      if (sel) return filter((ua) => sel.has(atomKey(ua.objName, ua.atom)));
      // A group name used as a selection spans all atoms of its member objects.
      const members = env.ctx.groupMembers?.(node.name);
      if (members) return filter((ua) => members.has(ua.objName));
      // Object-name wildcard (`sym_*`, `prot?`): a bare reference containing a
      // `*`/`?` glob matches every object whose name fits the pattern, as in
      // PyMOL. Without a glob it stays an exact object-name match.
      if (node.name.includes('*') || node.name.includes('?')) {
        const re = globToRegExp(node.name);
        return filter((ua) => re.test(ua.objName));
      }
      return filter((ua) => ua.objName === node.name);
    }
    case 'not': {
      const a = evalSet(node.a, env);
      const s = new Set<number>();
      for (let i = 0; i < n; i++) if (!a.has(i)) s.add(i);
      return s;
    }
    case 'and': {
      const a = evalSet(node.a, env);
      const b = evalSet(node.b, env);
      const s = new Set<number>();
      for (const i of a) if (b.has(i)) s.add(i);
      return s;
    }
    case 'or': {
      const s = evalSet(node.a, env);
      for (const i of evalSet(node.b, env)) s.add(i);
      return s;
    }
    case 'in': {
      // Keep atoms of A whose identity (resi/chain/name/resn/segi) also appears
      // on some atom of B — a cross-object atom-by-atom identity match (PyMOL's
      // SELE_IN_2), comparing the identifier fields, never coordinates.
      const a = evalSet(node.a, env);
      const b = evalSet(node.b, env);
      const bKeys = new Set<string>();
      for (const j of b) bKeys.add(identityKey(env.universe[j]!));
      const s = new Set<number>();
      for (const i of a) if (bKeys.has(identityKey(env.universe[i]!))) s.add(i);
      return s;
    }
    case 'like': {
      // Keep atoms of A whose name+resv+inscode identity also appears on some
      // atom of B — like `in`, but ignoring chain/segi/resn (PyMOL's SELE_LIK2).
      const a = evalSet(node.a, env);
      const b = evalSet(node.b, env);
      const bKeys = new Set<string>();
      for (const j of b) bKeys.add(likeKey(env.universe[j]!));
      const s = new Set<number>();
      for (const i of a) if (bKeys.has(likeKey(env.universe[i]!))) s.add(i);
      return s;
    }
    case 'byres': {
      const a = evalSet(node.a, env);
      const s = new Set<number>();
      for (const i of a) for (const j of env.byRes.get(resKey(env.universe[i]!)) ?? []) s.add(j);
      return s;
    }
    case 'bycalpha': {
      // Grow to the whole residue, then keep only its C-alpha (a carbon named CA).
      const a = evalSet(node.a, env);
      const s = new Set<number>();
      for (const i of a)
        for (const j of env.byRes.get(resKey(env.universe[i]!)) ?? []) {
          const at = env.universe[j]!.atom;
          if (at.name.toUpperCase() === 'CA' && at.elem.toUpperCase() === 'C') s.add(j);
        }
      return s;
    }
    case 'byring':
      return ringAtoms(evalSet(node.a, env), env);
    case 'pepseq':
      return pepseqAtoms(node.seq, env);
    case 'first': {
      let min = Infinity;
      for (const i of evalSet(node.a, env)) if (i < min) min = i;
      return min === Infinity ? new Set() : new Set([min]);
    }
    case 'last': {
      let max = -1;
      for (const i of evalSet(node.a, env)) if (i > max) max = i;
      return max < 0 ? new Set() : new Set([max]);
    }
    case 'bymol':
      return expandGroups(evalSet(node.a, env), (i) => env.byComponent.get(env.component[i]!) ?? []);
    case 'byobject':
      return expandGroups(evalSet(node.a, env), (i) => env.byObject.get(env.universe[i]!.objName) ?? []);
    case 'bychain':
      return expandGroups(evalSet(node.a, env), (i) => env.byChain.get(chainKey(env.universe[i]!)) ?? []);
    case 'bysegment':
      return expandGroups(evalSet(node.a, env), (i) => env.bySegment.get(segKey(env.universe[i]!)) ?? []);
    case 'neighbor': {
      // Atoms directly bonded to the selection. `neighbor`/`nbr.` excludes the
      // selection itself; `bound_to`/`bto.` (includeSelf) keeps members of the
      // selection that are bonded to another member (e.g. disulfide SG..SG).
      const a = evalSet(node.a, env);
      const s = new Set<number>();
      for (const i of a) for (const j of env.adj[i] ?? []) if (node.includeSelf || !a.has(j)) s.add(j);
      return s;
    }
    case 'within':
      return withinSet(node.dist, evalSet(node.a, env), env);
    case 'around': {
      // Within N of the selection, but NOT the selection itself.
      const a = evalSet(node.a, env);
      const w = withinSet(node.dist, a, env);
      for (const i of a) w.delete(i);
      return w;
    }
    case 'expand': {
      // The selection plus everything within N of it.
      const a = evalSet(node.a, env);
      const w = withinSet(node.dist, a, env);
      for (const i of a) w.add(i);
      return w;
    }
    case 'extend': {
      // The selection grown outward by N bonds (breadth-first over the bond
      // graph). Each round adds every atom bonded to a current member.
      const s = new Set<number>(evalSet(node.a, env));
      let frontier = [...s];
      for (let step = 0; step < node.dist; step++) {
        const next: number[] = [];
        for (const i of frontier) {
          for (const j of env.adj[i] ?? []) {
            if (!s.has(j)) {
              s.add(j);
              next.push(j);
            }
          }
        }
        if (next.length === 0) break;
        frontier = next;
      }
      return s;
    }
    case 'binwithin': {
      // Atoms in A that are within N of B.
      const a = evalSet(node.a, env);
      const w = withinSet(node.dist, evalSet(node.b, env), env);
      const s = new Set<number>();
      for (const i of a) if (w.has(i)) s.add(i);
      return s;
    }
    case 'nearto': {
      // Atoms in A within N of B, excluding B itself.
      const a = evalSet(node.a, env);
      const b = evalSet(node.b, env);
      const w = withinSet(node.dist, b, env);
      const s = new Set<number>();
      for (const i of a) if (w.has(i) && !b.has(i)) s.add(i);
      return s;
    }
    case 'beyond': {
      // Atoms in A farther than N from every atom of B.
      const a = evalSet(node.a, env);
      const w = withinSet(node.dist, evalSet(node.b, env), env);
      const s = new Set<number>();
      for (const i of a) if (!w.has(i)) s.add(i);
      return s;
    }
    case 'gap': {
      // Atoms not in A whose VDW surface clears every atom of A by >= N.
      const a = evalSet(node.a, env);
      const s = new Set<number>();
      const gap2 = node.dist;
      for (let i = 0; i < n; i++) {
        if (a.has(i)) continue;
        const [x, y, z] = env.coords[i]!;
        let minClear = Infinity;
        for (const j of a) {
          const [jx, jy, jz] = env.coords[j]!;
          const dx = x - jx, dy = y - jy, dz = z - jz;
          const surf = Math.sqrt(dx * dx + dy * dy + dz * dz) - env.vdw[i]! - env.vdw[j]!;
          if (surf < minClear) minClear = surf;
        }
        if (minClear >= gap2) s.add(i);
      }
      return s;
    }
  }
}

/** Build the flat atom universe from the executive's objects, in load order. */
export function buildUniverse(objects: ObjectMolecule[]): UniverseAtom[] {
  const out: UniverseAtom[] = [];
  for (const obj of objects) {
    for (let i = 0; i < obj.atoms.length; i++) {
      out.push({ objName: obj.name, index: i, atom: obj.atoms[i]! });
    }
  }
  return out;
}

/**
 * Evaluate a selection string against the universe, returning the matching
 * {@link UniverseAtom}s in universe order. Throws {@link SelectionError} on a
 * malformed or out-of-scope expression.
 */
export function selectAtoms(expr: string, ctx: SelectorContext): UniverseAtom[] {
  const ast = new Parser(tokenize(expr)).parse();
  const objects = ctx.objects();
  const universe = buildUniverse(objects);
  const n = universe.length;
  const molByName = new Map(objects.map((o) => [o.name, o]));
  const coords = universe.map((ua) => molByName.get(ua.objName)!.coord(ua.index, 1));
  const vdw = universe.map((ua) => molByName.get(ua.objName)!.vdw(ua.index));

  const push = (m: Map<string, number[]>, k: string, i: number): void => {
    const a = m.get(k);
    if (a) a.push(i);
    else m.set(k, [i]);
  };
  const byRes = new Map<string, number[]>();
  const byChain = new Map<string, number[]>();
  const bySegment = new Map<string, number[]>();
  const byObject = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    push(byRes, resKey(universe[i]!), i);
    push(byChain, chainKey(universe[i]!), i);
    push(bySegment, segKey(universe[i]!), i);
    push(byObject, universe[i]!.objName, i);
  }

  // Local (per-object) atom index -> universe index: objects are concatenated in
  // load order, so each object owns a contiguous base offset.
  const objBase = new Map<string, number>();
  {
    let off = 0;
    for (const o of objects) {
      objBase.set(o.name, off);
      off += o.atoms.length;
    }
  }

  // Bond adjacency and covalent connected components, both across the universe.
  const adj: number[][] = Array.from({ length: n }, () => []);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const o of objects) {
    const base = objBase.get(o.name)!;
    for (const [i, j] of o.bonds) {
      const ui = base + i, uj = base + j;
      adj[ui]!.push(uj);
      adj[uj]!.push(ui);
      const ri = find(ui), rj = find(uj);
      if (ri !== rj) parent[ri] = rj;
    }
  }
  const component = new Int32Array(n);
  const byComponent = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    component[i] = r;
    const a = byComponent.get(r);
    if (a) a.push(i);
    else byComponent.set(r, [i]);
  }

  const enabled = new Set<string>();
  for (const o of objects) if (o.enabled) enabled.add(o.name);

  const set = evalSet(ast, {
    universe, ctx, coords, vdw, byRes, byChain, bySegment, byObject, component, byComponent, adj, enabled,
  });
  return [...set].sort((x, y) => x - y).map((i) => universe[i]!);
}

/** `cmd.count_atoms(selection)`. */
export function countAtoms(expr: string, ctx: SelectorContext): number {
  return selectAtoms(expr, ctx).length;
}
