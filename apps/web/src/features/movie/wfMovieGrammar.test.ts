/**
 * The parts of the movie-panel grammar that the first pass left out, and the
 * export dialog's encoder table.
 *
 * Everything asserted here has a counterpart in `bridge/tests/test_wf_movie.py`
 * that runs the resulting command against a live PyMOL — this file pins the
 * *choice* of command, that file pins its *effect*. The pairs that matter:
 *
 *   `object='none'` vs `''`   `test_object_none_is_the_camera_row_and_empty_is_every_row`
 *   ctrl+shift column mode    `test_object_none_is_the_camera_row_and_empty_is_every_row`
 *   ctrl+shift wheel          `test_row_height_is_a_settable_global_the_ctrl_shift_wheel_writes`
 *   encoder table             `test_produce_plan_matches_movie_py_decisions`
 */

import { describe, expect, it } from 'vitest';
import {
  boxSpan,
  classifyGesture,
  classifyWheel,
  dragBoxes,
  GHOST,
  objectArgument,
  type PanelRect,
} from './timeline';
import { panelGesture } from './movieSource';
import { encoderFor, presetSize } from './ExportDialog';

const drag = { button: 2 as const, shift: false, ctrl: false, from: 2, to: 5, travel: 40 };

describe('objectArgument — CMovie::release:1607-1615', () => {
  it('is none for the camera row, the name for an object row', () => {
    expect(objectArgument('', false)).toBe('none');
    expect(objectArgument('m2', false)).toBe('m2');
  });

  it("is '' for column mode, and 'same' for the Oblate/mview-clear column", () => {
    expect(objectArgument('', true)).toBe('');
    expect(objectArgument('m2', true)).toBe('');
    expect(objectArgument('m2', true, true)).toBe('same');
  });
});

describe('classifyGesture — the cases MovieClick has and the first pass did not', () => {
  it('ctrl+shift right-drag is a column MOVE, never a copy', () => {
    // `mod == cOrthoSHIFT` is an equality test (`Movie.cpp:1503`), so adding
    // ctrl takes the else branch: cMovieDragModeMoveKey with DragColumn set.
    expect(classifyGesture({ ...drag, ctrl: true, shift: true, object: 'm2' })).toEqual({
      kind: 'move',
      target: 6,
      source: 3,
      count: 1,
      object: '',
    });
  });

  it('a right-drag inside one cell is neither a menu nor an mmove', () => {
    // `CMovie::drag:1589` clears DragMenu past 3 px; `release:1621` needs
    // cur == start AND DragMenu. 4 px inside one cell satisfies neither arm.
    expect(classifyGesture({ ...drag, to: 2, travel: 4 })).toBeNull();
    expect(classifyGesture({ ...drag, to: 2, travel: 3 })).toEqual({
      kind: 'menu',
      frame: 2,
      object: '',
      column: false,
    });
  });

  it('a press past the last cell opens the menu at once', () => {
    // `if(I->DragStartFrame<n_frame) {...} else { MenuActivate }` (`:1508`).
    expect(classifyGesture({ ...drag, from: 9, to: 9, frames: 6, travel: 99 })).toEqual({
      kind: 'menu',
      frame: 9,
      object: '',
      column: false,
    });
  });

  it('drops a right-drag that lands outside the strip', () => {
    // `release:1626` requires `0 <= DragCurFrame < n_frame`.
    expect(classifyGesture({ ...drag, from: 2, to: 6, frames: 6 })).toBeNull();
    expect(classifyGesture({ ...drag, from: 2, to: -1, frames: 6 })).toBeNull();
    expect(classifyGesture({ ...drag, from: 2, to: 5, frames: 6 })).toMatchObject({ kind: 'move' });
  });

  it('shift+left is reserved, not a scrub', () => {
    // `case cOrthoSHIFT: /* TEMPORAL SELECTIONS -- TO COME */ break;` (`:1521`).
    expect(classifyGesture({ ...drag, button: 0, shift: true })).toBeNull();
  });

  it('ctrl+shift left-drag inserts across every row', () => {
    expect(classifyGesture({ ...drag, button: 0, ctrl: true, shift: true, object: 'm2' })).toEqual({
      kind: 'insert',
      count: 3,
      frame: 3,
      object: '',
    });
  });

  it('a backward ctrl-drag off the left edge clamps the delete to frame 1', () => {
    // `if(I->DragCurFrame<0) I->DragCurFrame = 0;` then `first+1` (`:1687`).
    expect(classifyGesture({ ...drag, button: 0, ctrl: true, from: 3, to: -4 })).toEqual({
      kind: 'delete',
      count: 3,
      frame: 1,
      object: 'none',
    });
  });

  it('ctrl+middle clamps the cleared range into the strip', () => {
    // `min_frame`/`max_frame` clamped to [0, n_frame-1] (`:1657-1663`).
    expect(
      classifyGesture({ ...drag, button: 1, ctrl: true, from: -3, to: 99, frames: 6 }),
    ).toEqual({ kind: 'clear', first: 1, last: 6, object: 'none' });
  });
});

