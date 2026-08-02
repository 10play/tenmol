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

import { LegacyPlugins } from './LegacyPlugins';
import { usePluginRegistry } from './usePluginRegistry';
import {
  addPath,
  movePath,
  removePath,
  writeReachesDisk,
  type PreferenceKey,
} from './pluginSystem';
import './plugin-manager.css';

type Tab = 'installed' | 'legacy' | 'settings' | 'paths';

const PLUGINSRC = '~/.pymolpluginsrc.py';

/**
 * The confirmation every write in this panel goes through.
 *
 * Inventory row 461 said editing was unwired because "a write rewrites the
 * user's interpreter startup file, which needs a confirmation flow this panel
 * does not have yet". This is that flow, and its job is to be SPECIFIC: it says
 * whether THIS write touches the file, before it happens. That is not
 * decoration — `set_pref_changed` reads `instantsave` after the assignment, so
 * exactly one of the controls here (turning instantsave off) changes nothing on
 * disk, and a panel that promised otherwise would be wrong.
 */
function Confirm({
  what,
  toDisk,
  busy,
  onApply,
  onCancel,
  extra,
}: {
  what: string;
  toDisk: boolean;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="plugmgr__confirm" role="group" aria-label="confirm plugin write">
      <p className="plugmgr__confirmtext" data-plugin-confirm="">
        {what}{' '}
        {toDisk ? (
          <>
            This <strong>rewrites {PLUGINSRC}</strong>, the file PyMOL runs at interpreter startup.
          </>
        ) : (
          <>
            <code>instantsave</code> is off, so this stays in memory for this session only and{' '}
            <code>{PLUGINSRC}</code> is not touched.
          </>
        )}
      </p>
      <div className="plugmgr__confirmrow">
        {extra}
        <button type="button" data-plugin-apply="" disabled={busy} onClick={onApply}>
          {busy ? 'writing…' : toDisk ? 'Apply and save' : 'Apply (session only)'}
        </button>
        <button type="button" data-plugin-cancel="" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'installed', label: 'Installed Plugins' },
  // Inventory row 76, option (b). Upstream's `initializePlugins` re-points the
  // registry so `menudict['Plugin']` becomes a `Legacy Plugins` submenu of the
  // menu bar; here it is a tab, because the browser's menu bar is generated
  // from `pymol.menu` data and a plugin cannot mutate it.
  { id: 'legacy', label: 'Legacy Plugins' },
  { id: 'settings', label: 'Settings' },
  { id: 'paths', label: 'Startup Paths' },
];

