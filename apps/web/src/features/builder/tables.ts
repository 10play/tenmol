/**
 * The Builder's button tables — a straight transcription of
 * `packages/engine/modules/pmg_qt/builder.py:1074-1112, 1132-1154, 1176-1224, 1226-1264`.
 *
 * There is a second copy of these tables on the backend
 * (`packages/bridge/tenmol_bridge/panels/builder.py`), on purpose: the panel must render
 * instantly, offline, without a round trip, and the backend must be able to
 * validate a request that did not come from this panel. Two copies drift, so
 * {@link diffTables} compares them at runtime and the panel SHOWS the drift
 * instead of quietly disagreeing with the engine.
 *
 * "The React layer never contains chemistry logic" (`docs/builder.md`
 * §10): every entry here is data, and the only thing the component does with it
 * is turn it into a button that dispatches `{kind, ...}`.
 */

import type { BuilderSettings, BuilderTables } from '@tenmol/protocol/topics/builder';

/** A button that replaces the picked atom's element. */
export interface ElementButton {
  label: string;
  tooltip: string;
  symbol: string;
  /** `packages/engine/layer2/AtomInfo.h:129-133`: 1 Single, 2 Linear, 3 Planar, 4 Tetrahedral. */
  geometry: number;
  valence: number;
  /** The text the ReplaceWizard puts in its prompt. */
  text: string;
}

/** A button that grows a fragment onto `pk1`. */
export interface FragmentButton {
  label: string;
  tooltip: string;
  fragment: string;
  /** The fragment atom id whose hydrogen is fused onto the pick. */
  hydrogen: number;
  /** `editor.attach_fragment`'s `anchor` — documented as unused (editor.py:62). */
  anchor: number;
  text: string;
}

/* --- Chemical tab, row 0 (builder.py:1075-1087) ------------------------- */

export const ELEMENTS: readonly ElementButton[] = [
  { label: 'H', tooltip: 'Hydrogen', symbol: 'H', geometry: 1, valence: 1, text: 'hydrogen' },
  { label: 'C', tooltip: 'Carbon', symbol: 'C', geometry: 4, valence: 4, text: 'carbon' },
  { label: 'N', tooltip: 'Nitrogen', symbol: 'N', geometry: 4, valence: 3, text: 'nitrogen' },
  { label: 'O', tooltip: 'Oxygen', symbol: 'O', geometry: 4, valence: 2, text: 'oxygen' },
  // builder.py:1079 — the wizard text upstream really is "Phosphorous".
  { label: 'P', tooltip: 'Phosphorus', symbol: 'P', geometry: 4, valence: 3, text: 'Phosphorous' },
  { label: 'S', tooltip: 'Sulfur', symbol: 'S', geometry: 2, valence: 2, text: 'sulfur' },
  { label: 'F', tooltip: 'Fluorine', symbol: 'F', geometry: 1, valence: 1, text: 'fluorine' },
  // builder.py:1082 — tooltip typo "Chlorrine" is upstream's; kept verbatim.
  { label: 'Cl', tooltip: 'Chlorrine', symbol: 'Cl', geometry: 1, valence: 1, text: 'chlorine' },
  { label: 'Br', tooltip: 'Bromine', symbol: 'Br', geometry: 1, valence: 1, text: 'bromine' },
  { label: 'I', tooltip: 'Iodine', symbol: 'I', geometry: 1, valence: 1, text: 'iodine' },
];

export const CHEM_ROW0_FRAGMENTS: readonly FragmentButton[] = [
  {
    label: '-CF3',
    tooltip: 'Trifluoromethane',
    fragment: 'trifluoromethane',
    hydrogen: 4,
    anchor: 0,
    text: 'trifluoro',
  },
  { label: '-OMe', tooltip: 'Methanol', fragment: 'methanol', hydrogen: 5, anchor: 0, text: 'methoxy' },
];

