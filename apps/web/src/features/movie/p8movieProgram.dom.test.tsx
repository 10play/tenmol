/**
 * Wave 8 — "Update Last Program", driven through the real panel.
 *
 * `PyMOLDesktopGUI.mvprg` (`_gui.py:958-970`) is three lines and one trap:
 *
 *   def mvprg(self, command=None):
 *       if command is not None:
 *           self.movie_start = cmd.get_movie_length() + 1
 *           self.movie_command = command % self.movie_start
 *       if self.movie_command: cmd.do(self.movie_command)
 *
 * The trap is that Update re-runs the ALREADY SUBSTITUTED string. Both `%d`
 * and `get_movie_length()` are resolved once, when the program is first
 * chosen; a second run appends at the SAME start frame, overwriting the
 * program instead of stacking another one behind it. A client that re-rendered
 * the template on Update would append at `length+1` of the now-longer movie —
 * the same click, silently doing something else.
 *
 * This test makes the movie grow between the two clicks and asserts that the
 * second command line is byte-identical to the first.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MoviePanel } from './MoviePanel';

interface Call {
  fn: string;
  args: readonly unknown[];
  kwargs?: Record<string, unknown>;
  echo?: string;
}

const acted: Call[] = [];
const lines: string[] = [];
const logged: string[] = [];

/** `cmd.get_movie_length()` as the panel sees it, through `status.length`. */
let movieLength = 10;

const SESSION = {
  call: vi.fn(async (fn: string, args: readonly unknown[] = []) => {
    if (fn === 'cmd.get_movie_status') {
      return {
        frame: 1,
        state: 1,
        nframes: movieLength,
        length: movieLength,
        playing: false,
        locked: false,
        rocking: false,
        fps: 30,
        sceneCurrent: null,
        settings: {},
      };
    }
    if (fn === 'cmd.get_movie_panel') {
      return {
        nframes: movieLength,
        cells: [],
        rows: [],
        visible: false,
        rowHeight: 15,
        height: 15,
        matrix: false,
        motions: 0,
        presentation: false,
        label: 'camera',
        labelIndent: 64,
        panelActive: false,
        panelHeight: 0,
      };
    }
    if (fn === 'cmd.get_scene_panel') return { scenes: [], current: null, order: [] };
    if (fn === 'cmd.count_states') return 1;
    if (fn === 'cmd.get_view') return String(args);
    return null;
  }),
  act: vi.fn(async (action: Call) => {
    acted.push(action);
  }),
  run: vi.fn(async (line: string) => {
    lines.push(line);
    // The program really does lengthen the movie — that is the whole point.
    if (line.includes('add_roll')) movieLength = 130;
  }),
  stores: {
    feedback: { appendClient: (line: string) => logged.push(line) },
    ui: { get: () => ({ echoActions: false }) },
  },
};

vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  acted.length = 0;
  lines.length = 0;
  logged.length = 0;
  movieLength = 10;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<MoviePanel />);
  });
  await act(async () => {});
}

/** Submenu buttons carry a trailing arrow glyph; leaves carry an empty mark. */
function label(button: Element): string {
  return (button.textContent ?? '').replace(/[▸▾✓●]/g, '').trim();
}

function byText(text: string): HTMLElement {
  const node = [...container.querySelectorAll('button')].find(
    (button) => label(button) === text,
  );
  if (!node) throw new Error(`no button labelled ${text}`);
  return node as HTMLElement;
}

async function click(text: string): Promise<void> {
  await act(async () => {
    byText(text).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Open the Movie menu tab and walk down to a Program leaf. */
async function chooseRollProgram(): Promise<void> {
  await click('menu');
  await click('Program');
  await click('Camera Loop');
  await click('Y-Roll');
  await click('4 seconds');
}

describe('Update Last Program re-runs the stored line, start frame and all', () => {
  it('substitutes %d with get_movie_length() + 1 the first time', async () => {
    await render();
    await chooseRollProgram();
    expect(lines).toEqual(["movie.add_roll(4.0,axis='y',start=11)"]);
  });

  it('re-runs the SAME line after the movie has grown to 130 frames', async () => {
    await render();
    await chooseRollProgram();
    expect(movieLength).toBe(130);

    await click('Update Last Program');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(lines[0]);
    // Not `start=131`: `movie_start` was frozen when the program was chosen.
    expect(lines[1]).toContain('start=11');
  });

  it('does nothing at all before any program has been chosen', async () => {
    await render();
    await click('menu');
    await click('Update Last Program');
    expect(lines).toEqual([]);
  });

  it('Remove Last Program deletes from that same frozen start frame', async () => {
    await render();
    await chooseRollProgram();
    await click('Remove Last Program');

    const deletes = acted.filter((action) => action.fn === 'cmd.mdelete');
    expect(deletes).toHaveLength(1);
    // `mvprg_remove_last`: `cmd.mdelete(-1, movie_start)`.
    expect(deletes[0]?.args).toEqual([-1, 11]);
    expect(deletes[0]?.echo).toBe('cmd.mdelete(-1, 11)');
  });

  it('a second program chosen after the first re-reads the length', async () => {
    await render();
    await chooseRollProgram();
    await click('4 seconds');
    expect(lines[1]).toBe("movie.add_roll(4.0,axis='y',start=131)");
  });
});
