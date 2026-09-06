/**
 * The File menu and the dialog orchestrator for parity area 6.
 *
 * The menu bar itself is WP-14's slot and is not installed yet, so this
 * overlay feature carries its own compact "File ▾" strip: the area has to be
 * *reachable* to be verifiable. The item list is `packages/engine/modules/pymol/_gui.py:80-133`
 * — the toolkit-independent menu data every PyMOL front end consumes — minus
 * the entries that have no single-process web analogue (New PyMOL Window),
 * which are shown disabled with the reason rather than quietly dropped.
 *
 * THE OPEN PIPELINE is `load_dialog` (`packages/engine/modules/pmg_qt/file_dialogs.py:33-77`)
 * driven from the client:
 *
 *   pick paths            -> `plan_open` (first file partial=0, rest partial=1,
 *                            `pymol_qt_gui.py:643-649`)
 *   per file: `note_open` -> initialdir + recent.db (`file_dialogs.py:39-42`)
 *             classify    -> traj | aln | mae | map | mtz | session | script | plain
 *             run         -> the format's modal, or `cmd.load(f, quiet=0, **kw)`
 *   `.cms`                -> auto-detect the Desmond trajectory and chain into
 *                            the trajectory dialog (`:71-75`)
 *
 * Everything that PyMOL's dialogs execute as a *command string* is executed
 * here as a command string too, through `session.run` (`{t:'do'}`), so the
 * console echo and the log file match the desktop app exactly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FetchInfo,
  FileClassification,
  FilesHello,
  LogStatus,
  MaeDialogInfo,
  MapDialogInfo,
  MapGenerateInfo,
  MovieDialogInfo,
  MtzDialogInfo,
  PartialGate,
  RecentEntry,
  RenderInfo,
  SaveMoleculeInfo,
  TrajDialogInfo,
} from '@tenmol/protocol/topics/files';
import { useSession } from '../../app';
import { createFilesApi, saveToBrowser, type FilesApi } from './filesApi';
import { PathPicker, joinPath, type PickerRequest, type PickerResult } from './PathPicker';
import {
  AlnDialog,
  MaeDialog,
  MapDialog,
  MapGenerateDialog,
  MtzDialog,
  PartialDialog,
  TrajDialog,
  baseName,
  mapGenerateOutcome,
  type AlnInfo,
} from './LoadDialogs';
import {
  browserClassification,
  classify,
  dialogNeededFor,
  dialogRequiredMessage,
  objectNameForFile,
  refusalFor,
  scriptUnsupportedMessage,
} from './globalDrop';
import { FILES_ACTION_EVENT, FILES_OPEN_PATHS, type FilesActionDetail } from './menuHooks';
import { ExportMoleculeDialog, SaveObjectDialog, type MoleculeSaveRequest } from './SaveDialogs';
import { downloadBytes, downloadText } from './download';
import { saveSession } from './sessionSave';
import { MovieDialog, PngDialog, RenderPanel } from './ImageDialogs';
import { FetchDialog, LogDialog, RecentDialog } from './ToolsDialogs';
import { pngCommands, drawCommand, rayCommands } from './commands';
import './files.css';

type Dialog =
  | { kind: 'none' }
  | { kind: 'traj'; filename: string; info: TrajDialogInfo }
  | { kind: 'map'; filename: string; mapType: string; info: MapDialogInfo }
  | { kind: 'mae'; filename: string; info: MaeDialogInfo }
  | { kind: 'mtz'; filename: string; info: MtzDialogInfo }
  | { kind: 'mapgen'; filename: string; info: MapGenerateInfo }
  | { kind: 'aln'; filename: string; info: AlnInfo }
  | { kind: 'partial'; filename: string; gate: PartialGate }
  | { kind: 'export-molecule'; info: SaveMoleculeInfo }
  | { kind: 'save-object'; title: string; names: string[]; empty: string; filters: string[] }
  | { kind: 'png' }
  | { kind: 'render'; info: RenderInfo }
  | { kind: 'movie'; info: MovieDialogInfo; preselect: 'png' | 'mov' | null }
  | { kind: 'fetch'; info: FetchInfo }
  | { kind: 'log'; status: LogStatus }
  | { kind: 'recent'; entries: RecentEntry[] };

interface PickerState extends PickerRequest {
  resolve: (result: PickerResult | null) => void;
}

/** The Files panel: load/save molecules and sessions, with recent-file and picker dialogs. */
export function FilesPanel() {
  const session = useSession();
  const api = useMemo(
    () =>
      createFilesApi({
        call: (fn, args, kwargs) => session.call(fn, args ?? [], kwargs ?? {}),
        do: (line) => session.conn.do(line),
      }),
    [session],
  );

  const [hello, setHello] = useState<FilesHello | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Row 293: set while a `.psw` has this tab in presentation mode. */
  const [presentation, setPresentation] = useState<
    { previous: Record<string, string>; label: string } | null
  >(null);
  const pending = useRef<FileClassification[]>([]);

  /* --------------------------------------------------------- bootstrap */

  const ensure = useCallback(async (): Promise<FilesHello | null> => {
    try {
      const info = await api.ensure();
      setHello(info);
      setError(null);
      return info;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, [api]);

  /* ------------------------------------------------------------ picker */

  const pick = useCallback(
    (request: PickerRequest): Promise<PickerResult | null> =>
      new Promise((resolve) => {
        setPicker({ ...request, resolve });
      }),
    [],
  );

  const say = useCallback(
    (line: string, kind?: 'error' | 'warning') => {
      session.stores.feedback.appendClient(line, kind);
    },
    [session],
  );

  /* ---------------------------------------------------------- the flow */

  /**
   * One file of the open queue.
   *
   * Returns TRUE when it put a modal on screen, which SUSPENDS the queue —
   * the modal's own "finish" resumes it. Returning false means the file went
   * straight through `cmd.load` and the next queued file must run immediately;
   * without that signal a multi-file open loaded only its first plain file
   * (verified against a live bridge: `Open…` with 1rx1.pdb + 1bna.cif left
   * `get_names() == ['1rx1']`).
   */
  const runStep = useCallback(
    async (step: FileClassification): Promise<boolean> => {
      const { filename } = step;
      await api.noteOpen(filename);

      /*
       * Refuse a format that cannot load in this build, BEFORE trying.
       *
       * The modal branches below already disable themselves on
       * `info.unavailable` (mae, mtz), but a `.stl` or `.vis` classifies as
       * `plain` and fell straight through to `cmd.load`, which raises
       * IncentiveOnlyException — the user got a stack-flavoured console line
       * instead of "this build cannot read STL". The reason string comes from
       * the bridge, which derives it from the loader registry rather than a
       * name list (`panels/files.py::_is_sentinel_loader`).
       */
      /*
       * REFUSED formats come first and are a different thing from unavailable
       * ones: `.pwg` loads perfectly well, which is the problem. `cmd.load` on
       * a `.pwg` runs its directives with no confirmation — measured, a file
       * containing only the word `delete` deleted itself
       * (`packages/bridge/tests/test_wf_files.py`) — and the same parser opens a port,
       * imports an arbitrary module and starts a second HTTP server
       * (`packages/engine/modules/pymol/importing.py:516-615`). It classifies as `plain`, so
       * without this gate it went straight through.
       */
      const refusal = refusalFor(step, filename);
      if (refusal !== null) {
        say(refusal, 'warning');
        return false;
      }

      if (step.dialog === 'traj') {
        setDialog({ kind: 'traj', filename, info: await api.trajInfo() });
        return true;
      }
      if (step.dialog === 'aln') {
        const info = await api.alnInfo(filename, step.alnFormat ?? 'aln');
        if (info.fallback) {
          // "fasta files which don't contain alignments will be loaded as
          // extended structures (fab command) instead" (`:218-222`).
          await session.run(`load ${filename}`);
          return false;
        }
        setDialog({ kind: 'aln', filename, info });
        return true;
      }
      if (step.dialog === 'mae') {
        setDialog({ kind: 'mae', filename, info: await api.maeInfo(filename) });
        return true;
      }
      if (step.dialog === 'map') {
        setDialog({
          kind: 'map',
          filename,
          mapType: step.mapType ?? 'ccp4',
          info: await api.mapInfo(filename, step.mapType ?? 'ccp4'),
        });
        return true;
      }
      if (step.dialog === 'mtz') {
        setDialog({ kind: 'mtz', filename, info: await api.mtzInfo(filename) });
        return true;
      }
      if (step.dialog === 'session') {
        const gate = await api.partialGate();
        if (gate.needed && !step.partial) {
          setDialog({ kind: 'partial', filename, gate });
          return true;
        }
      }
      if (step.dialog === 'script') {
        // `parent.cmd.cd(parent.initialdir, quiet=0)` BEFORE the load (`:62-63`).
        const dir = await api.initialdir();
        await session.run(`cd ${dir}`);
      }
      return loadPlain(filename, step);
    },
    // `loadPlain` is declared below and is stable for the same [api, session,
    // say]; listing it here would be a use-before-declaration, so the closure
    // reads it at call time instead. Deliberate, not an oversight.
    [api, session, say],
  );

  /**
   * ROW 293 — the `.psw` presentation preset, applied by the one route that
   * can reach it.
   *
   * `PyMOLApplication.handle_file_open_active` (`pymol_qt_gui.py:1140-1160`) is
   * the macOS Finder "Open With" handler: it decides between a second PyMOL
   * process and loading in place, and for a PyMOL SHOW file it runs four
   * statements first — `set presentation`, `set internal_gui, 0`,
   * `set internal_feedback, 0`, `full_screen on` — before `load_dialog`.
   *
   * There is no Finder event in a browser, but the *file* still arrives here,
   * and until now `open_with_plan`/`presentation_preset` were an RPC with no
   * caller. This is the caller. Three deliberate differences, each measured:
   *
   *  * the plan's `action` is REPORTED, never obeyed: `new-window` means "a
   *    second OS process", which contradicts one bridge / one client (row 294),
   *    so the file loads here and the console says what upstream would have
   *    done;
   *  * because we always take the load-here branch, the preset follows the
   *    FILE TYPE (`classification.format === 'psw'`, which covers `.psw`,
   *    `.pzw` and `.psw.gz` — upstream's handler asks `endswith('.psw')` and
   *    misses the other two), not the plan's `presentation` flag, which is
   *    pre-ANDed with "we are not spawning a window";
   *  * `full_screen` is not attempted: `CmdFullScreen` never assigns its `ok`
   *    flag, so `cmd.full_screen` raises on every build while changing nothing
   *    (`presentation_preset`'s own docstring, measured).
   *
   * The previous values come back from the bridge so the tab can leave
   * presentation mode again — upstream throws them away, because a window
   * manager is not part of this app.
   */
  const enterPresentation = useCallback(
    async (filename: string, step: FileClassification): Promise<Record<string, string> | null> => {
      if (step.dialog !== 'session') return null;
      const plan = await api.openWithPlan(filename).catch(() => null);
      if (!plan) return null;
      if (plan.action === 'new-window') {
        say(
          ` ${baseName(filename)}: PyMOL would open this in a SECOND process` +
            ` (reuse_helper ${plan.reuseHelper ? 1 : 0}, ${plan.names.length} object(s) loaded);` +
            ' one bridge process, one client — loading it in place instead',
          'warning',
        );
      }
      if (plan.classification.format !== 'psw') return null;
      const preset = await api.presentationPreset(false);
      setPresentation({ previous: preset.previous, label: baseName(filename) });
      say(
        ` presentation mode on for ${baseName(filename)}:` +
          ` internal_gui ${preset.current['internal_gui'] ?? '0'},` +
          ` internal_feedback ${preset.current['internal_feedback'] ?? '0'}`,
      );
      return preset.previous;
    },
    [api, say],
  );

  const leavePresentation = useCallback(
    async (previous: Record<string, string>) => {
      await api.presentationRestore(previous).catch(() => undefined);
      setPresentation(null);
    },
    [api],
  );

  /** Returns true when the Desmond auto-chain opened the trajectory modal. */
  const loadPlain = useCallback(
    async (filename: string, step: FileClassification, partial?: 0 | 1): Promise<boolean> => {
      const usePartial = partial ?? step.partial ?? 0;
      // Upstream's order: the preset runs BEFORE `load_dialog` (`:1152-1156`),
      // so the session lands in a window that is already in presentation mode.
      const restore = await enterPresentation(filename, step);
      try {
        await session.act({
          fn: 'cmd.load',
          args: [filename],
          kwargs: usePartial ? { quiet: 0, partial: 1 } : { quiet: 0 },
          echo: `load ${filename}${usePartial ? ', partial=1' : ''}`,
          invalidatesNames: true,
        });
      } catch (e) {
        // `load_dialog` returns None after `QMessageBox.critical`, and
        // `file_open` breaks on a falsy return (`pymol_qt_gui.py:646-649`), so
        // a failed load abandons the rest of the selection here too.
        say(` ${String(e)}`, 'error');
        pending.current = [];
        // A show file that failed to load must not leave the tab in
        // presentation mode with nothing to present. Upstream has no such undo.
        if (restore) await leavePresentation(restore);
        return false;
      }
      // Desmond auto-chain (`file_dialogs.py:71-75`).
      if (step.cmsTraj) {
        setDialog({ kind: 'traj', filename: step.cmsTraj, info: await api.trajInfo() });
        return true;
      }
      return false;
    },
    [api, enterPresentation, leavePresentation, session, say],
  );

  /**
   * Drain the queue until a modal suspends it. `file_open` is a `for` loop over
   * every selected file (`pymol_qt_gui.py:643-649`); the modal steps are what
   * make it asynchronous here, not the loop itself.
   */
  const nextStep = useCallback(async () => {
    for (;;) {
      const step = pending.current.shift();
      if (!step) {
        setBusy(null);
        return;
      }
      setBusy(`opening ${baseName(step.filename)}`);
      const suspended = await runStep(step);
      if (suspended) return;
    }
  }, [runStep]);

  /** Cancelling a modal aborts the rest of the queue, as Qt's `break` does. */
  const abortQueue = useCallback(() => {
    pending.current = [];
    setDialog({ kind: 'none' });
    setBusy(null);
  }, []);

  const openPaths = useCallback(
    async (paths: string[]) => {
      if (!(await ensure())) return;
      const plan = await api.planOpen(paths);
      pending.current = plan.steps.slice();
      await nextStep();
    },
    [api, ensure, nextStep],
  );

  /** Called when a modal finishes so the queued files continue. */
  const finish = useCallback(() => {
    setDialog({ kind: 'none' });
    void nextStep();
  }, [nextStep]);

  const runCommand = useCallback(
    async (command: string) => {
      for (const line of command.split('\n')) {
        if (line.trim()) await session.run(line);
      }
    },
    [session],
  );

  /* --------------------------------------------------------- menu items */

  const fileOpen = useCallback(() => {
    // browser-open: load file contents
    //
    // Browser-only: no `ensure()`, no server `pick`, no `api.*`. Open the OS
    // file picker, read each file's TEXT, and hand the CONTENTS to the engine
    // through `cmd.load` (blank format => the engine sniffs). This also works
    // over the remote bridge — `cmd.load` accepts content on both backends — so
    // it is unconditional and never routes through `cmd.tenmol_files.*`.
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      void (async () => {
        for (const file of files) {
          // The `.pwg`/refusal gate is engine-independent and comes FIRST: a
          // `.pwg` classifies as plain and would otherwise reach `cmd.load`,
          // which executes its directives (`globalDrop.ts::refusalFor`).
          const refusal = refusalFor(browserClassification(file.name), file.name);
          if (refusal !== null) {
            say(refusal, 'warning');
            continue;
          }
          // Dialog-needed formats (session/map/mtz/trajectory/alignment/mae)
          // are BINARY and/or need loader options the content-only path cannot
          // supply. Text-decoding + `cmd.load`ing them would silently corrupt
          // or mis-load them, so refuse here just as the server drop path does —
          // browser-only cannot drive these modals. Only plain single-molecule
          // text formats fall through to `file.text()` + `cmd.load`.
          const dialog = dialogNeededFor(classify(file.name));
          if (dialog !== null) {
            say(dialogRequiredMessage(file.name, dialog), 'warning');
            continue;
          }
          // Scripts (`.pml`/`.py`/`.pym`) are neither refused nor dialog-needed,
          // so without this they would reach `cmd.load` with a blank format and
          // throw "could not determine the structure format". The browser build
          // cannot RUN them, so say so instead of attempting to load or execute.
          if (classify(file.name).dialog === 'script') {
            say(scriptUnsupportedMessage(file.name), 'warning');
            continue;
          }
          const content = await file.text();
          await session.act({
            fn: 'cmd.load',
            args: [content, objectNameForFile(file.name), 0, ''],
            echo: `load ${file.name}`,
            invalidatesNames: true,
          });
        }
      })();
    };
    input.click();
  }, [say, session]);

  const sessionSaveAs = useCallback(async () => {
    // browser-save: get_session download
    //
    // Browser-only: there is no OS save dialog and no host filesystem, so a
    // "save" is a download of the engine's session snapshot. No
    // ensure()/setInitialdir/recentAdd/PathPicker, and never `save <path>`,
    // which writes to disk and THROWS in the browser. The engine's reload path
    // keys off the .pse/.psw extension, so default the prompt to `.pse` and
    // append it when the typed name has neither. `saveSession` handles both
    // backends — object snapshot on the local engine, blob handle on the remote
    // bridge — and is shared with the Ctrl+S accelerator in FileDropTarget.
    const typed = window.prompt('Save session as', 'untitled.pse');
    if (!typed) return;
    const name = /\.(pse|psw)$/i.test(typed) ? typed : `${typed}.pse`;
    // `session.call` (via `saveSession` -> `cmd.get_session`) REJECTS silently
    // — no console self-report, unlike `session.run`/`session.act` — so a save
    // failure must be caught and surfaced here (mirrors FileDropTarget's Ctrl+S).
    try {
      await saveSession(session, name);
      say(` saved ${name}`);
    } catch (error) {
      say(` save failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }, [session, say]);

  /**
   * Seed the Export Molecule dialog WITHOUT the bridge.
   *
   * browser-export: get_str download. The object/selection combos come from
   * `cmd.get_names` (works on both backends), and the five PDB settings get
   * static defaults mirroring `SaveMoleculeInfo` — the dialog only needs a valid
   * shape to open, and the actual `set` writes happen at save time. `states: 1`
   * is a minimal valid default (the state combo still offers -1/0/1).
   */
  const saveMoleculeInfo = useCallback(async (): Promise<SaveMoleculeInfo> => {
    // `session.call` REJECTS silently (no console self-report, unlike
    // `session.run`/`session.act`), so a failed `cmd.get_names` would otherwise
    // be a no-op: no dialog, no error. Catch it, report, and open the dialog
    // with empty combos so the failure is visible rather than swallowed.
    let objects: string[] = [];
    let selections: string[] = [];
    try {
      objects = await session.call<string[]>('cmd.get_names', ['objects']);
      selections = await session.call<string[]>('cmd.get_names', ['public_selections']);
    } catch (error) {
      say(
        ` export molecule failed: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
    return {
      objects,
      selections,
      states: 1,
      filters: EXPORT_MOLECULE_FILTERS,
      settings: {
        no_pdb_conect_nodup: false,
        pdb_conect_all: false,
        no_ignore_pdb_segi: false,
        pdb_retain_ids: false,
        retain_order: false,
      },
    };
  }, [session, say]);

  const menu: MenuItem[] = useMemo(
    () => [
      { id: 'open', label: 'Open…', shortcut: '⌃O', run: fileOpen },
      {
        id: 'recent',
        label: 'Open Recent…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({ kind: 'recent', entries: await api.recent() });
        },
      },
      {
        id: 'fetch',
        label: 'Get PDB…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({ kind: 'fetch', info: await api.fetchInfo() });
        },
      },
      {
        /*
         * `PyMOLMapLoad` has NO menu entry anywhere in the Qt front-end — it is
         * dead code reachable only from the Tk skin. Giving it one here is the
         * whole point of porting it: `cmd.map_generate` is a real command with
         * no other UI. The dialog itself says, up front, that this build
         * compiles the generator out.
         */
        id: 'map-generate',
        label: 'Generate Map from Reflections…',
        run: async () => {
          if (!(await ensure())) return;
          const result = await pick({
            mode: 'open',
            title: 'Reflection file (MTZ)',
            filters: ['Reflections (*.mtz)', 'All Files (*)'],
            accept: 'Open',
          });
          if (!result) return;
          const filename = first(result.paths);
          setDialog({ kind: 'mapgen', filename, info: await api.mapGenerateInfo(filename) });
        },
      },
      { id: 'sep1', separator: true },
      {
        // browser-save: get_session download — both items serialize + download
        // the session snapshot. There is no persistent "current file" in the
        // browser, so Save Session and Save Session As… behave identically.
        id: 'session-save',
        label: 'Save Session',
        shortcut: '⌃S',
        run: sessionSaveAs,
      },
      { id: 'session-save-as', label: 'Save Session As…', run: sessionSaveAs },
      { id: 'sep2', separator: true },
      {
        id: 'export-molecule',
        label: 'Export Molecule…',
        run: async () => {
          // browser-export: get_str download — seed the dialog from the engine,
          // not the bridge (`api.saveMoleculeInfo`).
          setDialog({ kind: 'export-molecule', info: await saveMoleculeInfo() });
        },
      },
      {
        id: 'export-map',
        label: 'Export Map…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({
            kind: 'save-object',
            title: 'Save object:map',
            names: await api.namesOfType('object:map'),
            empty: 'No map objects loaded',
            filters: ['CCP4 (*.ccp4 *.map)'],
          });
        },
      },
      {
        id: 'export-aln',
        label: 'Export Alignment…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({
            kind: 'save-object',
            title: 'Save object:alignment',
            names: await api.namesOfType('object:alignment'),
            empty:
              'No alignment objects loaded\n\nHint: create alignment objects with "align" and\n"super" using the "object=..." argument.',
            filters: ['clustalw (*.aln)'],
          });
        },
      },
      { id: 'sep3', separator: true },
      {
        id: 'png',
        label: 'Export Image As ▸ PNG…',
        run: async () => {
          // browser-png: cmd.png download — no ensure()/bridge; the dialog only
          // needs the engine, which cmd.png reaches on both backends.
          setDialog({ kind: 'png' });
        },
      },
      ...(hello?.geometryExports ?? []).map((item) => ({
        id: 'geo-' + item.format,
        label: `Export Image As ▸ ${item.label}…`,
        disabledReason: hello?.unavailable['.' + item.format],
        run: async () => {
          const result = await pick({
            mode: 'save',
            title: 'Save As...',
            filters: [item.filter],
            accept: 'Save',
          });
          if (!result) return;
          await api.setInitialdir(first(result.paths));
          await session.run(`save ${first(result.paths)}, format=${item.format}`);
        },
      })),
      { id: 'sep4', separator: true },
      {
        id: 'movie-mpeg',
        label: 'Export Movie As ▸ MPEG…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({ kind: 'movie', info: await api.movieInfo(), preselect: null });
        },
      },
      {
        id: 'movie-mov',
        label: 'Export Movie As ▸ Quicktime…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({ kind: 'movie', info: await api.movieInfo(), preselect: 'mov' });
        },
      },
      {
        id: 'movie-png',
        label: 'Export Movie As ▸ PNG Images…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({ kind: 'movie', info: await api.movieInfo(), preselect: 'png' });
        },
      },
      { id: 'sep5', separator: true },
      {
        id: 'log',
        label: 'Log File ▸ …',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({ kind: 'log', status: await api.logStatus() });
        },
      },
      {
        id: 'run',
        label: 'Run Script…',
        run: async () => {
          if (!(await ensure())) return;
          const result = await pick({
            mode: 'open',
            title: 'Open file',
            filters: hello?.filters.run,
            accept: 'Run',
          });
          if (!result) return;
          const plan = await api.runPlan(result.paths, result.filterLabel.startsWith('Python'));
          for (const step of plan.steps) {
            await api.setInitialdir(step.filename);
            await session.run(`cd ${step.cd}`);
            await session.run(step.command);
          }
        },
      },
      {
        id: 'cd',
        label: 'Working Directory ▸ Change…',
        run: async () => {
          if (!(await ensure())) return;
          const result = await pick({
            mode: 'dir',
            title: 'Change Working Directory',
            accept: 'Choose',
          });
          if (!result) return;
          await session.run(`cd ${first(result.paths) || '.'}`);
          await api.chdir(first(result.paths) || '.');
        },
      },
      {
        id: 'browse',
        label: 'Working Directory ▸ File Browser',
        run: async () => {
          if (!(await ensure())) return;
          // `cmd.system('open .')` has no browser analogue; reveal the cwd in
          // the in-app picker instead (`docs/file-io.md` §9).
          const info = await api.chdir('.');
          await pick({ mode: 'dir', title: 'Working directory', directory: info.cwd });
        },
      },
      { id: 'sep6', separator: true },
      {
        id: 'render',
        label: 'Draw / Ray…',
        run: async () => {
          if (!(await ensure())) return;
          setDialog({ kind: 'render', info: await api.renderInfo() });
        },
      },
      {
        id: 'new-window',
        label: 'New PyMOL Window',
        disabledReason:
          'one bridge process, one client: `new_window` spawns a second OS process (_gui.py:41-53)',
        run: async () => undefined,
      },
    ],
    [api, ensure, fileOpen, hello, pick, saveMoleculeInfo, session, sessionSaveAs],
  );

  /* ------------------------------------------------ the menu bar's leaves */

  /**
   * Run one of this panel's menu actions on behalf of somebody else.
   *
   * The File menu is WP-14's feature and these dialogs are WP-18's; the bridge
   * between them is `menuHooks.ts` (`registerMenuHook` -> `openPanel('files',
   * …)` -> this event). The action id is looked up in the SAME table the
   * panel's own strip renders, so `File ▸ Open…` in the menu bar and `File ▾ ▸
   * Open…` here cannot drift apart — there is one implementation.
   *
   * The three `log-*` ids are the exception and are handled directly: Qt's
   * `log_open`/`log_resume`/`log_append` each go straight to a file dialog
   * (`pymol_qt_gui.py:823-845`), whereas this panel's single `Log File ▸ …`
   * item opens the hub that offers all three. Routing the leaves through
   * `logPick` keeps the leaf's meaning exact.
   *
   * TWO STEPS, and the second is not ceremony. Five of the ids exist only once
   * `hello` has landed — `Export Image As ▸ VRML 2/COLLADA/GLTF/POV-Ray/STL`
   * are built from `hello.geometryExports`, i.e. from the bridge's own
   * `savefunctions` view — and a hook fired on a panel that has just been
   * mounted for it arrives BEFORE that. So the request is parked in state, the
   * bootstrap is kicked off, and the effect below runs again when the menu
   * table it needs actually exists. (Measured: without this, those five leaves
   * answered `no File action "geo-wrl"` every time.)
   */
  const [request, setRequest] = useState<string | null>(null);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<FilesActionDetail>).detail;
      const action = detail?.action;
      if (!action) return;
      setMenuOpen(false);
      // `load_dialog(fname)` for a path the CALLER chose (Open Recent, a
      // "recently used" list, a deep link): it carries its own argument, so it
      // is not a menu id and does not wait for `hello`.
      if (action === FILES_OPEN_PATHS) {
        void openPaths([...(detail?.paths ?? [])]);
        return;
      }
      setRequest(action);
      void ensure();
    };
    window.addEventListener(FILES_ACTION_EVENT, onAction);
    return () => window.removeEventListener(FILES_ACTION_EVENT, onAction);
  }, [ensure, openPaths]);

  useEffect(() => {
    if (request === null) return;
    const LOG_MODES: Record<string, 'w' | 'a' | 'resume'> = {
      'log-open': 'w',
      'log-append': 'a',
      'log-resume': 'resume',
    };
    const item = menu.find((entry) => entry.id === request);
    const mode = LOG_MODES[request];
    // Neither yet: the menu is still half-built. Wait for `hello` — unless the
    // bootstrap has already failed, in which case nothing more is coming.
    if (!item && !mode && !hello && !error) return;
    setRequest(null);
    if (item?.disabledReason) {
      say(` ${request}: ${item.disabledReason}`, 'warning');
      return;
    }
    if (item?.run) {
      void item.run();
      return;
    }
    if (mode) {
      void logPick(mode);
      return;
    }
    say(` no File action "${request}" in this client`, 'warning');
    // `logPick` is a plain function declaration in this scope, so it is
    // re-created every render; `menu`/`hello` changing is what re-runs this,
    // and by then it closes over the same `hello` the menu was built from.
  }, [request, menu, hello, error, say]);

  /* ------------------------------------------------- keyboard + dropping */

  useEffect(() => {
    // A `QMenu` closes on Escape and on any click outside it. Without this the
    // strip's dropdown stayed open until its button was pressed a second time,
    // which also swallowed the next attempt to open it.
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.files__strip')) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /*
   * THE Ctrl+O / Ctrl+S ACCELERATORS USED TO BE REGISTERED HERE, and that was
   * the same bug the drop handler had: this panel is an OVERLAY slot, so the
   * shortcuts only worked while it happened to be open. They now live in
   * `FileDropTarget`, which the viewport slot mounts unconditionally.
   *
   * Not duplicated on purpose — two listeners would both fire, opening two
   * pickers for one keypress.
   */

  /*
   * The window-level drag & drop handler USED TO LIVE HERE, and that was the
   * bug: this panel is an overlay slot, so `AppShell.OverlayLayer` mounts it
   * only while the user has it open. Dropping a structure on the window did
   * nothing whenever it was closed, silently. It is now `FileDropTarget`,
   * mounted by the viewport slot, which is always on screen.
   */

  /* -------------------------------------------- blocking plugin dialogs */

  /*
   * THE PLUGIN FILE-DIALOG POLLER USED TO LIVE HERE, and that was row 295's
   * remaining defect: this panel is an OVERLAY slot, so `AppShell.OverlayLayer`
   * mounts it only while the user has it open. A legacy plugin that called
   * `tkinter.filedialog.askopenfilename()` with the panel closed parked a
   * request nothing was watching for, and its Python thread stayed blocked
   * until `DialogBroker.DEFAULT_TIMEOUT` (300 s) turned the request into
   * tkinter's `''` — silently, because the picker was never drawn. Upstream's
   * `mimic_tk` dialog is a parentless application-modal `QFileDialog`, which
   * has no such window.
   *
   * It is now `PluginDialogHost`, rendered by `FileDropTarget`, which the
   * viewport slot mounts unconditionally. NOT duplicated here on purpose: two
   * pollers would both claim the same request and the loser's `dialog_answer`
   * would answer a dialog that no longer exists.
   */

  /* ------------------------------------------------------------- render */

  return (
    <>
      <div className="files__strip">
        <button
          type="button"
          className="files__menubtn modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:transition-colors modern:hover:bg-btn-hover modern:hover:text-pm-text-bright"
          data-testid="files-menu-button"
          onClick={() => {
            setMenuOpen((v) => !v);
            void ensure();
          }}
        >
          File ▾
        </button>
        {busy && <span className="files__busy">{busy}</span>}
        {presentation && (
          <button
            type="button"
            className="files__menubtn modern:rounded-md modern:border modern:border-btn-border modern:bg-btn modern:text-pm-text modern:transition-colors modern:hover:bg-btn-hover modern:hover:text-pm-text-bright"
            data-testid="files-leave-presentation"
            title="Restore internal_gui / internal_feedback / presentation"
            onClick={() => void leavePresentation(presentation.previous)}
          >
            Leave presentation ({presentation.label})
          </button>
        )}
        {error && (
          <span className="files__error modern:text-danger" title={error}>
            file service unavailable
          </span>
        )}
        {menuOpen && (
          <div
            className="files__menu modern:rounded-md modern:border modern:border-line modern:bg-pm-panel modern:text-pm-text"
            data-testid="files-menu"
          >
            {menu.map((item) =>
              item.separator ? (
                <div key={item.id} className="files__menusep" />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  className="files__menuitem"
                  data-testid={`files-menu-${item.id}`}
                  disabled={Boolean(item.disabledReason)}
                  title={item.disabledReason ?? ''}
                  onClick={() => {
                    setMenuOpen(false);
                    void item.run?.();
                  }}
                >
                  <span>{item.label}</span>
                  {item.shortcut && <span className="files__menukey">{item.shortcut}</span>}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      {picker && (
        <PathPicker
          api={api}
          request={picker}
          onCancel={() => {
            const { resolve } = picker;
            setPicker(null);
            resolve(null);
          }}
          onAccept={(result) => {
            const { resolve } = picker;
            setPicker(null);
            resolve(result);
          }}
        />
      )}

      {dialog.kind === 'traj' && (
        <TrajDialog
          filename={dialog.filename}
          info={dialog.info}
          onClose={finish}
          onRun={(command) => {
            void runCommand(command).then(finish);
          }}
        />
      )}

      {dialog.kind === 'map' && (
        <MapDialog
          filename={dialog.filename}
          mapType={dialog.mapType}
          info={dialog.info}
          onClose={finish}
          onRun={(command) => {
            void runCommand(command).then(finish);
          }}
        />
      )}

      {dialog.kind === 'mae' && (
        <MaeDialog
          filename={dialog.filename}
          info={dialog.info}
          onClose={finish}
          onRun={(command) => {
            void runCommand(command).then(finish);
          }}
        />
      )}

      {dialog.kind === 'mtz' && (
        <MtzDialog
          filename={dialog.filename}
          info={dialog.info}
          onClose={finish}
          onRun={(args) => {
            void session
              .run(
                `load_mtz ${dialog.filename}, ${args.prefix}, ${args.amplitudes}, ${args.phases}, ${args.weights}, ${args.resoMin}, ${args.resoMax}`,
              )
              .then(finish);
          }}
        />
      )}

      {dialog.kind === 'mapgen' && (
        <MapGenerateDialog
          filename={dialog.filename}
          info={dialog.info}
          onClose={finish}
          onRun={(args) => {
            void api
              .mapGenerateRun({ filename: dialog.filename, ...args })
              .then((result) => {
                // `autoclose_dialogs` decides whether OK closes the form
                // (`PyMOLMapLoad.py:338-340`) and a failed generate never
                // closes it, so the user can fix a column and press OK again.
                // Both decisions are `mapGenerateOutcome`, which is pure and
                // tested; this used to close the dialog on success either way,
                // which made the setting do nothing.
                const outcome = mapGenerateOutcome(result);
                say(outcome.line, outcome.kind);
                if (outcome.close) finish();
              })
              .catch((e: unknown) => say(` map_generate failed: ${String(e)}`, 'error'));
          }}
        />
      )}

      {dialog.kind === 'aln' && (
        <AlnDialog
          filename={dialog.filename}
          info={dialog.info}
          onLoad={(mapping) => {
            void api.loadAln(dialog.filename, mapping).then(finish);
          }}
          onCancel={(loadAnyway) => {
            if (loadAnyway) void session.run(`load ${dialog.filename}`).then(finish);
            else finish();
          }}
        />
      )}

      {dialog.kind === 'partial' && (
        <PartialDialog
          filename={dialog.filename}
          gate={dialog.gate}
          /* `ask_partial` Cancel returns False and `file_open` breaks on it. */
          onCancel={abortQueue}
          onChoice={(choice, rename) => {
            void (async () => {
              if (choice === 'partial') {
                await session.run(`set auto_rename_duplicate_objects, ${rename ? 1 : 0}`);
              }
              await loadPlain(
                dialog.filename,
                { ...emptyClassification, filename: dialog.filename },
                choice === 'partial' ? 1 : 0,
              );
              finish();
            })();
          }}
        />
      )}

      {dialog.kind === 'export-molecule' && (
        <ExportMoleculeDialog
          info={dialog.info}
          onClose={() => setDialog({ kind: 'none' })}
          onSave={(request) => {
            void exportMolecule(request);
          }}
        />
      )}

      {dialog.kind === 'save-object' && (
        <SaveObjectDialog
          title={dialog.title}
          names={dialog.names}
          emptyMessage={dialog.empty}
          onClose={() => setDialog({ kind: 'none' })}
          onPick={(name) => {
            const filters = dialog.filters;
            setDialog({ kind: 'none' });
            void (async () => {
              const result = await pick({
                mode: 'save',
                title: 'Save As...',
                filters,
                accept: 'Save',
              });
              if (!result) return;
              await session.run(`save ${first(result.paths)}, ${name}, -1`);
            })();
          }}
        />
      )}

      {dialog.kind === 'png' && (
        <PngDialog
          onClose={() => setDialog({ kind: 'none' })}
          onSave={(rendering) => {
            // browser-png: cmd.png download
            //
            // Browser-only: no OS save dialog, no host filesystem. Run the
            // dialog's render SETUP lines (`draw 0, 0` / `set opaque_background,
            // …`, commands.ts:164-172) but NOT the final `png <path>` line — the
            // browser png disk-write is a no-op. Then pull the pixels straight
            // from the engine (`cmd.png`, works over the remote bridge too) and
            // download them. No ensure()/setInitialdir/PathPicker/recentAdd.
            setDialog({ kind: 'none' });
            void (async () => {
              const typed = window.prompt('Save image as', 'image.png');
              if (!typed) return;
              const name = /\.png$/i.test(typed) ? typed : `${typed}.png`;
              // `session.call('cmd.png', …)` REJECTS silently (and `session.run`
              // for the setup lines can too); wrap so a failed export reports
              // instead of leaving a no-op.
              try {
                const lines = pngCommands('', rendering);
                // Every line except the trailing `png <path>` is render setup.
                for (const line of lines.slice(0, -1)) await session.run(line);
                const ray = rendering >= 2 ? 1 : 0;
                const bytes = await session.call<number[]>('cmd.png', ['', 0, 0, -1], { ray });
                downloadBytes(name, Uint8Array.from(bytes), 'image/png');
                say(` saved ${name}`);
              } catch (error) {
                say(
                  ` png export failed: ${error instanceof Error ? error.message : String(error)}`,
                  'error',
                );
              }
            })();
          }}
        />
      )}

      {dialog.kind === 'render' && (
        <RenderPanel
          info={dialog.info}
          onClose={() => setDialog({ kind: 'none' })}
          onDraw={(w, h) => void session.run(drawCommand(w, h))}
          onRay={(w, h, transparent) => {
            void (async () => {
              for (const line of rayCommands(w, h, transparent)) await session.run(line);
            })();
          }}
          onSave={(dpi) => {
            // browser-png: cmd.png download — the render already ran (Draw/Ray),
            // so read it back with `prior=1` (no re-render) and download the
            // bytes instead of writing `png <path>` to a disk the browser lacks.
            void (async () => {
              const typed = window.prompt('Save image as', 'image.png');
              if (!typed) return;
              const name = /\.png$/i.test(typed) ? typed : `${typed}.png`;
              // `session.call('cmd.png', …)` REJECTS silently, so wrap and report
              // rather than leaving the Save button a no-op on failure.
              try {
                // Filename-only positional args: `dpi` is PyMOL's 4th positional
                // slot, so passing `-1` there AND `dpi=` as a kwarg makes the real
                // bridge raise `TypeError: png() got multiple values for argument
                // 'dpi'`. Pass everything but the filename as kwargs (convention
                // per panels/files.py::copy_image_png).
                const bytes = await session.call<number[]>('cmd.png', [''], {
                  prior: 1,
                  dpi,
                });
                downloadBytes(name, Uint8Array.from(bytes), 'image/png');
                say(` saved ${name}`);
              } catch (error) {
                say(
                  ` png export failed: ${error instanceof Error ? error.message : String(error)}`,
                  'error',
                );
              }
            })();
          }}
          onClipboard={() => {
            void session.call('cmd._copy_image', [], { quiet: 0 }).catch((e) => say(String(e)));
          }}
        />
      )}

      {dialog.kind === 'movie' && (
        <MovieDialog
          info={dialog.info}
          preselect={dialog.preselect}
          onClose={() => setDialog({ kind: 'none' })}
          onSave={(options) => {
            setDialog({ kind: 'none' });
            void (async () => {
              const filter = dialog.info.filters[options.format] ?? 'All Files (*)';
              const result = await pick({
                mode: 'save',
                title: 'Save As...',
                filters: [filter],
                accept: 'Save',
              });
              if (!result) return;
              await api.setInitialdir(first(result.paths));
              if (options.format === 'png') {
                await session.act({
                  fn: 'cmd.mpng',
                  args: [first(result.paths)],
                  kwargs: {
                    width: options.width,
                    height: options.height,
                    mode: options.ray ? 2 : 1,
                    quiet: 0,
                    modal: -1,
                  },
                  echo: `mpng ${first(result.paths)}, width=${options.width}, height=${options.height}, mode=${options.ray ? 2 : 1}`,
                });
              } else {
                // NOT `movie.produce` directly: `movie._encode` spawns the
                // encoder with no `stdin=` (`packages/engine/modules/pymol/movie.py:770-800`),
                // ffmpeg eats the bridge's own fd 0 and the server shuts down
                // mid-export — reproduced twice against a live bridge. The
                // wrapper in `panels/files.py` detaches fd 0 first.
                setBusy(`encoding ${baseName(first(result.paths))}`);
                const produced = await api.produce(first(result.paths), {
                  width: options.width,
                  height: options.height,
                  quality: options.quality,
                  mode: options.ray ? 'ray' : 'draw',
                  encoder: options.encoder,
                  quiet: 0,
                });
                setBusy(null);
                if (!produced.ok) say(` produce: ${produced.error}`, 'error');
              }
            })();
          }}
        />
      )}

      {dialog.kind === 'fetch' && (
        <FetchDialog
          api={api}
          info={dialog.info}
          onClose={() => setDialog({ kind: 'none' })}
          onBrowseFetchPath={() => {
            void (async () => {
              const result = await pick({
                mode: 'dir',
                title: 'fetch_path',
                directory: dialog.info.fetchPath,
                accept: 'Use',
              });
              if (!result) return;
              const info = await api.setFetchPath(first(result.paths));
              setDialog({ kind: 'fetch', info });
            })();
          }}
          onRun={(command) => {
            setDialog({ kind: 'none' });
            void runCommand(command);
          }}
        />
      )}

      {dialog.kind === 'log' && (
        <LogDialog
          status={dialog.status}
          onClose={() => setDialog({ kind: 'none' })}
          onOpen={() => void logPick('w')}
          onAppend={() => void logPick('a')}
          onResume={() => void logPick('resume')}
          onCloseLog={() => {
            void session.run('log_close').then(async () => {
              setDialog({ kind: 'log', status: await api.logStatus() });
            });
          }}
        />
      )}

      {dialog.kind === 'recent' && (
        <RecentDialog
          entries={dialog.entries}
          onClose={() => setDialog({ kind: 'none' })}
          onOpen={(path) => {
            setDialog({ kind: 'none' });
            void openPaths([path]);
          }}
        />
      )}
    </>
  );

  async function logPick(mode: 'w' | 'a' | 'resume') {
    const result = await pick({
      mode: 'save',
      title: 'Open Logfile...',
      filters: hello?.filters.log,
      accept: mode === 'resume' ? 'Resume' : 'Open',
    });
    if (!result) return;
    await api.setInitialdir(first(result.paths));
    if (mode === 'resume') await session.run(`resume ${first(result.paths)}`);
    else await session.run(`log_open ${first(result.paths)}, ${mode}`);
    setDialog({ kind: 'log', status: await api.logStatus() });
  }

  async function exportMolecule(request: MoleculeSaveRequest) {
    // browser-export: get_str download
    setDialog({ kind: 'none' });
    // The five settings are written back before saving (`file_dialogs.py:558-562`).
    const s = request.settings;
    await session.run(`set pdb_conect_nodup, ${s.no_pdb_conect_nodup ? 0 : 1}`);
    await session.run(`set pdb_conect_all, ${s.pdb_conect_all ? 1 : 0}`);
    await session.run(`set ignore_pdb_segi, ${s.no_ignore_pdb_segi ? 0 : 1}`);
    await session.run(`set pdb_retain_ids, ${s.pdb_retain_ids ? 1 : 0}`);
    await session.run(`set retain_order, ${s.retain_order ? 1 : 0}`);

    // OUT OF SCOPE for browser download: `multisave` writes one multi-object
    // file, and the "Multiple files" patterns (`multifilesave`/
    // `cmd.multifilenamegen`) write MANY files — neither maps onto a single
    // blob download, and `multifilenamegen` is a bridge-only generator anyway.
    // Refuse gracefully rather than half-implement it.
    if (request.multisave || request.pattern) {
      say(
        ' multi-file / multi-object export is not available in the browser — ' +
          'export a single object or selection to one file instead',
        'warning',
      );
      return;
    }

    // Single file: derive the format from the dialog's chosen filter, get the
    // text straight from the engine (`cmd.get_str`, which dispatches pdb ->
    // get_pdbstr / fasta -> get_fastastr internally) and download it. No
    // PathPicker, no saveCheck, no recentAdd, no `save <path>` (writes to disk +
    // THROWS in the browser).
    const ext = extForFilter(request.filter);
    const format = formatForExt(ext);
    const typed = window.prompt('Save molecule as', `${defaultBaseName(request.selection)}.${ext}`);
    if (!typed) return;
    const name = /\.[a-z0-9]+$/i.test(typed) ? typed : `${typed}.${ext}`;
    try {
      const text = await session.call<string>('cmd.get_str', [
        format,
        request.selection,
        request.state,
      ]);
      downloadText(name, text);
      say(` saved ${name}`);
    } catch (error) {
      say(` export failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }
}

interface MenuItem {
  id: string;
  label?: string | undefined;
  shortcut?: string | undefined;
  separator?: boolean | undefined;
  disabledReason?: string | undefined;
  run?: (() => Promise<unknown> | void) | undefined;
}

/** `paths[0]` under `noUncheckedIndexedAccess`. */
function first(paths: readonly string[]): string {
  return paths[0] ?? '';
}

/**
 * Static save filters for the browser Export Molecule dialog — one per
 * single-file format `cmd.get_str` can produce. Replaces the bridge's
 * `hello.filters.saveMolecule`, which is unreachable in a browser-only build.
 */
const EXPORT_MOLECULE_FILTERS = [
  'PDB File (*.pdb)',
  'CIF File (*.cif)',
  'MOL File (*.mol)',
  'SD File (*.sdf)',
  'MOL2 File (*.mol2)',
  'XYZ File (*.xyz)',
  'FASTA File (*.fasta)',
];

/** The extension from a picker filter like `PDB File (*.pdb)` (defaults to pdb). */
function extForFilter(filter: string): string {
  return (/\*\.([a-z0-9]+)/i.exec(filter)?.[1] ?? 'pdb').toLowerCase();
}

/**
 * Map a file extension to the `cmd.get_str` format token. Mirrors the engine's
 * own `formatFromFilename` (exporters.ts): unknown extensions fall back to pdb.
 */
function formatForExt(ext: string): string {
  switch (ext) {
    case 'cif':
    case 'mmcif':
      return 'cif';
    case 'xyz':
      return 'xyz';
    case 'fasta':
    case 'fa':
      return 'fasta';
    case 'mol':
      return 'mol';
    case 'sdf':
      return 'sdf';
    case 'mol2':
      return 'mol2';
    case 'ent':
    case 'pdb':
    default:
      return 'pdb';
  }
}

/** A filesystem-safe default basename from the chosen selection/object name. */
function defaultBaseName(selection: string): string {
  return selection.trim().replace(/[^A-Za-z0-9_.-]+/g, '_') || 'molecule';
}

/**
 * First-seen-wins de-duplication for a filter list.
 *
 * The Export Molecule dialog's chosen filter is prepended to the picker's
 * filter list so it is preselected, and it is also a member of that list; the
 * `<option key={f}>` rows must stay unique.
 */
export function dedupe(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) if (!out.includes(value)) out.push(value);
  return out;
}

const emptyClassification: FileClassification = {
  filename: '',
  prefix: '',
  ext: '',
  format: '',
  zipped: '',
  isUrl: false,
  objectName: '',
  dialog: 'plain',
  mapType: null,
  alnFormat: null,
  cmsTraj: null,
  refused: null,
  unavailable: null,
};

/** Exposed for the manual "download a copy" affordance in the picker footer. */
export async function downloadCopy(api: FilesApi, path: string): Promise<void> {
  saveToBrowser(await api.download(path));
}

export { joinPath };