/* --- Chemical tab, row 1 (builder.py:1088-1099) ------------------------- */

export const FUNCTIONAL_GROUPS: readonly FragmentButton[] = [
  { label: 'CH4', tooltip: 'Methyl', fragment: 'methane', hydrogen: 1, anchor: 0, text: 'methyl' },
  { label: 'C=C', tooltip: 'Ethylene', fragment: 'ethylene', hydrogen: 4, anchor: 0, text: 'vinyl' },
  { label: 'C#C', tooltip: 'Acetylene', fragment: 'acetylene', hydrogen: 2, anchor: 0, text: 'alkynl' },
  { label: 'C#N', tooltip: 'Cyanide', fragment: 'cyanide', hydrogen: 2, anchor: 0, text: 'cyano' },
  {
    label: 'C=O',
    tooltip: 'Aldehyde',
    fragment: 'formaldehyde',
    hydrogen: 2,
    anchor: 0,
    text: 'carbonyl',
  },
  { label: 'C=OO', tooltip: 'Formic Acid', fragment: 'formic', hydrogen: 4, anchor: 0, text: 'carboxyl' },
  {
    label: 'C=ON',
    tooltip: 'C->N amide',
    fragment: 'formamide',
    hydrogen: 5,
    anchor: 0,
    text: 'C->N amide',
  },
  {
    label: 'NC=O',
    tooltip: 'N->C amide',
    fragment: 'formamide',
    hydrogen: 3,
    anchor: 1,
    text: 'N->C amide',
  },
  { label: 'S=O2', tooltip: 'Sulfone', fragment: 'sulfone', hydrogen: 3, anchor: 1, text: 'sulfonyl' },
  {
    label: 'P=O3',
    tooltip: 'Phosphite',
    fragment: 'phosphite',
    hydrogen: 4,
    anchor: 0,
    text: 'phosphoryl',
  },
  { label: 'N=O2', tooltip: 'Nitro', fragment: 'nitro', hydrogen: 3, anchor: 0, text: 'nitro' },
];

/* --- Chemical tab, row 2 (builder.py:1100-1111) ------------------------- */

/**
 * The ten ring buttons. Upstream loads `$PYMOL_DATA/pmg_tk/bitmaps/builder/
 * <icon>.gif` twice — normal and `invertPixels()` — and never uses the
 * inverted copy (dead code, `builder.py:1114,1125`). The same bitmaps ship
 * here, inlined by {@link RING_ICONS}, with the inversion done as a CSS filter
 * because this dock is dark and Qt's palette was light.
 */
export interface RingButton extends FragmentButton {
  /** The `.gif` basename upstream uses, and the key into `RING_ICONS`. */
  icon: string;
}

