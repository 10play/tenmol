/**
 * File I/O contract — parity area 6.  OWNER: WP-18.
 *
 * NOT A TOPIC. `topics/_registry.ts` and `topics/index.ts` are frozen and list
 * nineteen topics; `files` is not one of them, and inventing one would mean
 * editing a frozen barrel. Nothing here needs a push channel anyway: a path
 * listing is a request/response, and the two things that *are* events —
 * feedback lines from `cmd.load`/`cmd.save` and the blocking-dialog round trip
 * — already have `feedback` and `dialog`.
 *
 * This module lives under `topics/` because the package's export map
 * (`./topics/*` -> `./src/topics/*.ts`) is the only per-owner extension point
 * WP-01 left open, so the file-I/O types are reachable as
 * `@tenmol/protocol/topics/files` without touching a shared file.
 *
 * ============================================================================
 * THE BACKEND SURFACE
 *
 * Everything below is served by `packages/bridge/tenmol_bridge/panels/files.py`, which
 * installs itself onto `pymol.cmd` as `cmd.tenmol_files` (three dotted
 * segments = the policy's maximum, and `cmd` is an addressable root, so no
 * policy grant and no `server.py` edit is required). The client bootstraps it
 * with ONE `{t:'do'}`:
 *
 *     import tenmol_bridge.panels.files as _tf; _tf.install()
 *
 * and then calls `{t:'call', fn:'cmd.tenmol_files.<method>'}`.
 *
 * Why a server-side picker at all: every load/save path in PyMOL is a real
 * server path string (`cmd.load` -> `exp_path`, `packages/engine/modules/pymol/importing.py:751`;
 * `cmd.save`, `packages/engine/modules/pymol/exporting.py:836-838`) and format dispatch is on
 * the extension, not the content (`importing.py:41-109`). A browser `File` blob
 * has neither. `docs/file-io.md` §0.
 * ============================================================================
 *
 * @notATopic  NOT A TRANSPORT TOPIC — deliberately not re-exported by the
 * frozen `topics/index.ts` barrel. Reached by its subpath
 * (`@tenmol/protocol/topics/files`); its events, if any, ride an existing
 * topic. `packages/bridge/tests/test_dispatch.py` looks for this tag.
 */

/** Dotted prefix for every call in this area. */
export const FILES_NS = 'cmd.tenmol_files' as const;

/** The one-line Python the client sends as `{t:'do'}` to install the service. */
export const FILES_BOOTSTRAP = 'import tenmol_bridge.panels.files as _tf; _tf.install()';

/* -------------------------------------------------------------------------- *
 * Path browsing
 * -------------------------------------------------------------------------- */

/** One entry in a directory listing. */
export interface FsEntry {
  name: string;
  /** Absolute server path. */
  path: string;
  isDir: boolean;
  size: number;
  /** Unix epoch seconds. */
  mtime: number;
  /** Lower-case extension without the dot; '' for directories. */
  ext: string;
}

/** A directory's contents plus the anchors the picker navigates by. */
export interface FsListing {
  path: string;
  /** null at the filesystem root. */
  parent: string | null;
  cwd: string;
  home: string;
  entries: FsEntry[];
  /** `os.listdir` failure (permission denied, no such directory). */
  error: string | null;
  /** Directories with more than 4000 visible entries are cut off. */
  truncated: boolean;
}

/** `stat()` of one path, as the save dialog needs it. */
export interface FsStat {
  path: string;
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  size: number;
  mtime: number;
  writable: boolean;
}

/** A named shortcut (home, cwd, …) in the picker's sidebar. */
export interface FsPlace {
  label: string;
  path: string;
}

/* -------------------------------------------------------------------------- *
 * Loading
 * -------------------------------------------------------------------------- */

/**
 * Which modal `load_dialog` would open (`packages/engine/modules/pmg_qt/file_dialogs.py:33-77`).
 * `plain` means "no dialog, just `cmd.load`".
 */
