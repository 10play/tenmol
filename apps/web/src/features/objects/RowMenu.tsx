/**
 * The popup a toggle button opens — driven entirely by JSON from
 * `pymol.menu.<name>`, never by a table in this file.
 *
 * `layer4/PopUp.cpp` semantics reproduced here:
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
 *   `\RGB`        text colour escapes (`layer1/Text.cpp:507-548`), including
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

/** `PopUp.cpp` opens a submenu 0.25 s after the pointer settles on its row. */
export const SUBMENU_DELAY_MS = 250;

export interface RowMenuProps {
  title: string;
  op: OpButton;
  /** The `pymol.menu` function that produced `items` (shown in the header). */
  menuName: string | null;
  items: readonly PanelMenuNode[];
  loading?: boolean;
  error?: string | null;
  anchor: { x: number; y: number };
  onPick: (command: string) => void;
  onExpand: (path: readonly number[]) => void;
  onClose: () => void;
}

export function RowMenu({
  title,
  op,
  menuName,
  items,
  loading,
  error,
  anchor,
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

  return (
    <div className="rowmenu" ref={ref} style={position} role="menu" data-testid="rowmenu">
      <div className="rowmenu__head">
        {OP_TITLES[op]} · {title}
        {menuName && <span className="rowmenu__src">{menuName}</span>}
      </div>
      {error && <div className="rowmenu__error">{error}</div>}
      {loading && !items.length && <div className="rowmenu__title">resolving…</div>}
      <MenuList items={items} onPick={onPick} onExpand={onExpand} depth={0} />
    </div>
  );
}

/** One level of the popup. Recurses for submenus, so nesting is unbounded. */
function MenuList({
  items,
  onPick,
  onExpand,
  depth,
}: {
  items: readonly PanelMenuNode[];
  onPick: (command: string) => void;
  onExpand: (path: readonly number[]) => void;
  depth: number;
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
          return (
            <button
              type="button"
              className="rowmenu__row"
              key={key}
              role="menuitem"
              title={node.command ?? ''}
              style={indentOf(node.text)}
              onMouseEnter={() => {
                cancel();
                setOpen(null);
              }}
              onClick={() => onPick(node.command ?? '')}
            >
              <Coded text={node.text} />
            </button>
          );
        }
        return (
          <div
            className="rowmenu__sub"
            key={key}
            onMouseEnter={() => arm(index, node)}
            onMouseLeave={cancel}
          >
            <button
              type="button"
              className={'rowmenu__row is-sub' + (open === index ? ' is-open' : '')}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === index}
              style={indentOf(node.text)}
              onClick={() => {
                cancel();
                if (open === index) {
                  setOpen(null);
                  return;
                }
                setOpen(index);
                if (node.lazy) onExpand(node.path);
              }}
            >
              <Coded text={node.text} />
              <span className="rowmenu__arrow">▸</span>
            </button>
            {open === index && (
              <div className="rowmenu__panel" style={{ zIndex: 310 + depth }}>
                {node.lazy && !node.items ? (
                  <div className="rowmenu__title">resolving…</div>
                ) : (
                  <MenuList
                    items={node.items ?? []}
                    onPick={onPick}
                    onExpand={onExpand}
                    depth={depth + 1}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
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
