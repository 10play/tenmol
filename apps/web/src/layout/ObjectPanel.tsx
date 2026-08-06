import { useState } from 'react';
import type { PanelRow } from './placeholderData';
import { PLACEHOLDER_PANEL } from './placeholderData';
import { useBridge } from '../bridge/BridgeContext';

/**
 * The object panel ("names list", the Executive block).
 *
 * In PyMOL today this is drawn by C++ *inside* the GL viewport
 * (`CExecutive::draw`, packages/engine/layer3/Executive.cpp:16116-16541). Here it is real DOM.
 *
 * Row anatomy, left to right (docs/internal-gui.md §1.2):
 *   scrollbar gutter | group [+]/[-] | indent (nest_level * 8px) | name button |
 *   caption | A S H L C (M) toggles, each 17px wide, right-aligned
 *
 * The toggle column index is computed exactly as in `CExecutive::click`
 * (packages/engine/layer3/Executive.cpp:14992-15258): 0=A 1=S 2=H 3=L 4=C 5=M, and `get_op_cnt()`
 * (packages/engine/layer3/Executive.cpp:1749-1756) is 5 normally, 6 when
 * `button_mode_name == "3-Button Motions"`.
 */

const OPS = ['A', 'S', 'H', 'L', 'C'] as const;
const MOTION_OP = 'M' as const;

interface ObjectPanelProps {
  /** setting `button_mode_name`; "3-Button Motions" adds the M column. */
  buttonModeName: string;
}

/** The object ("names list") panel: one row per object with its A/S/H/L/C(/M) toggles. */
export function ObjectPanel({ buttonModeName }: ObjectPanelProps) {
  const bridge = useBridge();
  const [rows, setRows] = useState<PanelRow[]>(PLACEHOLDER_PANEL);
  const ops: readonly string[] = buttonModeName === '3-Button Motions' ? [...OPS, MOTION_OP] : OPS;

  const visible = rows.filter((r) => r.nestLevel === 0 || isAncestorOpen(rows, r));

  const toggleEnabled = (row: PanelRow) => {
    // TODO(objects): optimistic only. Truth arrives on the `objects` topic; the
    // backend call is cmd.enable/disable (a name-button click in Executive.cpp).
    setRows((prev) => prev.map((r) => (r.name === row.name ? { ...r, enabled: !r.enabled } : r)));
    void bridge
      .do(`${row.enabled ? 'disable' : 'enable'} ${quote(row.name)}`)
      .catch(() => undefined);
  };

  const toggleGroup = (row: PanelRow) => {
    setRows((prev) => prev.map((r) => (r.name === row.name ? { ...r, isOpen: !r.isOpen } : r)));
  };

  const openOpMenu = (row: PanelRow, op: string) => {
    // TODO(pymol-menu): each of these opens a popup built by packages/engine/modules/pymol/menu.py
    // (mol_action / mol_show / mol_hide / mol_labels / mol_color / obj_motion, ...)
    // resolved server-side per row type. See docs/internal-gui.md §1.3 for
    // the full dispatch table. The popup engine is another package's work.
    bridge.appendFeedback([` [stub] ${op}-menu for ${row.name} (${row.specType})`]);
  };

  return (
    <div className="objpanel">
      <div className="objpanel__rows">
        {visible.map((row) => (
          <div
            className={
              'objrow' +
              (row.enabled ? ' is-enabled' : '') +
              (row.specType === 'all' ? ' objrow--all' : '')
            }
            key={row.name}
            style={{ paddingLeft: row.nestLevel * 8 }}
          >
            {row.isGroup ? (
              <button
                type="button"
                className="objrow__group"
                title={row.isOpen ? 'collapse group' : 'expand group'}
                onClick={() => toggleGroup(row)}
              >
                {row.isOpen ? '-' : '+'}
              </button>
            ) : (
              <span className="objrow__group objrow__group--empty" />
            )}

            <button
              type="button"
              className="objrow__name"
              title={row.name}
              onClick={() => toggleEnabled(row)}
            >
              <span className="objrow__name-text">
                {row.specType === 'selection' ? `(${shortName(row)})` : shortName(row)}
              </span>
              {row.caption && <span className="objrow__caption">{row.caption}</span>}
            </button>

            <div className="objrow__ops">
              {ops.map((op) => (
                <button
                  type="button"
                  key={op}
                  className={`objrow__op objrow__op--${op.toLowerCase()}`}
                  title={`${op} menu`}
                  onClick={() => openOpMenu(row, op)}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Strip the group prefix, per `CExecutive::draw` (packages/engine/layer3/Executive.cpp:16421-16434)
 * when `group_full_member_names` is 0.
 */
function shortName(row: PanelRow): string {
  const dot = row.name.lastIndexOf('.');
  return dot > 0 && row.nestLevel > 0 ? row.name.slice(dot + 1) : row.name;
}

function isAncestorOpen(rows: PanelRow[], row: PanelRow): boolean {
  const dot = row.name.lastIndexOf('.');
  if (dot <= 0) return true;
  const parent = rows.find((r) => r.name === row.name.slice(0, dot));
  return parent ? parent.isOpen && isAncestorOpen(rows, parent) : true;
}

/** Empty / whitespace-bearing names must be quoted on the command line. */
function quote(name: string): string {
  return /^[A-Za-z0-9_.]+$/.test(name) ? name : `"${name}"`;
}
