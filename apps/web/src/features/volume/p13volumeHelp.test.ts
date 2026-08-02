/**
 * Row 445 — **Volume: Help text**. The one row in the whole parity file that
 * carried `—` in `Covered by`: no test named it and no fallback match found one
 * either, because the row's backend contract is literally "none". Nothing in
 * the suite read `VOLUME_HELP` at all, so the string could have been deleted,
 * truncated or silently reworded and every one of the 1900 web tests would
 * still have been green.
 *
 * The row is a VERBATIM-TEXT row: "shows the VOLUME_HELP block: canvas mouse
 * actions with and without a point under the cursor, the L/M/R legend and a
 * pointer to the volume_color command". So the assertion that means anything is
 * the one that compares the ported constant against the upstream literal it was
 * copied from, character for character — the same technique
 * `builder.test.ts` uses for the 60-button tables. A help text that drifts from
 * the bindings it documents is worse than no help text: it teaches the user a
 * gesture that does not exist.
 *
 * The only licensed difference is the leading newline of Python's
 * `'''\nVOLUME PANEL HELP` triple-quoted literal, which the TS template literal
 * drops; that is asserted here explicitly rather than papered over with a
 * `trim()` on both sides, so a SECOND difference cannot hide behind it.
 *
 * The DOM half — the `Help` button actually rendering this text into the
 * reusable 500 px text dialog — is in `p13volumeGestures.dom.test.tsx`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_DIALOG_WIDTH, VOLUME_HELP } from './ramp';

const REPO = join(import.meta.dirname, '../../../../..');
const QT_VOLUME = join(REPO, 'packages/engine/modules/pmg_qt/volume.py');
const qtSource = readFileSync(QT_VOLUME, 'utf8');

/** The `VOLUME_HELP = '''...'''` literal of `volume.py:30-66`, unescaped. */
function upstreamHelp(): string {
  const match = /^VOLUME_HELP = '''([\s\S]*?)'''$/m.exec(qtSource);
  if (!match) throw new Error('VOLUME_HELP literal not found in pmg_qt/volume.py');
  return match[1]!;
}

describe("row 445 — the volume Help text is upstream's, not a paraphrase", () => {
  it('reproduces VOLUME_HELP character for character, modulo the leading newline', () => {
    const upstream = upstreamHelp();
    // The literal really does open with a newline: proving that pins down the
    // ONE difference the port is allowed to have.
    expect(upstream.startsWith('\nVOLUME PANEL HELP')).toBe(true);
    expect(VOLUME_HELP).toBe(upstream.slice(1));
  });

  it('documents every gesture the canvas implements, with no point under the cursor', () => {
    // `volume.py:34-40` — the empty-canvas block.
    expect(VOLUME_HELP).toContain('Canvas Mouse Actions (no Point under Cursor)');
    expect(VOLUME_HELP).toContain('  L-Click            Add point');
    expect(VOLUME_HELP).toContain('  CTRL+L-Click       Add 3 points (isosurface)');
    expect(VOLUME_HELP).toContain('  CTRL+R-Drag        Zoom in');
  });

  it('documents every gesture with a point under the cursor, all eleven of them', () => {
    // `volume.py:42-58`. Listed one by one rather than as a blob: a `toContain`
    // on the section header alone stays green if a line goes missing.
    for (const line of [
      '  L-Click            Edit point color',
      '  R-Click            Edit point value',
      '  SHIFT+R-Click      Edit point opacity',
      '  CTRL+L-Click       Edit color of 3 points',
      '  M-Click            Remove Point',
      '  SHIFT+L-Click      Remove Point',
      '  CTRL+M-Click       Remove 3 points',
      '  CTRL+SHIFT+L-Click Remove 3 points',
      '  L-Drag             Move point',
      '  CTRL+L-Drag        Move 3 points (horizontal only)',
      '  R-Drag             Move point along one axis only',
    ]) {
      expect(VOLUME_HELP).toContain(line);
    }
  });

  it('keeps the L/M/R legend and the pointer to the volume_color command', () => {
    expect(VOLUME_HELP).toContain('L = Left mouse button');
    expect(VOLUME_HELP).toContain('M = Middle mouse button');
    expect(VOLUME_HELP).toContain('R = Right mouse button');
    expect(VOLUME_HELP).toContain('See also the "volume_color" command for getting and');
    expect(VOLUME_HELP).toContain('setting volume colors on the command line.');
  });

  it('is shown in the 500 px reusable text dialog upstream uses (volume.py:28)', () => {
    expect(DEFAULT_TEXT_DIALOG_WIDTH).toBe(500);
    expect(qtSource).toContain('DEFAULT_TEXT_DIALOG_WIDTH = 500');
  });
});
