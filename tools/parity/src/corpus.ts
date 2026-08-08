/**
 * The differential corpus: command scripts run identically through BOTH engines
 * (the TypeScript port and real PyMOL over the bridge), plus the exact set of
 * observables to compare for each. Every op is expressed with the SAME public
 * PyMOL API both backends implement, so the two runs are apples-to-apples.
 *
 * The fixture structure is a two-chain di-peptide; the expected counts are
 * hand-derivable, which is what lets `fixtures/golden.json` be an authoritative
 * (not self-referential) ground truth.
 *
 * DERIVING THE GOLDENS — the fixture's 9 atoms (0-based idx / 1-based id):
 *   idx0 id1  N  ALA A 1     idx5 id6  N  GLY B 2
 *   idx1 id2  CA ALA A 1     idx6 id7  CA GLY B 2
 *   idx2 id3  C  ALA A 1     idx7 id8  C  GLY B 2
 *   idx3 id4  O  ALA A 1     idx8 id9  O  GLY B 2
 *   idx4 id5  CB ALA A 1
 * ALA (chain A, resi 1): N CA C O CB  — 5 atoms, elements N C C O C.
 * GLY (chain B, resi 2): N CA C O     — 4 atoms, elements N C C O.
 * Distance bonding (PyMOL connect): every atom is bonded (a cross-chain C-N
 * peptide bond links resi 1 -> resi 2), so `nonbonded`/`nb_spheres` geometry is
 * empty, but the rep BIT still lands on every selected atom (what `count_atoms`
 * and the `rep` selector observe).
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

/** A second view — a real rotation (90° about Z) with different translations. */
export const KNOWN_VIEW_2: number[] = [
  0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, -35, 1, 2, 3, 15, 55, -20,
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
  /** Setting names to compare as `get_setting_float` values. */
  gateSettings?: string[];
  /** Compare `get_chains()` (the sorted distinct chain identifiers). */
  gateChains?: boolean;
  /**
   * Compare per-atom coordinates of this selection (via `get_model`), keyed by
   * `chain/resi/name` and rounded — the observable an OBJECT transform
   * (`rotate`/`translate`) changes while leaving the camera untouched.
   */
  gateModel?: string;
}

/**
 * View indices we assert. Rotation (0-8), both origins (9-14) and the fov/ortho
 * flag (17) round-trip exactly through set_view/get_view. The near/far clip
 * planes (15,16) are recomputed by the scene and are asserted by the live
 * differential job, not the fixtures.
 */
export const GATED_VIEW_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17];

const load: Op = { call: ['read_pdbstr', SMALL_PDB, 'm'] };

/**
 * The full selection-language battery, exercised on the freshly loaded fixture.
 * Every value is hand-derived from the 9-atom topology above and is a public
 * PyMOL selector, so the live differential validates it against real PyMOL too.
 */
const COUNT_BATTERY = [
  // ---- trivial + property selectors ----
  'all',
  'none',
  'name CA',
  'name CB',
  'name C',
  'name N',
  'name O',
  'name CA+CB', // '+' grouping
  'name N+CA+C+O',
  'elem C',
  'elem N',
  'elem O',
  'chain A',
  'chain B',
  'resn ALA',
  'resn GLY',
  'resi 1',
  'resi 2',
  'resi 1-2', // range
  'resi 1+2', // enumerated
  'index 1',
  'index 1-5',
  'id 1',
  'id 6-9',
  // ---- keyword selectors ----
  'hetatm',
  'polymer',
  'solvent',
  'hydro',
  'backbone',
  'sidechain',
  // ---- wildcards ----
  'name C*',
  'name *A',
  // ---- set operators ----
  'byres name CA',
  'byres name CB',
  'first all',
  'last all',
  'first chain B',
  'last chain A',
  'chain A and name CA',
  'chain A or chain B',
  'not chain A',
  'not name CA',
  'name C* and chain A',
  // ---- within (distance, PyMOL's infix `s1 within X of s2`) ----
  'all within 100 of name N',
  'all within 2 of name CA',
  // ---- proximity set-operators ----
  'name N around 3', // atoms within 3 of an N, excluding the N's
  'name CA around 2',
  'chain A expand 2', // chain A plus atoms within 2
  'neighbor name CA', // atoms bonded to a CA
  'bound_to name CA',
  // ---- by-entity expansion ----
  'bymol chain A',
  'byobject name CA',
  'bychain resi 1',
  // ---- numeric property comparisons ----
  'b < 10',
  'b > 50',
  'q > 0.5',
  'q = 1',
  // ---- flag/keyword selectors ----
  'bonded',
  'visible',
  'present',
  'metals',
  'not backbone',
  // ---- slash notation /object/segi/chain/resi/name ----
  '/m//A/1/CA',
  '/m//A//',
  '/m////CA',
];

