/**
 * Row 334 — the Scene menu (`packages/engine/modules/pymol/_gui.py:775-805`)
 * and its F-key submenus (`_gui.py:61`, `F_scene_menu`).
 *
 * WHY THIS FILE EXISTS. The row cited `packages/bridge/tests/test_key_bindings.py`,
 * which covers the OTHER half of the row — a bare F-key with no `set_key`
 * mapping falling through to a scene of the same name, then to a view of the
 * same name. Nothing covered the menu tree itself. MEASURED while auditing the
 * citation: rewriting `Store> F<n>` to store into `new` instead of into the
 * key, and swapping the `Append> Camera` flags for the `Color` flags, both
 * left the entire web suite green. Those are the two mistakes the menu invites
 * — the F-key submenus and the Append> flag combinations are four almost
 * identical command strings each, and only the arguments distinguish them.
 *
 * The flag combinations are `_gui.py:782-785` verbatim, and they are not
 * symmetric: "Camera" turns colour and reps OFF, "Color" turns view and reps
 * off, "Reps" turns view and colour off, and "Reps + Color" turns only view
 * off. Getting one wrong stores a scene that silently restores the wrong
 * things a week later, when the user has no way left to tell.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneMenu } from './SceneMenu';
import { F_KEYS, type SceneAction } from './sceneActions';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let ran: SceneAction[];
let lines: string[];

function render(opts: { current?: string | null; scenes?: string[]; buttons?: boolean | null } = {}) {
  act(() => {
    root.render(
      <SceneMenu
        current={opts.current ?? null}
        scenes={opts.scenes ?? []}
        buttons={opts.buttons ?? false}
        onRun={(action) => ran.push(action)}
        onCommand={(line) => lines.push(line)}
      />,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!found) {
    throw new Error(
      `no button "${label}"; have ${Array.from(container.querySelectorAll('button'))
        .map((b) => JSON.stringify((b.textContent ?? '').trim()))
        .join(', ')}`,
    );
  }
  return found as HTMLButtonElement;
}

function click(label: string): void {
  act(() => {
    button(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  ran = [];
  lines = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Scene menu — the top row (row 334)', () => {
  it('Next / Previous are cmd.scene("", next|previous), the PgDn/PgUp bindings', () => {
    render();
    click('Next [PgDn]');
    click('Previous [PgUp]');
    expect(ran.map((a) => [a.fn, a.args])).toEqual([
      ['cmd.scene', ['', 'next']],
      ['cmd.scene', ['', 'previous']],
    ]);
  });

  it('Append stores a NEW key; Insert Before / After are their own actions', () => {
    render();
    click('Append');
    click('Insert Before');
    click('Insert After');
    expect(ran.map((a) => a.args)).toEqual([
      ['new', 'store'],
      ['', 'insert_before'],
      ['', 'insert_after'],
    ]);
  });

  it('Update and Delete address the CURRENT scene through key="auto"', () => {
    render({ current: 'F3' });
    click('Update');
    click('Delete');
    // `viewing.py:1090` aliases clear -> delete and update -> store, but the
    // wire word is the one the user typed: `update` is what preserves the
    // message, `clear` is what the menu calls Delete.
    expect(ran.map((a) => a.args)).toEqual([
      ['auto', 'update'],
      ['auto', 'clear'],
    ]);
  });
});

describe('Scene menu — Append> flag combinations (_gui.py:782-785)', () => {
  it('is four DIFFERENT flag sets, one per column of the submenu', () => {
    render();
    click('Append…');
    click('Camera');
    click('Color');
    click('Reps');
    click('Reps + Color');
    expect(lines).toEqual([
      'scene new, store, color=0, rep=0',
      'scene new, store, view=0, rep=0',
      'scene new, store, view=0, color=0',
      'scene new, store, view=0',
    ]);
    // no two of them are the same command
    expect(new Set(lines).size).toBe(4);
  });
});

describe('Scene menu — Recall / Store / Clear submenus of F1..F12 (_gui.py:61)', () => {
  it('lists exactly F1..F12', () => {
    render();
    click('Store…');
    const keys = Array.from(container.querySelectorAll('.scmenu__sub--keys button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(keys).toEqual(F_KEYS);
    expect(keys).toHaveLength(12);
  });

  it.each([
    ['Recall…', 'recall'],
    ['Store…', 'store'],
    ['Clear…', 'clear'],
  ])('%s sends cmd.scene("F<n>", %s) FOR THAT KEY, not for the current scene', (open, action) => {
    render({ current: 'someOtherScene' });
    click(open);
    click('F1');
    click('F12');
    expect(ran.map((a) => a.args)).toEqual([
      ['F1', action],
      ['F12', action],
    ]);
  });

  it('marks the keys that already carry a scene, so Store> shows what it overwrites', () => {
    render({ scenes: ['F2', 'F9'] });
    click('Store…');
    const lit = Array.from(container.querySelectorAll('.scmenu__sub--keys button.has-scene')).map(
      (b) => (b.textContent ?? '').trim(),
    );
    expect(lit).toEqual(['F2', 'F9']);
  });
});

describe('Scene menu — Buttons check and Cache> (_gui.py:801-805)', () => {
  it('Buttons writes the scene_buttons SETTING, which is what draws the overlay', () => {
    render({ buttons: false });
    act(() => {
      const box = container.querySelector('.scmenu__check input') as HTMLInputElement;
      box.click();
    });
    expect(ran.map((a) => [a.fn, a.args])).toEqual([['cmd.set', ['scene_buttons', 1]]]);
  });

  it('Cache> is the four cmd.cache modes, in menu order', () => {
    render();
    click('Cache…');
    // the ORDER on screen is `_gui.py:803`'s, not just the set of four
    expect(
      Array.from(container.querySelectorAll('.scmenu__sub button')).map((b) =>
        (b.textContent ?? '').trim(),
      ),
    ).toEqual(['enable', 'optimize', 'read_only', 'disable']);
    for (const mode of ['enable', 'optimize', 'read_only', 'disable']) click(mode);
    expect(ran.map((a) => [a.fn, a.args])).toEqual([
      ['cmd.cache', ['enable']],
      ['cmd.cache', ['optimize']],
      ['cmd.cache', ['read_only']],
      ['cmd.cache', ['disable']],
    ]);
  });
});
