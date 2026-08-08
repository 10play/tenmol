/**
 * The popup a toggle button opens — driven entirely by JSON from
 * `pymol.menu.<name>`, never by a table in this file.
 *
 * `packages/engine/layer4/PopUp.cpp` semantics reproduced here:
 *   code 0        separator bar          (`:270-300`)
 *   code 1        clickable item
 *   code 2        non-clickable title
 *   submenu       opens on hover after `SUBMENU_DELAY_MS` (`PopUp.cpp:131-160`,
 *                 `0.25` s), placed on whichever side fits
 *   lazy submenu  a Python callable; resolved on first hover, which is what
 *                 `SubGetItem` (`:88-110`) does
 *   leaf          logs the command string and PParses it (`:471-475`) — here
 *                 `session.run(command)`, i.e. `{t:'do'}`, so the console shows
 *                 the same `PyMOL>` line the Qt build's log file gets
 *   `\RGB`        text colour escapes (`packages/engine/layer1/Text.cpp:507-548`), including
 *                 the `\933` that makes every delete/remove leaf red
 *
 * Sticky ("passive") mode: PyMOL makes a menu passive when the press and the
 * release are within 0.45 s of each other without dragging (`PopUp.cpp` press
 * timer). Every menu here is opened by a click, i.e. always passive, so it
 * stays open until Escape, an outside click or a leaf selection — which is the
 * behaviour a mouse user gets from the C++ menu too.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PanelMenuNode } from '@tenmol/protocol';
import { parseColorCodes, stripColorCodes } from '@tenmol/stores/objects';
import { OP_TITLES, type OpButton } from './menus';
import { POP_SCROLL_PX, placeChild, type Affinity } from './placement';
import { repCheck, type RepCheck } from './reps';

/** `PopUp.cpp` opens a submenu 0.25 s after the pointer settles on its row. */
export const SUBMENU_DELAY_MS = 250;

/** Props for {@link RowMenu}: the menu tree, anchor, rep state, and callbacks. */
export interface RowMenuProps {
  title: string;
  op: OpButton;
  /** The `pymol.menu` function that produced `items` (shown in the header). */
  menuName: string | null;
  items: readonly PanelMenuNode[];
  loading?: boolean;
  error?: string | null;
  anchor: { x: number; y: number };
  /**
   * The row's live rep bitmask (`cmd.get_vis()[name][2]`, re-packed by
   * `panels/objects.py:_rep_bitmask`). Drives the check marks PyMOL does not
   * draw; 0 or absent means "tick nothing".
   */
  reps?: number;
  /**
   * `internal_gui_mode`. `PopUp.cpp:144-164` builds the menu with white text
   * on {0.1,0.1,0.1} for Default (0) and inverts to black on white for
   * anything else, and the title bar goes {0.3,0.3,0.6} -> white (`:813-826`).
   */
  internalGuiMode?: number;
  onPick: (command: string) => void;
  onExpand: (path: readonly number[]) => void;
  onClose: () => void;
}

/** The popup menu for one object-panel row, mirroring PyMOL's `PopUp.cpp`. */
export function RowMenu({
  title,
  op,
  menuName,
  items,
  loading,
  error,
  anchor,
  reps = 0,
  internalGuiMode = 0,
  onPick,
  onExpand,
  onClose,
}: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(anchor.x, window.innerWidth - rect.width - 4));
    const top = Math.max(4, Math.min(anchor.y, window.innerHeight - rect.height - 4));
    setPosition({ left, top });
  }, [anchor.x, anchor.y, items.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest('.rowmenu')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // `capture` so a click anywhere, including on another toggle, closes first.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // `CPopUp::release` scrolls by a FIXED 10 px per wheel notch
  // (`PopUp.cpp:438-445`), in the opposite sense to the browser's own scroll,
  // and React's root wheel listener is passive so `preventDefault` from JSX is
  // ignored — the listener has to be attached by hand, exactly as the panel's
  // one-row wheel does (`ObjectPanel.tsx:154-164`).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const body = (event.target as HTMLElement | null)?.closest(
        '.rowmenu__panel, .rowmenu__body',
      ) as HTMLElement | null;
      const target = body ?? el.querySelector<HTMLElement>('.rowmenu__body');
      if (!target) return;
      event.preventDefault();
      target.scrollTop += Math.sign(event.deltaY) * POP_SCROLL_PX;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      className={'rowmenu' + (internalGuiMode !== 0 ? ' is-light' : '')}
      ref={ref}
      style={position}
      role="menu"
      data-testid="rowmenu"
      data-gui-mode={internalGuiMode}
    >
      <div className="rowmenu__head">
        {OP_TITLES[op]} · {title}
        {menuName && <span className="rowmenu__src">{menuName}</span>}
      </div>
      {error && <div className="rowmenu__error">{error}</div>}
      {loading && !items.length && <div className="rowmenu__title">resolving…</div>}
      <MenuList items={items} onPick={onPick} onExpand={onExpand} depth={0} reps={reps} />
    </div>
  );
}

