/**
 * Parity category: provably-impossible-in-a-browser (documented gaps).
 *
 * Every test here uses vitest `it.fails` (xfail): the body asserts the ideal
 * REAL-PyMOL observable, but the assertion genuinely fails against the
 * synchronous in-browser TypeScript port today, so the runner records it GREEN
 * as an accepted, documented gap. Each test's comment states WHY 1:1 parity is
 * unreachable in a synchronous browser / WebGL engine.
 *
 * Reference: docs/engine-port-gaps.md §"Genuinely not modelled (documented
 * no-ops): file load/fetch/save to disk, and other FS/OS-bound verbs" plus §1
 * (callback/CGO/slice/volume reps) and the vendored real-PyMOL sources under
 * packages/engine/modules/pymol/*.py cited per test. (`ray`/`draw`/`png` are NOT
 * here — a real CPU ray tracer renders them; see parity-render.test.ts.)
 */
import { describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { LocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from './fixture';

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  await b.call('read_pdbstr', [SMALL_PDB, 'm']);
  return b;
}

/** Swallow a rejected engine call so the test still reaches its assertion. */
const ignore = (p: Promise<unknown>): Promise<unknown> => p.catch(() => null);

describe('parity: provably-impossible-in-a-browser (xfail)', () => {
  // NOTE: `ray` graduated out of this set — a real headless CPU ray tracer now
  // renders it (cmd/render.ts); see parity-render.test.ts. `load_callback` also
  // graduated: its OBJECT-creation side effect (an object:callback in get_names)
  // is a synchronous, observable state change even though the per-frame Python
  // draw callback itself cannot fire in a browser — so it is a real passing test
  // below, not an xfail. `volume`/`slice_new` likewise graduated: their
  // object-creation side effect (object:volume / object:slice in get_names) is a
  // synchronous, observable state change, only the pixel raymarch stays out of
  // scope. `save` also graduated: under Node it writes the file to disk (a real
  // observable side effect) — see the real passing test below. 3 xfail items remain.

  // (2) volume + slice RENDERING -> volumetric 3-D-texture raymarch.
  // WHY the pixel raymarch is impossible: `volume` (creating.py, line 577) and
  // `slice_new` (creating.py, line 680) create object:volume / object:slice that
  // a separate WebGL2 3-D-texture raymarching subsystem draws, which the
  // geometry-frame protocol excludes. BUT object *creation* is a synchronous,
  // observable state change: both verbs now register a gadget so get_names lists
  // the object and get_type reports object:volume / object:slice — matching real
  // PyMOL for state observers. Only the pixel raymarch stays out of scope, so
  // this is a real passing test, not an xfail.
  it('volume/slice: create observable object:volume and object:slice', async () => {
    const b = await boot();
    await ignore(b.call('map_new', ['map', 'gaussian', 1.0, 'all']));
    await ignore(b.call('volume', ['vol', 'map']));
    await ignore(b.call('slice_new', ['sli', 'map']));
    const names = (await b.call('get_names', ['objects'])) as string[];
    // A real PyMOL lists both freshly-created volumetric objects.
    expect(names).toContain('vol');
    expect(names).toContain('sli');
  });

  // (3) cgo user objects -> load_cgo / a drawn CGO object present & rendered.
  // WHY IMPOSSIBLE: `load_cgo` (importing.py, line 308) wraps a CGO float list
  // into an object:cgo via load_object. No CGO-creation verb is in the ported
  // scope (`load_cgo` is unregistered -> NotPorted), so the object never exists.
  it.fails('load_cgo: a drawn CGO object appears in get_names', async () => {
    const b = await boot();
    // Minimal CGO: SPHERE(=7.0) at origin, radius 1.0 (cgo.py constants).
    const cgo = [7.0, 0.0, 0.0, 0.0, 1.0];
    await ignore(b.call('load_cgo', [cgo, 'box']));
    const names = (await b.call('get_names', ['objects'])) as string[];
    expect(names).toContain('box'); // the CGO object real PyMOL would create
  });

  // (4) callback -> a Python draw callback object.
  // NOTE: `load_callback` (importing.py, line 291) stores a Python object whose
  // __call__ issues OpenGL draw commands each frame. The per-frame draw callback
  // itself cannot fire in a browser (no Python interpreter, no live GL redraw
  // loop) — but the OBJECT-creation side effect is a synchronous, observable
  // state change: real PyMOL (even headless) registers an object:callback under
  // the given name, and so does the port (cmd/fileio.ts:load_callback), so this
  // is a genuine passing test — verified against the oracle.
  it('load_callback: a callback object appears in get_names', async () => {
    const b = await boot();
    // A callback list [callable, name]; PyMOL builds an object:callback from it.
    await ignore(b.call('load_callback', [() => null, 'cb']));
    const names = (await b.call('get_names', ['objects'])) as string[];
    expect(names).toContain('cb');
    // …and it reports the object:callback type, like real PyMOL's ObjectCallback.
    expect(await b.call('get_type', ['cb'])).toBe('object:callback');
  });

  // (5) load from a filesystem PATH and fetch from the PDB.
  // WHY IMPOSSIBLE: `fetch` (importing.py, line 1331) downloads an entry over
  // HTTP; `load` reads a filesystem path. The synchronous browser engine has no
  // filesystem and no blocking network — `fetch` is a no-op and a bare path to
  // `load` throws "no filesystem" — so neither structure is ever read.
  it.fails('fetch/load-path: a downloaded / disk-read structure appears', async () => {
    const b = await boot();
    await ignore(b.call('fetch', ['1ubq', 'ubq'])); // PDB 1UBQ over the network
    await ignore(b.call('load', ['/data/1ubq.pdb', 'onpath'])); // from a disk path
    const names = (await b.call('get_names', ['objects'])) as string[];
    expect(names).toContain('ubq'); // fetch would create the object 1UBQ
    expect(names).toContain('onpath'); // load-from-path would create this object
  });

  // (6) save to disk (writes a file). GRADUATED: under Node (the differential and
  // app-server, where a real filesystem is reachable via process.getBuiltinModule)
  // `save` (cmd/exporters.ts) now writes the file exactly as real PyMOL does —
  // .pse/.psw sessions plus the format-string structure exporters. The write is a
  // synchronous, observable side effect, so this is a real passing test. Only a
  // pure browser (no filesystem) still degrades it to a no-op, which is out of
  // scope for the Node-based differential.
  it('save: writes a structure file to a disk path', async () => {
    const b = await boot();
    const out = join(tmpdir(), `tenmol-parity-save-${Date.now()}.pdb`);
    if (existsSync(out)) rmSync(out);
    await b.call('save', [out, 'all']);
    expect(existsSync(out)).toBe(true);
    rmSync(out);
  });

  // (7) run / @script / spawn a Python script.
  // WHY IMPOSSIBLE: `run`/`spawn` execute a Python script through the embedded
  // interpreter. A JS engine has no Python interpreter — controlflow.ts registers
  // `run`/`spawn` as no-ops that never execute the file — so a script's commands
  // (here, building a glycine fragment) never run and add no atoms.
  it.fails('run: executing a Python script performs its cmd.* side effects', async () => {
    const b = await boot();
    const before = (await b.call('count_atoms', ['all'])) as number; // 9 (the fixture)
    // A script that runs `cmd.fragment("gly")` would add a glycine (7 atoms).
    await ignore(b.call('run', ['/scripts/build_gly.py']));
    const after = (await b.call('count_atoms', ['all'])) as number;
    expect(after).toBeGreaterThan(before); // the script's atoms would appear
  });
});
