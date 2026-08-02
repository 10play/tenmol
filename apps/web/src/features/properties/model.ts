/**
 * The properties inspector's tree shape and value formatting —
 * `packages/engine/modules/pmg_qt/properties_dialog.py:69-117` and `:11-16`.
 *
 * Pure: no React, no bridge. `service.ts` fills it in, `PropertiesPanel.tsx`
 * draws it, and `model.test.ts` proves the formatting rules.
 */

import {
  ASTATE_BUILTIN_KEYS,
  ATOM_BUILTIN_KEYS,
  ATOM_IDENTIFIER_KEYS,
  PROPERTY_READONLY_KEYS,
  type PropertyBranch,
  type PropertyRow,
} from '@tenmol/protocol/topics/dialogs';

export interface PropertyGroup {
  /** Stable id used as the React key and by the tests. */
  id: string;
  label: string;
  /** Only leaf groups have a branch; category rows are pure containers. */
  branch: PropertyBranch;
  rows: PropertyRow[];
  /** Rendered instead of rows when the data cannot be fetched at all. */
  note?: string;
}

export interface PropertySection {
  id: string;
  label: string;
  groups: PropertyGroup[];
  hidden?: boolean;
}

export const READONLY = new Set<string>(PROPERTY_READONLY_KEYS);

/**
 * `strfunctions` (`properties_dialog.py:11-16`).
 *
 *   color  hex when >= 0x40000000, decimal otherwise
 *   reps   binary
 *   flags  binary
 *
 * Python's `hex()`/`bin()` produce `0x…` / `0b…` and are what `int(x, 0)` in the
 * edit path reads back, so the prefixes are not decoration.
 */
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (key === 'color' && typeof value === 'number') {
    return value >= 0x40000000 ? '0x' + (value >>> 0).toString(16) : String(value);
  }
  if ((key === 'reps' || key === 'flags') && typeof value === 'number') {
    return '0b' + (value >>> 0).toString(2);
  }
  if (Array.isArray(value)) return `[${value.map((v) => formatValue('', v)).join(', ')}]`;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

/**
 * What TYPE the old value was. Qt reads the live Python object; the tree only
 * ever holds a string, and JavaScript cannot tell `1.0` from `1` — so the kind
 * is inferred from the RENDERED text, where the decimal point survives.
 */
export type OldValueKind = 'int' | 'float' | 'str' | 'literal';

/**
 * `int` / `float` / `str` / `literal`, from the string the tree is showing.
 *
 * `literal` means "upstream would have called `safe_eval`" — a tuple, a list or
 * a bool (`properties_dialog.py:203-204`).
 */
export function inferOldKind(text: string): OldValueKind {
  const s = text.trim();
  if (s === 'True' || s === 'False') return 'literal';
  if (s.startsWith('[') || s.startsWith('(')) return 'literal';
  if (parseIntBase0(s) !== null) return 'int';
  if (s !== '' && Number.isFinite(Number(s))) return 'float';
  return 'str';
}

/**
 * `get_new_value` (`properties_dialog.py:202-213`), moved to the client because
 * the closure it lives in is passed to `cmd.alter` through `space=` and a
 * closure cannot cross a WebSocket.
 *
 * The rules, in upstream's order:
 *   tuple / list / bool  -> `safe_eval(new)`  (the raw text; `alter`'s
 *                           expression is already Python, so it needs no
 *                           second evaluation)
 *   int                  -> `int(new, 0)`  so `0x1f` and `0b1010` work
 *   anything else        -> `type(old)(new)`
 *   ValueError           -> the raw string, and let PyMOL decide
 *
 * Returns a **Python literal** ready to be pasted into an `alter` expression.
 */
export function coerceToPythonLiteral(
  kind: OldValueKind,
  text: string,
): { literal: string; needsSafeEval: boolean } {
  if (kind === 'literal') return { literal: text, needsSafeEval: true };
  if (kind === 'int') {
    const parsed = parseIntBase0(text);
    if (parsed !== null) return { literal: String(parsed), needsSafeEval: false };
    return { literal: pythonString(text), needsSafeEval: false };
  }
  if (kind === 'float') {
    const parsed = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(parsed)) {
      // Keep the text so `2.50` stays `2.50` rather than becoming `2.5`.
      return { literal: text.trim(), needsSafeEval: false };
    }
    return { literal: pythonString(text), needsSafeEval: false };
  }
  return { literal: pythonString(text), needsSafeEval: false };
}

