/**
 * The internal-GUI column's height budget, as arithmetic.
 *
 * NOT A PARITY ROW — this guards a product fix. `.objpanel` was the only child
 * of `.internal-gui` with `flex-basis: 0`, so it was the residual, and it had
 * `min-height: 0`, so the residual could be nothing. MEASURED IN CHROMIUM at
 * 1280x900 (`apps/web/e2e/smoke.e2e.mjs`, spec "the internal-gui column keeps
 * the object list reachable"):
 *
 *                        before                after
 *     .objpanel            34 px  ->  0 px      161 px
 *     .objpanel__rows      17 px  ->  2 px      144 px  (scrollHeight 128)
 *     rows rendered              7                    7
 *     rows REACHABLE       1      ->  0                7
 *
 * WHAT THIS FILE CAN AND CANNOT TEST. jsdom lays nothing out, so the numbers
 * above are unreachable here and the e2e spec is the real guard. What IS
 * testable here is the DERIVATION: the floor must stay tied to the two PyMOL
 * constants it is claimed to come from, so that changing `ORTHO.butModeGridHeight`
 * to match a future `ButModeGetHeight` moves the floor with it — and so that a
 * later edit cannot quietly turn 144 into a taste number.
 *
 * The stylesheet holds the same value as `--pm-exec-min`, and vitest stubs CSS
 * imports, so the two are cross-checked by READING THE STYLESHEET AS TEXT.
 * That is deliberately crude and it is the only thing that catches the two
 * drifting apart without a browser.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXECUTIVE_MIN_HEIGHT, ORTHO } from './orthoPanel';

const GLOBAL_CSS = fileURLToPath(new URL('../styles/global.css', import.meta.url));
const OBJECTS_CSS = fileURLToPath(new URL('../features/objects/objects.css', import.meta.url));
const MOVIE_CSS = fileURLToPath(new URL('../features/movie/movie.css', import.meta.url));
const SCENES_CSS = fileURLToPath(new URL('../features/scenes/scenes.css', import.meta.url));

const read = (path: string) => readFileSync(path, 'utf8');

/** `--name: value;` out of a stylesheet's `:root`. */
function cssVar(source: string, name: string): string | null {
  const hit = new RegExp(`--${name}:\\s*([^;]+);`).exec(source);
  return hit?.[1] !== undefined ? hit[1].trim() : null;
}

describe('the object list floor (measured defect, not a parity row)', () => {
  it('is controlHeight plus the LARGEST ButModeGetHeight, and nothing else', () => {
    // The claim in one line: the object list is never handed less height than
    // the two blocks that outrank it in `OrthoLayoutPanel` can ever take
    // between them. Control is a flat `DIP2PIXEL(20)`; ButMode is 40, or 124
    // with `mouse_grid` — and `mouse_grid` DEFAULTS TO 1, so 124 is the case
    // that matters, not the exception.
    expect(ORTHO.controlHeight).toBe(20);
    expect(ORTHO.butModeGridHeight).toBe(124);
    expect(EXECUTIVE_MIN_HEIGHT).toBe(ORTHO.controlHeight + ORTHO.butModeGridHeight);
    expect(EXECUTIVE_MIN_HEIGHT).toBe(144);
  });

  it('is a whole number of Executive rows', () => {
    // `ExecutiveDrawPanel` measures the block in rows of
    // `DIP2PIXEL(internal_gui_control_size)` (`packages/engine/layer3/Executive.cpp:16192`),
    // which is 18 and is `--pm-row-h`. A floor that is not a multiple of it
    // would guarantee a half-row nobody can click the middle of.
    expect(ORTHO.controlSize).toBe(18);
    expect(EXECUTIVE_MIN_HEIGHT % ORTHO.controlSize).toBe(0);
    expect(EXECUTIVE_MIN_HEIGHT / ORTHO.controlSize).toBe(8);
    expect(cssVar(read(GLOBAL_CSS), 'pm-row-h')).toBe(`${ORTHO.controlSize}px`);
  });

  it('is UNDER what PyMOL gives the same list, so it is a floor and not a claim', () => {
    // MEASURED against the real engine at the browser column's own 644 px
    // (`packages/bridge/tests/test_p11_layout.py`): PyMOL's Executive block is
    // 644 - 20 (Control) - 40 (ButMode) - 0 (Wizard) = 584 px, and 569 with a
    // movie panel active. The floor must stay a long way under both or it stops
    // being a floor and starts starving the panels around it.
    const pymolExecutiveAt644 = 644 - ORTHO.controlHeight - ORTHO.butModeHeight;
    expect(pymolExecutiveAt644).toBe(584);
    expect(EXECUTIVE_MIN_HEIGHT).toBeLessThan(pymolExecutiveAt644 / 2);
  });

  it('is the number the stylesheet actually applies', () => {
    const global = read(GLOBAL_CSS);
    expect(cssVar(global, 'pm-exec-min')).toBe(`${EXECUTIVE_MIN_HEIGHT}px`);
    // …and it is applied to the LIST, which is what PyMOL's Executive block is;
    // `.objpanel__head` is a web addition with no counterpart.
    expect(read(OBJECTS_CSS)).toContain('min-height: var(--pm-exec-min);');
    // The panel around it carries head + floor, so `overflow: hidden` there can
    // never cut into the floor.
    expect(read(OBJECTS_CSS)).toContain(
      'min-height: calc(var(--pm-panel-head-h) + var(--pm-exec-min));',
    );
  });
});

