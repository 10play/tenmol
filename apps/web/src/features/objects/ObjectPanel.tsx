/**
 * The object panel ("names list", the Executive block).
 *
 * In PyMOL this is drawn by C++ INSIDE the GL viewport (`CExecutive::draw`,
 * `layer3/Executive.cpp:16116-16541`). Here it is real DOM, fed by the poll in
 * `@tenmol/stores/objectsSource` (there is no push feed to subscribe to —
 * `ReportEnabledChange` only calls back under `_PYMOL_LIB`).
 *
 * Row anatomy, left to right (`docs/webclient/internal-gui.md` §1.2):
 *   group [+]/[-] | indent (nest_level × 8px) | name button | caption |
 *   A S H L C (M) toggles, each 17 px wide, right-aligned
 *
 * Click semantics reproduced from `CExecutive::click` (`:15260-15315`) and
 * `ExecutiveSpecSetVisibility` (`:15413-15487`):
 *
 *   left on name              toggle enable/disable  -> cmd.enable / cmd.disable
 *   shift+ctrl on name        enable + zoom          -> cmd.enable + cmd.zoom
 *   ctrl on name              enable only
 *   middle on name            center on it           -> cmd.center
 *   ctrl+middle               zoom to it             -> cmd.zoom
 *   ctrl+shift+middle         disable ALL, enable it -> exclusive activate
 *   toggle button             open that row's menu
 *
 * NOT reproduced (owner noted in the UI, not silently missing): drag-reorder and
 * re-grouping (`:15845-15870`, emits `cmd.order` / `group` / `ungroup`), the
 * vertical band-select drag (`:15680-15740`), and the group open/close state,
 * which PyMOL keeps in C++ `PanelRec.is_open` with no Python getter — collapse
 * here is client-side only.
 */

import { useState } from 'react';
import { displayName, panelActions, visibleRows, type PanelRow } from '@tenmol/stores';
import { useSession, useStore } from '../../app';
import { RowMenu } from './RowMenu';
import { MOTION_OP, OPS, type OpButton } from './menus';
import './objects.css';

interface OpenMenu {
  row: PanelRow;
  op: OpButton;
  anchor: { x: number; y: number };
}

export function ObjectPanel() {
  const session = useSession();
  const rows = useStore(session.stores.objects, (s) => s.rows);
  const collapsed = useStore(session.stores.objects, (s) => s.collapsed);
  const source = useStore(session.stores.objects, (s) => s.source);
  const error = useStore(session.stores.objects, (s) => s.lastError);
  const phase = useStore(session.stores.connection, (s) => s.phase);
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  // `get_op_cnt()` is 5, or 6 with the "3-Button Motions" mouse mode
  // (layer3/Executive.cpp:1749-1756). The mouse-mode block that would tell us
  // which is active is WP-?; until then, five.
  const ops: readonly OpButton[] = OPS;
  const shown = visibleRows(rows, collapsed);

  const onNameClick = (row: PanelRow, event: React.MouseEvent) => {
    const name = row.isAll ? 'all' : row.name;
    if (event.shiftKey && (event.ctrlKey || event.metaKey)) {
      void session.act(panelActions.enable(name)).then(() => session.act(panelActions.zoom(name)));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      void session.act(panelActions.enable(name));
      return;
    }
    void session.act(row.enabled ? panelActions.disable(name) : panelActions.enable(name));
  };

  const onNameAux = (row: PanelRow, event: React.MouseEvent) => {
    if (event.button !== 1) return; // middle only
    event.preventDefault();
    const name = row.isAll ? 'all' : row.name;
    if (event.ctrlKey && event.shiftKey) {
      // ZoomExclusiveActivate (Executive.cpp:15317-15322)
      void session
        .act(panelActions.disable('all'))
        .then(() => session.act(panelActions.enable(name)))
        .then(() => session.act(panelActions.zoom(name)));
      return;
    }
    void session.act(event.ctrlKey ? panelActions.zoom(name) : panelActions.center(name));
  };

  return (
    <div className="objpanel">
      <div className="objpanel__head">
        <span className="objpanel__head-title">Objects</span>
        <span className="objpanel__head-note" title={`row source: ${source}`}>
          {source === 'topic' ? 'pushed' : 'polled'}
        </span>
      </div>

      {error && <div className="objpanel__error">{error}</div>}

      {shown.length === 0 && (
        <div className="objpanel__empty">
          {phase === 'open'
            ? 'no objects — type `fragment ala` below'
            : 'not connected to a bridge'}
        </div>
      )}

      <div className="objpanel__rows">
        {shown.map((row) => (
          <div
            className={
              'objrow' +
              (row.enabled ? ' is-enabled' : '') +
              (row.cloaked ? ' is-cloaked' : '') +
              (row.isAll ? ' objrow--all' : '')
            }
            key={row.name}
          >
            {row.isGroup ? (
              <button
                type="button"
                className="objrow__group"
                title={
                  collapsed.includes(row.name)
                    ? 'expand group (client-side: PanelRec.is_open has no Python getter)'
                    : 'collapse group'
                }
                onClick={() => session.stores.objects.toggleCollapsed(row.name)}
              >
                {collapsed.includes(row.name) ? '+' : '-'}
              </button>
            ) : (
              <span className="objrow__group objrow__group--empty" />
            )}

            <button
              type="button"
              className="objrow__name"
              style={row.nest > 0 ? { marginLeft: row.nest * 8 } : undefined}
              title={rowTooltip(row)}
              onClick={(e) => onNameClick(row, e)}
              onAuxClick={(e) => onNameAux(row, e)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="objrow__name-text">{displayName(row)}</span>
              {row.atoms !== null && <span className="objrow__caption">{row.atoms}</span>}
            </button>

            <div className="objrow__ops">
              {ops.map((op) => (
                <button
                  type="button"
                  key={op}
                  className={`objrow__op objrow__op--${op.toLowerCase()}`}
                  title={`${op} menu`}
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ row, op, anchor: { x: rect.left - 190, y: rect.bottom + 2 } });
                  }}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="objpanel__foot">
        <span title="drag-reorder and re-grouping emit cmd.order / group / ungroup (Executive.cpp:15845-15870)">
          reorder / group drag: WP-12
        </span>
        <span title="M column appears when button_mode_name == '3-Button Motions' (Executive.cpp:1749-1756)">
          {MOTION_OP} column: WP-20
        </span>
      </div>

      {menu && (
        <RowMenu row={menu.row} op={menu.op} anchor={menu.anchor} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

function rowTooltip(row: PanelRow): string {
  const bits = [row.name, row.type];
  if (row.atoms !== null) bits.push(`${row.atoms} atoms`);
  if (row.color !== null) bits.push(`color index ${row.color}`);
  if (row.cloaked) bits.push('cloaked (enabled inside a disabled group)');
  if (row.nestInferred) bits.push(`group "${row.group}" inferred from the dotted name`);
  bits.push('click: toggle · ctrl: enable · ctrl+shift: enable+zoom · middle: center');
  return bits.join(' · ');
}