export const RINGS: readonly RingButton[] = [
  {
    icon: 'cyc3',
    label: 'cyc3',
    tooltip: 'Cyclopropane',
    fragment: 'cyclopropane',
    hydrogen: 4,
    anchor: 0,
    text: 'cyclopropyl',
  },
  {
    icon: 'cyc4',
    label: 'cyc4',
    tooltip: 'Cyclobutane',
    fragment: 'cyclobutane',
    hydrogen: 4,
    anchor: 0,
    text: 'cyclobutyl',
  },
  {
    icon: 'cyc5',
    label: 'cyc5',
    tooltip: 'Cyclopentane',
    fragment: 'cyclopentane',
    hydrogen: 5,
    anchor: 0,
    text: 'cyclopentyl',
  },
  {
    icon: 'cyc6',
    label: 'cyc6',
    tooltip: 'Cyclohexane',
    fragment: 'cyclohexane',
    hydrogen: 7,
    anchor: 0,
    text: 'cyclohexyl',
  },
  {
    icon: 'cyc7',
    label: 'cyc7',
    tooltip: 'Cycloheptane',
    fragment: 'cycloheptane',
    hydrogen: 8,
    anchor: 0,
    text: 'cycloheptyl',
  },
  {
    icon: 'aro5',
    label: 'aro5',
    tooltip: 'Cyclopentadiene',
    fragment: 'cyclopentadiene',
    hydrogen: 5,
    anchor: 0,
    text: 'cyclopentadienyl',
  },
  {
    icon: 'aro6',
    label: 'aro6',
    tooltip: 'Benzene',
    fragment: 'benzene',
    hydrogen: 6,
    anchor: 0,
    text: 'phenyl',
  },
  {
    icon: 'aro65',
    label: 'aro65',
    tooltip: 'Indane',
    fragment: 'indane',
    hydrogen: 12,
    anchor: 0,
    text: 'indanyl',
  },
  {
    // builder.py:1109 — "Napthylene"/`napthylene.pkl` is misspelled upstream,
    // including on disk. Correcting it here would break the fragment load.
    icon: 'aro66',
    label: 'aro66',
    tooltip: 'Napthylene',
    fragment: 'napthylene',
    hydrogen: 13,
    anchor: 0,
    text: 'napthyl',
  },
  {
    icon: 'aro67',
    label: 'aro67',
    tooltip: 'Benzocycloheptane',
    fragment: 'benzocycloheptane',
    hydrogen: 13,
    anchor: 0,
    text: 'benzocycloheptyl',
  },
];

/* --- Protein tab (builder.py:1132-1154) --------------------------------- */

export const AMINO_ACIDS_ROW0: readonly string[] = [
  'Ace', 'Ala', 'Arg', 'Asn', 'Asp', 'Cys', 'Gln', 'Glu', 'Gly', 'His', 'Ile', 'Leu',
];
export const AMINO_ACIDS_ROW1: readonly string[] = [
  'Lys', 'Met', 'Phe', 'Pro', 'Ser', 'Thr', 'Trp', 'Tyr', 'Val', 'NMe', 'NHH',
];

/** ss = index + 1; phi/psi from `packages/engine/modules/pymol/editor.py:151-162`. */
export const SECONDARY_STRUCTURE: readonly { label: string; ss: number; phi: number; psi: number }[] =
  [
    { label: 'Alpha Helix', ss: 1, phi: -57.0, psi: -47.0 },
    { label: 'Beta Sheet (Anti-Parallel)', ss: 2, phi: -139.0, psi: 135.0 },
    { label: 'Beta Sheet (Parallel)', ss: 3, phi: -119.0, psi: 113.0 },
  ];

/* --- Nucleic acid tab (builder.py:1156-1224) ---------------------------- */

export interface BaseButton {
  label: string;
  tooltip: string;
  fragment: string;
}

export const DNA_BASES: readonly BaseButton[] = [
  { label: 'A', tooltip: 'Deoxyadenosine', fragment: 'atp' },
  { label: 'C', tooltip: 'Deoxycytidine', fragment: 'ctp' },
  { label: 'T', tooltip: 'Deoxythymidine', fragment: 'ttp' },
  { label: 'G', tooltip: 'Deoxyguanosine', fragment: 'gtp' },
];

export const RNA_BASES: readonly BaseButton[] = [
  { label: 'A', tooltip: 'Adenosine', fragment: 'atp' },
  { label: 'C', tooltip: 'Cytosine', fragment: 'ctp' },
  { label: 'U', tooltip: 'Uracil', fragment: 'utp' },
  { label: 'G', tooltip: 'Guanine', fragment: 'gtp' },
];

/** builder.py:1218-1223 — a rich-text QLabel with `setOpenExternalLinks(True)`. */
export const RNA_HINT_LINKS: readonly { text: string; href: string }[] = [
  { text: 'fiber', href: 'http://x3dna.org/articles/3dna-fiber-models' },
  {
    text: 'PyMOL wrapper',
    href: 'http://x3dna.org/articles/pymol-wrapper-to-3dna-fiber-models',
  },
];