describe('classifyWheel — MovieClick:1556-1568', () => {
  const at = (deltaY: number, ctrl: boolean, shift: boolean) =>
    classifyWheel({ deltaY, ctrl, shift, rowHeight: 15 });

  it('steps one frame per notch without modifiers', () => {
    expect(at(1, false, false)).toEqual({ kind: 'frame', delta: 1 });
    expect(at(-1, false, false)).toEqual({ kind: 'frame', delta: -1 });
    expect(at(1, true, false)).toEqual({ kind: 'frame', delta: 1 });
    expect(at(1, false, true)).toEqual({ kind: 'frame', delta: 1 });
  });

  it('ctrl+shift resizes the rows: forward taller, backward shorter', () => {
    // SCROLL_FORWARD falls through with scrolldir = -1, and the setting is
    // written as `row_height - scrolldir`.
    expect(at(-1, true, true)).toEqual({ kind: 'rowHeight', value: 16 });
    expect(at(1, true, true)).toEqual({ kind: 'rowHeight', value: 14 });
  });

  it('floors the row height at 1 where the C would go negative', () => {
    expect(classifyWheel({ deltaY: 1, ctrl: true, shift: true, rowHeight: 1 })).toEqual({
      kind: 'rowHeight',
      value: 1,
    });
  });
});

describe('panelGesture — the strings CMovie::release hands to PParse', () => {
  it('formats them exactly as the C does, commas without spaces', () => {
    expect(panelGesture.mmove(6, 3, 1, 'none').echo).toBe("cmd.mmove(6,3,1,object='none')");
    expect(panelGesture.mcopy(6, 3, 1, 'm2').echo).toBe("cmd.mcopy(6,3,1,object='m2')");
    expect(panelGesture.minsert(3, 3, '').echo).toBe("cmd.minsert(3,3,object='')");
    expect(panelGesture.mdelete(3, 3, 'none').echo).toBe("cmd.mdelete(3,3,object='none')");
    expect(panelGesture.clear(4, 8, 'same').echo).toBe(
      "cmd.mview('clear',first=4,last=8,object='same')",
    );
  });

  it('always sends object=, because omitting it means the column default', () => {
    // `mmove(target, source=0, count=-1, freeze=0, object='')` — the fourth
    // POSITIONAL is freeze, and the default object is '' == every row.
    expect(panelGesture.mmove(6, 3, 1, 'none').args).toEqual([6, 3, 1]);
    expect(panelGesture.mmove(6, 3, 1, 'none').kwargs).toEqual({ object: 'none' });
    expect(panelGesture.clear(4, 8, 'none').kwargs).toEqual({ first: 4, last: 8, object: 'none' });
  });

  it('marks every one of them as invalidating the panel', () => {
    for (const action of [
      panelGesture.mmove(1, 2, 1, ''),
      panelGesture.mcopy(1, 2, 1, ''),
      panelGesture.minsert(1, 1, ''),
      panelGesture.mdelete(1, 1, ''),
      panelGesture.clear(1, 2, ''),
      panelGesture.rowHeight(16),
    ]) {
      expect(action.invalidatesPanel).toBe(true);
    }
  });
});

