/**
 * The declarative menu-data renderer.
 *
 * `get_menudata` (`packages/engine/modules/pymol/_gui.py:55-58`) exists precisely so that the
 * menu is toolkit-independent: Qt walks it in `pymol_qt_gui.py:353` and Tk in
 * `pmg_tk/skins/normal/__init__.py:1072`. This is the third consumer, and it
 * interprets the node kinds as DATA — a `check` is a check because the DATA
 * says so. It renders whichever subtree it is handed, which is why the same
 * component draws the Setting, Display, Mouse and Scene menus.
 *
 * WHAT CHANGED, and why it matters. The nodes are now the HARVESTED ones
 * (`features/menubar/generated/menudata.ts`, produced by
 * `packages/bridge/tenmol_bridge/panels/menus.py` from the real `get_menudata`), not a
 * transcription of `_gui.py` living in this directory. A transcription can be
 * right and still rot; this cannot drift without `packages/bridge/tests/test_menus.py`
 * going red.
 *
 * Radio state is a comparison against the LIVE value, never a local selection:
 * Qt does the same by registering each action in `setting_callbacks` and
 * re-reading on the `get_setting_updates` poll (`pymol_qt_gui.py:952-956`,
 * `:1065-1066`). Typing `set cartoon_ring_mode, 3` in the console therefore
 * moves the radio here too.
 *
 * The check rule is Qt's, not "equals the true value":
 * `lambda v: action.setChecked(v != false_value)` (`pymol_qt_gui.py:1065`),
 * shared with the menu bar through `features/menubar/model.ts` so the two
 * surfaces can never disagree about what "on" means.
 */

import { useState } from 'react';
import type {
  MenuCommandNode,
  MenuNode,
  MenuSettingValue,
  MenuValue,
} from '@tenmol/protocol/topics/menus';
import {
  baseLabel,
  describe,
  isCheckable,
  isChecked,
  isRadioActive,
} from '../menubar/model';
import { groupRadios, type MenuGroup } from './menuTree';

/** The live-state and action callbacks the menu renderer needs to render a menu tree. */
export interface MenuContext {
  /** Live `{type, value}` for a setting name, or undefined while unloaded. */
  valueOf(name: string): MenuSettingValue | undefined;
  /** `cmd.set(name, value, log=1, quiet=0)` — the row's own writer. */
  write(setting: string, value: MenuValue): void;
  /** A `command` node the user chose. */
  run(node: MenuCommandNode): void;
  /** A `= None` toolkit seam that somebody has filled, or undefined. */
  hook(name: string): ((args: unknown[]) => void | Promise<void>) | undefined;
  /** Why an unfilled seam is unfilled — shown in the disabled item's tooltip. */
  hookNote(name: string): string;
}

/** Renders a `menudata` node tree as nested lists, grouping radios into their own group. */
export function MenuDataRenderer({
  nodes,
  ctx,
  depth = 0,
}: {
  nodes: readonly MenuNode[];
  ctx: MenuContext;
  depth?: number;
}) {
  return (
    <ul className="setmenu__list" data-depth={depth}>
      {groupRadios(nodes).map((group) =>
        group.kind === 'radios' ? (
          <li className="setmenu__group" key={`g-${group.setting}-${group.index}`}>
            {/*
              * `actiongroups.setdefault(setting, QActionGroup(self))`
              * (`pymol_qt_gui.py:1084`) — the group is keyed by SETTING NAME,
              * so that is the key here and the accessible name too.
              */}
            <ul
              className="setmenu__list setmenu__list--radios"
              role="group"
              aria-label={group.setting}
              data-radio-group={group.setting}
            >
              {group.nodes.map((node, i) => (
                <MenuNodeView key={`r-${i}`} node={node} ctx={ctx} depth={depth} />
              ))}
            </ul>
          </li>
        ) : (
          <MenuNodeView
            key={`n-${group.index}`}
            node={group.node}
            ctx={ctx}
            depth={depth}
          />
        ),
      )}
    </ul>
  );
}

