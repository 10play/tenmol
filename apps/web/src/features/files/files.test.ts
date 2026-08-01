/**
 * Unit tests for parity area 6 (file I/O).
 *
 * The command builders are checked against strings produced by running the
 * ACTUAL `%`-formatting of `modules/pmg_qt/file_dialogs.py` in CPython — a
 * dialog whose preview differs by one backslash writes a different log file
 * than PyMOL would, so these are exact-match assertions, not shape checks.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  filterPatterns,
  humanSize,
  withExtension,
  FILES_BOOTSTRAP,
  FILES_NS,
  MOVIE_ENCODER_SUPPORT,
} from '@tenmol/protocol/topics/files';
import {
  fetchCommand,
  maeCommand,
  mapCommand,
  movieResolution,
  pngCommands,
  rayCommands,
  trajCommand,
} from './commands';
import { breadcrumbs, joinPath } from './PathPicker';
import { dedupe } from './FilesPanel';
import { createFilesApi } from './filesApi';

describe('load_traj dialog command (file_dialogs.py:112-126)', () => {
  it('matches the Python %-format byte for byte', () => {
    expect(
      trajCommand({
        filename: '/tmp/x.dcd',
        object: 'obj',
        state: 1,
        start: 1,
        stop: -1,
        interval: 1,
        deferBuilds: false,
      }),
    ).toBe('load_traj \\\n    /tmp/x.dcd, \\\n    obj, 1, \\\n    start=1, stop=-1, interval=1');
  });

  it('prepends the defer_builds_mode line when the checkbox is on', () => {
    const command = trajCommand({
      filename: '/a.xtc',
      object: 'm',
      state: 0,
      start: 1,
      stop: -1,
      interval: 2,
      deferBuilds: true,
    });
    expect(command.startsWith('set defer_builds_mode, 3\nload_traj')).toBe(true);
  });
});

describe('load_map dialog command (file_dialogs.py:344-380)', () => {
  it('reproduces the volume line, the selection suffix and the carve suffix', () => {
    expect(
      mapCommand({
        filename: '/tmp/x.ccp4',
        normalizeSetting: 'normalize_ccp4_maps',
        normalize: true,
        objectName: '',
        defaultName: 'x_',
        selection: 'enabled',
        buffer: 2,
        carve: true,
        level: 1,
        volume: true,
        volumeName: '',
        isomesh: false,
        isomeshName: '',
        isosurface: false,
        isosurfaceName: '',
      }),
    ).toBe(
      'set normalize_ccp4_maps, 1\nload /tmp/x.ccp4\n' +
        'volume x__volume, x_, 1.0 blue .5 2.0 yellow 0, enabled, 2.0, carve=2.0',
    );
  });

  it('adds the typed object name after the load, not before', () => {
    const command = mapCommand({
      filename: '/m.ccp4',
      normalizeSetting: 'normalize_o_maps',
      normalize: false,
      objectName: 'mymap',
      defaultName: 'm',
      selection: '',
      buffer: 2,
      carve: false,
      level: 3,
      volume: false,
      volumeName: '',
      isomesh: true,
      isomeshName: '',
      isosurface: false,
      isosurfaceName: '',
    });
    expect(command).toBe(
      'set normalize_o_maps, 0\nload /m.ccp4, \\\n    mymap\nisomesh mymap_isomesh, mymap, 3.0',
    );
  });
});

describe('load_mae dialog command (file_dialogs.py:293-320)', () => {
  it('omits discrete/multiplex for the "automatic handling" entry (-2,-1)', () => {
    expect(
      maeCommand({
        filename: '/tmp/x.mae',
        objectName: '',
        mimic: true,
        objectProps: '*',
        atomProps: '*',
        multiplex: -2,
        discrete: -1,
      }),
    ).toBe('load \\\n    /tmp/x.mae, \\\n    mimic=1, \\\n    object_props=*, \\\n    atom_props=*');
  });

  it('emits both for "as one multi-state object (discrete states)" (0,1)', () => {
    const command = maeCommand({
      filename: '/x.mae',
      objectName: 'o',
      mimic: false,
      objectProps: '*',
      atomProps: '*',
      multiplex: 0,
      discrete: 1,
    });
    expect(command).toContain('mimic=0');
    expect(command).toContain('discrete=1');
    expect(command).toContain('multiplex=0');
  });
});

describe('fetch dialog command (file_dialogs.py:448-475)', () => {
  it('is empty until the code is exactly four characters', () => {
    expect(
      fetchCommand({
        code: '1ti',
        assembly: '',
        chain: '',
        name: '',
        structure: true,
        map2fofc: false,
        name2fofc: '',
        mapfofc: false,
        namefofc: '',
      }),
    ).toBe('');
  });

  it('sets assembly, appends the chain to the code, and adds the map fetches', () => {
    expect(
      fetchCommand({
        code: '1tii',
        assembly: '1',
        chain: 'A',
        name: 'foo',
        structure: true,
        map2fofc: true,
        name2fofc: 'm2',
        mapfofc: true,
        namefofc: '',
      }),
    ).toBe(
      'set assembly, "1"\nfetch 1tiiA, foo\nfetch 1tii, m2, type=2fofc\nfetch 1tii, type=fofc',
    );
  });
});

describe('png dialog (file_dialogs.py:636-652)', () => {
  it('capture current display -> a single png with ray=0', () => {
    expect(pngCommands('/tmp/a.png', 0)).toEqual(['png /tmp/a.png, 0, 0, -1, ray=0']);
  });
  it('draw antialiased -> draw first, then png', () => {
    expect(pngCommands('/tmp/a.png', 1)).toEqual(['draw 0, 0', 'png /tmp/a.png, 0, 0, -1, ray=0']);
  });
  it('ray opaque / transparent -> the opaque_background write then ray=1', () => {
    expect(pngCommands('/a.png', 2)).toEqual([
      'set opaque_background, 1',
      'png /a.png, 0, 0, -1, ray=1',
    ]);
    expect(pngCommands('/a.png', 3)).toEqual([
      'set opaque_background, 0',
      'png /a.png, 0, 0, -1, ray=1',
    ]);
  });
});

describe('render panel ray (pymol_qt_gui.py:736-742)', () => {
  it('transparent means opaque_background 0 and the ray is async', () => {
    expect(rayCommands(1920, 1080, true)).toEqual([
      'set opaque_background, 0',
      'ray 1920, 1080, async=1',
    ]);
  });
});

describe('movie resolution presets (file_dialogs.py:789-794)', () => {
  it('clamps to 16:9 and rounds the width to an even number', () => {
    expect(movieResolution(1280, 960, 720)).toEqual({ width: 960, height: 720 });
    expect(movieResolution(3840, 1000, 480)).toEqual({ width: 854, height: 480 });
  });
});

describe('getSaveFileNameWithExt (pymol/Qt/utils.py:229-246)', () => {
  it('appends the first extension of the filter when the basename has no dot', () => {
    expect(withExtension('/tmp/foo', 'PDB (*.pdb *.pdb.gz)')).toBe('/tmp/foo.pdb');
  });
  it('leaves a name that already has an extension alone', () => {
    expect(withExtension('/tmp/foo.cif', 'PDB (*.pdb)')).toBe('/tmp/foo.cif');
  });
  it('only looks at the BASENAME, so a dotted directory does not count', () => {
    expect(withExtension('/a.b/name', 'PNG File (*.png)')).toBe('/a.b/name.png');
  });
  it('does nothing when the filter has no glob', () => {
    expect(withExtension('/tmp/foo', 'All (*)')).toBe('/tmp/foo');
  });
});

describe('filter parsing', () => {
  it('splits the parenthesised globs', () => {
    expect(filterPatterns('PDBx/mmCIF (*.cif *.cif.gz)')).toEqual(['*.cif', '*.cif.gz']);
    expect(filterPatterns('All Files (*)')).toEqual(['*']);
  });
});

describe('picker path helpers', () => {
  it('joins without doubling the separator and respects absolute names', () => {
    expect(joinPath('/a/b', 'c.pdb')).toBe('/a/b/c.pdb');
    expect(joinPath('/a/b/', 'c.pdb')).toBe('/a/b/c.pdb');
    expect(joinPath('/a/b', '/abs.pdb')).toBe('/abs.pdb');
  });
  it('builds breadcrumbs from the root down', () => {
    expect(breadcrumbs('/usr/local/lib')).toEqual([
      { label: '/', path: '/' },
      { label: 'usr', path: '/usr' },
      { label: 'local', path: '/usr/local' },
      { label: 'lib', path: '/usr/local/lib' },
    ]);
  });
  it('formats sizes', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2.0 kB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('the encoder capability matrix (file_dialogs.py:702-707)', () => {
  it('is the Python table, unchanged', () => {
    expect(MOVIE_ENCODER_SUPPORT.ffmpeg).toEqual({ mp4: 1, mpg: 1, mov: 1, gif: 1 });
    expect(MOVIE_ENCODER_SUPPORT.mpeg_encode).toEqual({ mp4: 0, mpg: 1, mov: 0, gif: 0 });
    expect(MOVIE_ENCODER_SUPPORT.convert).toEqual({ mp4: 0, mpg: 0, mov: 0, gif: 1 });
    expect(MOVIE_ENCODER_SUPPORT['']).toEqual({ mp4: 0, mpg: 0, mov: 0, gif: 0 });
  });
});

describe('bootstrap', () => {
  const hello = { installed: true, cwd: '/w' };

  it('probes hello first and does NOT re-install when the service is already there', async () => {
    const call = vi.fn().mockResolvedValue(hello);
    const doFn = vi.fn();
    const api = createFilesApi({ call, do: doFn });
    await api.ensure();
    expect(call).toHaveBeenCalledWith(`${FILES_NS}.hello`, [], {});
    expect(doFn).not.toHaveBeenCalled();
    expect(api.ready()).toBe(true);
  });

  it('installs with one {t:do} and retries once when the symbol is missing', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowed: no such symbol'))
      .mockResolvedValue(hello);
    const doFn = vi.fn().mockResolvedValue(null);
    const api = createFilesApi({ call, do: doFn });
    await api.ensure();
    expect(doFn).toHaveBeenCalledWith(FILES_BOOTSTRAP);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent ensure() calls into one bootstrap', async () => {
    const call = vi.fn().mockResolvedValue(hello);
    const api = createFilesApi({ call, do: vi.fn() });
    await Promise.all([api.ensure(), api.ensure(), api.ensure()]);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('sends browse parameters as kwargs, in the Python names', async () => {
    const call = vi.fn().mockResolvedValue({ entries: [] });
    const api = createFilesApi({ call, do: vi.fn() });
    await api.browse('/tmp', { showHidden: true, patterns: ['*.pdb'] });
    expect(call).toHaveBeenCalledWith(`${FILES_NS}.browse`, [], {
      path: '/tmp',
      show_hidden: true,
      dirs_only: false,
      patterns: ['*.pdb'],
    });
  });
});

/* ------------------------------------------------------------------ *
 * Regressions found by driving the real UI against a live bridge
 * ------------------------------------------------------------------ */