/** Python's `int(x, 0)`: decimal, `0x`, `0o`, `0b`, with an optional sign. */
export function parseIntBase0(text: string): number | null {
  const s = text.trim();
  const m = /^([+-]?)0([xXoObB])([0-9a-fA-F_]+)$/.exec(s);
  if (m) {
    const radix = { x: 16, o: 8, b: 2 }[m[2]!.toLowerCase() as 'x' | 'o' | 'b'];
    const value = parseInt(m[3]!.replace(/_/g, ''), radix);
    if (Number.isNaN(value)) return null;
    return m[1] === '-' ? -value : value;
  }
  if (!/^[+-]?\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

/** A Python string literal — single-quoted, backslash-escaped. */
export function pythonString(text: string): string {
  return "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

/** The fixed skeleton, before any value is known. */
export function emptyTree(): PropertySection[] {
  return [
    {
      id: 'object',
      label: 'Object-Level',
      groups: [
        { id: 'object-ttt', label: 'TTT Matrix', branch: 'object-ttt', rows: [] },
        { id: 'object-settings', label: 'Settings', branch: 'object-settings', rows: [] },
      ],
    },
    {
      id: 'ostate',
      label: 'Object-State-Level',
      groups: [
        { id: 'ostate-title', label: 'Title', branch: 'ostate-title', rows: [] },
        { id: 'ostate-matrix', label: 'State Matrix', branch: 'ostate-matrix', rows: [] },
        { id: 'ostate-settings', label: 'Settings', branch: 'ostate-settings', rows: [] },
      ],
    },
    {
      id: 'atom',
      label: 'Atom-Level',
      groups: [
        { id: 'atom-identifiers', label: 'Identifiers', branch: 'atom-identifier', rows: [] },
        {
          id: 'atom-builtins',
          label: 'Properties (built-in)',
          branch: 'atom-builtin',
          rows: [],
        },
        {
          id: 'atom-properties',
          label: 'Properties (custom)',
          branch: 'atom-property',
          rows: [],
        },
        { id: 'atom-settings', label: 'Settings', branch: 'atom-settings', rows: [] },
      ],
    },
    {
      id: 'astate',
      label: 'Atom-State-Level',
      groups: [
        {
          id: 'astate-builtins',
          label: 'Properties (built-in)',
          branch: 'astate-builtin',
          rows: [],
        },
        { id: 'astate-settings', label: 'Settings', branch: 'astate-settings', rows: [] },
      ],
    },
  ];
}

/** The three fixed key lists, re-exported so the panel does not import protocol twice. */
export const KEYS = {
  identifiers: ATOM_IDENTIFIER_KEYS,
  atomBuiltins: ATOM_BUILTIN_KEYS,
  astateBuiltins: ASTATE_BUILTIN_KEYS,
} as const;

/**
 * Three-letter residue name -> one letter.
 *
 * Qt reads `oneletter` straight out of `cmd.iterate`'s namespace; there is no
 * `cmd` call that returns it for a single atom, so it is DERIVED here from the
 * standard table and marked read-only exactly as upstream marks it
 * (`properties_dialog.py:117`). Unknown residues answer `?`, which is what
 * PyMOL itself does.
 */
const ONE_LETTER: Record<string, string> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
  ASX: 'B',
  GLX: 'Z',
  MSE: 'M',
  SEC: 'U',
  PYL: 'O',
  UNK: 'X',
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'U',
  DA: 'A',
  DC: 'C',
  DG: 'G',
  DT: 'T',
  HSD: 'H',
  HSE: 'H',
  HSP: 'H',
  HID: 'H',
  HIE: 'H',
  HIP: 'H',
  CYX: 'C',
  CYM: 'C',
  ASH: 'D',
  GLH: 'E',
  LYN: 'K',
};

export function oneLetter(resn: string): string {
  return ONE_LETTER[resn.toUpperCase()] ?? '?';
}
