/**
 * The declarative menu-data renderer, and the Setting menu it renders.
 *
 * `get_menudata` (`modules/pymol/_gui.py:55-58`) exists precisely so that the
 * menu is toolkit-independent: Qt walks it in `pymol_qt_gui.py:353` and Tk in
 * `pmg_tk/skins/normal/__init__.py:1072`. This is the third consumer, and it
 * interprets the same five node kinds. Nothing about a setting is special-cased
 * here — a `check` is a check because the DATA says so.
 *
 * Radio state is a comparison against the LIVE value, never a local selection:
 * Qt does the same by registering each action in `setting_callbacks` and
 * re-reading on the `get_setting_updates` poll (`pymol_qt_gui.py:952-956`,
 * `:1065-1066`). Typing `set cartoon_ring_mode, 3` in the console therefore
 * moves the radio here too.
 */

import { useState } from 'react';
import type { SettingMeta, SettingValue } from '@tenmol/protocol';
import { SETTING_MENU, type MenuItem } from './menuData';

export interface MenuContext {
  byName: ReadonlyMap<string, SettingMeta>;
  /** Live value for a setting name, or undefined while it is not loaded. */
  valueOf(name: string): SettingValue | undefined;
  write(meta: SettingMeta, value: SettingValue): void;
  run(item: Extract<MenuItem, { kind: 'command' }>): void;
}

/** Numeric-tolerant equality; a float radio must match `0.5` read back as 0.5. */
export function valuesEqual(a: SettingValue | undefined, b: SettingValue): boolean {
  if (a === undefined) return false;
  if (typeof b === 'number') {
    const n = typeof a === 'boolean' ? Number(a) : Number(a);
    return Number.isFinite(n) && Math.abs(n - b) < 1e-6;
  }
  if (Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

export function MenuDataRenderer({
  items = SETTING_MENU,
  ctx,
  depth = 0,
}: {
  items?: readonly MenuItem[];
  ctx: MenuContext;
  depth?: number;
}) {
  return (
    <ul className="setmenu__list" data-depth={depth}>
      {items.map((item, i) => (
        <MenuNode key={`${item.kind}-${i}`} item={item} ctx={ctx} depth={depth} />
      ))}
    </ul>
  );
}

function MenuNode({
  item,
  ctx,
  depth,
}: {
  item: MenuItem;
  ctx: MenuContext;
  depth: number;
}) {
  const [open, setOpen] = useState(depth === 0 ? false : true);

  if (item.kind === 'separator') return <li className="setmenu__sep" aria-hidden />;

  if (item.kind === 'menu') {
    return (
      <li className="setmenu__submenu">
        <button
          type="button"
          className="setmenu__row setmenu__row--menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="setmenu__mark">{open ? '▾' : '▸'}</span>
          <span className="setmenu__label">{item.label}</span>
        </button>
        {open && <MenuDataRenderer items={item.items} ctx={ctx} depth={depth + 1} />}
      </li>
    );
  }

  if (item.kind === 'command') {
    return (
      <li>
        <button
          type="button"
          className="setmenu__row setmenu__row--command"
          title={item.echo}
          onClick={() => ctx.run(item)}
        >
          <span className="setmenu__mark" />
          <span className="setmenu__label">{item.label}</span>
        </button>
      </li>
    );
  }

  const meta = ctx.byName.get(item.setting);
  const value = ctx.valueOf(item.setting);
  const missing = meta === undefined;
  const checked =
    item.kind === 'check' ? valuesEqual(value, item.on) : valuesEqual(value, item.value);
  const target = item.kind === 'check' ? (checked ? item.off : item.on) : item.value;
  const title = missing
    ? `${item.setting} — not in this build's setting table`
    : `${item.setting} (${meta.level}) = ${value === undefined ? '?' : String(value)}`;

  return (
    <li>
      <button
        type="button"
        className={`setmenu__row setmenu__row--${item.kind}${checked ? ' is-on' : ''}`}
        disabled={missing}
        title={title}
        role={item.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
        aria-checked={checked}
        data-setting={item.setting}
        onClick={() => meta && ctx.write(meta, target)}
      >
        <span className="setmenu__mark">
          {item.kind === 'check' ? (checked ? '✓' : '') : checked ? '●' : '○'}
        </span>
        <span className="setmenu__label">{item.label}</span>
      </button>
    </li>
  );
}