describe('picker filter list', () => {
  it('de-duplicates the preselected filter (React key collision)', () => {
    // `exportMolecule` prepends the dialog's chosen filter to the picker's
    // list so it is preselected — and that filter is already a member, which
    // rendered two <option key="PDBx/mmCIF (*.cif *.cif.gz)"> children.
    const all = [
      'PDBx/mmCIF (*.cif *.cif.gz)',
      'PDB (*.pdb *.pdb.gz)',
      'By Extension (*.*)',
    ];
    const merged = dedupe(['PDBx/mmCIF (*.cif *.cif.gz)', ...all]);
    expect(merged).toEqual(all);
    expect(new Set(merged).size).toBe(merged.length);
  });

  it('keeps first-seen order so the chosen filter stays index 0', () => {
    expect(dedupe(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
});

describe('save picker overwrite guard', () => {
  it('asks the bridge whether the composed target exists', async () => {
    // The picker composes `joinPath(dir, typed)` then `withExtension(...)`
    // BEFORE the existence check, so a typed name with no dot is stat-ed with
    // the extension the filter will add — otherwise "shot" would never warn
    // about an existing "shot.png".
    const target = withExtension(joinPath('/out', 'shot'), 'PNG File (*.png)');
    expect(target).toBe('/out/shot.png');

    const call = vi.fn().mockResolvedValue({ path: target, exists: true });
    const api = createFilesApi({ call, do: vi.fn() });
    const info = await api.stat(target);
    expect(info.exists).toBe(true);
    expect(call).toHaveBeenCalledWith(`${FILES_NS}.stat`, [target], {});
  });
});
