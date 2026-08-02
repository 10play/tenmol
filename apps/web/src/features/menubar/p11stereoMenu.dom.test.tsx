/**
 * Row 65 — `Display ▸ Stereo Mode` in the real menu bar.
 *
 * WHAT THE ROW ASKED FOR, and what this asserts:
 *
 *  * the submenu is NOT deleted — all nine leaves still render, in tree order;
 *  * the two whose second eye cannot cross a WebSocket are DISABLED and say
 *    why, and clicking them sends nothing;
 *  * the other seven still issue their literal `stereo <word>` line, because
 *    they work — MEASURED, `packages/bridge/tests/test_p11_menus.py`;
 *  * every live leaf's tooltip says where it will be visible, and that sentence
 *    CHANGES with the live answer from `_bridge.render_stats`, which is how the
 *    Mode-G half of the gap is closed without `features/viewport` publishing
 *    anything;
 *  * after the click the client reads the state back and writes one console
 *    line — the answer to "a menu item that silently does nothing".
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';
import { Rep } from '@tenmol/protocol/geometry';

import { SessionContext, type Session } from '../../app';
import { resetPanelHooks } from '../../shell/panelHooks';
import { MenuBar } from './MenuBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Stub {
  session: Session;
  ran: string[];
  calls: Array<{ fn: string; args: readonly unknown[] }>;
  feedback: () => string[];
  state: { stereo: string; stereoMode: string };
}

function makeSession(options: { geometryReps?: number[] | null } = {}): Stub {
  const ran: string[] = [];
  const calls: Array<{ fn: string; args: readonly unknown[] }> = [];
  const state = { stereo: 'off', stereoMode: '2' };
  const stores = {
    connection: createConnectionStore('ws://test/ws', true),
    feedback: createFeedbackStore(),
    objects: createObjectsStore(),
    ui: createUiStore(null),
  };

  const session = {
    config: {} as Session['config'],
    // Refuse the live-tree bootstrap: these assertions are about the CHECKED-IN
    // harvested tree, so no reply may reshape it.
    conn: { sendInput: vi.fn(), isOpen: true, do: () => Promise.reject(new Error('offline')) },
    stores,
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: (line: string) => {
      ran.push(line);
      // The engine's own effect, so the readback is not a tautology.
      const word = line.startsWith('stereo ') ? line.slice(7) : '';
      const modes: Record<string, string> = { anaglyph: '10', crosseye: '2', walleye: '3', byrow: '6' };
      if (modes[word]) {
        state.stereo = 'on';
        state.stereoMode = modes[word] as string;
      } else if (word === 'off' || word === 'chromadepth') {
        state.stereo = 'off';
      }
      return Promise.resolve();
    },
    act: () => Promise.resolve(undefined),
    call: (fn: string, args: readonly unknown[] = []) => {
      calls.push({ fn, args });
      if (fn === '_bridge.render_stats') {
        const reps = options.geometryReps;
        if (reps === null) return Promise.reject(new Error('no render route'));
        return Promise.resolve({ modeP: { params: { geometryReps: reps ?? [] } } });
      }
      if (fn === 'cmd.get') {
        if (args[0] === 'stereo') return Promise.resolve(state.stereo);
        if (args[0] === 'stereo_mode') return Promise.resolve(state.stereoMode);
      }
      return Promise.reject(new Error(`offline: ${fn}`));
    },
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;

  return { session, ran, calls, state, feedback: () => stores.feedback.get().lines.map((l) => l.text) };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetPanelHooks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetPanelHooks();
});

/** Mount, open Display, hover Stereo Mode. Returns the submenu's rows. */
async function openStereo(stub: Stub): Promise<HTMLElement[]> {
  act(() =>
    root.render(
      <SessionContext.Provider value={stub.session}>
        <MenuBar />
      </SessionContext.Provider>,
    ),
  );
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const display = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
    (el) => el.textContent?.trim() === 'Display',
  );
  if (!display) throw new Error('no Display menu');
  act(() => display.click());
  // The render_stats read lands after the open.
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const list = container.querySelector<HTMLElement>('.menubar__item-wrap .menu');
  if (!list) throw new Error('the Display menu did not open');
  const parent = [...list.querySelectorAll<HTMLElement>(':scope > .menu__row')].find(
    (el) => el.querySelector(':scope > .menu__label')?.textContent?.trim() === 'Stereo Mode',
  );
  if (!parent) throw new Error('no Stereo Mode row');
  act(() => parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  const sub = parent.querySelector<HTMLElement>(':scope > .menu');
  if (!sub) throw new Error('the Stereo Mode submenu did not open');
  return [...sub.querySelectorAll<HTMLElement>(':scope > .menu__row')];
}

