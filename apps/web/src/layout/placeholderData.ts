/**
 * Static placeholder data for the shell.
 *
 * TODO(objects topic): every value here is replaced by the `objects` topic payload
 * (`{ t:'event', topic:'objects', seq, payload }`) once the bridge lands. The shape
 * mirrors `SpecRec` / `PanelRec` (packages/engine/layer3/SpecRec.h:9-37, packages/engine/layer3/ExecutiveDef.h:20-31)
 * as rebuilt by `ExecutiveUpdatePanelList()` (packages/engine/layer3/Executive.cpp:1557-1569).
 */

/** `SpecRec::type`: cExecAll / cExecObject / cExecSelection. */
export type SpecType = 'all' | 'object' | 'selection';

/** Object subtype, only meaningful when `specType === 'object'`. */
export type ObjectType =
  | 'molecule'
  | 'map'
  | 'mesh'
  | 'surface'
  | 'measurement'
  | 'cgo'
  | 'slice'
  | 'group'
  | 'gadget'
  | 'alignment'
  | 'volume'
  | 'callback';

export interface PanelRow {
  name: string;
  specType: SpecType;
  objectType?: ObjectType;
  /** `SpecRec::visible` -- "enabled", not "visible". */
  enabled: boolean;
  /** `PanelRec::nest_level` -- indent is nest_level * 8px. */
  nestLevel: number;
  isGroup: boolean;
  isOpen: boolean;
  /**
   * `CObject::getCaption()` -- only ObjectMolecule implements it
   * (packages/engine/layer2/ObjectMolecule.cpp:386-460): "<coordset name> <state>/<nstates>".
   */
  caption?: string;
}

export const PLACEHOLDER_PANEL: PanelRow[] = [
  { name: 'all', specType: 'all', enabled: true, nestLevel: 0, isGroup: false, isOpen: false },
  {
    name: '1ubq',
    specType: 'object',
    objectType: 'molecule',
    enabled: true,
    nestLevel: 0,
    isGroup: false,
    isOpen: false,
    caption: '1/1',
  },
  {
    name: 'ligands',
    specType: 'object',
    objectType: 'group',
    enabled: true,
    nestLevel: 0,
    isGroup: true,
    isOpen: true,
  },
  {
    name: 'ligands.hem',
    specType: 'object',
    objectType: 'molecule',
    enabled: true,
    nestLevel: 1,
    isGroup: false,
    isOpen: false,
    caption: '1/1',
  },
  {
    name: 'ligands.nag',
    specType: 'object',
    objectType: 'molecule',
    enabled: false,
    nestLevel: 1,
    isGroup: false,
    isOpen: false,
  },
  {
    name: '2fofc',
    specType: 'object',
    objectType: 'map',
    enabled: false,
    nestLevel: 0,
    isGroup: false,
    isOpen: false,
  },
  {
    name: 'mesh01',
    specType: 'object',
    objectType: 'mesh',
    enabled: true,
    nestLevel: 0,
    isGroup: false,
    isOpen: false,
  },
  {
    name: 'sele',
    specType: 'selection',
    enabled: true,
    nestLevel: 0,
    isGroup: false,
    isOpen: false,
  },
  {
    name: 'polar_contacts',
    specType: 'object',
    objectType: 'measurement',
    enabled: true,
    nestLevel: 0,
    isGroup: false,
    isOpen: false,
  },
];

/**
 * Mouse-mode block (packages/engine/layer1/ButMode.cpp:192-395). The 5-char codes come from
 * `CButMode::Code` (packages/engine/layer1/ButMode.cpp:497-520).
 *
 * TODO(butmode): needs `ButModeGet` / `ButModeTranslate` exposed to Python -- see
 * docs/feature-parity.md §14 items 7/8. Static until then.
 */
export interface MouseModeState {
  /** setting `button_mode_name` */
  buttonModeName: string;
  /** setting `mouse_grid` -- draws the 4x4 matrix */
  mouseGrid: boolean;
  /** rows: keyed by modifier, columns L / M / R / Wheel */
  grid: { label: string; cells: [string, string, string, string] }[];
  /** `Picking Atoms (and Joints)` or `Selecting <mode>` */
  selectionLine: string;
}

export const PLACEHOLDER_MOUSE_MODE: MouseModeState = {
  buttonModeName: '3-Button Viewing',
  mouseGrid: true,
  grid: [
    { label: '& Keys', cells: ['Rota', 'Move', 'MovZ', 'Slab'] },
    { label: 'Shft', cells: ['+Box', '-Box', 'clip', 'movS'] },
    { label: 'Ctrl', cells: ['PkAt', 'PkBd', 'RotZ', 'movS'] },
    { label: 'CtSh', cells: ['Orig', 'Clip', 'ClpF', 'movS'] },
    { label: 'SnglClk', cells: ['+/-', 'Cent', 'PkAt', ''] },
    { label: 'DblClk', cells: ['Menu', '', 'Sele', ''] },
  ],
  selectionLine: 'Selecting Residues',
};

/** Movie / frame state -- `frame` topic. */
export interface FrameState {
  frame: number;
  nFrame: number;
  state: number;
  nState: number;
  playing: boolean;
  rocking: boolean;
  seqView: boolean;
}

export const PLACEHOLDER_FRAME: FrameState = {
  frame: 1,
  nFrame: 1,
  state: 1,
  nState: 1,
  playing: false,
  rocking: false,
  seqView: false,
};
