/**
 * Pure model helpers for the menu bar. No React, no transport — so every rule
 * below is unit-testable against the real generated tree.
 *
 * The tree itself is `generated/menudata.ts`, harvested from
 * `PyMOLDesktopGUI.get_menudata` (`modules/pymol/_gui.py:55`) by
 * `bridge/tenmol_bridge/panels/menus.py`. Nothing here hard-codes a menu item.
 */

import {
  CHECKABLE_SETTING_TYPES,
  walkMenu,
  type MenuCheckNode,
  type MenuNode,
  type MenuRadioNode,
  type MenuSettingValue,
  type MenuValue,
} from '@tenmol/protocol/topics/menus';
import { STEREO_UNAVAILABLE } from './stereo';

/* ------------------------------------------------------------------ *
 * Toolkit hooks
 * ------------------------------------------------------------------ */

export interface HookOwner {
  /** Work package that owns the surface this hook opens. */
  owner: string;
  /** Shown in the item's tooltip while it is unavailable. */
  note: string;
}

/**
 * The `= None` seams of `PyMOLDesktopGUI` (`modules/pymol/_gui.py:13-38`) plus
 * the three stateful helpers. Qt fills every one of them with a `QFileDialog`
 * or a dialog class; in this client each belongs to the work package that owns
 * the corresponding surface, and a hook nobody has implemented renders as a
 * DISABLED item naming its owner — never as a dead item that looks alive.
 */
export const HOOK_OWNERS: Readonly<Record<string, HookOwner>> = {
  file_open: { owner: 'WP-18', note: 'bridge-served file browser (never the browser file picker)' },
  file_autoload_mtz: { owner: 'WP-18', note: 'bridge-served file browser' },
  file_fetch_pdb: { owner: 'WP-18', note: 'Get PDB dialog -> cmd.fetch' },
  session_save: { owner: 'WP-18', note: "cmd.save(cmd.get('session_file'), format='pse')" },
  session_save_as: { owner: 'WP-18', note: 'save dialog + recent_filenames_add' },
  file_save: { owner: 'WP-18', note: 'Export Molecule' },
  file_save_map: { owner: 'WP-18', note: 'Export Map' },
  file_save_aln: { owner: 'WP-18', note: 'Export Alignment' },
  file_save_png: { owner: 'WP-19', note: 'Export Image As PNG (render pipeline)' },
  file_save_wrl: { owner: 'WP-18', note: 'Export VRML2' },
  file_save_dae: { owner: 'WP-18', note: 'Export COLLADA' },
  file_save_pov: { owner: 'WP-18', note: 'Export POV-Ray' },
  file_save_gltf: { owner: 'WP-18', note: 'Export GLTF' },
  file_save_stl: { owner: 'WP-18', note: 'Export STL' },
  file_save_mpeg: { owner: 'WP-20', note: 'Export Movie As MPEG' },
  file_save_mov: { owner: 'WP-20', note: 'Export Movie As Quicktime' },
  file_save_mpng: { owner: 'WP-20', note: 'Export Movie As PNG images' },
  log_open: { owner: 'WP-18', note: 'cmd.log_open' },
  log_resume: { owner: 'WP-18', note: 'cmd.resume' },
  log_append: { owner: 'WP-18', note: 'cmd.log_open(mode=a)' },
  file_run: { owner: 'WP-18', note: 'Run Script (cmd.run / @file)' },
  edit_pymolrc: { owner: 'WP-22', note: 'text editor dialog' },
  cd_dialog: { owner: 'WP-18', note: 'Working Directory > Change (cmd.cd)' },
  settings_edit_all_dialog: { owner: 'WP-15', note: 'advanced settings table (779 rows)' },
  shortcut_menu_edit_dialog: { owner: 'WP-23', note: 'keyboard shortcuts dialog' },
  edit_colors_dialog: { owner: 'WP-22', note: 'colours editor dialog' },
  scene_panel_dialog: { owner: 'WP-20', note: 'scene panel' },
  scene_panel_menu_dialog: { owner: 'WP-20', note: 'scene panel' },
};

/** Hooks this feature implements itself. */
export const LOCAL_HOOKS = ['show_about', 'confirm_quit', 'mvprg', 'mvprg_remove_last'] as const;

/**
 * `new_window` is `os.spawnv` of a second PyMOL (`_gui.py:41-53`). The product
 * is one engine, one browser client (`session.ts`: a second connection splits
 * the destructive feedback drain), so this cannot be honoured and says so
 * instead of pretending.
 */
