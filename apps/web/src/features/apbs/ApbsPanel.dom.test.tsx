/**
 * The APBS stub, rendered.
 *
 * The row this panel answers is a DEFERRAL, so the thing worth testing is not
 * a widget — it is that the panel keeps telling the truth. Three ways it could
 * lie, each of which has already happened once or is one edit away:
 *
 *  1. saying the programs are missing when they are installed (the previous
 *     version said so in static prose);
 *  2. saying the plugin "still autoloads", which measurement disproved — the
 *     bridge never calls `pymol.plugins.initialize()`, so `plugins.plugins` is
 *     `[]` and `apbs_gui` is not in `sys.modules`
 *     (`bridge/tests/test_wf_apbs.py::test_the_plugin_is_on_the_path_but_has_NOT_been_imported`);
 *  3. rendering "not found" when the probe itself failed, which would send a
 *     user off installing software that is already there.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApbsPanel } from './ApbsPanel';

/** ONE stable object: `useSession()` is an effect dependency in this panel. */
const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Exactly what the live bridge answered while writing `test_wf_apbs.py`. */
function backend(which: Record<string, string | null>, failing = false) {
  return vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (failing) throw new Error("'subproc' is not an addressable namespace");
    if (fn === 'plugins.get_startup_path') {
      return ['/x/pmg_tk/startup', '/x/pymol/pymol_path/data/startup'];
    }
    if (fn === 'plugins.findPlugins') {
      return {
        apbs_gui: '/x/pymol/pymol_path/data/startup/apbs_gui/__init__.py',
        lightingsettings_gui: '/x/lightingsettings_gui/__init__.py',
      };
    }
    if (fn === 'cmd.exp_path') return String(args[0]);
    if (fn === 'subproc.which') return which[String(args[0])] ?? null;
    throw new Error(`unexpected ${fn}`);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  SESSION.call.mockReset();
});

/** Render and let the probe's promise chain settle. */
async function render() {
  await act(async () => {
    root.render(<ApbsPanel />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const text = () => container.textContent ?? '';

describe('ApbsPanel', () => {
  it('reports both programs missing, with every name it tried', async () => {
    SESSION.call.mockImplementation(backend({}));
    await render();

    expect(text()).toContain('apbs: not found (tried apbs, $SCHRODINGER/utilities/apbs)');
    expect(text()).toContain('pdb2pqr: not found (tried pdb2pqr, pdb2pqr30, pdb2pqr_cli)');
    expect(text()).toContain('scheduled after v1');
  });

  it('changes its argument when the programs ARE installed', async () => {
    SESSION.call.mockImplementation(
      backend({ apbs: '/usr/local/bin/apbs', pdb2pqr30: '/usr/local/bin/pdb2pqr30' }),
    );
    await render();

    expect(text()).toContain('apbs: /usr/local/bin/apbs');
    expect(text()).toContain('pdb2pqr: /usr/local/bin/pdb2pqr30');
    // The deferral argument is "the binaries are missing". When they are not,
    // the panel must stop making it — the missing thing is the dialog.
    expect(text()).toContain('the dialog is what is missing, not the capability');
    expect(text()).not.toContain('scheduled after v1');
  });

  it('says the plugin file is present but NOT imported', async () => {
    SESSION.call.mockImplementation(backend({}));
    await render();

    expect(text()).toContain('Plugin file on the startup path: yes (apbs_gui)');
    expect(text()).toContain('never runs plugin autoload');
    // The claim that measurement disproved must not come back.
    expect(text()).not.toContain('still autoloads');
  });

  it('states a probe failure instead of pretending nothing is installed', async () => {
    SESSION.call.mockImplementation(backend({}, true));
    await render();

    expect(text()).toContain('Could not check for the programs');
    expect(text()).not.toContain('not found (tried');
  });

  it('offers the no-external-binary route as well as the APBS one', async () => {
    SESSION.call.mockImplementation(backend({}));
    await render();

    // `util.protein_vacuum_esp` runs headless through the bridge — pinned in
    // `test_wf_apbs.py::test_the_in_pymol_route_the_panel_recommends_actually_runs`.
    expect(text()).toContain('util.protein_vacuum_esp');
    // ...and it is honestly labelled: vacuum Coulomb is not Poisson-Boltzmann.
    expect(text()).toContain('NOT Poisson-Boltzmann');
    expect(text()).toContain('util.protein_assign_charges_and_radii');

    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['copy vacuum ESP', 'copy script']);
  });

  it('copies the script the user can actually paste', async () => {
    SESSION.call.mockImplementation(backend({}));
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await render();

    const buttons = [...container.querySelectorAll('button')];
    await act(async () => {
      buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain('util.protein_vacuum_esp');
    expect(buttons[0]!.textContent).toBe('copied');
    // The other button is independent: one "copied" must not claim the other.
    expect(buttons[1]!.textContent).toBe('copy script');
  });
});
