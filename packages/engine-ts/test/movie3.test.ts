/**
 * Tests for the `cmd.movie.*` namespace (packages/engine-ts/src/cmd/movie3.ts),
 * ported from `modules/pymol/movie.py`.
 *
 * These boot the full engine through {@link LocalBackend} (loading SMALL_PDB so
 * a molecule/state exists) because `movie.*` is pure orchestration over the
 * top-level movie verbs (`mset`, `mview`, `frame`, `turn`, `count_states`, …)
 * which live in other subsystems. Frame-table effects are observed through
 * those same top-level verbs:
 *   - `madd('')` appends nothing and returns the current movie length — a
 *     non-mutating length probe;
 *   - `get_movie_view(frame)` returns the interpolated 18-float camera view,
 *     which is non-trivial only once `mview` key frames have been stored.
 */

import { describe, expect, it } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

async function booted(): Promise<LocalBackend> {
  const backend = new LocalBackend();
  await backend.connect();
  await backend.call('read_pdbstr', [SMALL_PDB, 'm']);
  return backend;
}

/** Current movie length: `madd('')` appends nothing and returns the total. */
async function movieLength(backend: LocalBackend): Promise<number> {
  return backend.call<number>('madd', ['']);
}

describe('movie.tdroll skip guard', () => {
  it('does not hang when skip=0 (clamped to 1)', async () => {
    const b = await booted();
    // Regression: skip=0 made `range % skip` NaN and the frame loop never
    // advanced (infinite loop). This must return promptly. vitest's per-test
    // timeout would fail the test if it hung.
    await expect(b.call('movie.tdroll', [1, 90, 0, 0, 0])).resolves.toBeNull();
  });
});

describe('movie.get_movie_fps', () => {
  it('defaults to 30 and reflects the movie_fps setting', async () => {
    const backend = await booted();
    // Unset -> PyMOL's 30 fps floor.
    expect(await backend.call('movie.get_movie_fps')).toBe(30);
    // A positive value is returned verbatim.
    await backend.call('set', ['movie_fps', 24]);
    expect(await backend.call('movie.get_movie_fps')).toBe(24);
    // A non-positive value falls back to 30.
    await backend.call('set', ['movie_fps', 0]);
    expect(await backend.call('movie.get_movie_fps')).toBe(30);
  });
});

describe('movie.add_blank', () => {
  it('builds duration*fps blank frames', async () => {
    const backend = await booted();
    // fps defaults to 30, so 1s -> 30 frames.
    await backend.call('movie.add_blank', [1]);
    expect(await movieLength(backend)).toBe(30);
    // add_blank APPENDS at get_movie_length()+1 (start=0 default), so a second
    // 2s clip splices 60 frames after the first 30 -> 90 total. (Verified
    // against real PyMOL via the movie-programs oracle probe; the previous
    // expectation of 60 encoded the old mset that ignored `start` and replaced.)
    await backend.call('movie.add_blank', [2]);
    expect(await movieLength(backend)).toBe(90);
    // Zero duration adds nothing.
    await backend.call('movie.add_blank', [0]);
    expect(await movieLength(backend)).toBe(90);
  });
});

describe('movie.add_roll', () => {
  it('sets the frame table and stores interpolating camera key frames', async () => {
    const backend = await booted();
    await backend.call('movie.add_roll', [1]); // 1 second -> 30 frames
    expect(await movieLength(backend)).toBe(30);

    // Key frames were stored at frames 1/10/20/30; the camera at a mid frame is
    // rotated away from the frame-1 pose, so the interpolated views differ.
    const v1 = await backend.call<number[]>('get_movie_view', [1]);
    const v10 = await backend.call<number[]>('get_movie_view', [10]);
    expect(v1).toHaveLength(18);
    expect(v10).toHaveLength(18);
    const diff = v1.reduce((acc, x, i) => acc + Math.abs(x - v10[i]!), 0);
    expect(diff).toBeGreaterThan(1e-3);
  });
});