/** One level of the popup. Recurses for submenus, so nesting is unbounded. */
function MenuList({
  items,
  onPick,
  onExpand,
  depth,
  reps,
  affinity,
}: {
  items: readonly PanelMenuNode[];
  onPick: (command: string) => void;
  onExpand: (path: readonly number[]) => void;
  depth: number;
  reps: number;
  /** The side this level was placed on; children inherit it (`Pop.cpp:131`). */
  affinity?: Affinity | undefined;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const arm = useCallback(
    (index: number, node: PanelMenuNode) => {
      cancel();
      timer.current = setTimeout(() => {
        setOpen(index);
        if (node.lazy) onExpand(node.path);
      }, SUBMENU_DELAY_MS);
    },
    [cancel, onExpand],
  );

  return (
    <div className="rowmenu__body" role="group">
      {items.map((node, index) => {
        const key = `${index}:${node.text}`;
        if (node.code === 0) return <div className="rowmenu__sep" key={key} />;
        if (node.code === 2) {
          return (
            <div className="rowmenu__title" key={key}>
              <Coded text={node.text} />
            </div>
          );
        }
        const isSub = node.lazy === true || node.items !== undefined;
        if (!isSub) {
          const check = repCheck(node.command, reps);
          return (
            <button
              type="button"
              className={'rowmenu__row' + (check === 'none' ? '' : ` is-rep-${check}`)}
              key={key}
              role="menuitem"
              {...(check === 'none' ? {} : { 'aria-checked': check === 'on' })}
              data-rep={check === 'none' ? undefined : check}
              title={node.command ?? ''}
              style={indentOf(node.text)}
              onMouseEnter={() => {
                cancel();
                setOpen(null);
              }}
              onClick={() => onPick(node.command ?? '')}
            >
              <RepTick check={check} />
              <Coded text={node.text} />
            </button>
          );
        }
        return (
          <SubMenu
            key={key}
            node={node}
            index={index}
            open={open === index}
            depth={depth}
            reps={reps}
            affinity={affinity}
            onArm={() => arm(index, node)}
            onCancel={cancel}
            onToggle={() => {
              cancel();
              if (open === index) {
                setOpen(null);
                return;
              }
              setOpen(index);
              if (node.lazy) onExpand(node.path);
            }}
            onPick={onPick}
            onExpand={onExpand}
          />
        );
      })}
    </div>
  );
}

/**
 * One submenu, placed by `PopPlaceChild` (`packages/engine/layer1/Pop.cpp:111-150`): the
 * inherited side first, the other side when the first one had to be clamped.
 */
function SubMenu({
  node,
  open,
  depth,
  reps,
  affinity,
  onArm,
  onCancel,
  onToggle,
  onPick,
  onExpand,
}: {
  node: PanelMenuNode;
  index: number;
  open: boolean;
  depth: number;
  reps: number;
  affinity?: Affinity | undefined;
  onArm: () => void;
  onCancel: () => void;
  onToggle: () => void;
  onPick: (command: string) => void;
  onExpand: (path: readonly number[]) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<Affinity>(affinity ?? 'right');

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const parent = panel.parentElement?.closest<HTMLElement>('.rowmenu__panel, .rowmenu');
    if (!parent) return;
    const box = parent.getBoundingClientRect();
    const width = panel.getBoundingClientRect().width || panel.offsetWidth;
    // A jsdom-shaped environment reports 0 for everything; a zero-width menu
    // "fits" on both sides and the flip would be meaningless, so leave the
    // inherited side alone rather than inventing one.
    if (width === 0 && box.width === 0) return;
    const placed = placeChild({
      parentLeft: box.left,
      parentRight: box.right,
      width,
      viewportWidth: window.innerWidth,
      ...(affinity ? { affinity } : {}),
    });
    setSide(placed.affinity);
  }, [open, affinity, node.items]);

  return (
    <div className="rowmenu__sub" onMouseEnter={onArm} onMouseLeave={onCancel}>
      <button
        type="button"
        className={'rowmenu__row is-sub' + (open ? ' is-open' : '')}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        style={indentOf(node.text)}
        onClick={onToggle}
      >
        <Coded text={node.text} />
        <span className="rowmenu__arrow">▸</span>
      </button>
      {open && (
        <div
          className={`rowmenu__panel rowmenu__panel--${side}`}
          ref={panelRef}
          data-side={side}
          style={{ zIndex: 310 + depth }}
        >
          {node.lazy && !node.items ? (
            <div className="rowmenu__title">resolving…</div>
          ) : (
            <MenuList
              items={node.items ?? []}
              onPick={onPick}
              onExpand={onExpand}
              depth={depth + 1}
              reps={reps}
              affinity={side}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The check mark PyMOL does not draw. `on` = every bit of the leaf's rep mask
 * is in `cmd.get_vis()[name][2]`; `partial` = some of them, which only a
 * combination leaf (`wire`, `licorice`) can produce.
 */
function RepTick({ check }: { check: RepCheck }) {
  if (check === 'none') return null;
  return (
    <span className="rowmenu__tick" aria-hidden="true">
      {check === 'on' ? '✓' : check === 'partial' ? '·' : ''}
    </span>
  );
}

/**
 * `rep_action` (`menu.py:145-176`) indents its sub-reps with two literal
 * spaces (`'  lines'`); PyMOL draws them as spaces in a fixed-width font, so
 * turning them into padding keeps the shape without inventing a data field.
 */
function indentOf(text: string): { paddingLeft: number } | undefined {
  const spaces = /^ +/.exec(text)?.[0].length ?? 0;
  return spaces ? { paddingLeft: 8 + spaces * 5 } : undefined;
}

/** A PyMOL string rendered with its `\RGB` colour escapes applied. */
export function Coded({ text }: { text: string }) {
  const spans = parseColorCodes(text);
  const plain = stripColorCodes(text);
  return (
    <span className="rowmenu__label" title={plain}>
      {spans.map((span, index) => (
        <span key={index} style={span.color ? { color: span.color } : undefined}>
          {span.text}
        </span>
      ))}
    </span>
  );
}