export const UNAVAILABLE_HOOKS: Readonly<Record<string, string>> = {
  new_window: 'one PyMOL process per bridge — a second window would need a second engine',
};

/**
 * The same idea for a `do` leaf: a command line this client can never honour.
 *
 * A hook has an owner who might one day implement it; a command has none, so
 * this table is only for things that are impossible by construction rather than
 * unfinished. Today that is the two stereo modes whose second eye has no way to
 * cross a WebSocket — see `stereo.ts` for the measurement and the argument.
 */
export const UNAVAILABLE_COMMANDS: Readonly<Record<string, string>> = {
  ...STEREO_UNAVAILABLE,
};

/* ------------------------------------------------------------------ *
 * Setting state
 * ------------------------------------------------------------------ */

/** Every setting name a check/radio in `nodes` binds to, first-seen order. */
export function settingsIn(nodes: readonly MenuNode[]): string[] {
  const out: string[] = [];
  for (const node of walkMenu(nodes)) {
    if (node.kind === 'check' || node.kind === 'radio') {
      if (!out.includes(node.setting)) out.push(node.setting);
    }
  }
  return out;
}

/**
 * Float equality with a relative tolerance.
 *
 * DELIBERATE DEVIATION FROM QT, recorded rather than hidden. PyMOL stores most
 * float settings as C `float`, so `cmd.get_setting_tuple('stick_radius')` on a
 * value the menu calls `0.1` comes back as 0.10000000149011612. Qt compares
 * with `values[0] == value` (`pymol_qt_gui.py:337`) and therefore fails to tick
 * its own radio item. We tolerate 1e-6 relative, so the radio reflects reality.
 */
export function valueEquals(a: MenuValue | null | undefined, b: MenuValue): boolean {
  if (a === null || a === undefined) return false;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= 1e-6 * scale;
  }
  return String(a) === String(b);
}

/**
 * `SettingAction` registers `lambda v: action.setChecked(v != false_value)`
 * (`pymol_qt_gui.py:1065`), so "checked" means "not the off value" — which is
 * what makes the non-boolean pairs work: `cartoon_highlight_color` 104/-1,
 * `ray_interior_color` 74/-1, `auto_show_classified` -1/0, `assembly` '1'/''.
 */
export function isChecked(node: MenuCheckNode, value: MenuSettingValue | undefined): boolean {
  if (!value) return false;
  return !valueEquals(value.value, node.falseValue);
}

/** `if values[0] == value: action.setChecked(True)` (`pymol_qt_gui.py:337-339`). */
export function isRadioActive(node: MenuRadioNode, value: MenuSettingValue | undefined): boolean {
  if (!value) return false;
  return valueEquals(value.value, node.value);
}

/**
 * `SettingAction` only makes types 1/2/3/5/6 checkable and prints
 * `TODO <type> <name>` for the rest (`pymol_qt_gui.py:1069-1078`). Radios are
 * built by a different branch of `_addmenu` and are always checkable, so this
 * gate applies to `check` nodes only, exactly as upstream.
 */
export function isCheckable(value: MenuSettingValue | undefined): boolean {
  return !!value && CHECKABLE_SETTING_TYPES.includes(value.type);
}

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

/**
 * The label without its bracketed accelerator. PyMOL writes the key hint into
 * the label text itself ('Acetylene [Alt-J]'); the harvester also extracts it
 * to `node.accel` so it can be right-aligned like a real menu.
 */
export function baseLabel(label: string, accel?: string): string {
  if (!accel) return label;
  const suffix = ` [${accel}]`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
}

/** A one-line description of what a node will do. Used as the tooltip. */
export function describe(node: MenuNode): string {
  switch (node.kind) {
    case 'command':
      switch (node.action.type) {
        case 'do':
          return `PyMOL> ${node.action.command}`;
        case 'call':
          return node.action.calls
            .map((call) => {
              const args = call.args.map((a) => JSON.stringify(a));
              const kwargs = Object.entries(call.kwargs).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
              return `${call.fn}(${[...args, ...kwargs].join(', ')})`;
            })
            .join('; ');
        case 'url':
          return node.action.url;
        case 'hook':
          return `hook ${node.action.hook}`;
        case 'dropped':
          return `dropped: ${node.action.reason}`;
      }
      return '';
    case 'check':
      return `set ${node.setting}, ${node.trueValue} / ${node.falseValue}`;
    case 'radio':
      return `set ${node.setting}, ${node.value}`;
    case 'dynamic':
      return `dynamic submenu: ${node.source}`;
    default:
      return '';
  }
}
