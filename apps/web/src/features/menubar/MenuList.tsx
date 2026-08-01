/**
 * One popup list. Recursive: a `submenu` node renders another `<MenuList>`.
 *
 * This is the whole rendering surface of the menu bar — ~700 leaves, eleven
 * top-level menus, none of them written by hand. Every branch below is one
 * branch of `_addmenu` (`modules/pmg_qt/pymol_qt_gui.py:295-345`).
 *
 * Check and radio state is READ LIVE from `cmd.get_setting_tuple`, never stored
 * in the tree and never kept in component state: Qt does the same through
 * `setting_callbacks`, and a menu that remembers its own checkmarks lies as
 * soon as the user types `set cartoon_fancy_helices, 1` in the console.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuNode, MenuSettingValue } from '@tenmol/protocol/topics/menus';
import { baseLabel, describe, isCheckable, isChecked, isRadioActive } from './model';

export interface MenuListProps {
  nodes: readonly MenuNode[];
  values: Readonly<Record<string, MenuSettingValue>>;
  onPick: (node: MenuNode) => void;
  /** True for a nested list (positions itself beside its parent row). */
  nested?: boolean;
  /** Renders the `dynamic` node's children. */
  renderDynamic: (node: Extract<MenuNode, { kind: 'dynamic' }>) => React.ReactNode;
  /** Reason this item cannot be used, or null. Drives the disabled state. */
  unavailable: (node: MenuNode) => string | null;
}

export function MenuList({
  nodes,
  values,
  onPick,
  nested,
  renderDynamic,
  unavailable,
}: MenuListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);

  // A 210 px column opened four levels deep runs off a 1280 px window, so a
  // list that would overflow opens to the LEFT of its parent instead.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFlip(rect.right > window.innerWidth - 4);
  }, [nodes]);

  return (
    <div
      className={'menu' + (nested ? ' menu--sub' : '') + (flip ? ' menu--flip' : '')}
      role="menu"
      ref={ref}
    >
      {nodes.map((node, index) => {
        if (node.kind === 'separator') return <div className="menu__sep" key={index} />;

        if (node.kind === 'error') {
          return (
            <div className="menu__row is-disabled" key={index} title={node.raw}>
              <span className="menu__mark"> </span>
              <span className="menu__label">unparsable item</span>
            </div>
          );
        }

        if (node.kind === 'submenu' || node.kind === 'dynamic') {
          const open = openIndex === index;
          return (
            <div
              className={'menu__row menu__row--sub' + (open ? ' is-open' : '')}
              key={index}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              onMouseEnter={() => setOpenIndex(index)}
              onFocus={() => setOpenIndex(index)}
              tabIndex={0}
            >
              <span className="menu__mark"> </span>
              <span className="menu__label">{node.label}</span>
              <span className="menu__arrow">▸</span>
              {open &&
                (node.kind === 'dynamic' ? (
                  renderDynamic(node)
                ) : (
                  <MenuList
                    nodes={node.items}
                    values={values}
                    onPick={onPick}
                    nested
                    renderDynamic={renderDynamic}
                    unavailable={unavailable}
                  />
                ))}
            </div>
          );
        }

        const value = node.kind === 'check' || node.kind === 'radio' ? values[node.setting] : undefined;
        const blocked = unavailable(node);
        // A `check` on a setting type SettingAction refuses to make checkable
        // (`print('TODO', type_, name)`) is shown but never ticked.
        const checkable = node.kind === 'check' ? isCheckable(value) : true;
        const mark =
          node.kind === 'check'
            ? checkable && isChecked(node, value)
              ? '✓'
              : ' '
            : node.kind === 'radio'
              ? isRadioActive(node, value)
                ? '●'
                : ' '
              : ' ';

        return (
          <button
            type="button"
            className={'menu__row' + (blocked ? ' is-disabled' : '')}
            key={index}
            role="menuitem"
            disabled={!!blocked}
            title={blocked ? `${describe(node)} — ${blocked}` : describe(node)}
            onMouseEnter={() => setOpenIndex(null)}
            onClick={() => onPick(node)}
          >
            <span className="menu__mark">{mark}</span>
            <span className="menu__label">{baseLabel(node.label, node.accel)}</span>
            {node.accel && <span className="menu__accel">{node.accel}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The `Open Recent...` body: fetched when the submenu opens, never cached long. */
export function DynamicList({
  items,
  empty,
  onPick,
}: {
  items: readonly { label: string; value: string }[];
  empty: string;
  onPick: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setFlip(el.getBoundingClientRect().right > window.innerWidth - 4);
  }, [items]);

  return (
    <div className={'menu menu--sub' + (flip ? ' menu--flip' : '')} role="menu" ref={ref}>
      {items.length === 0 ? (
        <div className="menu__row is-disabled">
          <span className="menu__mark"> </span>
          <span className="menu__label">{empty}</span>
        </div>
      ) : (
        items.map((item) => (
          <button
            type="button"
            className="menu__row"
            key={item.value}
            role="menuitem"
            title={item.value}
            onClick={() => onPick(item.value)}
          >
            <span className="menu__mark"> </span>
            <span className="menu__label">{item.label}</span>
          </button>
        ))
      )}
    </div>
  );
}
