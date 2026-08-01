/**
 * Topic `wizard` — the generic wizard protocol.  OWNER: WP-16.
 *
 * A PyMOL wizard is a plain Python object on a stack inside the C++ core
 * (`CWizard::Wiz`, `layer1/Wizard.cpp:69`), not a widget. The core pulls a
 * *declarative* panel + prompt out of it and pushes events into it. Port that
 * protocol once and all 26 bundled wizards — plus the 16 builder wizards in
 * `modules/pmg_qt/builder.py` and any third-party plugin wizard — render with
 * no per-wizard code. These are the wire shapes of that protocol.
 *
 * TRANSPORT. Not a push topic: there is no Python-visible "wizard changed"
 * callback (verified — no observer hook exists in `layer1/Wizard.cpp` or
 * `modules/pymol/wizarding.py`; the direction is C pulling from Python). The
 * bridge instead wraps `cmd.refresh_wizard` / `set_wizard` / `set_wizard_stack`
 * / `dirty_wizard` and exposes a version counter, so the client polls the CHEAP
 * `wizards.probe` and only pulls `wizards.snapshot` when something changed.
 * That distinction is not an optimisation, it is correctness:
 *
 *   - `get_panel()` has side effects — `mutagenesis.py:278` forces
 *     `mouse_selection_mode`, `density.py:160` and `filter.py:236` rebuild menus;
 *   - `get_prompt()` has side effects — `charge.py:124-128` runs `cmd.iterate`.
 *
 * The wizard EVENT MASK is also NOT a transport for anything else (plan §1.5,
 * measured): draw-pumped, misses delete/select/ungroup entirely, 38,313 us per
 * pump after a recolour-all, and a bridge "spy" wizard received zero events
 * after `cmd.wizard('measurement')` because there is exactly one stack.
 */

/* ------------------------------------------------------------------ masks */

/**
 * `modules/pymol/wizard/__init__.py:6-15`, identical to `layer1/Wizard.cpp:49-58`.
 * `CWizard::isEventType` (`:140`) gates EVERY dispatch on these bits before
 * crossing into Python, and the mask changes with wizard sub-state
 * (`box.py:398-403` adds `key` while renaming; `command.py:149-152` returns 0
 * unless text is being entered) — so it is re-read on every event, never
 * trusted from a stale snapshot.
 */
export const WIZARD_EVENT_BITS = {
  pick: 1,
  select: 2,
  key: 4,
  special: 8,
  scene: 16,
  state: 32,
  frame: 64,
  dirty: 128,
  view: 256,
  position: 512,
} as const;

export type WizardEventKind = keyof typeof WIZARD_EVENT_BITS;

export const WIZARD_EVENT_KINDS = Object.keys(WIZARD_EVENT_BITS) as WizardEventKind[];

/** `Wizard.get_event_mask()` default is pick+select (`wizard/__init__.py:56`). */
export const WIZARD_DEFAULT_EVENT_MASK = WIZARD_EVENT_BITS.pick + WIZARD_EVENT_BITS.select;

export function wizardWants(mask: number, kind: WizardEventKind): boolean {
  return (mask & WIZARD_EVENT_BITS[kind]) !== 0;
}

/* ------------------------------------------------------------------ panel */

/** `layer1/Wizard.cpp:44-47`. */
export const WIZARD_ROW_TYPES = {
  /** `cWizBlank` — draws nothing, still occupies a row. */
  blank: 0,
  /** `cWizTypeText` — flat text in `text_color2` (`Wizard.cpp:752-755`). */
  text: 1,
  /** `cWizTypeButton` — fires `code` on RELEASE inside the row (`:568-580`). */
  button: 2,
  /** `cWizTypePopUp` — opens `get_menu(code)` on PRESS (`:495-511`). */
  popup: 3,
} as const;

export type WizardRowKind = keyof typeof WIZARD_ROW_TYPES;

/**
 * One row of `Wizard.get_panel()` — the Python literal is
 * `[int type, str text, str code]` and `layer1/Wizard.cpp:241` requires at
 * least three items and reads only the first three.
 */
export interface WizardPanelRow {
  /** Position in the panel. Rows must be diffed BY INDEX: the row count is
   *  state-dependent (`appearance.py:163-183` swaps the middle row). */
  index: number;
  /** 0/1/2/3 exactly as the wizard declared it. */
  type: number;
  /** `type` decoded; `'unknown'` for a value PyMOL does not define. */
  kind: WizardRowKind | 'unknown';
  text: string;
  /**
   * PyMOL **command language**, executed by `PParse` server-side
   * (`layer1/Wizard.cpp:573-577`). It is not JavaScript and not necessarily a
   * method call — `sculpting.py:175` carries raw inline Python and
   * `demo.py:42` carries the keyword `replace_wizard demo,reps`.
   * NEVER evaluate this in the browser; send it back as `wizards.exec_code`.
   * For a `popup` row it is instead the TAG passed to `get_menu`.
   */
  code: string;
}

/* ------------------------------------------------------------------- menu */

