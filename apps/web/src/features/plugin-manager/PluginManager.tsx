/**
 * Plugin Manager.
 *
 * Mirrors the three tabs of `modules/pymol/plugins/managergui_qt.py:34-415`
 * that do not execute network-fetched code: Installed, Settings, Startup Paths.
 * The Install-New-Plugin and Repositories tabs are deliberately absent and say
 * so on screen — an unbuilt feature must be VISIBLY unbuilt (registry.ts).
 *
 * The one thing that is NOT read-only is the per-plugin `autoload` checkbox
 * (`managergui_qt.py:214-217`, inventory row 463). It is writable because it
 * touches nothing but PyMOL's own preferences file, and because a list of
 * plugins with no indication of which ones are switched off is misleading.
 */

import { useState } from 'react';

import { usePluginRegistry } from './usePluginRegistry';
import './plugin-manager.css';

type Tab = 'installed' | 'settings' | 'paths';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'installed', label: 'Installed Plugins' },
  { id: 'settings', label: 'Settings' },
  { id: 'paths', label: 'Startup Paths' },
];

export function PluginManager() {
  const reg = usePluginRegistry();
  const [tab, setTab] = useState<Tab>('installed');

  return (
    <div className="plugmgr">
      <div className="plugmgr__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`plugmgr__tab${tab === t.id ? ' is-on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="plugmgr__spacer" />
        <button type="button" className="plugmgr__btn" onClick={reg.refresh} disabled={reg.loading}>
          {reg.loading ? 'scanning…' : 'rescan'}
        </button>
      </div>

      {reg.error !== null && <div className="plugmgr__error">plugin scan failed: {reg.error}</div>}

      {tab === 'installed' && (
        <div className="plugmgr__body">
          <table className="plugmgr__table">
            <thead>
              <tr>
                <th className="plugmgr__enabled">Enabled</th>
                <th>Plugin</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {reg.plugins.map((p) => (
                <tr key={p.filename}>
                  <td className="plugmgr__enabled">
                    <input
                      type="checkbox"
                      checked={p.autoload}
                      disabled={reg.loading || reg.saving !== null}
                      aria-label={`load ${p.name} at startup`}
                      title={
                        reg.preferences.instantsave
                          ? 'load at startup — saved to ~/.pymolpluginsrc.py immediately'
                          : 'load at startup — instantsave is off, so this session only'
                      }
                      onChange={(e) => void reg.setAutoload(p.name, e.target.checked)}
                    />
                  </td>
                  <td className="plugmgr__name">{p.name}</td>
                  <td className="plugmgr__path" title={p.filename}>
                    {p.startupPath === '' ? p.filename : p.filename.slice(p.startupPath.length + 1)}
                  </td>
                </tr>
              ))}
              {!reg.loading && reg.plugins.length === 0 && reg.error === null && (
                <tr>
                  <td colSpan={3} className="plugmgr__empty">
                    no plugins found on the startup paths
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="plugmgr__note">
            Installing from a file or URL and browsing repositories are not available: those paths
            download and execute arbitrary Python, which is a worse posture through a web service
            than in the desktop app.
          </p>
          <p className="plugmgr__note">
            <strong>Enabled</strong> is <code>PluginInfo.autoload</code>, and it persists to{' '}
            <code>~/.pymolpluginsrc.py</code>
            {reg.preferences.instantsave ? ' on every click' : ' only when instantsave is on'}.
            Opening this panel runs <code>plugins.initialize(-2)</code>, which registers every
            plugin and reads that file but loads no plugin code — the bridge does not do it at
            startup the way the desktop app does.
          </p>
          <p className="plugmgr__note">
            Enabling a <em>legacy</em> plugin does not make it appear anywhere. A legacy plugin
            reaches the UI only through <code>plugins.addmenuitem</code>, which needs the Tk
            <code> PMGApp</code> the bridge refuses to build, so it is a no-op here;{' '}
            <code>addmenuitemqt</code> raises <code>QtNotAvailableError</code> because a PyQt window
            would open on the server, not in this browser. PyMOL&rsquo;s own bundled plugins are
            replaced by native panels (APBS, lighting settings) instead of being ported.
          </p>
        </div>
      )}

      {tab === 'settings' && (
        <div className="plugmgr__body">
          <dl className="plugmgr__prefs">
            <dt>verbose</dt>
            <dd>{String(reg.preferences.verbose)}</dd>
            <dt>instantsave</dt>
            <dd>{String(reg.preferences.instantsave)}</dd>
          </dl>
          <p className="plugmgr__note">
            Stored in <code>~/.pymolpluginsrc.py</code>. Editing is not wired in v1 — writing
            preferences also rewrites that file, which is a change to the user&rsquo;s interpreter
            startup.
          </p>
        </div>
      )}

      {tab === 'paths' && (
        <div className="plugmgr__body">
          <ol className="plugmgr__paths">
            {reg.startupPaths.map((p) => (
              <li key={p} className="plugmgr__path" title={p}>
                {p}
              </li>
            ))}
          </ol>
          <p className="plugmgr__note">
            Scanned in order; the first match for a name wins. Adding and reordering paths is not
            wired in v1.
          </p>
        </div>
      )}
    </div>
  );
}
