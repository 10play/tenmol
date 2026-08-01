/**
 * The command strings PyMOL's own file dialogs build.
 *
 * Every format-specific import dialog in `modules/pmg_qt/file_dialogs.py` has
 * a `get_command()` that renders a live preview into `output_command` and is
 * then executed verbatim through `cmd.do` — the dialogs do NOT call the typed
 * API. Reproducing the *string* is therefore the parity requirement: it is
 * what the user sees in the preview box, what lands in the log file, and what
 * `cmd.do` echoes into the console.
 *
 * These functions are pure so they can be unit-tested against the Python
 * source line by line (`files.test.ts`).
 */

/** `load_traj_dialog.get_command` (`file_dialogs.py:112-126`). */
export interface TrajOptions {
  filename: string;
  object: string;
  state: number;
  start: number;
  stop: number;
  interval: number;
  /** "defer_builds_mode=3" checkbox (`forms/load_traj.ui` `input_dbm3`). */
  deferBuilds: boolean;
}

export function trajCommand(o: TrajOptions): string {
  let command = '';
  if (o.deferBuilds) command += 'set defer_builds_mode, 3\n';
  command +=
    'load_traj \\\n' +
    `    ${o.filename}, \\\n` +
    `    ${o.object}, ${o.state | 0}, \\\n` +
    `    start=${o.start | 0}, stop=${o.stop | 0}, interval=${o.interval | 0}`;
  return command;
}

/** `load_map_dialog.get_command` (`file_dialogs.py:344-380`). */
export interface MapOptions {
  filename: string;
  /** 'normalize_ccp4_maps' | 'normalize_o_maps' */
  normalizeSetting: string;
  normalize: boolean;
  objectName: string;
  /** Fallback when the name field is blank: `filename_to_objectname`. */
  defaultName: string;
  selection: string;
  buffer: number;
  carve: boolean;
  level: number;
  volume: boolean;
  volumeName: string;
  isomesh: boolean;
  isomeshName: string;
  isosurface: boolean;
  isosurfaceName: string;
}

export function mapCommand(o: MapOptions): string {
  let command = `set ${o.normalizeSetting}, ${o.normalize ? 1 : 0}\n`;
  command += 'load ' + o.filename;
  let name = o.objectName;
  if (name) {
    command += ', \\\n    ' + name;
  } else {
    name = o.defaultName;
  }

  let selesuffix = '';
  // `round(value, 4)` in Python; JS has no round-to-n, so do it explicitly and
  // drop the trailing zeros the way repr() does.
  const level = trimNumber(Math.round(o.level * 1e4) / 1e4);
  const sele = o.selection;
  if (sele) {
    const buf = trimNumber(o.buffer);
    selesuffix += `, ${sele}, ${buf}`;
    if (o.carve) selesuffix += `, carve=${buf}`;
  }

  if (o.volume) {
    const nameVolume = o.volumeName || name + '_volume';
    command += `\nvolume ${nameVolume}, ${name}, ${level} blue .5 ${trimNumber(
      Math.round(o.level * 2 * 1e4) / 1e4,
    )} yellow 0`;
    command += selesuffix;
  }
  if (o.isomesh) {
    const nameIsomesh = o.isomeshName || name + '_isomesh';
    command += `\nisomesh ${nameIsomesh}, ${name}, ${level}`;
    command += selesuffix;
  }
  if (o.isosurface) {
    const nameIsosurface = o.isosurfaceName || name + '_isosurface';
    command += `\nisosurface ${nameIsosurface}, ${name}, ${level}`;
    command += selesuffix;
  }
  return command;
}

/** `load_mae_dialog.get_command` (`file_dialogs.py:293-320`). */
export interface MaeOptions {
  filename: string;
  objectName: string;
  mimic: boolean;
  objectProps: string;
  atomProps: string;
  multiplex: number;
  discrete: number;
}