/* --- Action row 2, bond orders (builder.py:1245-1248) ------------------- */

export const BOND_ORDERS: readonly { glyph: string; order: string; text: string; tooltip: string }[] =
  [
    { glyph: '|', order: '1', text: 'single', tooltip: 'Create single bond' },
    { glyph: '||', order: '2', text: 'double', tooltip: 'Create double bond' },
    { glyph: '|||', order: '3', text: 'triple', tooltip: 'Create triple bond' },
    { glyph: 'Arom', order: '4', text: 'aromatic', tooltip: 'Create aromatic bond' },
  ];

/* --- Action row 3, setting checkboxes (builder.py:1256-1261) ------------ */

export const SETTING_CHECKBOXES: readonly {
  label: string;
  setting: keyof BuilderSettings;
  tooltip: string;
  /** `#`-prefixed in the source table: checked = NOT the setting value. */
  inverted: boolean;
}[] = [
  {
    label: 'El-stat',
    setting: 'clean_electro_mode',
    tooltip: "Electrostatics term for 'Clean' action",
    inverted: false,
  },
  {
    label: 'Bumps',
    setting: 'sculpt_vdw_vis_mode',
    tooltip: 'Show VDW contacts during sculpting',
    inverted: false,
  },
  { label: 'Undo Enabled', setting: 'suspend_undo', tooltip: '', inverted: true },
];

/* --- drift detection ---------------------------------------------------- */

/**
 * Compare this file with `cmd.builder_tables()`. Returns one human-readable
 * line per disagreement; an empty array means the two copies are identical.
 *
 * This exists because the alternative — trusting two hand-maintained tables to
 * stay in step across 60-odd buttons — is exactly how a Builder button ends up
 * silently attaching the wrong fragment.
 */
export function diffTables(remote: BuilderTables | null): string[] {
  if (!remote) return [];
  const problems: string[] = [];

  const compare = (name: string, mine: readonly unknown[], theirs: readonly unknown[]) => {
    const a = JSON.stringify(mine);
    const b = JSON.stringify(theirs);
    if (a !== b) problems.push(`${name}: client ${a} !== bridge ${b}`);
  };

  compare(
    'elements',
    ELEMENTS.map((e) => [e.label, e.tooltip, e.symbol, e.geometry, e.valence, e.text]),
    remote.elements,
  );
  compare(
    'chemRow0Fragments',
    CHEM_ROW0_FRAGMENTS.map((f) => [f.label, f.tooltip, f.fragment, f.hydrogen, f.anchor, f.text]),
    remote.chemRow0Fragments,
  );
  compare(
    'functionalGroups',
    FUNCTIONAL_GROUPS.map((f) => [f.label, f.tooltip, f.fragment, f.hydrogen, f.anchor, f.text]),
    remote.functionalGroups,
  );
  compare(
    'rings',
    RINGS.map((r) => [r.icon, r.tooltip, r.fragment, r.hydrogen, r.anchor, r.text]),
    remote.rings,
  );
  compare('aminoAcidsRow0', AMINO_ACIDS_ROW0, remote.aminoAcidsRow0);
  compare('aminoAcidsRow1', AMINO_ACIDS_ROW1, remote.aminoAcidsRow1);
  compare(
    'secondaryStructure',
    SECONDARY_STRUCTURE.map((s) => [s.label, s.ss, s.phi, s.psi]),
    remote.secondaryStructure,
  );
  compare(
    'dnaBases',
    DNA_BASES.map((b) => [b.label, b.tooltip, b.fragment]),
    remote.dnaBases,
  );
  compare(
    'rnaBases',
    RNA_BASES.map((b) => [b.label, b.tooltip, b.fragment]),
    remote.rnaBases,
  );
  if (remote.missingFragments.length > 0) {
    problems.push(`fragments missing from packages/engine/data/chempy/fragments: ${remote.missingFragments.join(', ')}`);
  }
  return problems;
}

