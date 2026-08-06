/**
 * The differential corpus: command scripts run identically through BOTH engines
 * (the TypeScript port and real PyMOL over the bridge), plus the exact set of
 * observables to compare for each. Every op is expressed with the SAME public
 * PyMOL API both backends implement, so the two runs are apples-to-apples.
 *
 * The fixture structure is a two-chain di-peptide; the expected counts are
 * hand-derivable, which is what lets `fixtures/golden.json` be an authoritative
 * (not self-referential) ground truth.
 */

export interface FixtureAtom {
  serial: number;
  name: string;
  resn: string;
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  elem: string;
}

export const FIXTURE_ATOMS: FixtureAtom[] = [
  { serial: 1, name: 'N', resn: 'ALA', chain: 'A', resi: 1, x: 0.0, y: 0.0, z: 0.0, elem: 'N' },
  { serial: 2, name: 'CA', resn: 'ALA', chain: 'A', resi: 1, x: 1.458, y: 0.0, z: 0.0, elem: 'C' },
  { serial: 3, name: 'C', resn: 'ALA', chain: 'A', resi: 1, x: 2.0, y: 1.42, z: 0.0, elem: 'C' },
  { serial: 4, name: 'O', resn: 'ALA', chain: 'A', resi: 1, x: 1.25, y: 2.39, z: 0.0, elem: 'O' },
  { serial: 5, name: 'CB', resn: 'ALA', chain: 'A', resi: 1, x: 2.0, y: -0.77, z: 1.2, elem: 'C' },
  { serial: 6, name: 'N', resn: 'GLY', chain: 'B', resi: 2, x: 3.33, y: 1.5, z: 0.0, elem: 'N' },
  { serial: 7, name: 'CA', resn: 'GLY', chain: 'B', resi: 2, x: 4.0, y: 2.79, z: 0.0, elem: 'C' },
  { serial: 8, name: 'C', resn: 'GLY', chain: 'B', resi: 2, x: 5.5, y: 2.66, z: 0.0, elem: 'C' },
  { serial: 9, name: 'O', resn: 'GLY', chain: 'B', resi: 2, x: 6.1, y: 3.7, z: 0.0, elem: 'O' },
];

function pad(s: string, width: number, right = true): string {
  const t = s.slice(0, width);
  const fill = ' '.repeat(Math.max(0, width - t.length));
  return right ? fill + t : t + fill;
}

function formatAtom(a: FixtureAtom): string {
  const cols = ' '.repeat(80).split('');
  const put = (start: number, text: string): void => {
    for (let i = 0; i < text.length; i++) cols[start - 1 + i] = text[i]!;
  };
  put(1, 'ATOM  ');
  put(7, pad(String(a.serial), 5));
  put(13, a.name.length >= 4 ? a.name : ' ' + pad(a.name, 3, false));
  put(18, pad(a.resn, 3, false));
  put(22, a.chain);
  put(23, pad(String(a.resi), 4));
  put(31, pad(a.x.toFixed(3), 8));
  put(39, pad(a.y.toFixed(3), 8));
  put(47, pad(a.z.toFixed(3), 8));
  put(55, pad('1.00', 6));
  put(61, pad('0.00', 6));
  put(77, pad(a.elem, 2));
  return cols.join('').replace(/\s+$/, '');
}

export const SMALL_PDB: string = FIXTURE_ATOMS.map(formatAtom).join('\n') + '\nEND\n';

/** A view chosen so its 3x3 is a real rotation (30° about Y). */
export const KNOWN_VIEW: number[] = [
  0.8660254, 0, -0.5, 0, 1, 0, 0.5, 0, 0.8660254, 0, 0, -30, 1, 2, 3, 10, 50, -20,
];

export type Op = { call: [string, ...unknown[]] } | { do: string };

export interface Script {
  name: string;
  ops: Op[];
  /** count_atoms selectors to compare. */
  selectors: string[];
  /** Compare `get_names()`. */
  gateNames: boolean;
  /** Compare `get_view()` (only the indices in {@link GATED_VIEW_INDICES}). */
  gateView?: boolean;
  /** Colour names to compare as resolved RGB tuples (name -> index -> tuple). */
  gateColorTuples?: string[];
}

/**
 * View indices we assert. Rotation (0-8), both origins (9-14) and the fov/ortho
 * flag (17) round-trip exactly through set_view/get_view. The near/far clip
 * planes (15,16) are recomputed by the scene and are asserted by the live
 * differential job, not the fixtures.
 */
export const GATED_VIEW_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17];

const load: Op = { call: ['read_pdbstr', SMALL_PDB, 'm'] };

const COUNT_BATTERY = [
  'all',
  'name CA',
  'chain A',
  'chain B',
  'elem C',
  'elem N',
  'elem O',
  'resi 1',
  'name CB',
  'hetatm',
  // Expanded selection language — gated against real PyMOL too.
  'backbone',
  'sidechain',
  'byres name CA',
  'name C*',
  'first all',
  'within 100 of name N',
];

export const CORPUS: Script[] = [
  {
    name: 'load',
    ops: [load],
    selectors: COUNT_BATTERY,
    gateNames: true,
  },
  {
    name: 'color_chains',
    ops: [load, { call: ['color', 'cyan', 'chain A'] }, { call: ['color', 'red', 'chain B'] }],
    selectors: ['color cyan', 'color red', 'color green'],
    gateNames: true,
    gateColorTuples: ['cyan', 'red', 'green', 'yellow', 'orange'],
  },
  {
    name: 'as_spheres',
    ops: [load, { call: ['show_as', 'spheres', 'all'] }],
    selectors: ['rep spheres', 'rep lines'],
    gateNames: true,
  },
  {
    name: 'show_hide',
    ops: [
      load,
      { call: ['show_as', 'lines', 'all'] },
      { call: ['show', 'spheres', 'name CA'] },
      { call: ['hide', 'lines', 'chain B'] },
    ],
    selectors: ['rep spheres', 'rep lines'],
    gateNames: true,
  },
  {
    name: 'console_color',
    ops: [load, { do: 'color yellow, elem C' }],
    selectors: ['color yellow'],
    gateNames: true,
  },
  {
    name: 'view_roundtrip',
    ops: [load, { call: ['set_view', KNOWN_VIEW] }],
    selectors: ['all'],
    gateNames: true,
    gateView: true,
  },
];
