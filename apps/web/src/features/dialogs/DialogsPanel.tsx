/**
 * Slot `dialogs`, region `overlay`.
 *
 * Two jobs:
 *
 * 1. HOST the windows this slot owns (today: Advanced Settings). The volume,
 *    properties and text-editor windows are hosted by their own slots, because
 *    the registry gives each of them one and a slot that renders nothing is
 *    indistinguishable from a slot that is broken.
 *
 * 2. LAUNCH all four. In Qt these are reached from the menu bar (`Settings >
 *    Edit All`, `Wizard`-adjacent entries, `File > Edit pymolrc`) and from the
 *    internal object menu (`A > volume > panel`, `packages/engine/modules/pymol/menu.py:644-654`).
 *    `features/menubar/` is WP-14's and `features/pymol-menu/` is WP-13's;
 *    until they land, a small launcher strip is the honest way to make the
 *    dialogs reachable without editing anyone else's file.
 *
 * The volume entry is populated from `cmd.get_names_of_type('object:volume')`,
 * so it lists exactly the objects `A > volume` would.
 *
 * NOT WIRED YET, and it is a bridge task, not a React one: `cmd.volume_panel(name)`
 * — the command that PyMOL's own menu leaf emits — currently fails on this tree
 * with `ImportError: pymol.Qt`, because `colorramping.volume_panel` reaches for
 * `pmg_qt.volume` as soon as `gui.get_qtwindow()` answers with the bridge's
 * `BridgeWindow` shim. Until the shim intercepts it, the launcher is how a
 * volume panel gets opened.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../app';
import { Button, Select } from '../../ui';
import { createPortal } from 'react-dom';
import { AdvancedSettings } from './AdvancedSettings';
import { VolumePanel } from '../volume/VolumePanel';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { TextEditorPanel } from '../texteditor/TextEditorPanel';
import { dialogsStore, type DialogKind } from './store';
import { useHostedWindows } from './useDialogs';
import './dialogs.css';

/**
 * This slot claims ALL FOUR window kinds, so a shell that mounts only
 * `dialogs` still shows every dialog. The other three slots claim their own
 * kind and draw nothing while this one holds it (`store.ts`, `claimHost`).
 */
const ALL_KINDS: readonly DialogKind[] = [
  'advanced-settings',
  'volume',
  'properties',
  'texteditor',
];

export function DialogsPanel() {
  const session = useSession();
  const windows = useHostedWindows(ALL_KINDS);
  const [volumes, setVolumes] = useState<string[]>([]);

  const refreshVolumes = useCallback(() => {
    void session
      .call<string[]>('get_names_of_type', ['object:volume'])
      .then((names) => setVolumes(Array.isArray(names) ? names : []))
      .catch(() => setVolumes([]));
  }, [session]);

  useEffect(() => {
    refreshVolumes();
    const timer = setInterval(refreshVolumes, 3000);
    return () => clearInterval(timer);
  }, [refreshVolumes]);

  return (
    <>
      {windows.map((w) => {
        if (w.kind === 'advanced-settings') return <AdvancedSettings key={w.key} spec={w} />;
        if (w.kind === 'volume') return <VolumePanel key={w.key} spec={w} />;
        if (w.kind === 'properties') return <PropertiesPanel key={w.key} spec={w} />;
        return <TextEditorPanel key={w.key} spec={w} />;
      })}

      <Launcher volumes={volumes} />
    </>
  );
}

/** Portalled for the same reason the windows are — see `DialogWindow`. */
function Launcher({ volumes }: { volumes: readonly string[] }) {
  const strip = (
    <div
      className="dlglaunch modern:bg-pm-panel modern:text-pm-text modern:border-line"
      data-dialogs-launcher=""
    >
      <span className="dlglaunch__title modern:text-pm-text-dim">dialogs</span>
      <Button data-open="properties" onClick={() => dialogsStore.open('properties')}>
        Properties
      </Button>
      <Button data-open="advanced-settings" onClick={() => dialogsStore.open('advanced-settings')}>
        Advanced settings
      </Button>
      <Button data-open="texteditor" onClick={() => dialogsStore.open('texteditor')}>
        Text editor
      </Button>
      <Select
        data-open="volume"
        value=""
        title="cmd.get_names_of_type('object:volume')"
        onChange={(e) => {
          if (e.target.value) dialogsStore.open('volume', e.target.value);
        }}
      >
        <option value="">volume panel…</option>
        {volumes.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>
    </div>
  );
  return typeof document === 'undefined' ? strip : createPortal(strip, document.body);
}
