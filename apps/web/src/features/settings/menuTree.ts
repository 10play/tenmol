/**
 * The DATA half of the declarative menu-data renderer.
 *
 * `get_menudata` (`modules/pymol/_gui.py:55-58`) is toolkit-independent on
 * purpose: Qt walks it in `pymol_qt_gui.py:353` and Tk in
 * `pmg_tk/skins/normal/__init__.py:1072`. This client walks the same literal —
 * not a transcription of it. `bridge/tenmol_bridge/panels/menus.py` runs the
 * real `get_menudata` against a recording `cmd` proxy and emits
 * `features/menubar/generated/menudata.ts`; `bridge/tests/test_menus.py` fails
 * if that file drifts from a fresh harvest.
 *
 * WHY THE IMPORT CROSSES A FEATURE. The harvested tree is one document with
 * eleven top-level menus in it. Copying the four this panel renders into
 * `features/settings` would recreate exactly the transcription this module
 * exists to delete, so the generated module is imported read-only, the way any
 * feature imports a package.
 *
 * `menuData.ts` — the hand transcription that used to be rendered — survives as
 * an INDEPENDENT ORACLE for `p9menudata.test.ts`, which is the only thing that
 * can catch a harvester that is wrong rather than merely stale.
 */

import type { MenuNode, MenuSettingValue } from '@tenmol/protocol/topics/menus';
import type { SettingKind, SettingMeta, SettingValue } from '@tenmol/protocol';
import { MENU_DATA } from '../menubar/generated/menudata';

/**
 * The menus this renderer serves.
 *
 * Setting, Display, Mouse and Scene are the four `_gui.py` menus that are
 * (almost) entirely `check`/`radio` over settings — i.e. the four the parity
 * inventory asks one renderer to cover. File/Edit/Build/Movie/Wizard/Plugin/Help
 * are command menus and belong to the menu bar.
 */
export const PANEL_MENUS = ['Setting', 'Display', 'Mouse', 'Scene'] as const;

/** Provenance of the tree, for the "where did this come from" affordance. */
export const MENUDATA_SOURCE = MENU_DATA.source;

export type PanelMenuName = (typeof PANEL_MENUS)[number];

/** The items of one top-level menu of the harvested tree. */
export function menuSubtree(label: string): readonly MenuNode[] {
  const top = MENU_DATA.menus.find(
    (node) => node.kind === 'submenu' && node.label === label,
  );
  return top && top.kind === 'submenu' ? top.items : [];
}

/**
 * `layer1/Setting.h:113-120` order, which is what `get_setting_tuple` returns
 * and what `SettingAction` switches on (`pymol_qt_gui.py:1069-1075`).
 * `blank` is the retired slot (index 83) and is checkable by nothing.
 */
const KIND_TYPE: Record<SettingKind, number> = {
  boolean: 1,
  int: 2,
  float: 3,
  float3: 4,
  color: 5,
  string: 6,
  blank: 0,
};

export function settingType(kind: SettingKind): number {
  return KIND_TYPE[kind] ?? 0;
}

/**
 * Adapt WP-15's catalogue+value pair to the `{type, value}` pair the menu model
 * compares against. `values[0]` in Qt terms: a float3 has no scalar to compare,
 * and a boolean is reported as a number so `assembly`-style string toggles and
 * `cartoon_highlight_color`-style index toggles both work.
 */
export function menuValue(
  meta: SettingMeta | undefined,
  value: SettingValue | undefined,
): MenuSettingValue | undefined {
  if (!meta || value === undefined) return undefined;
  if (Array.isArray(value)) return { type: settingType(meta.kind), value: null };
  const scalar = typeof value === 'boolean' ? Number(value) : (value as number | string);
  return { type: settingType(meta.kind), value: scalar };
}

/* ------------------------------------------------------------------ *
 * Radio groups
 * ------------------------------------------------------------------ */

/**
 * A run of sibling `radio` nodes bound to the same setting.
 *
 * Qt keys its `QActionGroup`s by SETTING NAME (`pymol_qt_gui.py:1084-1090`:
 * `actiongroups.setdefault(setting, QActionGroup(...))`), so this is the same
 * grouping, computed from the same data. It matters for more than markup:
 * `Surface ▸ Cavities and Pockets Only|(Culled)|Exterior (Normal)` are three
 * `surface_cavity_mode` radios separated by two other submenus, and grouping
 * them by adjacency alone would make three groups of one.
 */
export type MenuGroup =
  | { kind: 'node'; node: MenuNode; index: number }
  | { kind: 'radios'; setting: string; nodes: readonly MenuNode[]; index: number };

/**
 * Group a sibling list. Radios sharing a setting join ONE group even when they
 * are not adjacent; the group takes the position of its first member, and a
 * separator between members does not split it — again as `QActionGroup` does,
 * which has no notion of position at all.
 */
export function groupRadios(nodes: readonly MenuNode[]): MenuGroup[] {
  const out: MenuGroup[] = [];
  const groupAt = new Map<string, number>();
  nodes.forEach((node, index) => {
    if (node.kind !== 'radio') {
      out.push({ kind: 'node', node, index });
      return;
    }
    const at = groupAt.get(node.setting);
    if (at === undefined) {
      groupAt.set(node.setting, out.length);
      out.push({ kind: 'radios', setting: node.setting, nodes: [node], index });
      return;
    }
    const group = out[at] as Extract<MenuGroup, { kind: 'radios' }>;
    group.nodes = [...group.nodes, node];
  });
  return out;
}

/** Every setting name bound anywhere under `label`, first-seen order. */
export function settingsUnder(label: string): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly MenuNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'submenu') walk(node.items);
      else if (node.kind === 'check' || node.kind === 'radio') {
        if (!out.includes(node.setting)) out.push(node.setting);
      }
    }
  };
  walk(menuSubtree(label));
  return out;
}
