/**
 * The typed client for `cmd.tenmol_files` (`bridge/tenmol_bridge/panels/files.py`).
 *
 * INSTALLATION, and why it looks like this: the file-I/O service cannot be a
 * `_bridge.*` route, because `_bridge.*` is dispatched inside `server.py`,
 * which WP-02 owns and this work package must not edit (plan §5.2). It also
 * cannot be a policy grant file, for the same reason. What IS available is the
 * `cmd` namespace: the policy allows any three-segment dotted path under an
 * addressable root whose interior segment is not private
 * (`bridge/tenmol_bridge/policy/base.py`). So the bridge module attaches
 * itself to `pymol.cmd` as `cmd.tenmol_files`, and the client bootstraps it
 * with exactly one `{t:'do'}` of a Python line — PyMOL's parser runs a
 * non-keyword line as Python. One round trip, no shared file touched.
 *
 * `ensure()` is idempotent and re-runs after a reconnect (the PyMOL process
 * survives a socket drop, but a bridge restart does not, and the client cannot
 * tell the two apart cheaply — so it just probes `hello` first and only
 * bootstraps when the probe fails).
 */

import {
  FILES_BOOTSTRAP,
  FILES_NS,
  type FileClassification,
  type FetchInfo,
  type FilesHello,
  type FsListing,
  type FsPlace,
  type FsStat,
  type LogStatus,
  type MaeDialogInfo,
  type MapDialogInfo,
  type MovieDialogInfo,
  type MtzDialogInfo,
  type AlnDialogInfo,
  type OpenPlan,
  type PartialGate,
  type PdbeLookup,
  type RecentEntry,
  type MultiFileNames,
  type RenderInfo,
  type RunPlan,
  type SaveCheck,
  type SaveMoleculeInfo,
  type SessionFileInfo,
  type TrajDialogInfo,
  type DownloadResult,
  type UploadResult,
} from '@tenmol/protocol/topics/files';

/** The subset of `Session` this module needs — keeps the API unit-testable. */
export interface FilesTransport {
  call<T>(fn: string, args?: readonly unknown[], kwargs?: Record<string, unknown>): Promise<T>;
  do(commandLine: string): Promise<unknown>;
}

export interface FilesApi {
  ready(): boolean;
  ensure(): Promise<FilesHello>;
  hello(): FilesHello | null;

  browse(
    path: string,
    options?: { showHidden?: boolean; dirsOnly?: boolean; patterns?: string[] },
  ): Promise<FsListing>;
  stat(path: string): Promise<FsStat>;
  places(): Promise<FsPlace[]>;
  mkdir(path: string): Promise<{ path: string; created: boolean; error: string | null }>;
  glob(pattern: string): Promise<string[]>;
  initialdir(): Promise<string>;
  setInitialdir(path: string): Promise<string>;
  chdir(path: string): Promise<{ cwd: string; initialdir: string }>;

  recent(limit?: number): Promise<RecentEntry[]>;
  recentAdd(path: string): Promise<unknown>;

  classify(filename: string): Promise<FileClassification>;
  planOpen(paths: readonly string[]): Promise<OpenPlan>;
  noteOpen(filename: string): Promise<unknown>;
  partialGate(): Promise<PartialGate>;
  trajInfo(): Promise<TrajDialogInfo>;
  mapInfo(filename: string, mapType: string): Promise<MapDialogInfo>;
  maeInfo(filename: string): Promise<MaeDialogInfo>;
  mtzInfo(filename: string): Promise<MtzDialogInfo>;
  alnInfo(filename: string, format: string): Promise<AlnDialogInfo>;
  loadAln(filename: string, mapping: Record<string, string>): Promise<unknown>;

  saveCheck(filename: string, filter?: string): Promise<SaveCheck>;
  saveMoleculeInfo(): Promise<SaveMoleculeInfo>;
  namesOfType(otype: string): Promise<string[]>;
  /**
   * `cmd.multifilenamegen` through the bridge wrapper — the direct call is
   * impossible because the upstream function is a generator and the codec
   * refuses `builtins.generator`.
   */
  multiFileNames(
    pattern: string,
    selection: string,
    state: number,
  ): Promise<MultiFileNames>;
  sessionFile(): Promise<SessionFileInfo>;

  movieInfo(): Promise<MovieDialogInfo>;
  renderInfo(): Promise<RenderInfo>;
  logStatus(): Promise<LogStatus>;
  runPlan(paths: readonly string[], pythonFilter?: boolean): Promise<RunPlan>;
  pymolrc(): Promise<{ paths: string[]; home: string }>;