function MenuNodeView({
  node,
  ctx,
  depth,
}: {
  node: MenuNode;
  ctx: MenuContext;
  depth: number;
}) {
  const [open, setOpen] = useState(depth > 0);

  if (node.kind === 'separator') return <li className="setmenu__sep" aria-hidden />;

  if (node.kind === 'error') {
    return (
      <li>
        <span className="setmenu__row setmenu__row--error" title={node.raw}>
          <span className="setmenu__mark">!</span>
          <span className="setmenu__label">unrenderable item</span>
        </span>
      </li>
    );
  }

  if (node.kind === 'submenu') {
    return (
      <li className="setmenu__submenu">
        <button
          type="button"
          className="setmenu__row setmenu__row--menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="setmenu__mark">{open ? '▾' : '▸'}</span>
          <span className="setmenu__label">{baseLabel(node.label, node.accel)}</span>
          {node.accel && <span className="setmenu__accel">{node.accel}</span>}
        </button>
        {open && <MenuDataRenderer nodes={node.items} ctx={ctx} depth={depth + 1} />}
      </li>
    );
  }

  if (node.kind === 'dynamic') {
    // `('open_recent_menu',)`. Rebuilt from `~/.pymol/recent.db` by the menu
    // bar; none of the four menus this panel draws contains one, so it renders
    // as what it is rather than as a dead row.
    return (
      <li>
        <span className="setmenu__row setmenu__row--dynamic" title={describe(node)}>
          <span className="setmenu__mark">…</span>
          <span className="setmenu__label">{node.label}</span>
        </span>
      </li>
    );
  }

  if (node.kind === 'command') {
    const action = node.action;
    const hooked = action.type === 'hook' ? ctx.hook(action.hook) : undefined;
    const dead =
      action.type === 'dropped' || (action.type === 'hook' && hooked === undefined);
    const title =
      action.type === 'hook' && hooked === undefined
        ? ctx.hookNote(action.hook)
        : describe(node);

    if (action.type === 'url') {
      return (
        <li>
          <a
            className="setmenu__row setmenu__row--command"
            href={action.url}
            target="_blank"
            rel="noreferrer"
            title={action.url}
          >
            <span className="setmenu__mark" />
            <span className="setmenu__label">{baseLabel(node.label, node.accel)}</span>
          </a>
        </li>
      );
    }

    return (
      <li>
        <button
          type="button"
          className="setmenu__row setmenu__row--command"
          title={title}
          disabled={dead}
          onClick={() => ctx.run(node)}
        >
          <span className="setmenu__mark" />
          <span className="setmenu__label">{baseLabel(node.label, node.accel)}</span>
          {node.accel && <span className="setmenu__accel">{node.accel}</span>}
        </button>
      </li>
    );
  }

  const value = ctx.valueOf(node.setting);
  const missing = value === undefined;
  const checked =
    node.kind === 'check' ? isChecked(node, value) : isRadioActive(node, value);
  // `SettingAction` refuses to make a float3 checkable and prints
  // `TODO 4 <name>` (`pymol_qt_gui.py:1069-1078`); radios go through a
  // different branch and are always checkable.
  const uncheckable = node.kind === 'check' && !missing && !isCheckable(value);
  const target = node.kind === 'check' ? (checked ? node.falseValue : node.trueValue) : node.value;
  const title = missing
    ? `${node.setting} — not in this build's setting table`
    : uncheckable
      ? `${node.setting} — type ${value.type} is not checkable (pymol_qt_gui.py:1069)`
      : `${describe(node)}  ·  now ${String(value.value)}`;

  return (
    <li>
      <button
        type="button"
        className={`setmenu__row setmenu__row--${node.kind}${checked ? ' is-on' : ''}`}
        disabled={missing || uncheckable}
        title={title}
        role={node.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
        aria-checked={checked}
        data-setting={node.setting}
        onClick={() => ctx.write(node.setting, target)}
      >
        <span className="setmenu__mark">
          {node.kind === 'check' ? (checked ? '✓' : '') : checked ? '●' : '○'}
        </span>
        <span className="setmenu__label">{baseLabel(node.label, node.accel)}</span>
        {node.accel && <span className="setmenu__accel">{node.accel}</span>}
      </button>
    </li>
  );
}

export type { MenuGroup };
