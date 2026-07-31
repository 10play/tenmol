/**
 * The popup a toggle button opens.
 *
 * `layer4/PopUp.cpp` semantics that are reproduced here: code 0 draws a
 * separator bar, code 1 is clickable, code 2 is a non-clickable title
 * (`:270-300`), and selecting a leaf executes its command (`:471-475`). What is
 * NOT reproduced — nested submenus, lazy `SubGetItem` expansion, `\RGB` text
 * colour codes in labels — is exactly what WP-13's popup engine is for; those
 * rows render as disabled TODOs naming the owner.
 *
 * Positioning is fixed-to-viewport and flipped when it would overflow, because
 * the panel column is only 220 px wide and the colour menu is tall.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from '../../app';
import { menuFor, OP_TITLES, type MenuItem, type OpButton } from './menus';
import type { PanelRow } from '@tenmol/stores';

export interface RowMenuProps {
  row: PanelRow;
  op: OpButton;
  anchor: { x: number; y: number };
  onClose: () => void;
}

export function RowMenu({ row, op, anchor, onClose }: RowMenuProps) {
  const session = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  const items = menuFor(row, op);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(anchor.x, window.innerWidth - rect.width - 4));
    const top = Math.max(4, Math.min(anchor.y, window.innerHeight - rect.height - 4));
    setPosition({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
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
    <div className="rowmenu" ref={ref} style={position} role="menu">
      <div className="rowmenu__head">
        {OP_TITLES[op]} · {row.isAll ? 'all' : row.name}
      </div>
      <div className="rowmenu__body">
        {items.map((entry, index) => (
          <MenuRow
            key={index}
            entry={entry}
            onPick={(item) => {
              onClose();
              void session.act(item.action);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function MenuRow({
  entry,
  onPick,
}: {
  entry: MenuItem;
  onPick: (item: Extract<MenuItem, { kind: 'item' }>) => void;
}) {
  switch (entry.kind) {
    case 'sep':
      return <div className="rowmenu__sep" />;
    case 'title':
      return <div className="rowmenu__title">{entry.label}</div>;
    case 'todo':
      return (
        <div className="rowmenu__row is-todo" title={`${entry.owner}: ${entry.note}`}>
          <span className="rowmenu__label">{entry.label}</span>
          <span className="rowmenu__owner">{entry.owner}</span>
        </div>
      );
    case 'item':
      return (
        <button
          type="button"
          className="rowmenu__row"
          style={entry.indent ? { paddingLeft: 8 + entry.indent * 10 } : undefined}
          title={entry.action.echo}
          onClick={() => onPick(entry)}
          role="menuitem"
        >
          {entry.swatch && (
            <span className="rowmenu__swatch" style={{ background: entry.swatch }} />
          )}
          <span className="rowmenu__label">{entry.label}</span>
        </button>
      );
  }
}
