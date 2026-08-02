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

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { MenuNode, MenuSettingValue } from '@tenmol/protocol/topics/menus';
import { baseLabel, describe, isCheckable, isChecked, isRadioActive } from './model';

/**
 * Where a NESTED list goes, in viewport coordinates.
 *
 * WHY IT IS NOT CSS ANY MORE. `.menu` caps its height and scrolls
 * (`menubar.css`), and CSS computes `overflow-x: visible` to `auto` the moment
 * `overflow-y` is not `visible`. Every menu was therefore a scroll container,
 * and the submenu it opens at `left: 100%` was OUTSIDE it and got CLIPPED —
 * not painted at all.
 *
 * MEASURED in a real 1280x900 browser before this fix, with `Display ▸ Stereo
 * Mode` open: the submenu reported a full bounding box (391.8, 340, 208x19 for
 * `off`) and `document.elementFromPoint` at its centre returned `CANVAS` — the
 * 3-D viewport, not the menu. The parent's `scrollWidth` was 418 against a
 * `clientWidth` of 208, i.e. the submenu had become horizontal scroll content.
 * A screenshot confirms it: the `Stereo Mode` row highlights and NO submenu
 * appears. All eleven menus were in that state. Playwright's own clicks worked
 * only because it scrolls a target into view first, which a mouse user cannot
 * do — the exact "reports a full box, cannot be clicked" trap.
 *
 * `position: fixed` leaves that clip entirely (a fixed box is not clipped by an
 * ancestor's `overflow`), and the price is that the coordinates come from here.
 * The anchor is the row that owns the list, which is the element's own parent.
 *
 * AFTER: `elementFromPoint` lands inside the row for all 684 leaves of all
 * eleven menus, four levels deep.
 */
function useSubmenuPosition(
  ref: RefObject<HTMLDivElement | null>,
  nested: boolean,
  deps: unknown,
): { left: number; top: number } | null {
  const [fixed, setFixed] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !nested) return;
    const anchor = el.parentElement;
    if (!anchor) return;
    const row = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    // A 210 px column opened four levels deep runs off a 1280 px window, so a
    // list that would overflow opens to the LEFT of its parent instead.
    const left = row.right + width > window.innerWidth - 4 ? row.left - width : row.right;
    // …and a long one (Open Recent holds 20 paths) is pulled up so its last row
    // is still on screen rather than below the fold.
    const top = Math.min(Math.max(4, row.top - 4), Math.max(4, window.innerHeight - height - 4));
    setFixed((previous) =>
      previous && previous.left === left && previous.top === top ? previous : { left, top },
    );
    // `deps` is the caller's node/item list: re-measure when the content that
    // decides the box changes, and only then.
  }, [ref, nested, deps]);
  return fixed;
}

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
  /**
   * Extra truth for an item that IS usable — appended to its tooltip.
   *
   * `describe()` is pure and says what the leaf will run; this says what the
   * user will then see, which can depend on live state `describe` cannot reach.
   * `Display ▸ Stereo Mode` is the case that needed it: every leaf runs, and
   * whether anything appears depends on which reps this browser is drawing
   * itself. Optional, so nothing else has to care.
   */
  annotate?: (node: MenuNode) => string | null;
}

export function MenuList({
  nodes,
  values,
  onPick,
  nested,
  renderDynamic,
  unavailable,
  annotate,
}: MenuListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  const fixed = useSubmenuPosition(ref, !!nested, nodes);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || nested) return;
    setFlip(el.getBoundingClientRect().right > window.innerWidth - 4);
  }, [nodes, nested]);

  return (
    <div
      className={'menu' + (nested ? ' menu--sub' : '') + (flip ? ' menu--flip' : '')}
      role="menu"
      ref={ref}
      style={nested && fixed ? { left: fixed.left, top: fixed.top } : undefined}
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
                    {...(annotate ? { annotate } : {})}
                  />
                ))}
            </div>
          );
        }

        const value = node.kind === 'check' || node.kind === 'radio' ? values[node.setting] : undefined;
        const blocked = unavailable(node);
        const extra = blocked ? null : (annotate?.(node) ?? null);
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
            title={
              blocked
                ? `${describe(node)} — ${blocked}`
                : extra
                  ? `${describe(node)} — ${extra}`
                  : describe(node)
            }
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
  // Same escape from the parent's scroll clip as a nested `MenuList` — and this
  // one needs the vertical clamp too: 20 recent paths is a 400 px list.
  const fixed = useSubmenuPosition(ref, true, items);

  return (
    <div
      className="menu menu--sub"
      role="menu"
      ref={ref}
      style={fixed ? { left: fixed.left, top: fixed.top } : undefined}
    >
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