describe('what yields instead of the object list', () => {
  it('gives the movie panel a floor of head + Control block + one movie row', () => {
    const global = read(GLOBAL_CSS);
    // `movie_panel_row_height` (`packages/engine/layer1/SettingInfo.h:722`) and
    // `controlHeight` (`packages/engine/layer1/Ortho.cpp:2267`).
    expect(cssVar(global, 'pm-movie-row-h')).toBe('15px');
    expect(cssVar(global, 'pm-control-h')).toBe(`${ORTHO.controlHeight}px`);
    expect(read(MOVIE_CSS)).toContain(
      'min-height: calc(var(--pm-panel-head-h) + var(--pm-control-h) + var(--pm-movie-row-h));',
    );
  });

  it('gives the scene bin a floor of head + one control-size row', () => {
    // PyMOL reserves NOTHING for the scene bin — `SceneDrawButtons` paints over
    // the scene and returns early with an empty `SceneVec` (measured in
    // `packages/bridge/tests/test_p11_layout.py`: storing three scenes moves neither the
    // scene rectangle nor the Executive block). So its floor is the smallest
    // thing that is still operable: the head and the one row
    // `SceneDrawButtons` clamps `n_disp` to.
    expect(read(SCENES_CSS)).toContain(
      'min-height: calc(var(--pm-panel-head-h) + var(--pm-row-h));',
    );
  });

  it('makes every panel that can shrink SCROLL rather than clip', () => {
    // The defect's real shape: a squeezed panel with `overflow: hidden` leaves
    // its children with full bounding boxes and no way to click them. Anything
    // that yields must be a scroll container.
    for (const [name, source] of [
      ['movie', read(MOVIE_CSS)],
      ['scenes', read(SCENES_CSS)],
    ] as const) {
      expect(source, `${name}: the panel that yields must scroll`).toContain('overflow-y: auto;');
    }
    // The column itself is the last valve: when every panel is at its floor and
    // the column is still shorter, the user gets a scrollbar, not a clip.
    expect(read(GLOBAL_CSS)).toMatch(/\.internal-gui \{[^}]*overflow-y: auto;/);
  });

  it('never lets the object list out-rank its own head', () => {
    // 17 + 144. Asserted as arithmetic because the e2e spec asserts >= 161 and
    // the two must not drift.
    expect(cssVar(read(GLOBAL_CSS), 'pm-panel-head-h')).toBe('17px');
    expect(17 + EXECUTIVE_MIN_HEIGHT).toBe(161);
  });
});