const labelOf = (row: HTMLElement): string =>
  row.querySelector(':scope > .menu__label')?.textContent?.trim() ?? '';

describe('row 65 — the Stereo Mode submenu is honest, not deleted', () => {
  it('still renders all nine leaves, in tree order', async () => {
    const rows = await openStereo(makeSession());
    expect(rows.map(labelOf)).toEqual([
      'Anaglyph Stereo',
      'Cross-Eye Stereo',
      'Wall-Eye Stereo',
      'Quad-Buffered Stereo',
      'Zalman Stereo',
      'OpenVR',
      'Swap Sides',
      'Chromadepth',
      'off',
    ]);
  });

  it('disables exactly Quad-Buffered and OpenVR, each with its own reason', async () => {
    const rows = await openStereo(makeSession());
    const disabled = rows.filter((r) => (r as HTMLButtonElement).disabled).map(labelOf);
    expect(disabled).toEqual(['Quad-Buffered Stereo', 'OpenVR']);

    const quad = rows.find((r) => labelOf(r) === 'Quad-Buffered Stereo');
    expect(quad?.getAttribute('title')).toBe(
      'PyMOL> stereo quadbuffer — quad-buffered stereo needs two GL colour buffers on the ' +
        'display; this client is sent ONE image per frame off a single offscreen FBO, so there ' +
        'is nothing to carry the second eye (PyMOL also refuses it on this build: "no ' +
        '\'quadbuffer\' support detected")',
    );
    const vr = rows.find((r) => labelOf(r) === 'OpenVR');
    expect(vr?.getAttribute('title')).toContain('there is no HMD at the far end of a WebSocket');
  });

  it('sends nothing when a refused leaf is clicked', async () => {
    const stub = makeSession();
    const rows = await openStereo(stub);
    const quad = rows.find((r) => labelOf(r) === 'Quad-Buffered Stereo') as HTMLButtonElement;
    act(() => quad.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stub.ran).toEqual([]);
    expect(stub.state.stereo).toBe('off');
  });

  it('leaves the other seven live and issues their literal command line', async () => {
    const stub = makeSession();
    const rows = await openStereo(stub);
    const anaglyph = rows.find((r) => labelOf(r) === 'Anaglyph Stereo') as HTMLButtonElement;
    expect(anaglyph.disabled).toBe(false);
    act(() => anaglyph.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // `{t:'do'}`, so PyMOL produces the `PyMOL>` echo itself.
    expect(stub.ran).toEqual(['stereo anaglyph']);
    expect(stub.state).toEqual({ stereo: 'on', stereoMode: '10' });
  });
});

/**
 * The submenu had to be REACHABLE before any of the above meant anything.
 *
 * MEASURED in a real 1280x900 browser (jsdom lays nothing out, so it cannot see
 * this): `.menu` set `overflow-y: auto` with `overflow-x: visible`, which CSS
 * computes to `auto`, so every menu was a scroll container and clipped the
 * submenu it opens at `left: 100%`. With `Display ▸ Stereo Mode` open, the
 * parent's scrollWidth was 418 against a clientWidth of 208 and
 * `document.elementFromPoint` over the `off` row returned `CANVAS`; the
 * screenshot showed no submenu at all. After the fix, `elementFromPoint` lands
 * inside the row for all 684 leaves of all eleven menus, four levels deep.
 *
 * What CAN be pinned here is the two structural facts that produced it.
 */
describe('row 65 — the submenu is not clipped away', () => {
  it('places a nested list in viewport coordinates, not at left:100% inside the clip', async () => {
    await openStereo(makeSession());
    const sub = container.querySelector<HTMLElement>('.menu .menu--sub');
    expect(sub).not.toBeNull();
    // Inline `left`/`top` from `useSubmenuPosition`. A submenu still relying on
    // the stylesheet's `left: 100%` is one inside the parent's scroll box.
    expect((sub as HTMLElement).style.left).not.toBe('');
    expect((sub as HTMLElement).style.top).not.toBe('');
  });

  it('the stylesheet no longer asks for the overflow-x that CSS refuses to give', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // vitest serves `import.meta.url` as an http:// id in the dom environment,
    // so the path is rebuilt from the repo root instead.
    const css = readFileSync(
      join(process.cwd(), 'apps/web/src/features/menubar/menubar.css'),
      'utf8',
    );
    // Comments stripped: the rule that explains the bug names it.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // `overflow-x: visible` beside `overflow-y: auto` computes to `auto`. Its
    // presence is the bug, not the fix.
    expect(rules).not.toMatch(/overflow-x:\s*visible/);
    expect(rules).toMatch(/\.menu--sub\s*\{[^}]*position:\s*fixed/);
  });
});

