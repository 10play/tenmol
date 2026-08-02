/**
 * Topic `menus` — PyMOL's **menu bar** (File … Help).  OWNER: WP-14.
 *
 * NOT to be confused with `topics/menu.ts` (WP-13), which is the *popup* menu
 * engine: `pymol.menu.*` resolved for a right-click on one object. This module
 * is the eleven top-level application menus, whose source of truth is a single
 * Python literal — `PyMOLDesktopGUI.get_menudata` (`packages/engine/modules/pymol/_gui.py:55`)
 * — walked identically by Qt (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:295-345`
 * `_addmenu`) and Tk (`packages/engine/modules/pmg_tk/skins/normal/__init__.py:1072`).
 *
 * The bridge harvester (`packages/bridge/tenmol_bridge/panels/menus.py`) walks that
 * literal against a recording `cmd` proxy, so the ~300 leaves that are Python
 * *callables* upstream arrive here as data. Every node below therefore maps 1:1
 * onto one branch of `_addmenu`, and the client renders it generically — there
 * are no hand-written menu items anywhere in `apps/web`.
 *
 * Setting-bound state (`check` / `radio`) is deliberately NOT carried in the
 * tree. Qt reads it live (`cmd.get_setting_tuple`, then a `setting_callbacks`
 * entry per index) and so does the client; a `checked` flag baked into the tree
 * would be stale the moment anything ran `set`.
 *
 * @notATopic  NOT A TRANSPORT TOPIC — deliberately not re-exported by the
 * frozen `topics/index.ts` barrel. Reached by its subpath
 * (`@tenmol/protocol/topics/menus`); its events, if any, ride an existing
 * topic. `packages/bridge/tests/test_dispatch.py` looks for this tag.
 */

/** A menu literal only ever carries scalars (ints, floats, strings). */
export type MenuValue = number | string;

/** One recorded `cmd` call: `{t:'call'}` on the wire. */
export interface MenuCall {
  /** Dotted symbol as the menu wrote it, e.g. `cmd.zoom`, `cmd.util.ray_shadows`. */
  fn: string;
  args: MenuValue[];
  kwargs: Record<string, MenuValue>;
  /**
   * The upstream call passed `cmd` itself as an argument — always the `_self`
   * parameter (`cmd.util.modernize_rendering(1, cmd)`,
   * `packages/engine/modules/pymol/util.py:553`). It is dropped: over the wire the bridge's own
   * instance is the only `_self` there is.
   */
  selfArg?: boolean;
}

export type MenuAction =
  /** A command STRING. Runs through `{t:'do'}`, so PyMOL echoes `PyMOL>…`. */
  | { type: 'do'; command: string }
  /** One or more direct API calls. Qt calls these silently, with no echo. */
  | { type: 'call'; calls: MenuCall[] }
  /** `webbrowser.open(url)` upstream — an `<a target="_blank">` here. */
  | { type: 'url'; url: string }
  /**
   * A toolkit seam: a `= None` class attribute of `PyMOLDesktopGUI` that the
   * front end fills in (`file_open`, `session_save_as`, `confirm_quit`,
   * `settings_edit_all_dialog`, …), plus the three stateful helpers
   * `mvprg`, `mvprg_remove_last`, `new_window`.
   */
  | { type: 'hook'; hook: string; args?: unknown[] }
  /**
   * `_addmenu` prints `warning: skipping` and DROPS a `('command', label, None)`
   * item. Kept as a node so the client can show *why* rather than silently
   * losing a row.
   */
  | { type: 'dropped'; reason: string };

export interface MenuSeparatorNode {
  kind: 'separator';
}

export interface MenuSubmenuNode {
  kind: 'submenu';
  label: string;
  accel?: string;
  items: MenuNode[];
}

export interface MenuCommandNode {
  kind: 'command';
  label: string;
  accel?: string;
  action: MenuAction;
}

/**
 * `SettingAction` (`pymol_qt_gui.py:1041`). Checkable only for setting types
 * 1 bool / 2 int / 3 float / 5 color / 6 str; anything else prints
 * `TODO <type> <name>` upstream and is not checkable.
 *
 * NOTE the `len(item) > 4` rule reproduced by the harvester: a 4-tuple such as
 * `('check', 'Specular Reflections', 'specular', 1.0)` does **not** override the
 * true value — only a 5-tuple does. So `trueValue` here is 1 for that item, as
 * in Qt.
 */
export interface MenuCheckNode {
  kind: 'check';
  label: string;
  accel?: string;
  setting: string;
  trueValue: MenuValue;
  falseValue: MenuValue;
}

/** A `QActionGroup` keyed by SETTING NAME ONLY, upstream — hence group-per-setting. */
export interface MenuRadioNode {
  kind: 'radio';
  label: string;
  accel?: string;
  setting: string;
  value: MenuValue;
}

/** `('open_recent_menu',)` — rebuilt from the bridge on every open. */
export interface MenuDynamicNode {
  kind: 'dynamic';
  label: string;
  source: 'open_recent';
}

/** An item `_addmenu` would answer with `print('error:', item)`. */
export interface MenuErrorNode {
  kind: 'error';
  raw: string;
}

export type MenuNode =
  | MenuSeparatorNode
  | MenuSubmenuNode
  | MenuCommandNode
  | MenuCheckNode
  | MenuRadioNode
  | MenuDynamicNode
  | MenuErrorNode;

export interface MenusPayload {
  /** Bumped when the node shape changes; the client asserts on it. */
  schema: number;
  /** Provenance string, for the "where did this come from" affordance. */
  source: string;
  /** The eleven top-level menus, in order. Always `kind: 'submenu'`. */
  menus: MenuNode[];
  /** Every setting name any check/radio in the tree binds to, first-seen order. */
  settings: string[];
}

/** Live values for the check/radio nodes: `cmd.get_setting_tuple(name)`. */
export interface MenuSettingValue {
  /** PyMOL setting type: 1 bool, 2 int, 3 float, 4 float3, 5 color, 6 str. */
  type: number;
  /**
   * `values[0]`, exactly as Qt compares it (`pymol_qt_gui.py:337`).
   *
   * MEASURED CORRECTION to the area docs: `bg_rgb` — the setting behind the
   * Display ▸ Background radios — is **type 5 (color)**, not float3, and
   * `get_setting_tuple` returns a one-element tuple holding the colour INDEX.
   * That is precisely what the radio values are (0 white, 134 grey80, 104
   * grey50, 1 black, annotated as such at `_gui.py:404-410`), so the compare
   * is index-to-index and the radios tick correctly.
   */
  value: MenuValue | null;
}

/** Setting types `SettingAction` will make checkable (`pymol_qt_gui.py:1069-1075`). */
export const CHECKABLE_SETTING_TYPES: readonly number[] = [1, 2, 3, 5, 6];

/** `fname if len(fname) < 128 else '...' + fname[-120:]` (`pymol_qt_gui.py:346`). */
export function truncateRecentLabel(filename: string): string {
  return filename.length < 128 ? filename : '...' + filename.slice(-120);
}

/** Depth-first walk over a menu tree. */
export function* walkMenu(nodes: readonly MenuNode[]): Generator<MenuNode> {
  for (const node of nodes) {
    yield node;
    if (node.kind === 'submenu') yield* walkMenu(node.items);
  }
}
