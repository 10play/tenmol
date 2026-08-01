/**
 * Parity area 6, wave 7 — what OK on the map dialog does with the answer
 * (inventory row 259).
 *
 * The row names three things the Tk dialog does after `cmd.map_generate`:
 * build a representation, report, and "auto-close when `autoclose_dialogs` is
 * set". The first two were ported; the third was not — `FilesPanel` closed the
 * dialog on success through either branch, so the setting did nothing. That is
 * what this pins.
 *
 * The bridge half is `bridge/tests/test_f7_legacyfiles.py`, which runs the
 * generate against a live PyMOL and measures the results these shapes carry:
 * `autoclose_dialogs` is ON by default, this build's generator is compiled out
 * (so `ok:false` with a build note is the everyday answer), and with the
 * compiled-out call substituted a real run comes back `ok:true` with
 * `reps:[{name:'f7gen01-vol01', op:'volume'}]`.
 */

import { describe, expect, it } from 'vitest';
import type { MapGenerateResult } from '@tenmol/protocol/topics/files';
import { mapGenerateOutcome } from './LoadDialogs';

const BUILD_NOTE = 'cmd.map_generate needs MMLIBS: layer3/Executive.cpp:6929-6935 …';

function result(over: Partial<MapGenerateResult> = {}): MapGenerateResult {
  return {
    ok: false,
    prefix: '',
    returned: null,
    created: false,
    reps: [],
    rep: '',
    error: null,
    help: null,
    autoclose: true,
    buildNote: BUILD_NOTE,
    ...over,
  };
}

describe('mapGenerateOutcome (row 259)', () => {
  it('closes on success only when autoclose_dialogs is on', () => {
    const made = {
      ok: true,
      created: true,
      prefix: 'data_101',
      rep: 'volume',
      reps: [{ name: 'data_101-vol01', op: 'volume' }],
    };
    expect(mapGenerateOutcome(result({ ...made, autoclose: true })).close).toBe(true);
    // `PyMOLMapLoad.run` reaches `self.quit()` only inside
    // `if get_setting_boolean("autoclose_dialogs")` (`:339-340`); with it off
    // the Pmw form stays up so a second map can be generated from the same
    // reflection file.
    expect(mapGenerateOutcome(result({ ...made, autoclose: false })).close).toBe(false);
  });

  it('names the map and every representation it built', () => {
    const outcome = mapGenerateOutcome(
      result({
        ok: true,
        created: true,
        prefix: 'data_101',
        rep: 'isomesh',
        reps: [
          { name: 'data_101-msh301', op: 'isomesh' },
          { name: 'data_101-msh-301', op: 'isomesh' },
        ],
      }),
    );
    expect(outcome.line).toBe(
      ' map_generate: created data_101 and data_101-msh301, data_101-msh-301',
    );
    expect(outcome.kind).toBeUndefined();
  });

  it('does not invent an "and" when the rep list is empty', () => {
    expect(mapGenerateOutcome(result({ ok: true, created: true, prefix: 'm01' })).line).toBe(
      ' map_generate: created m01',
    );
  });

  it('keeps the dialog open on every failure that the form can fix', () => {
    // Measured over the socket in `test_f7_legacyfiles.py`: each of these is a
    // real answer from `map_generate_run`, and each is fixable in the dialog —
    // pick another column, pick another file, or (the build case) give up. In
    // every one of them upstream returns before `self.quit()`.
    for (const error of [
      'Missing Amplitudes Column Name',
      'Missing Phases Column Name',
      'no such file: /tmp/f7-does-not-exist.mtz',
      ' Error: no dataset found',
      `map_generate returned 'data_101' but created no object: ${BUILD_NOTE}`,
    ]) {
      const outcome = mapGenerateOutcome(result({ error, prefix: 'data_101' }));
      expect(outcome.close, error).toBe(false);
      expect(outcome.kind).toBe('error');
      expect(outcome.line).toBe(` map_generate: ${error}`);
    }
  });

  it('still closes when the map was made and only the rep step failed', () => {
    // `ok` and `error` can BOTH be set: the bridge builds the representation
    // inside a try/finally and reports what it caught, where
    // `PyMOLMapLoad.py:332-333` swallows it in a bare `except` and closes
    // anyway. Same close decision, louder console.
    const outcome = mapGenerateOutcome(
      result({
        ok: true,
        created: true,
        prefix: 'data_101',
        rep: 'volume',
        error: ' Error: Object data_101-vol01 not found',
      }),
    );
    expect(outcome.close).toBe(true);
    expect(outcome.kind).toBe('error');
  });
});