export type LoadDialogKind =
  | 'traj'
  | 'aln'
  | 'mae'
  | 'map'
  | 'mtz'
  | 'session'
  | 'script'
  | 'plain';

/** `importing.filename_to_format` + the `load_dialog` branch it selects. */
export interface FileClassification {
  filename: string;
  /** `filename_to_format()[0]` — the basename without extension. */
  prefix: string;
  ext: string;
  format: string;
  /** 'gz' | 'bz2' | '' */
  zipped: string;
  isUrl: boolean;
  /** `filename_to_objectname` = prefix through `cmd.get_legal_name`. */
  objectName: string;
  dialog: LoadDialogKind;
  /** For `dialog: 'map'`: which normalize setting applies. */
  mapType: 'ccp4' | 'o' | null;
  /** For `dialog: 'aln'`: 'aln' or 'fasta'. */
  alnFormat: string | null;
  /** Desmond sidecar found next to a `.cms` (`file_dialogs.py:12-30`). */
  cmsTraj: string | null;
  /** Non-null when the format RAISES in this open-source build. */
  unavailable: string | null;
  /**
   * Non-null when the client REFUSES the format on purpose — a different thing
   * from `unavailable` ("this build cannot"). Today that is `.pwg` alone: a
   * `.pwg` is a script that can open a listening port, publish a document
   * root, `__import__` an arbitrary module and call its `__launch__`, launch a
   * browser, report the port to a remote URL, delete itself, and start a second
   * HTTP server in the process the bridge already serves from
   * (`packages/engine/modules/pymol/importing.py:516-615`).
   *
   * MEASURED (`packages/bridge/tests/test_wf_files.py`): handing `cmd.load` a file whose
   * only content is the word `delete` deleted that file, with no prompt. The
   * refusal is a real gate, not a label.
   */
  refused: string | null;
  /** Only on `plan_open` steps: 0 for the first file, 1 for the rest. */
  partial?: 0 | 1;
}

/** The classified per-file steps of a multi-file open. */
export interface OpenPlan {
  steps: FileClassification[];
  count: number;
}

/** `ask_partial`'s inputs (`file_dialogs.py:80-99`). */
export interface PartialGate {
  /** False when the session is empty — the Qt dialog skips the prompt. */
  needed: boolean;
  names: string[];
  autoRenameDuplicates: boolean;
}

/** The three radio choices of `forms/askpartial.ui`. */
export const PARTIAL_CHOICES = [
  { id: 'discard', label: 'Discard current session' },
  { id: 'partial', label: 'Merge with current session (partial load)' },
  { id: 'new', label: 'Open in new PyMOL Window' },
] as const;
/** Which of the three partial-load radio choices the user picked. */
export type PartialChoice = (typeof PARTIAL_CHOICES)[number]['id'];

/** Inputs for the trajectory (`traj`) load dialog. */
export interface TrajDialogInfo {
  objects: string[];
  ok: boolean;
  message: string;
}

/** Inputs for the map (`map`) load dialog. */
export interface MapDialogInfo {
  objectName: string;
  /** `normalize_ccp4_maps` or `normalize_o_maps`. */
  normalizeSetting: string;
  normalize: boolean;
}

/** `load_aln_dialog` (`file_dialogs.py:204-282`). */
export interface AlnDialogInfo {
  ids: string[];
  models: string[];
  /** id -> object, pre-filled by the greedy difflib argmax. */
  mapping: Record<string, string>;
  /** True when the file is not an alignment: load it as extended structures. */
  fallback: boolean;
  error: string | null;
}

/** Inputs for the Maestro (`.mae`) load dialog. */
export interface MaeDialogInfo {
  objectName: string;
  objectProps: string;
  atomProps: string;
  choices: MaeMultiplexChoice[];
  unavailable: string | null;
}

/** One multiplex/discrete loading option offered by the `.mae` dialog. */
export interface MaeMultiplexChoice {
  label: string;
  multiplex: number;
  discrete: number;
}

