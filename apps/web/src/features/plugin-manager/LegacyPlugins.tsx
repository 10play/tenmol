/**
 * `Plugin > Legacy Plugins`, as JSON descriptors — inventory row 76, option (b).
 *
 * Upstream's `initializePlugins` (`pmg_qt/pymol_qt_gui.py:970`) re-points the
 * menu registry so `menudict['Plugin']` becomes a `Legacy Plugins` submenu of
 * the real menu bar, and every `plugins.addmenuitem` call lands in it. That
 * cannot be reproduced literally here — this client's menu bar is generated
 * from `pymol.menu` data and a plugin cannot mutate it — so the same registry
 * is rendered as a panel, with the same addressing: a menu is its pipe-joined
 * label path, an item is its index in that menu, and clicking a leaf RPCs the
 * plugin's own Python function.
 *
 * A plugin that registers nothing shows nothing, and says so. That is the
 * honest state for the two plugins this build ships: `apbs_gui` cannot import
 * without PyQt, and `lightingsettings_gui`'s entire `__init_plugin__` is one
 * `addmenuitemqt` call, which is refused here on purpose.
 */

import { useCallback, useEffect, useState } from 'react';

import { Button } from '../../ui';
import { useSession } from '../../app';
import {
  ensureRegistry,
  flattenMenus,
  invokeLeaf,
  leafCount,
  readMenu,
  type InvokeReply,
  type LegacyMenu,
} from './legacyMenu';

export function LegacyPlugins() {
  const session = useSession();
  const [menus, setMenus] = useState<LegacyMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<(InvokeReply & { key: string }) | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureRegistry(session.call, session.run);
      setMenus(await readMenu(session.call));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = flattenMenus(menus);
  const leaves = leafCount(menus);

  const click = async (key: string, index: number, label: string) => {
    try {
      const reply = await invokeLeaf(session.call, key, index);
      setLast({ ...reply, key: `${key}|${label}` });
    } catch (e) {
      setLast({ ok: false, key, error: e instanceof Error ? e.message : String(e) });
    }
    // A plugin can do anything at all — reload a structure, change the scene.
    session.poller.kick();
  };

  return (
    <div className="plugmgr__body">
      <div className="plugmgr__legacyhead modern:text-pm-text-dim">
        <span data-legacy-count="">
          {loading ? 'reading the registry…' : `${leaves} menu item${leaves === 1 ? '' : 's'}`}
        </span>
        <Button className="plugmgr__btn" onClick={() => void refresh()}>
          reread
        </Button>
      </div>

      {error !== null && (
        <div className="plugmgr__error" data-legacy-error="">
          plugin menu registry unavailable: {error}
        </div>
      )}

      <ul className="plugmgr__legacy" data-legacy-menu="">
        {rows.map((row, i) => (
          <li
            key={`${row.menuKey}:${row.index}:${i}`}
            className={`plugmgr__legacyrow plugmgr__legacyrow--${row.kind}`}
            style={row.depth > 0 ? { paddingLeft: row.depth * 14 } : undefined}
          >
            {row.kind === 'separator' ? (
              <hr className="plugmgr__legacysep modern:border-line" />
            ) : row.clickable ? (
              <Button
                className="plugmgr__legacyleaf"
                data-legacy-leaf={`${row.menuKey}:${row.index}`}
                title={`${row.menuKey} → ${row.label}`}
                onClick={() => void click(row.menuKey, row.index, row.label)}
              >
                {row.label}
              </Button>
            ) : (
              <span className="plugmgr__legacymenu modern:text-pm-text-bright">{row.label}</span>
            )}
          </li>
        ))}
        {!loading && leaves === 0 && (
          <li className="plugmgr__empty" data-legacy-empty="">
            no plugin has registered a menu item
          </li>
        )}
      </ul>

      {last !== null && (
        <div
          className={`plugmgr__legacyresult modern:rounded-md modern:border modern:border-line modern:bg-pm-panel-alt${last.ok ? ' modern:text-pm-text-dim' : ' is-error modern:text-danger'}`}
          data-legacy-result=""
          role="status"
        >
          {last.ok ? (
            <>ran {last.label}</>
          ) : (
            <>
              {last.label ?? last.key} failed: {last.error}
              {last.note !== undefined && <div className="plugmgr__note">{last.note}</div>}
            </>
          )}
        </div>
      )}

      <p className="plugmgr__note">
        This is the registry <code>pymol.plugins.addmenuitem</code> writes into. The bridge stands
        in as <code>pymol._ext_gui</code> and drives PyMOL&rsquo;s own <code>PmwMenuBar</code> over
        a recording menu dict, so the semantics are upstream&rsquo;s: a <code>|</code> in the label
        makes a submenu, a bare <code>-</code> makes a separator, and re-registering an existing
        submenu is a no-op.
      </p>
      <p className="plugmgr__note">
        <code>plugins.addmenuitemqt</code> is refused (<code>HAVE_QT</code> stays false). A plugin
        using it is asserting that its callback opens a PyQt window, and that window would open on
        the machine running PyMOL rather than in this browser.
      </p>
    </div>
  );
}
