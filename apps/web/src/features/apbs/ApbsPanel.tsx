/**
 * APBS Electrostatics — v1 stub (WP-25 stub / WP-30 full, critique B1).
 *
 * `data/startup/apbs_gui/` is a real autoloading plugin: 5 stacked pages and 86
 * `<widget>` elements in a 1,405-line `apbs.ui`, which subprocess-shells
 * `pdb2pqr` and `apbs`.
 *
 * v1 does NOT port it, and the reason is that porting 86 widgets for a feature
 * gated on two external binaries most users do not have is the wrong first
 * investment. But the menu entry must still EXIST and say so: a feature that
 * silently disappears is indistinguishable from one that is broken, and the
 * user cannot tell whether to go looking for it.
 *
 * So this panel states the position, reports whether the plugin is installed,
 * and gives the equivalent commands to paste — which is the actual workflow a
 * user needs today, not a placeholder.
 */

import { useEffect, useState } from 'react';

import { useSession } from '../../app';
import './apbs.css';

/**
 * What the plugin does, as commands. Taken from
 * `data/startup/apbs_gui/creating.py` and `electrostatics.py`: prepare the
 * structure, run pdb2pqr for charges and radii, run apbs, load the map, then
 * ramp a surface against it.
 */
const SCRIPT = `# APBS equivalent — needs pdb2pqr and apbs on PATH.
# The plugin wraps these steps; the commands themselves are plain PyMOL.

# 1. a clean, protonated copy with charges and radii
util.protein_assign_charges_and_radii("polymer")

# 2. run apbs externally, then load the potential map it writes
# load  /path/to/apbs.dx, apbs_map, format=dx

# 3. colour a surface by the potential
# ramp_new e_lvl, apbs_map, [-5, 0, 5], [red, white, blue]
# set surface_color, e_lvl, polymer
# show surface, polymer`;

export function ApbsPanel() {
  const session = useSession();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const paths = await session.call<string[]>('plugins.get_startup_path');
        const found = await session.call<Record<string, string>>('plugins.findPlugins', [paths]);
        if (!cancelled) setInstalled(Object.keys(found ?? {}).includes('apbs_gui'));
      } catch {
        if (!cancelled) setInstalled(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <div className="apbs">
      <div className="apbs__title">APBS Electrostatics</div>
      <div className="apbs__body">
        <p className="apbs__lead">
          Not available in the web client yet. The Qt plugin is five stacked pages of options around
          two external programs, <code>pdb2pqr</code> and <code>apbs</code>, which are not bundled
          with PyMOL and are not installed here by default.
        </p>
        <p className="apbs__status">
          Plugin on the startup path:{' '}
          {installed === null ? 'unknown' : installed ? 'yes (apbs_gui)' : 'no'}. It still autoloads
          into the Python process, so nothing about your PyMOL install has changed.
        </p>
        <p className="apbs__lead">The workflow it wraps, as commands you can paste:</p>
        <pre className="apbs__script">{SCRIPT}</pre>
        <button
          type="button"
          className="apbs__btn"
          onClick={() => {
            void navigator.clipboard?.writeText(SCRIPT).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? 'copied' : 'copy script'}
        </button>
        <p className="apbs__note">
          Full port is WP-30. Tracked rather than dropped — see the APBS rows in the parity
          inventory.
        </p>
      </div>
    </div>
  );
}