/** Inputs for the Incentive-only `load_mtz` reflection dialog. */
export interface MtzDialogInfo {
  unavailable: string | null;
  amplitudes: string[];
  phases: string[];
  weights: string[];
  resoMin: number;
  resoMax: number;
  guessAmplitudes: string | null;
  guessPhases: string | null;
  prefix: string;
  error: string | null;
}

/* -------------------------------------------------------------------------- *
 * Map generation — the legacy Tk dialog `pmg_tk/PyMOLMapLoad.py`
 * -------------------------------------------------------------------------- */

/**
 * `PyMOLMapLoad`'s form, as data (`packages/engine/modules/pmg_tk/PyMOLMapLoad.py:10-175`).
 *
 * Distinct from {@link MtzDialogInfo}, which serves the OTHER MTZ dialog
 * (`load_mtz`, Incentive-only): this one carries the Pmw `"None"` weights
 * entry, the `%3.5f` resolution defaults and the two `default_*_map_rep`
 * settings that decide what gets built once a map exists.
 */
export interface MapGenerateInfo {
  filename: string;
  /** 'MTZHeader' | 'CIFHeader' | 'CNSHeader' | null — from the last 3 chars. */
  headerClass: string | null;
  amplitudes: string[];
  phases: string[];
  /** `"None"` FIRST (`PyMOLMapLoad.py:102`), then the W and Q columns. */
  weights: string[];
  guessAmplitudes: string | null;
  guessPhases: string | null;
  /** `float("%3.5f" % v)`, or `''` when the header has no value. */
  minRes: number | '';
  maxRes: number | '';
  prefix: string;
  fofc: boolean;
  /** `default_fofc_map_rep` — 'volume' | 'isomesh' | 'isosurface'. */
  fofcRep: string;
  twoFofcRep: string;
  autocloseDialogs: boolean;
  /**
   * `null` until something has tried. Nothing static can answer it: this tree
   * compiles `ExecutiveMapGenerate` out under `NO_MMLIBS`
   * (`packages/engine/layer3/Executive.cpp:6929-6935`) and the Python wrapper cannot see that.
   */
  supported: boolean | null;
  buildNote: string;
  missingAmplitudesHelp: string;
  missingPhasesHelp: string;
  error: string | null;
}

/** Outcome of `cmd.map_generate` and the representations it built. */
export interface MapGenerateResult {
  ok: boolean;
  prefix: string;
  /**
   * What `cmd.map_generate` returned. **Not a success signal**: `creating.py:288`
   * returns the name unconditionally, so it is the same on failure. `created`
   * is the real answer and comes from `cmd.get_names()`.
   */
  returned: string | null;
  created: boolean;
  reps: { name: string; op: string }[];
  rep: string;
  error: string | null;
  /** The Pmw help text for a blank amplitudes/phases column, verbatim. */
  help: string | null;
  autoclose: boolean;
  buildNote: string;
}

/* -------------------------------------------------------------------------- *
 * macOS Finder "Open With" — `pymol_qt_gui.py:1136-1160`
 * -------------------------------------------------------------------------- */

/** The macOS Finder "Open With" load plan for a single file. */
export interface OpenWithPlan {
  filename: string;
  reuseHelper: boolean;
  autoReinitialize: boolean;
  names: string[];
  /** `new-window` is the only branch that would need a second OS process. */
  action: 'new-window' | 'load-here';
  reinitialize: boolean;
  /** True for a `.psw`: apply the presentation preset before loading. */
  presentation: boolean;
  presetSteps: { kind: string; name: string; value: number | string }[];
  classification: FileClassification;
}

/** The setting snapshot a `.psw` presentation applies, and the previous values. */
export interface PresentationPreset {
  previous: Record<string, string>;
  current: Record<string, string>;
  /**
   * `cmd.full_screen` ALWAYS raises — `CmdFullScreen`
   * (`packages/engine/layer4/Cmd.cpp:5352-5362`) returns an `ok` flag it never assigns. So
   * `ok` here is false on every platform and every build.
   */
  fullScreen: { attempted: boolean; ok: boolean; error: string | null };
}

