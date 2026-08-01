/**
 * The `settings` overlay slot: the Setting menu, the advanced settings table
 * and the lighting panel, plus the one launcher that opens them.
 *
 * The launcher exists because WP-14's menu bar is not installed yet and an
 * overlay nobody can open is an overlay nobody can test. When the menu bar
 * lands, its `Setting ▸ Edit All...` entry can open the same windows: the state
 * is in the module-level service (`./service.ts`), not in this component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SettingMeta, SettingValue } from '@tenmol/protocol';
import { valueKey } from '@tenmol/stores/settings';
import { useSession, useStore } from '../../app';
import { AdvancedSettingsTable } from './AdvancedSettingsTable';
import { LightingPanel } from './LightingPanel';
import { MenuDataRenderer, type MenuContext } from './SettingMenu';
import type { MenuItem } from './menuData';
import { getSettingsService } from './service';
import './settings.css';

type Window = 'menu' | 'table' | 'lighting';

export function SettingsPanel() {
  const session = useSession();
  const service = useMemo(() => getSettingsService(session), [session]);
  const { store, source, poller } = service;

  const phase = useStore(store, (s) => s.phase);
  const error = useStore(store, (s) => s.lastError);
  const catalogue = useStore(store, (s) => s.catalogue);
  const entries = useStore(store, (s) => s.entries);
  const connection = useStore(session.stores.connection, (s) => s.phase);
  const objectRows = useStore(session.stores.objects, (s) => s.rows);
  const [open, setOpen] = useState<Window | null>(null);

  useEffect(() => {
    if (connection !== 'open') return;
    void service.ensure();
    poller.start();
    return () => poller.stop();
  }, [service, poller, connection]);

  const byName = useMemo(() => {
    const map = new Map<string, SettingMeta>();
    for (const meta of catalogue?.settings ?? []) map.set(meta.name, meta);
    return map;
  }, [catalogue]);

  const objects = useMemo(
    () => objectRows.filter((row) => !row.isAll).map((row) => row.name),
    [objectRows],
  );

  const write = useCallback(
    (meta: SettingMeta, value: SettingValue) => {
      void source.write(meta, value).catch(() => undefined);
    },
    [source],
  );

  const run = useCallback(
    (item: Extract<MenuItem, { kind: 'command' }>) => {
      void (async () => {
        session.stores.feedback.appendClient(item.echo);
        for (const call of item.calls) {
          try {
            await session.call(call.fn, call.args, call.kwargs ?? {});
          } catch (e) {
            session.stores.feedback.appendClient(
              ` ${e instanceof Error ? e.message : String(e)}`,
              'error',
            );
          }
        }
        // These commands write many settings at once; the tap will report them,
        // but a kick makes the checkmarks move immediately.
        await source.poll().catch(() => undefined);
      })();
    },
    [session, source],
  );

  const ctx: MenuContext = useMemo(
    () => ({
      byName,
      valueOf: (name: string) => {
        const meta = byName.get(name);
        return meta ? entries[valueKey(meta.index)]?.value : undefined;
      },
      write,
      run,
    }),
    [byName, entries, write, run],
  );

  return (
    <>
      <div className="setlaunch" role="group" aria-label="Settings">
        <button type="button" onClick={() => setOpen(open === 'menu' ? null : 'menu')}>
          Setting
        </button>
        <button type="button" onClick={() => setOpen(open === 'table' ? null : 'table')}>
          Edit All…
        </button>
        <button type="button" onClick={() => setOpen(open === 'lighting' ? null : 'lighting')}>
          Lighting
        </button>
        <span className={`setlaunch__state setlaunch__state--${phase}`} title={error ?? ''}>
          {phase === 'ready' ? `${catalogue?.count ?? 0} settings` : phase}
        </span>
      </div>

      {open && (
        <div className="setwin" data-window={open}>
          <div className="setwin__title">
            <span>
              {open === 'menu'
                ? 'Setting'
                : open === 'table'
                  ? 'PyMOL Advanced Settings'
                  : 'Lighting Settings'}
            </span>
            <button type="button" aria-label="Close" onClick={() => setOpen(null)}>
              ×
            </button>
          </div>
          <div className="setwin__body">
            {phase !== 'ready' ? (
              <p className="setwin__status">
                {phase === 'error'
                  ? `settings service unavailable: ${error ?? 'unknown error'}`
                  : 'loading the setting catalogue…'}
              </p>
            ) : open === 'menu' ? (
              <MenuDataRenderer ctx={ctx} />
            ) : open === 'table' ? (
              <AdvancedSettingsTable store={store} source={source} objects={objects} />
            ) : (
              <LightingPanel store={store} source={source} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
