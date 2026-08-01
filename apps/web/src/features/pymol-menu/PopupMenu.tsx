/**
 * A PyMOL pop-up, rendered as DOM.
 *
 * Reproduced from `layer4/PopUp.cpp`:
 *  * row code 0 = separator bar, 1 = clickable leaf, 2 = non-clickable title
 *    (`:270-300`);
 *  * choosing a leaf executes its command string (`:471-475`) — so the leaf is
 *    sent through `t:'do'`, unmodified, and PyMOL echoes it into the console
 *    itself;
 *  * the menu is dismissed by a click outside, by Escape, and by choosing.
 *
 * NOT reproduced yet (WP-13 owns the full engine): lazily-expanded submenus
 * (`SubGetItem`), the 0.25 s submenu delay, sticky mode, and `\RGB` colour
 * escapes in labels.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession, useStoreState } from '../../app';
import { pymolMenu } from './menuStore';
import './pymol-menu.css';

export function PopupMenu() {
  const session = useSession();
  const state = useStoreState(pymolMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });

  useLayoutEffect(() => {
    if (!state.open) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(state.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(state.y, window.innerHeight - rect.height - 4)),
    });
  }, [state.open, state.x, state.y, state.epoch]);

  useEffect(() => {
    if (!state.open) return undefined;
    const onDown = (e: MouseEvent) => {
      // `target` is not necessarily a Node (an event dispatched at `window`
      // has none), and `Node.contains` throws on anything else.
      const target = e.target instanceof Node ? e.target : null;
      if (target === null || !ref.current?.contains(target)) pymolMenu.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        pymolMenu.close();
      }
    };
    // Capture phase: a click on another opener must dismiss this one first,
    // and the keyboard service must not see the Escape as a PyMOL keystroke.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [state.open]);

  if (!state.open) return null;

  return (
    <div className="pymenu" ref={ref} style={position} role="menu" data-testid="pymol-menu">
      {state.title !== '' && <div className="pymenu__head">{state.title}</div>}
      {state.rows.map((row, index) => {
        const [code, label, command] = row;
        if (code === 0) return <div className="pymenu__sep" key={index} />;
        if (code === 2) {
          return (
            <div className="pymenu__title" key={index}>
              {label}
            </div>
          );
        }
        return (
          <button
            type="button"
            className="pymenu__item"
            key={index}
            role="menuitem"
            title={command}
            onClick={() => {
              pymolMenu.close();
              void session.run(command);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
