/**
 * Wave 13 — row 464, **"Install from file / URL / repository browse"**.
 *
 * This is one of only two rows in the whole parity file whose `Covered by`
 * column is `—`, and the only one marked `[-]` (descoped). Descoped is not the
 * same as absent: the row still makes a promise, and it is a NEGATIVE one —
 * these three entry points are deliberately not built, and the panel says why
 * instead of quietly shipping four tabs where upstream has six.
 *
 * A descope with no test is a descope that comes back by accident. What is
 * pinned here is exactly the claim the panel makes on screen, and the tab list
 * that claim describes. Nothing here asserts that the feature "works"; it
 * asserts that its absence is DELIBERATE and VISIBLE, which is the whole
 * content of a `[-]` row.
 *
 * WHAT THIS TEST DELIBERATELY DOES NOT CLAIM. The descope is a client-side one
 * only. `plugins` is an allowed dispatcher root
 * (`packages/bridge/tenmol_bridge/policy/base.py`), so
 * `plugins.installPluginFromFile` is still reachable over the socket by anyone
 * who types it — the panel refuses to offer the button, and nothing refuses the
 * call. That gap is reported rather than encoded here, because a test that
 * asserted the current behaviour would make it look intentional.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginManager } from './PluginManager';

const SESSION = { call: vi.fn() };
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = '/x/pymol/pymol_path/data/startup';

function backend() {
  return vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'plugins.initialize') return null;
    if (fn === 'plugins.get_startup_path') return args[0] === true ? [] : [DATA];
    if (fn === 'plugins.findPlugins') return { apbs_gui: `${DATA}/apbs_gui/__init__.py` };
    if (fn === 'plugins.pref_get') return args[0] === 'instantsave';
    if (fn === 'plugins.autoload.copy') return {};
    throw new Error(`unexpected ${fn}`);
  });
}

let container: HTMLDivElement;
let root: Root;

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

async function render() {
  SESSION.call.mockImplementation(backend());
  await act(async () => {
    root.render(<PluginManager />);
  });
  for (let i = 0; i < 6; i += 1) await act(async () => {});
}

const tabLabels = () =>
  [...container.querySelectorAll('.plugmgr__tabs button, [role="tab"]')].map((b) =>
    (b.textContent ?? '').trim(),
  );
const text = () => container.textContent ?? '';

describe('row 464 — installing from file/URL and browsing repositories is descoped', () => {
  it('offers no Install and no Repositories tab', async () => {
    await render();
    const labels = tabLabels();
    expect(labels.length).toBeGreaterThan(0);
    // Upstream's `managergui_qt.py` has "Install New Plugin" and
    // "Settings"/"Repositories"; these four are what this build ships.
    expect(labels).toContain('Installed Plugins');
    expect(labels.some((l) => /install new|repositor/i.test(l))).toBe(false);
  });

  it('states the reason on screen, so the gap is legible and not a bug report', async () => {
    await render();
    expect(text()).toContain(
      'Installing from a file or URL and browsing repositories are not available',
    );
    // The REASON is the load-bearing half: without it this reads as a missing
    // feature rather than a decision.
    expect(text()).toContain('download and execute arbitrary Python');
  });

  it('exposes no control that would start an install', async () => {
    await render();
    const buttons = [...container.querySelectorAll('button')].map((b) =>
      (b.textContent ?? '').toLowerCase(),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const label of buttons) {
      // `Installed Plugins` is the tab that LISTS them; an install ACTION
      // would read "install …" / "add repository" / "fetch".
      expect(label).not.toMatch(/^install\b|fetch|download|repositor|add plugin/);
    }
    // and no file picker either — `installPluginFromFile` takes a path.
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