/** Every PyMOL named colour whose RGB the port gates (values from Color.cpp). */
const PALETTE = [
  'white', 'black', 'blue', 'green', 'red', 'cyan', 'yellow', 'magenta', 'orange',
  'marine', 'purple', 'pink', 'salmon', 'limon', 'slate', 'violet', 'teal',
  'forest', 'firebrick', 'deepblue', 'wheat',
];

export const CORPUS: Script[] = [
  {
    name: 'load',
    ops: [load],
    selectors: COUNT_BATTERY,
    gateNames: true,
    gateChains: true,
  },
  {
    name: 'color_chains',
    ops: [load, { call: ['color', 'cyan', 'chain A'] }, { call: ['color', 'red', 'chain B'] }],
    selectors: ['color cyan', 'color red', 'color green'],
    gateNames: true,
    gateColorTuples: ['cyan', 'red', 'green', 'yellow', 'orange'],
  },
  {
    // Recolour with overlap: chain A -> marine, then name CA -> salmon. The two
    // CA atoms (one in chain A) are overwritten, proving last-write-wins.
    name: 'color_override',
    ops: [load, { call: ['color', 'marine', 'chain A'] }, { call: ['color', 'salmon', 'name CA'] }],
    selectors: ['color marine', 'color salmon', 'color blue'],
    gateNames: true,
  },
  {
    // The whole palette, resolved name -> index -> RGB tuple. No atoms needed.
    name: 'palette',
    ops: [load],
    selectors: ['all'],
    gateNames: true,
    gateColorTuples: PALETTE,
  },
  {
    name: 'as_spheres',
    ops: [load, { call: ['show_as', 'spheres', 'all'] }],
    selectors: ['rep spheres', 'rep lines'],
    gateNames: true,
  },
  {
    name: 'as_sticks',
    ops: [load, { call: ['show_as', 'sticks', 'all'] }],
    selectors: ['rep sticks', 'rep lines'],
    gateNames: true,
  },
  {
    name: 'as_nonbonded',
    ops: [load, { call: ['show_as', 'nonbonded', 'all'] }],
    selectors: ['rep nonbonded', 'rep lines'],
    gateNames: true,
  },
  {
    name: 'as_nb_spheres',
    ops: [load, { call: ['show_as', 'nb_spheres', 'all'] }],
    selectors: ['rep nb_spheres', 'rep lines'],
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
    // `hide everything` clears every rep bit on the selection. Start from an
    // explicit `as lines` baseline so the assertion is about the hide logic,
    // not the loaded default rep (PyMOL's auto_show classification — cartoon +
    // sticks + nb_spheres — is a separate, unported gap; see engine-port-gaps).
    name: 'hide_everything',
    ops: [
      load,
      { call: ['show_as', 'lines', 'all'] },
      { call: ['show', 'spheres', 'all'] },
      { call: ['hide', 'everything', 'chain A'] },
    ],
    selectors: ['rep lines', 'rep spheres', 'rep sticks'],
    gateNames: true,
  },
  {
    // `as` collapses to a single rep; a later `show` adds a second onto a subset.
    name: 'as_then_show',
    ops: [load, { call: ['show_as', 'spheres', 'all'] }, { call: ['show', 'sticks', 'chain A'] }],
    selectors: ['rep spheres', 'rep sticks', 'rep lines'],
    gateNames: true,
  },
  {
    // The console command language (`cmd.do`): PyMOL verb form.
    name: 'console_color',
    ops: [load, { do: 'color yellow, elem C' }],
    selectors: ['color yellow'],
    gateNames: true,
  },
  {
    // The console JavaScript form. `cmd.color("magenta","name CA")` is ALSO valid
    // Python, so real PyMOL runs the identical line — the whole point of the port.
    name: 'console_js',
    ops: [load, { do: 'cmd.color("magenta","name CA")' }],
    selectors: ['color magenta', 'name CA and color magenta', 'chain B and color magenta'],
    gateNames: true,
  },
  {
    name: 'select_named',
    ops: [load, { call: ['select', 'sub', 'resi 1'] }],
    selectors: ['sub', 'sub and name CA', 'not sub'],
    gateNames: true,
  },
  {
    name: 'set_settings',
    ops: [
      load,
      { call: ['set', 'sphere_scale', 2.5] },
      { call: ['set', 'stick_radius', 0.5] },
      { call: ['set', 'nb_spheres_size', 0.75] },
      { call: ['set', 'field_of_view', 45] },
    ],
    selectors: ['all'],
    gateNames: true,
    gateSettings: ['sphere_scale', 'stick_radius', 'nb_spheres_size', 'field_of_view'],
  },
  {
    name: 'view_roundtrip',
    ops: [load, { call: ['set_view', KNOWN_VIEW] }],
    selectors: ['all'],
    gateNames: true,
    gateView: true,
  },
  {
    name: 'view_roundtrip2',
    ops: [load, { call: ['set_view', KNOWN_VIEW_2] }],
    selectors: ['all'],
    gateNames: true,
    gateView: true,
  },
  {
    // Colour by element (`util.cbag`): non-carbon atoms take their PyMOL element
    // colour, carbons take the cbag carbon colour. Gated by both the per-atom
    // `color <element>` counts AND the resolved element-colour RGBs.
    name: 'by_element',
    ops: [load, { do: 'util.cbag' }],
    selectors: ['color carbon', 'color nitrogen', 'color oxygen'],
    gateNames: true,
    gateColorTuples: ['carbon', 'nitrogen', 'oxygen'],
  },
  {
    // `set_color` defines a colour; `color` applies it. Gated by the atom count
    // AND the exact RGB the new name resolves to.
    name: 'set_color_custom',
    ops: [
      load,
      { call: ['set_color', 'myslate', [0.1, 0.2, 0.3]] },
      { call: ['color', 'myslate', 'name CA'] },
    ],
    selectors: ['color myslate'],
    gateNames: true,
    gateColorTuples: ['myslate'],
  },
  {
    // `center` pivots on the selection centroid (a camera change).
    name: 'center_ca',
    ops: [load, { call: ['set_view', KNOWN_VIEW] }, { call: ['center', 'name CA'] }],
    selectors: ['all'],
    gateNames: true,
    gateView: true,
  },
  {
    // `move z` translates the camera along its view axis.
    name: 'move_z',
    ops: [load, { call: ['set_view', KNOWN_VIEW] }, { call: ['move', 'z', 5] }],
    selectors: ['all'],
    gateNames: true,
    gateView: true,
  },
  {
    // `rotate` is an OBJECT transform: the atom coordinates move about the
    // origin while the camera (get_view) is unchanged. Gated on the coords.
    name: 'rotate_object',
    ops: [load, { call: ['set_view', KNOWN_VIEW] }, { call: ['rotate', 'y', 90] }],
    selectors: ['all'],
    gateNames: true,
    gateView: true, // must be UNCHANGED from KNOWN_VIEW
    gateModel: 'all',
  },
  {
    // `translate` likewise shifts the object's coordinates, not the camera.
    name: 'translate_object',
    ops: [load, { call: ['set_view', KNOWN_VIEW] }, { call: ['translate', [1, 2, 3]] }],
    selectors: ['all'],
    gateNames: true,
    gateView: true,
    gateModel: 'all',
  },
];