export function PluginManager() {
  const reg = usePluginRegistry();
  const [tab, setTab] = useState<Tab>('installed');
  /** A staged preference edit, waiting for the confirmation. */
  const [pendingPref, setPendingPref] = useState<{ key: PreferenceKey; value: boolean } | null>(
    null,
  );
  /** A staged startup-path list. `null` means "no local edits". */
  const [draft, setDraft] = useState<string[] | null>(null);
  const [candidate, setCandidate] = useState('');

  const userPaths = draft ?? reg.paths.user;
  const dirty =
    draft !== null &&
    (draft.length !== reg.paths.user.length || draft.some((p, i) => p !== reg.paths.user[i]));

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
            A legacy plugin reaches the UI through <code>plugins.addmenuitem</code>, and what it
            registers is listed under <strong>Legacy Plugins</strong> — the bridge stands in as{' '}
            <code>pymol._ext_gui</code> and records the menu instead of building a Tk one.{' '}
            <code>addmenuitemqt</code> still raises <code>QtNotAvailableError</code>: that call
            asserts the plugin opens a PyQt window, which would open on the server, not in this
            browser. PyMOL&rsquo;s own bundled plugins are replaced by native panels (APBS,
            lighting settings) instead of being ported.
          </p>
        </div>
      )}

      {tab === 'legacy' && <LegacyPlugins />}

      {tab === 'settings' && (
        <div className="plugmgr__body">
          <dl className="plugmgr__prefs">
            {(['verbose', 'instantsave'] as PreferenceKey[]).map((key) => (
              <div key={key} className="plugmgr__prefrow">
                <dt>
                  <label>
                    <input
                      type="checkbox"
                      data-plugin-pref={key}
                      checked={reg.preferences[key]}
                      disabled={reg.loading || reg.saving !== null}
                      onChange={(e) => setPendingPref({ key, value: e.target.checked })}
                    />
                    {key}
                  </label>
                </dt>
                <dd>{String(reg.preferences[key])}</dd>
              </div>
            ))}
          </dl>

          {pendingPref && (
            <Confirm
              what={`Set ${pendingPref.key} to ${String(pendingPref.value)}.`}
              toDisk={writeReachesDisk(
                pendingPref.key,
                pendingPref.value,
                reg.preferences.instantsave,
              )}
              busy={reg.saving !== null}
              onApply={() => {
                void reg
                  .setPreference(pendingPref.key, pendingPref.value)
                  .catch(() => {})
                  .finally(() => setPendingPref(null));
              }}
              onCancel={() => setPendingPref(null)}
            />
          )}
          {reg.writeError !== null && (
            <div className="plugmgr__error" data-plugin-writeerror="">
              {reg.writeError}
            </div>
          )}

          <p className="plugmgr__note">
            Stored in <code>{PLUGINSRC}</code>, alongside the per-plugin <code>autoload</code> flags
            and the startup paths — one file carries all three, which is why every write here asks
            first.
          </p>
          <p className="plugmgr__note">
            <code>pref_set</code> ends in <code>set_pref_changed()</code>, which saves only if{' '}
            <code>instantsave</code> is on <em>after</em> the change. Turning{' '}
            <code>instantsave</code> off is therefore the one write that never reaches the file: it
            applies to this session and the file goes on saying <code>True</code>.
          </p>
        </div>
      )}

      {tab === 'paths' && (
        <div className="plugmgr__body">
          <ol className="plugmgr__paths" data-plugin-userpaths="">
            {userPaths.map((p, index) => (
              <li key={p} className="plugmgr__path" title={p}>
                <span className="plugmgr__pathtext">{p}</span>
                <button
                  type="button"
                  data-plugin-path-up={index}
                  aria-label={`move ${p} up`}
                  disabled={index === 0}
                  onClick={() => setDraft(movePath(userPaths, index, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  data-plugin-path-down={index}
                  aria-label={`move ${p} down`}
                  disabled={index === userPaths.length - 1}
                  onClick={() => setDraft(movePath(userPaths, index, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  data-plugin-path-remove={index}
                  aria-label={`remove ${p}`}
                  onClick={() => setDraft(removePath(userPaths, index))}
                >
                  ✕
                </button>
              </li>
            ))}
            {userPaths.length === 0 && (
              <li className="plugmgr__empty" data-plugin-nouserpaths="">
                no user startup paths — every directory below is part of the installation
              </li>
            )}
          </ol>

          <div className="plugmgr__addrow">
            <input
              type="text"
              data-plugin-path-input=""
              aria-label="startup directory to add"
              placeholder="/path/to/plugins"
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
            />
            <button
              type="button"
              data-plugin-path-add=""
              disabled={candidate.trim() === '' || userPaths.includes(candidate.trim())}
              onClick={() => {
                setDraft(addPath(userPaths, candidate));
                setCandidate('');
              }}
            >
              Add
            </button>
          </div>

          {dirty && (
            <Confirm
              what={`Replace the ${reg.paths.user.length} user startup path(s) with ${draft!.length}.`}
              toDisk={reg.preferences.instantsave}
              busy={reg.saving !== null}
              onApply={() => {
                void reg
                  .setStartupPaths(draft!, true)
                  .then(() => setDraft(null))
                  .catch(() => {});
              }}
              onCancel={() => setDraft(null)}
              extra={
                reg.preferences.instantsave ? (
                  <button
                    type="button"
                    data-plugin-apply-session=""
                    disabled={reg.saving !== null}
                    onClick={() => {
                      void reg
                        .setStartupPaths(draft!, false)
                        .then(() => setDraft(null))
                        .catch(() => {});
                    }}
                  >
                    Apply (session only)
                  </button>
                ) : null
              }
            />
          )}
          {reg.writeError !== null && (
            <div className="plugmgr__error" data-plugin-writeerror="">
              {reg.writeError}
            </div>
          )}

          <p className="plugmgr__note">
            Scanned in order; the first match for a name wins, so position matters.
          </p>

          <p className="plugmgr__note">
            <strong>Installation paths</strong> ({reg.paths.installation.length}) cannot be edited:{' '}
            <code>set_startup_path</code> assigns to{' '}
            <code>startup.__path__[:-N_NON_USER_PATHS]</code>, so these survive every edit. They are
            listed here rather than mixed in above, because a delete button that silently did
            nothing would be worse than no button.
          </p>
          <ol className="plugmgr__paths plugmgr__paths--fixed" data-plugin-fixedpaths="">
            {reg.paths.installation.map((p) => (
              <li key={p} className="plugmgr__path" title={p}>
                {p}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