/** `layer4/PopUp.cpp:231-248`, heights at `:293-320`. */
export const WIZARD_MENU_CODES = {
  /** Separator bar; text and command are ignored. */
  separator: 0,
  /** Selectable item. */
  item: 1,
  /** Non-selectable title/header. */
  title: 2,
} as const;

export type WizardMenuKind = keyof typeof WIZARD_MENU_CODES;

/**
 * One entry of `get_menu(tag)`. The Python literal's third element is a command
 * string, a nested list (submenu) **or a callable** — the lazy form resolved by
 * `SubGetItem` (`PopUp.cpp:88-105`). A callable cannot be serialized, so the
 * bridge calls it and sends the result as `submenu`.
 */
export interface WizardMenuItem {
  code: number;
  kind: WizardMenuKind | 'unknown';
  text: string;
  /** Leaf: run through `wizards.exec_code` (`PopUp.cpp:471-473`). */
  command?: string;
  /** Nested submenu, already resolved. */
  submenu?: WizardMenuItem[];
  /** A lazy submenu that raised, or a depth-limit refusal. */
  error?: string;
}

export interface WizardMenuResult {
  tag: string;
  /** `null` means `get_menu` returned `None` — no menu, do not open a popup. */
  items: WizardMenuItem[] | null;
  error: string | null;
}

/* --------------------------------------------------------------- snapshot */

export interface WizardStackEntry {
  cls: string;
  module: string;
}

/** The cheap poll. Side-effect free: it never calls `get_panel`/`get_prompt`. */
export interface WizardProbe {
  /** Bumped by the bridge's wrapped `refresh_wizard`/`set_wizard`/... */
  version: number;
  /** `len(cmd.get_wizard_stack())`; > 1 means nested wizards. */
  depth: number;
  /** Class name of the TOP wizard, or null when the stack is empty. */
  cls: string | null;
  module: string | null;
}

/**
 * The full render state, mirroring `WizardRefresh` (`layer1/Wizard.cpp:195`),
 * which pulls prompt, event mask and panel in that order.
 */
export interface WizardSnapshot extends WizardProbe {
  stack: WizardStackEntry[];
  /** May be empty: `dragging.py:104` returns `None`, `message.py:36` `[]`. */
  panel: WizardPanelRow[];
  /** `get_prompt()` lines, drawn as the top-left viewport overlay. */
  prompt: string[];
  eventMask: number;
  /** Which optional `do_*`/`get_*` methods this wizard actually implements. */
  methods: string[];
  /** A wizard method that raised. Shown, not swallowed. */
  errors: string[];
  /** Setting `wizard_prompt_mode`: 0 off, 1 backdrop, 2 text, 3 flush. */
  promptMode: number;
}

/** The `wizard` topic payload is the snapshot. */
export type WizardPayload = WizardSnapshot;

/* ---------------------------------------------------------------- events */

export interface WizardEventCall {
  method: string;
  args: (string | number | boolean | null)[];
  /** False when the wizard does not implement it — normal, not an error
   *  (`PyObject_HasAttrString`, `layer1/Wizard.cpp:162`). */
  present: boolean;
  error: string | null;
  result: unknown;
}

export interface WizardEventResult {
  kind: WizardEventKind;
  bit: number;
  mask: number;
  dispatched: boolean;
  /** `'masked out'` / `'no wizard on the stack'` / ... when not dispatched. */
  reason: string | null;
  version: number;
  /** `do_pick_state` then `do_pick`/`do_select`, in dispatch order. */
  calls: WizardEventCall[];
}

/* --------------------------------------------------------------- catalog */

export interface WizardCatalogEntry {
  /** Launch name: `cmd.wizard(name)` imports `pymol.wizard.<name>` and
   *  instantiates `name.capitalize()` (`wizarding.py:35,41`). */
  name: string;
  cls: string;
  /** False when the module or its class is missing. Says why in `note`. */
  available: boolean;
  note: string;
}

export type WizardMenubarNode =
  | { kind: 'separator' }
  | { kind: 'command'; label: string; command: string }
  | { kind: 'submenu'; label: string; items: WizardMenubarNode[] };

export interface WizardCatalog {
  wizards: WizardCatalogEntry[];
  /** The Qt Wizard menu, verbatim from `modules/pymol/_gui.py:834-864`. */
  menubar: WizardMenubarNode[];
  /** `wizarding.py:88-89` rewrites `distance` -> `measurement`. */
  aliases: Record<string, string>;
}

/* ------------------------------------------------------------------- RPC */

/** The bridge symbols this topic is served by (`policy/grants/wp-16.py`). */
export const WIZARD_RPC = {
  probe: 'wizards.probe',
  snapshot: 'wizards.snapshot',
  menu: 'wizards.menu',
  exec: 'wizards.exec_code',
  event: 'wizards.event',
  launch: 'wizards.launch',
  replace: 'wizards.replace',
  dismiss: 'wizards.dismiss',
  catalog: 'wizards.catalog',
} as const;
