/**
 * The Movie menu (`_gui.py:234-375`) as a cascading DOM menu, plus the
 * Camera/Object Motion context menus (`menu.py:108,126`).
 *
 * Check and radio items bind to a live setting read: a checkbox that lies about
 * `movie_loop` is worse than no checkbox, so the state comes from the polled
 * `MovieSettings`, never from local state.
 */

import { useState } from 'react';
import type { MovieSettings } from '@tenmol/protocol/topics/movie';
import { MOVIE_MENU, type MovieMenuNode } from './movieMenu';
import type { MotionItem } from './motionMenu';

interface MovieMenuProps {
  settings: MovieSettings;
  onCommand: (line: string) => void;
  onCall: (fn: string, args: readonly unknown[]) => void;
  onProgram: (template: string) => void;
  onProgramUpdate: () => void;
  onProgramRemove: () => void;
  onSetting: (name: string, value: number) => void;
}

function settingValue(settings: MovieSettings, name: string): unknown {
  return (settings as unknown as Record<string, unknown>)[name];
}

/** Recursively renders a list of movie-menu nodes as a cascading DOM menu. */
export function MovieMenuTree({
  nodes,
  ...handlers
}: MovieMenuProps & { nodes: readonly MovieMenuNode[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const { settings } = handlers;

  return (
    <ul className="mvmenu__list">
      {nodes.map((node, index) => {
        if (node.kind === 'separator') {
          return <li className="mvmenu__sep" key={`sep-${index}`} />;
        }
        if (node.kind === 'menu') {
          const isOpen = open === node.label;
          return (
            <li className="mvmenu__item mvmenu__item--sub" key={node.label}>
              <button
                type="button"
                className={`mvmenu__btn${isOpen ? ' is-open' : ''}`}
                onClick={() => setOpen(isOpen ? null : node.label)}
              >
                <span>{node.label}</span>
                <span className="mvmenu__arrow">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="mvmenu__sub">
                  <MovieMenuTree nodes={node.items} {...handlers} />
                </div>
              )}
            </li>
          );
        }
        if (node.kind === 'check') {
          const on = settingValue(settings, node.setting) === true;
          return (
            <li className="mvmenu__item" key={node.label}>
              <button
                type="button"
                className="mvmenu__btn"
                onClick={() => handlers.onSetting(node.setting, on ? 0 : 1)}
              >
                <span className="mvmenu__mark">{on ? '✓' : ''}</span>
                {node.label}
              </button>
            </li>
          );
        }
        if (node.kind === 'radio') {
          const on = Number(settingValue(settings, node.setting)) === node.value;
          return (
            <li className="mvmenu__item" key={node.label}>
              <button
                type="button"
                className="mvmenu__btn"
                onClick={() => handlers.onSetting(node.setting, node.value)}
              >
                <span className="mvmenu__mark">{on ? '●' : ''}</span>
                {node.label}
              </button>
            </li>
          );
        }
        if (node.kind === 'command') {
          return (
            <li className="mvmenu__item" key={node.label}>
              <button
                type="button"
                className="mvmenu__btn"
                onClick={() => handlers.onCommand(node.command)}
              >
                <span className="mvmenu__mark" />
                {node.label}
              </button>
            </li>
          );
        }
        if (node.kind === 'call') {
          return (
            <li className="mvmenu__item" key={node.label}>
              <button
                type="button"
                className="mvmenu__btn"
                onClick={() => handlers.onCall(node.fn, node.args)}
              >
                <span className="mvmenu__mark" />
                {node.label}
              </button>
            </li>
          );
        }
        if (node.kind === 'program') {
          return (
            <li className="mvmenu__item" key={node.label}>
              <button
                type="button"
                className="mvmenu__btn"
                title={node.template}
                onClick={() => handlers.onProgram(node.template)}
              >
                <span className="mvmenu__mark" />
                {node.label}
              </button>
            </li>
          );
        }
        return (
          <li className="mvmenu__item" key={node.label}>
            <button
              type="button"
              className="mvmenu__btn"
              onClick={() =>
                node.kind === 'program-update'
                  ? handlers.onProgramUpdate()
                  : handlers.onProgramRemove()
              }
            >
              <span className="mvmenu__mark" />
              {node.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The full Movie menu, rendered from `MOVIE_MENU`. */
export function MovieMenu(props: MovieMenuProps) {
  return (
    <div className="mvmenu">
      <MovieMenuTree nodes={MOVIE_MENU} {...props} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * motion context menu
 * ------------------------------------------------------------------ */

interface MotionMenuProps {
  items: readonly MotionItem[];
  at: { x: number; y: number };
  onCommand: (line: string) => void;
  onClose: () => void;
}

/** The Camera/Object Motion context menu, popped up at a screen point. */
export function MotionMenu({ items, at, onCommand, onClose }: MotionMenuProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="mvpopup__scrim" onClick={onClose} role="presentation">
      <div
        className="mvpopup"
        style={{ left: at.x, top: at.y }}
        onClick={(event) => event.stopPropagation()}
        role="menu"
      >
        {items.map((item, index) => {
          if (item.separator) return <div className="mvmenu__sep" key={`s${index}`} />;
          if (item.header)
            return (
              <div className="mvpopup__head" key={item.label}>
                {item.label}
              </div>
            );
          if (item.items) {
            const isOpen = open === item.label;
            return (
              <div key={item.label}>
                <button
                  type="button"
                  className="mvmenu__btn"
                  onClick={() => setOpen(isOpen ? null : item.label)}
                >
                  <span>{item.label}</span>
                  <span className="mvmenu__arrow">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="mvmenu__sub">
                    {item.items.map((child, childIndex) =>
                      child.separator ? (
                        <div className="mvmenu__sep" key={`cs${childIndex}`} />
                      ) : child.header ? (
                        <div className="mvpopup__head" key={child.label}>
                          {child.label}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mvmenu__btn"
                          key={child.label}
                          title={child.command}
                          onClick={() => {
                            if (child.command) onCommand(child.command);
                            onClose();
                          }}
                        >
                          {child.label}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          }
          return (
            <button
              type="button"
              className="mvmenu__btn"
              key={item.label}
              title={item.command}
              onClick={() => {
                if (item.command) onCommand(item.command);
                onClose();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
