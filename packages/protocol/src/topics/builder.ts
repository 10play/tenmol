/**
 * The Builder's RPC surface.  OWNER: WP-17.  Reachable as
 * `@tenmol/protocol/topics/builder` (the frozen barrel `./index.ts` carries the
 * 19 v1 *topics*; the Builder is not a topic, it is a request/response surface,
 * and `topics/editor.ts` already holds the pick-state topic payload).
 *
 * The backend is `bridge/tenmol_bridge/panels/builder.py` — a Qt-free port of
 * `modules/pmg_qt/builder.py`, which cannot live in TypeScript because a PyMOL
 * wizard is a **Python object the engine owns**: `cmd.set_wizard(obj)` takes an
 * instance and the pick path calls `obj.do_pick(bondFlag)`.
 *
 * INSTALLATION.  `bridge/tenmol_bridge/panels/__init__.py` is a frozen barrel
 * that does not list `builder`, and `server.py`'s `_bridge.*` route table
 * belongs to WP-02, so neither can carry this feature.  What the capability
 * policy already grants is the `cmd` root, and for `pymol2.SingletonPyMOL` the
 * dispatcher's `engine.cmd` **is** the `pymol.cmd` module (measured).  So the
 * client sends {@link BUILDER_BOOTSTRAP} once as `{t:'do'}` and every entry
 * point below becomes an ordinary `{t:'call'}` on `cmd.builder_*`.
 *
 * @notATopic  NOT A TRANSPORT TOPIC — deliberately not re-exported by the
 * frozen `topics/index.ts` barrel. Reached by its subpath
 * (`@tenmol/protocol/topics/builder`); its events, if any, ride an existing
 * topic. `bridge/tests/test_dispatch.py` looks for this tag.
 */

/** The single `{t:'do'}` line that installs `cmd.builder_*` on the engine. */
export const BUILDER_BOOTSTRAP =
  "_ __import__('tenmol_bridge.panels.builder', fromlist=['install']).install(cmd)";

/** `cmd.builder_*` — the whole surface, so a typo is a compile error. */
export const BUILDER_RPC = {
  tables: 'cmd.builder_tables',
  show: 'cmd.builder_show',
  state: 'cmd.builder_state',
  action: 'cmd.builder_action',
  pick: 'cmd.builder_pick',
  wizardClick: 'cmd.builder_wizard_click',
  dismiss: 'cmd.builder_dismiss',
} as const;

/** One entry of `pk1`..`pk4`, in click order (`layer3/Editor.h:30-48`). */
export interface BuilderPickedAtom {
  slot: 'pk1' | 'pk2' | 'pk3' | 'pk4' | (string & {});
  object: string;
  index: number;
  /** `/obj/segi/chain/RESN`RESI/NAME`, PyMOL's own atom identifier syntax. */
  label: string;
  elem: string;
  resn: string;
  resi: string;
  name: string;
  formalCharge: number;
}

/** `collectPicked` (`modules/pmg_qt/builder.py:1000-1006`), as data. */
export interface BuilderEditorState {
  picked: BuilderPickedAtom[];
  /** The same list reduced to slot names — what every button branches on. */
  slots: string[];
  /** True when `pkbond` exists, i.e. a BOND is picked, not two atoms. */
  hasBond: boolean;
  /** `_pkfragN` count from `SelectorSubdivide` (`Editor.cpp:1786-1830`). */
  nFrag: number;
  active: boolean;
  hasActiveSele: boolean;
}

/**
 * `cmd.edit_mode(1)` sets no boolean: it rotates the current mouse-ring entry
 * from `*_viewing` to `*_editing` (`modules/pymol/controlling.py:688-717`).
 */
export interface BuilderMouseState {
  button_mode: number;
  mode_name: string;
  editing: boolean;
}

/** One `get_panel()` row: `[type, text, command]`, type 1 = title, 2 = button. */
export type WizardPanelRow = [number, string, string];

export interface BuilderWizardState {
  /** Python class name, e.g. `AttachWizard`. */
  name: string;
  /** False for a wizard the Builder did not arm (demo, sculpting, a plugin). */
  mine: boolean;
  prompt: string[];
  panel: WizardPanelRow[];
  /** `RepeatableActionWizard.repeating` — always true on first activation. */
  repeating: boolean;
}

