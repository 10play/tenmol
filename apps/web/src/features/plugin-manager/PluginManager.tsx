/**
 * Plugin Manager — read-only (v1).
 *
 * Mirrors the three tabs of `modules/pymol/plugins/managergui_qt.py:34-415`
 * that do not execute network-fetched code: Installed, Settings, Startup Paths.
 * The Install-New-Plugin and Repositories tabs are deliberately absent and say
 * so on screen — an unbuilt feature must be VISIBLY unbuilt (registry.ts).
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
                <th>Plugin</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {reg.plugins.map((p) => (
                <tr key={p.filename}>
                  <td className="plugmgr__name">{p.name}</td>
                  <td className="plugmgr__path" title={p.filename}>
                    {p.startupPath === '' ? p.filename : p.filename.slice(p.startupPath.length + 1)}
                  </td>
                </tr>
              ))}
              {!reg.loading && reg.plugins.length === 0 && reg.error === null && (
                <tr>
                  <td colSpan={2} className="plugmgr__empty">
                    no plugins found on the startup paths
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="plugmgr__note">
            Read-only in v1. Installing from a file or URL and browsing repositories are not
            available: those paths download and execute arbitrary Python, which is a worse posture
            through a web service than in the desktop app. Plugins on the startup paths still
            autoload exactly as they do in PyMOL.
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