describe('dragBoxes — CMovie::draw:1793-1838', () => {
  it('move/copy: white source box, grey target box', () => {
    expect(dragBoxes({ button: 2, ctrl: false, from: 2, to: 5, frames: 8 })).toEqual([
      { first: 2, last: 3, color: GHOST.white, fill: false },
      { first: 5, last: 6, color: GHOST.grey, fill: true },
    ]);
  });

  it('move/copy: drops the source box past the end and the target off the strip', () => {
    // `if(I->DragStartFrame<n_frame)` / `if((cur>=0) && (cur<n_frame))`.
    expect(dragBoxes({ button: 2, ctrl: false, from: 9, to: 5, frames: 8 })).toEqual([
      { first: 5, last: 6, color: GHOST.grey, fill: true },
    ]);
    expect(dragBoxes({ button: 2, ctrl: false, from: 2, to: 9, frames: 8 })).toEqual([
      { first: 2, last: 3, color: GHOST.white, fill: false },
    ]);
  });

  it('oblate: white outline AND grey fill over the clamped span', () => {
    expect(dragBoxes({ button: 1, ctrl: true, from: 6, to: -2, frames: 8 })).toEqual([
      { first: 0, last: 7, color: GHOST.white, fill: false },
      { first: 0, last: 7, color: GHOST.grey, fill: true },
    ]);
  });

  it('ins/del: white unchanged, green forward, red backward', () => {
    expect(dragBoxes({ button: 0, ctrl: true, from: 3, to: 3, frames: 8 })).toEqual([
      { first: 3, last: 3, color: GHOST.white, fill: true },
    ]);
    expect(dragBoxes({ button: 0, ctrl: true, from: 3, to: 6, frames: 8 })).toEqual([
      { first: 3, last: 6, color: GHOST.green, fill: true },
    ]);
    expect(dragBoxes({ button: 0, ctrl: true, from: 6, to: 3, frames: 8 })).toEqual([
      { first: 3, last: 6, color: GHOST.red, fill: true },
    ]);
  });

  it('a plain left drag draws no ghost at all — it is the scrollbar', () => {
    expect(dragBoxes({ button: 0, ctrl: false, from: 1, to: 5, frames: 8 })).toEqual([]);
    expect(dragBoxes({ button: 1, ctrl: false, from: 1, to: 5, frames: 8 })).toEqual([]);
  });

  it('is the literal float4 palette of Movie.cpp, x255', () => {
    expect(GHOST.white).toBe('rgba(255,255,255,0.5)'); // {1,1,1,0.5}
    expect(GHOST.grey).toBe('rgba(191,191,191,0.5)'); // {0.75,0.75,0.75,0.5}
    expect(GHOST.green).toBe('rgba(128,255,128,0.5)'); // {0.5,1,0.5,0.5}
    expect(GHOST.red).toBe('rgba(255,128,128,0.5)'); // {1,0.5,0.5,0.5}
  });
});

describe('boxSpan — ViewElemDrawBox:107-123', () => {
  const rect: PanelRect = { left: 0, right: 100, top: 0, bottom: 20 };

  it('is the same arithmetic as frameToX, plus the 1 px minimum', () => {
    expect(boxSpan(rect, 10, 2, 5)).toEqual({ start: 20, stop: 50, top: 1, bottom: 19 });
    // `if((stop - start) < 1.0F) stop = start + 1` — a zero-width box would
    // make the "did not move" ins/del ghost invisible.
    expect(boxSpan(rect, 10, 3, 3)).toEqual({ start: 30, stop: 31, top: 1, bottom: 19 });
    // 500 frames in 100 px: every cell is a sub-pixel and still shows.
    expect(boxSpan(rect, 500, 250, 251).stop).toBe(51);
  });
});

describe('encoderFor — movie.produce:915-933', () => {
  const all = { ffmpeg: '/u/ffmpeg', convert: '/u/convert', mpeg_encode: '/u/mpeg_encode' };

  it('sends .mpg to mpeg_encode and never falls back for it', () => {
    expect(encoderFor('mpg', all)).toBe('mpeg_encode');
    expect(encoderFor('mpg', { ...all, mpeg_encode: null })).toBeNull();
  });

  it('prefers ffmpeg for everything else, then convert', () => {
    expect(encoderFor('mp4', all)).toBe('ffmpeg');
    expect(encoderFor('webm', all)).toBe('ffmpeg');
    expect(encoderFor('gif', { ...all, ffmpeg: null })).toBe('convert');
    // `_encode`'s convert branch is not gif-only; produce reaches it for any
    // extension once ffmpeg is missing (`movie.py:920`).
    expect(encoderFor('mov', { ...all, ffmpeg: null })).toBe('convert');
    expect(encoderFor('mp4', { ffmpeg: null, convert: null, mpeg_encode: null })).toBeNull();
  });

  it('needs no encoder for the PNG path', () => {
    expect(encoderFor('png', null)).toBeNull();
  });
});

describe('presetSize — file_dialogs.py 720p/480p/360p', () => {
  it('keeps the aspect ratio, clamped to 16:9', () => {
    expect(presetSize(720, [800, 600])).toEqual([960, 720]);
    // 21:9 is wider than 16:9 and gets clamped rather than honoured.
    expect(presetSize(360, [2100, 900])).toEqual([640, 360]);
  });
});
