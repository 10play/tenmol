/**
 * Launching a wizard.
 *
 * The Qt build launches wizards from the menubar (`packages/engine/modules/pymol/_gui.py:834-864`)
 * and from ten places in the viewport context menu (`packages/engine/modules/pymol/menu.py`).
 * WP-14 owns the menubar and WP-13 the context menus, so until those land this
 * feature carries the same list itself — built from the catalog the BRIDGE
 * reports, not from a hardcoded array, so a third-party module dropped into
 * `packages/engine/modules/pymol/wizard/` appears here too (`_wizard()` imports
 * `pymol.wizard.<name>` and instantiates `name.capitalize()`,
 * `packages/engine/modules/pymol/wizarding.py:35,41`).
 *
 * Every entry is dispatched as the exact command line PyMOL's own menu uses
 * (`wizard measurement`, `wizard demo, reps`, `replace_wizard demo, finish`),
 * so the console echo is identical to the desktop build's.
 */

import { useState } from 'react';
import type { WizardCatalog, WizardMenubarNode } from '@tenmol/protocol';

/** Props for {@link WizardLauncher}: the catalog, active state, and callbacks. */
export interface WizardLauncherProps {
  catalog: WizardCatalog | null;
  error: string | null;
  /** Runs a command line (`{t:'do'}`), the way the Qt menu item does. */
  onRun(commandLine: string): void;
  /** `cmd.set_wizard()` — pops the top wizard and calls its `cleanup()`. */
  onDismiss(): void;
  active: boolean;
}

/** The wizard picker bar: lists available wizards and launches or dismisses one. */
export function WizardLauncher({
  catalog,
  error,
  onRun,
  onDismiss,
  active,
}: WizardLauncherProps) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="wizlaunch" data-testid="wizard-launcher">
      <div className="wizlaunch__bar">
        <button
          type="button"
          className="wizlaunch__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▾' : '▸'} Wizard
        </button>
        {active && (
          <button type="button" className="wizlaunch__dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      {error && <div className="wizpanel__error">{error}</div>}

      {open && catalog && (
        <div className="wizlaunch__menu" role="menu">
          {catalog.menubar.map((node, index) => (
            <MenubarNode key={index} node={node} onRun={onRun} />
          ))}
          <div className="wizmenu__sep" role="separator" />
          <button
            type="button"
            className="wizlaunch__item wizlaunch__item--more"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? '▾' : '▸'} All modules ({catalog.wizards.length})
          </button>
          {showAll && (
            <div className="wizlaunch__all">
              {catalog.wizards.map((entry) => (
                <button
                  type="button"
                  key={entry.name}
                  className="wizlaunch__item"
                  disabled={!entry.available}
                  title={entry.note || `cmd.wizard('${entry.name}') -> ${entry.cls}`}
                  onClick={() => onRun(`wizard ${entry.name}`)}
                >
                  {entry.name}
                  {!entry.available && <span className="wizlaunch__na"> unavailable</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenubarNode({
  node,
  onRun,
  depth = 0,
}: {
  node: WizardMenubarNode;
  onRun(commandLine: string): void;
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  if (node.kind === 'separator') return <div className="wizmenu__sep" role="separator" />;
  if (node.kind === 'submenu') {
    return (
      <div className="wizlaunch__sub">
        <button
          type="button"
          className="wizlaunch__item"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: 8 + depth * 10 }}
        >
          {open ? '▾' : '▸'} {node.label}
        </button>
        {open &&
          node.items.map((child, index) => (
            <MenubarNode key={index} node={child} onRun={onRun} depth={depth + 1} />
          ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="wizlaunch__item"
      title={node.command}
      style={{ paddingLeft: 8 + depth * 10 }}
      onClick={() => onRun(node.command)}
    >
      {node.label}
    </button>
  );
}
