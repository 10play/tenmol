/**
 * APBS Electrostatics — v1 stub (WP-25 stub / WP-30 full, critique B1).
 *
 * `packages/engine/data/startup/apbs_gui/` is a real autoloading plugin: 1,405 lines of
 * `apbs.ui` holding 86 `<widget>` elements — a 7-page `QStackedWidget` (one
 * page per prep method), a 3-tab `QTabWidget`, four "Options >>" reveals and
 * ten buttons — driving subprocess calls to `pdb2pqr` and `apbs`.
 *
 * v1 does NOT port it, and the reason is that porting 86 widgets for a feature
 * gated on two external binaries most users do not have is the wrong first
 * investment. But the menu entry must still EXIST and say so: a feature that
 * silently disappears is indistinguishable from one that is broken, and the
 * user cannot tell whether to go looking for it.
 *
 * TWO THINGS THIS PANEL MEASURES RATHER THAN ASSERTS
 * --------------------------------------------------
 * 1. whether `apbs` and `pdb2pqr` exist, using the plugin's own search order
 *    (`apbsProbe.ts`). Prose that says "you probably do not have these" is
 *    unfalsifiable and wrong for the user who does.
 * 2. that the plugin is on the startup path but is *not imported*. An earlier
 *    version of this panel claimed it "still autoloads into the Python
 *    process". Measured over the socket, that is false: the bridge never calls
 *    `pymol.plugins.initialize()`, so `plugins.plugins` is `[]`, `autoload` is
 *    `{}` and `'apbs_gui' in sys.modules` is False. Autoload imports the module
 *    and calls `__init_plugin__`, which calls `addmenuitemqt` — a Qt entry
 *    point that cannot run here. The file is present; nothing has run.
 *    (`packages/bridge/tests/test_wf_apbs.py` pins both halves.)
 */

import { useEffect, useState } from 'react';

import { useSession } from '../../app';
import {
  describeProgram,
  pipelineIsRunnable,
  probeApbs,
  UNKNOWN_PROBE,
  type ApbsProbe,
} from './apbsProbe';
import './apbs.css';

/**
 * What the plugin does, as commands. Taken from
 * `packages/engine/data/startup/apbs_gui/creating.py` and `electrostatics.py`: prepare the
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

/**
 * The no-external-binary route, which is what most people reaching for this
 * panel actually want. `util.protein_vacuum_esp` is PyMOL's own solver
 * (`packages/engine/modules/pymol/util.py:385-425`): it runs `protein_assign_charges_and_radii`
 * and then `cmd.map_new(..., "coulomb_local", ...)`, so it needs nothing
 * installed. Verified to run headless through the bridge in
 * `packages/bridge/tests/test_wf_apbs.py` — it produces an `object:map` and an
 * `object:ramp` and colours the surface.
 *
 * It is vacuum Coulomb, not Poisson-Boltzmann: no solvent screening, no ionic
 * strength. Said plainly here rather than implied, because the difference is
 * the whole reason APBS exists.
 */
const VACUUM = `# No external programs needed. Vacuum Coulomb potential,
# NOT Poisson-Boltzmann: no solvent screening, no ionic strength.
util.protein_vacuum_esp("myprotein")`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="apbs__btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? 'copied' : label}
    </button>
  );
}

export function ApbsPanel() {
  const session = useSession();
  const [probe, setProbe] = useState<ApbsProbe | null>(null);

  useEffect(() => {
    let cancelled = false;
    void probeApbs((fn, args, kwargs) => session.call(fn, args, kwargs)).then((result) => {
      if (!cancelled) setProbe(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const known = probe !== null && probe.error === null;
  const view = probe ?? UNKNOWN_PROBE;
  const runnable = known && pipelineIsRunnable(view);

  return (
    <div className="apbs">
      <div className="apbs__title">APBS Electrostatics</div>
      <div className="apbs__body">
        <p className="apbs__lead">
          Not available in the web client yet. The Qt plugin is a seven-page stack of options around
          two external programs, <code>pdb2pqr</code> and <code>apbs</code>, neither of which is
          bundled with PyMOL.
        </p>

        <div className="apbs__probe" data-testid="apbs-probe">
          {probe === null ? (
            <p className="apbs__status">Checking for the two programs…</p>
          ) : probe.error !== null ? (
            <p className="apbs__status">Could not check for the programs: {probe.error}</p>
          ) : (
            <ul className="apbs__list">
              <li className={view.apbs.path ? 'apbs__found' : 'apbs__missing'}>
                {describeProgram(view.apbs)}
              </li>
              <li className={view.pdb2pqr.path ? 'apbs__found' : 'apbs__missing'}>
                {describeProgram(view.pdb2pqr)}
              </li>
            </ul>
          )}
        </div>

        <p className="apbs__status">
          {runnable
            ? 'Both programs are installed, so the full pipeline is available from the command line today — the dialog is what is missing, not the capability.'
            : 'Until both are installed the dialog would have nothing to drive, which is why the port is scheduled after v1 rather than in it.'}
        </p>

        <p className="apbs__status">
          Plugin file on the startup path:{' '}
          {probe === null ? 'checking…' : view.pluginOnStartupPath ? 'yes (apbs_gui)' : 'no'}. It is
          not imported: the web client has no Qt, so it never runs plugin autoload and{' '}
          <code>__init_plugin__</code> never registers the menu item.
        </p>

        <p className="apbs__lead">Electrostatics with nothing installed:</p>
        <pre className="apbs__script">{VACUUM}</pre>
        <CopyButton text={VACUUM} label="copy vacuum ESP" />

        <p className="apbs__lead">The APBS workflow itself, as commands you can paste:</p>
        <pre className="apbs__script">{SCRIPT}</pre>
        <CopyButton text={SCRIPT} label="copy script" />

        <p className="apbs__note">
          Full port is WP-30. Tracked rather than dropped — see the APBS rows in the parity
          inventory. Child-process output from those two programs already has a home: the bridge
          streams it onto the <code>feedback</code> topic (<code>subproc.execute</code>).
        </p>
      </div>
    </div>
  );
}