describe('row 65 — the tooltip says where it will be visible', () => {
  it('says "the whole scene" when the browser has declared no reps', async () => {
    const rows = await openStereo(makeSession({ geometryReps: [] }));
    const anaglyph = rows.find((r) => labelOf(r) === 'Anaglyph Stereo');
    expect(anaglyph?.getAttribute('title')).toBe(
      'PyMOL> stereo anaglyph — both eyes in one frame, split across the colour channels ' +
        '(red/cyan glasses) — the server is drawing the whole scene (Mode P), so this applies ' +
        'to all of it',
    );
  });

  it('NAMES the client-drawn reps when the viewport is in Mode G for them', async () => {
    const stub = makeSession({ geometryReps: [Rep.Cartoon, Rep.Cyl] });
    const rows = await openStereo(stub);
    // The read really happened, and it is the read-only route.
    expect(stub.calls.filter((c) => c.fn === '_bridge.render_stats')).toHaveLength(1);
    for (const label of ['Anaglyph Stereo', 'Cross-Eye Stereo', 'Zalman Stereo', 'off']) {
      const row = rows.find((r) => labelOf(r) === label);
      expect(row?.getAttribute('title')).toContain(
        'cartoon, sticks are drawn by this browser (Mode G) and will NOT be in stereo',
      );
    }
  });

  it('falls back to "whatever the server is drawing" on a bridge with no such route', async () => {
    const rows = await openStereo(makeSession({ geometryReps: null }));
    const anaglyph = rows.find((r) => labelOf(r) === 'Anaglyph Stereo');
    expect(anaglyph?.getAttribute('title')).toContain(
      'applies to whatever the server is drawing (Mode P)',
    );
  });

  it('does not pay for the probe on a menu with no stereo leaves', async () => {
    const stub = makeSession();
    act(() =>
      root.render(
        <SessionContext.Provider value={stub.session}>
          <MenuBar />
        </SessionContext.Provider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const file = [...container.querySelectorAll<HTMLButtonElement>('.menubar__item')].find(
      (el) => el.textContent?.trim() === 'File',
    );
    act(() => (file as HTMLButtonElement).click());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(stub.calls.filter((c) => c.fn === '_bridge.render_stats')).toEqual([]);
  });
});

describe('row 65 — the console line after the click', () => {
  it('reads the state back and says what the user will see', async () => {
    const stub = makeSession({ geometryReps: [Rep.Cartoon] });
    const rows = await openStereo(stub);
    const anaglyph = rows.find((r) => labelOf(r) === 'Anaglyph Stereo') as HTMLButtonElement;
    act(() => anaglyph.click());
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(stub.feedback()).toContain(
      ' stereo anaglyph: stereo on, stereo_mode 10 — cartoon is drawn by this browser (Mode G) ' +
        'and will NOT be in stereo; switch those reps back to P in the viewport HUD to see them in stereo',
    );
  });

  it('says Chromadepth is not stereo, which its own label does not', async () => {
    const stub = makeSession({ geometryReps: [] });
    const rows = await openStereo(stub);
    const chroma = rows.find((r) => labelOf(r) === 'Chromadepth') as HTMLButtonElement;
    act(() => chroma.click());
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(stub.ran).toEqual(['stereo chromadepth']);
    expect(stub.feedback().join('\n')).toContain(
      'stereo chromadepth is not a stereo mode: it sets chromadepth 1 and turns stereo OFF',
    );
  });

  it('writes nothing extra for a leaf that is not a stereo leaf', async () => {
    const stub = makeSession({ geometryReps: [] });
    await openStereo(stub);
    const list = container.querySelector<HTMLElement>('.menubar__item-wrap .menu');
    const zoom = [...(list?.querySelectorAll<HTMLElement>(':scope > .menu__row') ?? [])].find(
      (el) => el.querySelector(':scope > .menu__label')?.textContent?.trim() === 'Zoom',
    );
    act(() => (zoom as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    const leaf = zoom?.querySelector<HTMLButtonElement>(':scope > .menu > .menu__row');
    expect(leaf?.textContent).toContain('4 Angstrom Sphere');
    act(() => (leaf as HTMLButtonElement).click());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(stub.feedback().filter((l) => l.includes('stereo'))).toEqual([]);
  });
});