/* -------------------------------------------------------------------------- *
 * Blocking plugin file dialogs — the tkinter shim
 * -------------------------------------------------------------------------- */

/** The `tkFileDialog` entry points `mimic_tk.py:36-90` implements. */
export const PLUGIN_DIALOG_KINDS = [
  'askopenfilename',
  'askopenfilenames',
  'asksaveasfilename',
  'askdirectory',
] as const;
/** Which `tkFileDialog` entry point a blocked plugin is waiting inside. */
export type PluginDialogKind = (typeof PLUGIN_DIALOG_KINDS)[number];

/**
 * One legacy plugin blocked inside `tkinter.filedialog`, waiting for a path.
 *
 * The plugin's Python thread is parked in `DialogBroker.ask`; answering with
 * `cmd.tenmol_files.dialog_answer(dialogId, value)` unblocks it. `value` is a
 * string, a list of strings for `askopenfilenames`, or `null` for Cancel —
 * which the shim turns back into tkinter's `''` / `[]`.
 */
export interface PluginDialogRequest {
  dialogId: number;
  kind: PluginDialogKind;
  options: {
    title: string;
    initialdir: string;
    initialfile: string;
    /** Qt's `';;'`-joined filter string, exactly as `mimic_tk` builds it. */
    filter: string;
    /** The same thing split, because the path picker takes a list. */
    filters: string[];
    multiple: boolean;
  };
  /** Seconds the plugin has been blocked. */
  waitingFor: number;
}

/* -------------------------------------------------------------------------- *
 * Saving
 * -------------------------------------------------------------------------- */

/** `save_check` — validated BEFORE `cmd.save` throws (`exporting.py:841-843`). */
export interface SaveCheck {
  /** The name after `getSaveFileNameWithExt` (`pymol/Qt/utils.py:229-246`). */
  filename: string;
  ext: string;
  format: string;
  zipped: string;
  recognised: boolean;
  exists: boolean;
  parentWritable: boolean;
  unavailable: string | null;
  error: string | null;
}

/** Everything the Export Molecule dialog reads on open. */
export interface SaveMoleculeInfo {
  objects: string[];
  selections: string[];
  states: number;
  filters: string[];
  settings: {
    /** INVERTED, exactly as `file_dialogs.py:523-528` inverts it. */
    no_pdb_conect_nodup: boolean;
    pdb_conect_all: boolean;
    /** INVERTED. */
    no_ignore_pdb_segi: boolean;
    pdb_retain_ids: boolean;
    retain_order: boolean;
  };
}

/**
 * One `(filename, selection, state)` triple of `cmd.multifilenamegen`
 * (`packages/engine/modules/pymol/exporting.py:735-781`).
 */
export interface MultiFileTarget {
  filename: string;
  selection: string;
  state: number;
}

/**
 * `cmd.tenmol_files.multifilenamegen` — the bridge-side wrapper.
 *
 * `cmd.multifilenamegen` is a GENERATOR function, so it cannot be called over
 * the wire: the codec rejects `builtins.generator`. The bridge consumes it and
 * returns this instead. `error` carries the dialog-level
 * `need one or more of {name}, {num}, {state}, {title}` (`:752`).
 */
export interface MultiFileNames {
  ok: boolean;
  error: string | null;
  items: MultiFileTarget[];
}

/**
 * `cmd.tenmol_files.produce` — `pymol.movie.produce` run with fd 0 detached.
 *
 * The wrapper is not a nicety: `movie._encode` spawns the encoder with no
 * `stdin=` (`packages/engine/modules/pymol/movie.py:770-800`), so `ffmpeg` inherits and eats
 * the bridge's own stdin and the server shuts down mid-export.
 */
export interface ProduceResult {
  ok: boolean;
  error: string | null;
  path: string;
  size?: number;
}

/** What the Save Session dialog reads on open. */
export interface SessionFileInfo {
  path: string;
  hasPath: boolean;
  filters: string[];
}