/** The settings row 3 mirrors, plus the ones `showEvent` forces. */
export interface BuilderSettings {
  clean_electro_mode: number;
  sculpt_vdw_vis_mode: number;
  suspend_undo: number;
  valence: number;
  auto_overlay: number;
  editor_auto_measure: number;
  secondary_structure: number;
  auto_remove_hydrogens: number;
}

export interface BuilderState {
  editor: BuilderEditorState;
  mouse: BuilderMouseState;
  wizard: BuilderWizardState | null;
  settings: BuilderSettings;
  /**
   * ALWAYS false in this tree: `cmd.clean` raises `IncentiveOnlyException`
   * (`modules/pymol/computing.py:20-29`).  The button ships visibly disabled
   * with {@link BuilderState.clean_reason} as its tooltip.
   */
  clean_available: boolean;
  clean_reason: string;
  /** `editor.undocontext` is a bare `yield` here, so "undoable" is a lie. */
  undo_is_noop: boolean;
  objects: string[];
  /* present on an action/pick/click reply, absent on a plain state read */
  kind?: string;
  error?: string | null;
  value?: unknown;
  bondFlag?: number;
  unpicked?: boolean;
  clicked?: string;
}

/** Every action `cmd.builder_action(kind, ...)` accepts. */
export type BuilderActionKind =
  | 'grow'
  | 'replace'
  | 'attachAA'
  | 'attachNA'
  | 'ssChanged'
  | 'removeResn'
  | 'setCharge'
  | 'fixH'
  | 'addH'
  | 'invert'
  | 'removeAtom'
  | 'clear'
  | 'createBond'
  | 'deleteBond'
  | 'cycleBond'
  | 'setOrder'
  | 'sculpt'
  | 'clean'
  | 'fix'
  | 'rest'
  | 'setUndoEnabled'
  | 'enableUndoForObjects';

/** How a viewport click is routed (`layer1/SceneMouse.cpp:404-470`). */
export type BuilderPickMode = 'multi' | 'single' | 'bond';

/**
 * `cmd.builder_tables()` — the declarative button tables, shipped from the
 * backend so the React copy can be *compared* instead of trusted.
 *
 * Row shapes (they mirror `modules/pmg_qt/builder.py` exactly):
 *   elements / chemRow0Fragments / functionalGroups / rings
 *       `[label, tooltip, symbolOrFragment, geometryOrHydrogenId, valenceOrAnchor, text]`
 *   secondaryStructure  `[label, ss, phi, psi]`
 *   dnaBases / rnaBases `[label, tooltip, fragment]`
 *   bondOrders          `[glyph, order, text]`
 *   settingCheckboxes   `[label, setting, tooltip, inverted]`
 */
export interface BuilderTables {
  elements: Array<[string, string, string, number, number, string]>;
  chemRow0Fragments: Array<[string, string, string, number, number, string]>;
  functionalGroups: Array<[string, string, string, number, number, string]>;
  rings: Array<[string, string, string, number, number, string]>;
  aminoAcidsRow0: string[];
  aminoAcidsRow1: string[];
  secondaryStructure: Array<[string, number, number, number]>;
  dnaBases: Array<[string, string, string]>;
  rnaBases: Array<[string, string, string]>;
  bondOrders: Array<[string, string, string]>;
  settingCheckboxes: Array<[string, string, string, boolean]>;
  /** Distinct `data/chempy/fragments/<name>.pkl` the Chemical tab can request. */
  fragments: string[];
  /** Any of those that are NOT on disk. Must be empty. */
  missingFragments: string[];
}

/** Atom geometry codes (`layer2/AtomInfo.h:129-133`). */
export const GEOMETRY = {
  Single: 1,
  Linear: 2,
  Planar: 3,
  Tetrahedral: 4,
  None: 5,
} as const;

/** `cmd.flag` numbers used by the Builder (`modules/pymol/editing.py:2848-2861`). */
export const ATOM_FLAG = { restrain: 2, fix: 3 } as const;