  fetchInfo(): Promise<FetchInfo>;
  setFetchPath(path: string): Promise<FetchInfo>;
  pdbeStart(code: string): Promise<unknown>;
  pdbeResult(code: string): Promise<PdbeLookup>;

  download(path: string): Promise<DownloadResult>;
  upload(name: string, base64: string, directory?: string): Promise<UploadResult>;
}

export function createFilesApi(transport: FilesTransport): FilesApi {
  let cached: FilesHello | null = null;
  let pending: Promise<FilesHello> | null = null;

  const call = <T>(method: string, args: readonly unknown[] = [], kwargs = {}): Promise<T> =>
    transport.call<T>(`${FILES_NS}.${method}`, args, kwargs);

  async function bootstrap(): Promise<FilesHello> {
    try {
      cached = await call<FilesHello>('hello');
      return cached;
    } catch {
      // Not installed yet (`NotAllowed: no such symbol`). Install and retry
      // once; a second failure is a real error and propagates.
      await transport.do(FILES_BOOTSTRAP);
      cached = await call<FilesHello>('hello');
      return cached;
    }
  }

  return {
    ready: () => cached !== null,
    hello: () => cached,
    ensure(): Promise<FilesHello> {
      if (cached) return Promise.resolve(cached);
      if (!pending) {
        pending = bootstrap().finally(() => {
          pending = null;
        });
      }
      return pending;
    },

    browse: (path, options = {}) =>
      call<FsListing>('browse', [], {
        path,
        show_hidden: options.showHidden ?? false,
        dirs_only: options.dirsOnly ?? false,
        patterns: options.patterns ?? null,
      }),
    stat: (path) => call<FsStat>('stat', [path]),
    places: () => call<FsPlace[]>('places'),
    mkdir: (path) => call('mkdir', [path]),
    glob: (pattern) => call<string[]>('glob_paths', [pattern]),
    initialdir: () => call<string>('initialdir'),
    setInitialdir: (path) =>
      call<{ initialdir: string }>('set_initialdir', [path]).then((r) => r.initialdir),
    chdir: (path) => call('chdir', [path]),

    recent: (limit = 20) => call<RecentEntry[]>('recent', [limit]),
    recentAdd: (path) => call('recent_add', [path]),

    classify: (filename) => call<FileClassification>('classify', [filename]),
    planOpen: (paths) => call<OpenPlan>('plan_open', [paths]),
    noteOpen: (filename) => call('note_open', [filename]),
    partialGate: () => call<PartialGate>('ask_partial_needed'),
    trajInfo: () => call<TrajDialogInfo>('traj_dialog_info'),
    mapInfo: (filename, mapType) => call<MapDialogInfo>('map_dialog_info', [filename, mapType]),
    maeInfo: (filename) => call<MaeDialogInfo>('mae_dialog_info', [filename]),
    mtzInfo: (filename) => call<MtzDialogInfo>('mtz_dialog_info', [filename]),
    alnInfo: (filename, format) => call<AlnDialogInfo>('aln_dialog_info', [filename, format]),
    loadAln: (filename, mapping) => call('load_aln', [filename, mapping]),

    saveCheck: (filename, filter = '') => call<SaveCheck>('save_check', [filename, filter]),
    saveMoleculeInfo: () => call<SaveMoleculeInfo>('save_molecule_info'),
    namesOfType: (otype) => call<string[]>('names_of_type', [otype]),
    multiFileNames: (pattern, selection, state) =>
      call<MultiFileNames>('multifilenamegen', [pattern, selection, state]),
    sessionFile: () => call<SessionFileInfo>('session_file'),

    movieInfo: () => call<MovieDialogInfo>('movie_dialog_info'),
    renderInfo: () => call<RenderInfo>('render_info'),
    logStatus: () => call<LogStatus>('log_status'),
    runPlan: (paths, pythonFilter = false) => call<RunPlan>('run_plan', [paths, pythonFilter]),
    pymolrc: () => call<{ paths: string[]; home: string }>('pymolrc'),

    fetchInfo: () => call<FetchInfo>('fetch_info'),
    setFetchPath: (path) => call<FetchInfo>('set_fetch_path', [path]),
    pdbeStart: (code) => call('pdbe_start', [code]),
    pdbeResult: (code) => call<PdbeLookup>('pdbe_result', [code]),

    download: (path) => call<DownloadResult>('download', [path]),
    upload: (name, base64, directory = '') => call<UploadResult>('upload', [name, base64, directory]),
  };
}

/** Trigger a browser download for a base64 payload the bridge just handed us. */
export function saveToBrowser(result: DownloadResult): void {
  if (!result.ok || !result.base64) return;
  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.name ?? 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** `File` -> base64, for the upload path (a drop has no server path). */
export function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  });
}