/** One geometry export format the save dialog offers. */
export interface GeometryExport {
  label: string;
  filter: string;
  /** Passed as `cmd.save(fname, format=...)`. */
  format: string;
}

/* -------------------------------------------------------------------------- *
 * Images, movies
 * -------------------------------------------------------------------------- */

/** `forms/png.ui` `input_rendering`, in order; the index drives the command. */
export const PNG_RENDERING_MODES = [
  'capture current display',
  'draw antialiased OpenGL image',
  'ray trace with opaque background',
  'ray trace with transparent background',
] as const;
/** One of the four PNG-dialog rendering choices. */
export type PngRenderingMode = (typeof PNG_RENDERING_MODES)[number];

/** The movie encoders the movie dialog can drive; `''` means none found. */
export type MovieEncoder = '' | 'ffmpeg' | 'mpeg_encode' | 'convert';
/** The movie container formats offered by the export dialog. */
export type MovieFormat = 'png' | 'mp4' | 'mpg' | 'mov' | 'gif';

/** `file_dialogs.py:702-707` — which encoder writes which container. */
export const MOVIE_ENCODER_SUPPORT: Record<MovieEncoder, Record<string, 0 | 1>> = {
  '': { mp4: 0, mpg: 0, mov: 0, gif: 0 },
  ffmpeg: { mp4: 1, mpg: 1, mov: 1, gif: 1 },
  mpeg_encode: { mp4: 0, mpg: 1, mov: 0, gif: 0 },
  convert: { mp4: 0, mpg: 0, mov: 0, gif: 1 },
};

/** Everything the Save Movie dialog reads on open. */
export interface MovieDialogInfo {
  width: number;
  height: number;
  quality: number;
  ray: boolean;
  /** encoder name -> absolute path, or null when `shutil.which` found nothing. */
  encoders: Record<string, string | null>;
  defaultEncoder: MovieEncoder;
  support: Record<string, Record<string, number>>;
  filters: Record<string, string>;
  frames: number;
}

/** Size and DPI options for the still-image render dialog. */
export interface RenderInfo {
  width: number;
  height: number;
  dpi: number;
  dpiChoices: number[];
  units: string[];
  opaqueBackground: boolean;
}

/* -------------------------------------------------------------------------- *
 * Logs, scripts, fetch, transfer
 * -------------------------------------------------------------------------- */

/** Current command-logging state and the log-file filters. */
export interface LogStatus {
  /** 0 off, 1 pml, 2 python (`commanding.py:107-155`). */
  logging: 0 | 1 | 2 | number;
  path: string;
  open: boolean;
  filters: string[];
}

/** One script to run, with the `cd` that precedes it. */
export interface RunStep {
  filename: string;
  /** `cmd.cd(dirname)` runs BEFORE the script (`pymol_qt_gui.py:860-861`). */
  cd: string;
  how: 'run' | 'at';
  command: string;
}

/** The ordered scripts a Run dialog will execute. */
export interface RunPlan {
  steps: RunStep[];
  filters: string[];
}

/** The fetch defaults (path, host, assembly) the Fetch dialog reads. */
export interface FetchInfo {
  /** `fetch_path` expanded through `exp_path`. */
  fetchPath: string;
  fetchPathRaw: string;
  fetchPathWritable: boolean;
  fetchHost: string;
  fetchTypeDefault: string;
  assembly: string;
}

/** PDBe lookups, polled: the HTTP call runs on a worker thread server-side. */
export interface PdbeLookup {
  code: string;
  started: boolean;
  pending: boolean;
  assemblies: string[];
  chains: string[];
  error: string | null;
}

/** Result of a file download, with the body inlined when small enough. */
export interface DownloadResult {
  path: string;
  ok: boolean;
  size?: number;
  name?: string;
  /** base64 of the file body; capped at 32 MB server-side. */
  base64?: string;
  error: string | null;
}

