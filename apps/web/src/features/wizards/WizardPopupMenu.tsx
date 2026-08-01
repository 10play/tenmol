/**
 * The popup a type-3 (`cWizTypePopUp`) panel row opens.
 *
 * `CWizard::click` calls `get_menu(code)` with the row's `code` as the tag and
 * opens `PopUpNew` if the result is not `None` (`layer1/Wizard.cpp:495-511`).
 * Item grammar, from `layer4/PopUp.cpp:231-248` and the heights at `:293-320`:
 *
 *   code 0  separator bar   — text and command ignored
 *   code 1  selectable item — third element is a command string, a nested list
 *                             (submenu) or a CALLABLE (lazy submenu, resolved
 *                             server-side by the bridge, `PopUp.cpp:88-105`)
 *   code 2  non-selectable title
 *
 * Leaves run through `wizards.exec_code` — PyMOL command language, PParse'd on
 * the server (`PopUp.cpp:471-473`). The browser never evaluates it.
 *
 * Menus are FETCHED ON EVERY OPEN and never cached: `density.py:160`,
 * `filter.py:236` and `command.py:87-104` rebuild them from live state, and
 * `measurement.py:108-128` splices in the current object/selection lists.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WizardMenuItem } from '@tenmol/protocol';
import { ColorCodedText } from './ColorCodedText';
import { stripColorCodes } from './colorCodes';

export interface WizardPopupMenuProps {
  title: string;
  items: WizardMenuItem[];
  anchor: { x: number; y: number };
  onPick(command: string): void;
  onClose(): void;
}

export function WizardPopupMenu({ title, items, anchor, onPick, onClose }: WizardPopupMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(anchor.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(anchor.y, window.innerHeight - rect.height - 4)),
    });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="wizmenu" ref={ref} style={position} role="menu" data-testid="wizard-menu">
      <div className="wizmenu__head">{stripColorCodes(title)}</div>
      <MenuItems items={items} onPick={onPick} depth={0} />
    </div>
  );
}

function MenuItems({
  items,
  onPick,
  depth,
}: {
  items: WizardMenuItem[];
  onPick(command: string): void;
  depth: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="wizmenu__body">
      {items.map((item, index) => {
        if (item.code === 0) return <div className="wizmenu__sep" key={index} role="separator" />;
        if (item.code === 2) {
          return (
            <div className="wizmenu__title" key={index}>
              <ColorCodedText text={item.text} />
            </div>
          );
        }
        if (item.submenu) {
          const isOpen = open === index;
          return (
            <div
              className={'wizmenu__sub' + (isOpen ? ' is-open' : '')}
              key={index}
              onMouseEnter={() => setOpen(index)}
            >
              <button
                type="button"
                className="wizmenu__item wizmenu__item--sub"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : index)}
              >
                <ColorCodedText text={item.text} />
                <span className="wizmenu__arrow">▸</span>
              </button>
              {isOpen && (
                <div className="wizmenu__flyout" style={{ marginLeft: 8 * (depth + 1) }}>
                  <MenuItems items={item.submenu} onPick={onPick} depth={depth + 1} />
                </div>
              )}
            </div>
          );
        }
        if (item.error) {
          return (
            <div className="wizmenu__error" key={index} title={item.error}>
              <ColorCodedText text={item.text} /> — {item.error}
            </div>
          );
        }
        const command = item.command ?? '';
        return (
          <button
            type="button"
            className="wizmenu__item"
            key={index}
            disabled={command === ''}
            title={command}
            onClick={() => onPick(command)}
          >
            <ColorCodedText text={item.text} />
          </button>
        );
      })}
    </div>
  );
}