describe('movie.add_rock', () => {
  it('builds the frame table and yields a valid interpolated view', async () => {
    const backend = await booted();
    await backend.call('movie.add_rock', [1, 30]); // 1s, 30 deg
    expect(await movieLength(backend)).toBe(30);
    const view = await backend.call<number[]>('get_movie_view', [15]);
    expect(view).toHaveLength(18);
    expect(view.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe('movie.timed_roll', () => {
  it('builds period*fps*cycles frames with a key frame per step', async () => {
    const backend = await booted();
    // 0.1s * 30fps = 3 frames per cycle, 2 cycles -> 6 frames.
    await backend.call('movie.timed_roll', [0.1, 2]);
    expect(await movieLength(backend)).toBe(6);
    // A key frame was stored each step, so the first and last views differ.
    const v1 = await backend.call<number[]>('get_movie_view', [1]);
    const v6 = await backend.call<number[]>('get_movie_view', [6]);
    const diff = v1.reduce((acc, x, i) => acc + Math.abs(x - v6[i]!), 0);
    expect(diff).toBeGreaterThan(1e-3);
  });
});

describe('movie.sweep / movie.pause', () => {
  it('sweep defines a forward/back state movie', async () => {
    const backend = await booted();
    // Single-state fixture -> "1 -1 1 -1" -> two frames.
    await backend.call('movie.sweep');
    expect(await movieLength(backend)).toBe(2);
  });

  it('pause defines a dwelling state movie', async () => {
    const backend = await booted();
    await backend.call('movie.pause', [5]);
    expect(await movieLength(backend)).toBeGreaterThan(0);
  });
});

describe('movie.add_scenes', () => {
  it('tours a list of scenes, building frames and camera key frames', async () => {
    const backend = await booted();
    // Explicit scene names (get_scene_list is empty in-engine); animate=0 so the
    // duration is exactly names*pause seconds.
    await backend.call('movie.add_scenes', [['s1', 's2'], 1, 0, 1, -1, 1, 0]);
    // 2 scenes * (1s + 0) * 30fps = 60 frames.
    expect(await movieLength(backend)).toBe(60);
    const view = await backend.call<number[]>('get_movie_view', [30]);
    expect(view).toHaveLength(18);
    expect(view.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('is a no-op when there are no scenes to tour', async () => {
    const backend = await booted();
    expect(await backend.call('movie.add_scenes')).toBeNull();
    expect(await movieLength(backend)).toBe(0);
  });
});

describe('movie.produce / movie.find_exe / movie.load', () => {
  it('produce resolves the frame range, enables opaque background, and returns null', async () => {
    const backend = await booted();
    // A PNG-frame pipeline (.mp4) enables opaque_background as movie.py does.
    expect(await backend.call('movie.produce', ['out.mp4'])).toBeNull();
    expect(await backend.call('get_setting', ['opaque_background'])).toBe(1);
  });

  it('find_exe reports no executable available in-engine', async () => {
    const backend = await booted();
    expect(await backend.call('movie.find_exe', ['ffmpeg'])).toBeNull();
  });

  it('load is a documented no-op (no filesystem)', async () => {
    const backend = await booted();
    expect(await backend.call('movie.load', ['*.pdb'])).toBeNull();
  });
});

describe('movie: every ported verb is callable (no NotPorted)', () => {
  it('dispatches all 20 movie.* verbs without throwing', async () => {
    const backend = await booted();
    // Each entry: [verb, args]. The mdo-driven camera loops (roll/rock/tdroll/
    // zoom/screw/nutate) are inert in-engine but must dispatch cleanly.
    const calls: Array<[string, unknown[]]> = [
      ['movie.get_movie_fps', []],
      ['movie.find_exe', ['ffmpeg']],
      ['movie.load', ['*.pdb']],
      ['movie.produce', ['out.mpg']],
      ['movie.sweep', [0, 1]],
      ['movie.pause', [3, 1]],
      ['movie.roll', [1, 5]],
      ['movie.rock', [1, 5]],
      ['movie.tdroll', [1, 30, 30, 30, 10]],
      ['movie.zoom', [1, 5]],
      ['movie.screw', [1, 5]],
      ['movie.nutate', [1, 5]],
      ['movie.timed_roll', [0.1, 1]],
      ['movie.add_blank', [0.1]],
      ['movie.add_roll', [0.1]],
      ['movie.add_rock', [0.1]],
      ['movie.add_state_sweep', [1, 0.1]],
      ['movie.add_state_loop', [1, 0.1]],
      ['movie.add_nutate', [0.1]],
      ['movie.add_scenes', [['a', 'b'], 0.1]],
    ];
    for (const [verb, args] of calls) {
      // A rejection (e.g. a NotPorted throw) propagates and fails the test; a
      // clean resolve is the assertion.
      await backend.call(verb, args);
    }
    // Reaching here means all 20 verbs dispatched without throwing.
    expect(calls).toHaveLength(20);
  });
});