/** Result of writing an uploaded file to the server. */
export interface UploadResult {
  ok: boolean;
  path: string;
  dir?: string;
  error: string | null;
}

/** One entry of the Open Recent list. */
export interface RecentEntry {
  path: string;
  /** `'...' + path.slice(-120)` when >= 128 chars (`pymol_qt_gui.py:367-375`). */
  display: string;
  exists?: boolean;
  error?: string;
}

/* -------------------------------------------------------------------------- *
 * hello()
 * -------------------------------------------------------------------------- */

/** The file service's `hello()` snapshot: cwd, filters, formats, and capabilities. */
export interface FilesHello {
  installed: true;
  cwd: string;
  home: string;
  sep: string;
  initialdir: string;
  filters: {
    load: string[];
    saveMolecule: string[];
    session: string[];
    log: string[];
    run: string[];
    movie: Record<string, string>;
    map: string[];
    alignment: string[];
    png: string[];
  };
  geometryExports: GeometryExport[];
  pngRenderingModes: string[];
  maeMultiplex: MaeMultiplexChoice[];
  encoderSupport: Record<string, Record<string, number>>;
  encoders: Record<string, string | null>;
  /** Extension -> why it raises in this build (`incentive_only.py`). */
  unavailable: Record<string, string>;
  /** Format -> why the client declines to load it at all (today: `pwg`). */
  refused: Record<string, string>;
  loadFormats: string[];
  saveFormats: string[];
}

/* -------------------------------------------------------------------------- *
 * Pure helpers — shared by the React dialogs and by the tests
 * -------------------------------------------------------------------------- */

/**
 * `getSaveFileNameWithExt` (`packages/engine/modules/pymol/Qt/utils.py:229-246`): if the typed
 * BASENAME contains no `.`, append the first `*.ext` found in the filter.
 * Reimplemented here rather than round-tripping so the save dialog can show the
 * final name as the user types.
 */
export function withExtension(fname: string, filter: string): string {
  if (!fname) return '';
  const base = fname.slice(fname.lastIndexOf('/') + 1);
  if (base.includes('.')) return fname;
  const match = /\*(\.[\w.]+)/.exec(filter ?? '');
  return match ? fname + match[1] : fname;
}

/** `*.pdb *.cif` out of `PDB (*.pdb *.cif)`; `['*']` when the filter is `(*)`. */
export function filterPatterns(filter: string): string[] {
  const open = filter.lastIndexOf('(');
  const close = filter.lastIndexOf(')');
  if (open < 0 || close < open) return ['*'];
  return filter
    .slice(open + 1, close)
    .split(/\s+/)
    .filter(Boolean);
}

/** `1 file` / `12.3 kB` / `4.5 MB`, for the picker's size column. */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * `set_resolution` from the movie dialog (`file_dialogs.py:789-794`): clamp the
 * aspect ratio to 16:9 and round the width to an even number.
 */
export function movieResolution(
  width: number,
  height: number,
  targetHeight: number,
): { width: number; height: number } {
  const h = Math.max(1, height);
  const aspect = width && h ? width / h : 9999;
  return {
    width: Math.round((Math.min(aspect, 16 / 9) * targetHeight) / 2) * 2,
    height: targetHeight,
  };
}

/**
 * The PNG dialog's command sequence (`file_dialogs.py:636-652`). Returns the
 * command lines in order; index 0..3 of `PNG_RENDERING_MODES`.
 */
export function pngCommands(filename: string, rendering: number): string[] {
  const lines: string[] = [];
  let ray = 0;
  let width = 0;
  const height = 0;
  const dpi = -1;
  if (rendering === 1) {
    lines.push(`draw ${width}, ${height}`);
    width = 0;
  } else if (rendering === 2) {
    lines.push('set opaque_background, 1');
    ray = 1;
  } else if (rendering === 3) {
    lines.push('set opaque_background, 0');
    ray = 1;
  }
  lines.push(`png ${filename}, ${width}, ${height}, ${dpi}, ray=${ray}`);
  return lines;
}