export function maeCommand(o: MaeOptions): string {
  let command = `load \\\n    ${o.filename}`;
  if (o.objectName) command += ', \\\n    ' + o.objectName;
  command += ', \\\n    mimic=' + (o.mimic ? '1' : '0');
  command += `, \\\n    object_props=${o.objectProps}, \\\n    atom_props=${o.atomProps}`;
  if (o.discrete !== -1) command += `, \\\n    discrete=${o.discrete}`;
  if (o.multiplex !== -2) command += `, \\\n    multiplex=${o.multiplex}`;
  return command;
}

/** `file_fetch_pdb.get_command` (`file_dialogs.py:448-475`). */
export interface FetchOptions {
  code: string;
  assembly: string;
  chain: string;
  name: string;
  structure: boolean;
  map2fofc: boolean;
  name2fofc: string;
  mapfofc: boolean;
  namefofc: string;
}

export function fetchCommand(o: FetchOptions): string {
  // The Qt dialog returns '' until the code is exactly 4 characters, and the
  // OK button refuses with "Need 4 letter PDB code" (`:492-495`).
  if (o.code.length !== 4) return '';
  const named = (value: string) => (value ? ', ' + value : '');

  let command = '';
  if (o.structure) {
    command = `set assembly, "${o.assembly}"\nfetch ${o.code}${o.chain}${named(o.name)}`;
  }
  if (o.map2fofc) command += `\nfetch ${o.code}${named(o.name2fofc)}, type=2fofc`;
  if (o.mapfofc) command += `\nfetch ${o.code}${named(o.namefofc)}, type=fofc`;
  return command;
}

/**
 * `file_save_png.run` (`file_dialogs.py:636-652`).
 *
 * Width/height/dpi are hard 0/0/-1: the sizing inputs in `forms/png.ui` are
 * commented out in the Python (`:625-634`, `:654-685`) and the live sizing UI
 * is the Draw/Ray panel. Reproducing the dead widgets would be inventing a
 * feature PyMOL does not have.
 */
export function pngCommands(filename: string, rendering: number): string[] {
  const lines: string[] = [];
  let ray = 0;
  if (rendering === 1) {
    lines.push('draw 0, 0');
  } else if (rendering === 2) {
    lines.push('set opaque_background, 1');
    ray = 1;
  } else if (rendering === 3) {
    lines.push('set opaque_background, 0');
    ray = 1;
  }
  lines.push(`png ${filename}, 0, 0, -1, ray=${ray}`);
  return lines;
}

/** `run_draw` / `run_ray` of the render panel (`pymol_qt_gui.py:730-742`). */
export function drawCommand(width: number, height: number): string {
  return `draw ${width | 0}, ${height | 0}`;
}

export function rayCommands(width: number, height: number, transparent: boolean): string[] {
  return [
    `set opaque_background, ${transparent ? 0 : 1}`,
    `ray ${width | 0}, ${height | 0}, async=1`,
  ];
}

/**
 * `set_resolution` (`file_dialogs.py:789-794`): clamp to at most 16:9 and make
 * the width even (encoders reject odd dimensions).
 */
export function movieResolution(
  width: number,
  height: number,
  targetHeight: number,
): { width: number; height: number } {
  const h = Math.max(1, height);
  const aspect = width && h ? width / h : 9999;
  return {
    width: Math.round(Math.min(aspect, 16 / 9) * targetHeight * 0.5) * 2,
    height: targetHeight,
  };
}

/** `_gui.py:74-78` + `session_save_as` — the two session command shapes. */
export function sessionSaveCommand(filename: string): string {
  return `save ${filename}, format=pse`;
}

/** Python's `repr(float)` drops a trailing `.0`; `str(2.0)` is `'2.0'` though. */
function trimNumber(value: number): string {
  if (Number.isInteger(value)) {
    // Python renders `form.input_buffer.value()` (a float) as `2.0`, and
    // `round(level, 4)` of 1.0 as `1.0`. Keep the `.0`.
    return value.toFixed(1);
  }
  return String(value);
}
