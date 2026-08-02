import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuItem } from './menuData';
import { MENU_BAR } from './menuData';
import { useBridge } from '../bridge/BridgeContext';

/**
 * Menu bar. Mirrors `PyMOLQtGUI._addmenu` (packages/engine/modules/pmg_qt/pymol_qt_gui.py:295-344):
 * the same six item kinds, submenus as flyouts, and every leaf ultimately turning into
 * either a raw command line (`{t:'do'}`) or a dialog request.
 *
 * Not implemented yet (deliberate, not forgotten):
 *  - tear-off menus (`setTearOffEnabled(True)`, pymol_qt_gui.py:297)
 *  - live check/radio state: it comes from the `settings` topic driven by
 *    `cmd.get_setting_updates()` (pymol_qt_gui.py:952-957). Until that arrives the
 *    indicators render in an "unknown" state rather than lying about the backend.
 *  - the dynamic `Open Recent...` submenu (recent-files sqlite DB, _gui.py).
 */

interface MenuBarProps {
  onDialog?: (dialog: string) => void;
}

export function MenuBar({ onDialog }: MenuBarProps) {
  const bridge = useBridge();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenIndex(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenIndex(null);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openIndex]);

  const activate = useCallback(
    (item: MenuItem) => {
      setOpenIndex(null);
      switch (item.kind) {
        case 'command':
          if (item.cmd) {
            void bridge.do(item.cmd).catch(() => undefined);
          } else if (item.dialog) {
            onDialog?.(item.dialog);
            bridge.appendFeedback([` [stub] dialog requested: ${item.dialog}`]);
          }
          break;
        case 'check':
          // pymol_qt_gui.py:1041-1082 -- SettingAction toggles with log=1, quiet=0.
          bridge.appendFeedback([` [stub] toggle setting: ${item.setting}`]);
          break;
        case 'radio':
          void bridge
            .do(`set ${item.setting}, ${String(item.value)}, log=1, quiet=0`)
            .catch(() => undefined);
          break;
        default:
          break;
      }
    },
    [bridge, onDialog],
  );

  return (
    <div className="menubar" ref={rootRef} role="menubar">
      {MENU_BAR.map((menu, i) => (
        <div className="menubar__item-wrap" key={menu.label}>
          <button
            type="button"
            className={'menubar__item' + (openIndex === i ? ' is-open' : '')}
            aria-haspopup="true"
            aria-expanded={openIndex === i}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpenIndex(openIndex === i ? null : i);
            }}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(i);
            }}
          >
            {menu.label}
          </button>
          {openIndex === i && <MenuList items={menu.items} onActivate={activate} />}
        </div>
      ))}
      <div className="menubar__spacer" />
      <div className="menubar__title" title="Window title tracks the `session_file` setting">
        PyMOL
      </div>
    </div>
  );
}

function MenuList({
  items,
  onActivate,
  nested = false,
}: {
  items: MenuItem[];
  onActivate: (item: MenuItem) => void;
  nested?: boolean;
}) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <div className={'menu' + (nested ? ' menu--sub' : '')} role="menu">
      {items.map((item, i) => {
        if (item.kind === 'separator') {
          return <div className="menu__sep" key={`sep-${i}`} role="separator" />;
        }
        if (item.kind === 'recent') {
          return (
            <div className="menu__row is-disabled" key="recent" role="menuitem" aria-disabled>
              <span className="menu__mark" />
              <span className="menu__label">Open Recent...</span>
              <span className="menu__arrow">&#9656;</span>
            </div>
          );
        }
        if (item.kind === 'menu') {
          return (
            <div
              className={'menu__row has-sub' + (openSub === i ? ' is-open' : '')}
              key={item.label}
              role="menuitem"
              onMouseEnter={() => setOpenSub(i)}
              onMouseLeave={() => setOpenSub((cur) => (cur === i ? null : cur))}
            >
              <span className="menu__mark" />
              <span className="menu__label">{item.label}</span>
              <span className="menu__arrow">&#9656;</span>
              {openSub === i && <MenuList items={item.items} onActivate={onActivate} nested />}
            </div>
          );
        }
        const mark =
          item.kind === 'check' ? (
            <span className="menu__mark" title="state unknown -- needs the `settings` topic">
              ?
            </span>
          ) : item.kind === 'radio' ? (
            <span className="menu__mark menu__mark--radio" title="state unknown">
              &#8226;
            </span>
          ) : (
            <span className="menu__mark" />
          );
        return (
          <div
            className="menu__row"
            key={`${item.kind}-${item.label}`}
            role="menuitem"
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => onActivate(item)}
          >
            {mark}
            <span className="menu__label">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
