/**
 * The Text Editor — `packages/engine/modules/pmg_qt/TextEditor.py:18-195`.
 *
 * Qt builds a `QMainWindow` with a File menu (Open Ctrl+O, Save Ctrl+S, Save
 * as… Ctrl+Shift+S), an EXCLUSIVE Syntax menu (Python / PML / Plain Text), a
 * monospace `QPlainTextEdit` whose context menu gains `Select Font...`, and a
 * modal Yes/No/Cancel `Save changes?` guard on open and on close. All of that
 * is here.
 *
 * Highlighting is a textarea over a `<pre>` underlay — the standard way to keep
 * a real, accessible text control while still painting tokens. `syntax.ts` does
 * the tokenising and is unit-tested on its own.
 *
 * File access is `files.ts`: the WP-18 bridge endpoints when they exist, the
 * browser's own picker and download when they do not. The panel SAYS which one
 * it is using rather than pretending the path it shows is the path it wrote.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SYNTAX_MODES, type SyntaxMode } from '@tenmol/protocol/topics/dialogs';
import { useSession } from '../../app';
import { DialogWindow } from '../dialogs/DialogWindow';
import { ConfirmPrompt } from '../dialogs/modals';
import type { DialogWindowSpec } from '../dialogs/store';
import { useHostedWindows } from '../dialogs/useDialogs';
import {
  RECHECK,
  downloadFile,
  openServerFile,
  pickBrowserFile,
  probeServerFiles,
  readServerFile,
  resolvePymolrc,
  runScript,
  writeServerFile,
  type AccessState,
  type FileAccess,
} from './files';
import { PYMOLRC_ARG } from './openEditor';
import { editorTitle, highlight, isPymolrc, syntaxForFilename } from './syntax';
import { Button, Select, TextInput } from '../../ui';
import './texteditor.css';

const MODE_LABEL: Record<SyntaxMode, string> = {
  python: 'Python',
  pml: 'PML',
  plain: 'Plain Text',
};

/** What the status bar says about where bytes go. `probing` is not a guess. */
const ACCESS_LABEL: Record<AccessState, string> = {
  server: 'bridge fs',
  browser: 'browser fs',
  probing: 'probing…',
};

/**
 * The line the panel shows once the probe has run out of rounds.
 *
 * Named because {@link TextEditorPanel}'s re-check has to be able to TAKE IT
 * BACK: it is the only status this panel writes that a later fact can falsify.
 */
const NO_FILES_NOTICE =
  'this bridge serves no files (cmd.tenmol_files did not install) — ' +
  'the browser picker and download are the fallback; Open and Save ask again first';

/** Hosted window providing a text editor for pymolrc and other bridge-served files. */
export function TextEditorPanel({ spec }: { spec: DialogWindowSpec }) {
  const session = useSession();
  const [path, setPath] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [syntax, setSyntax] = useState<SyntaxMode>('plain');
  const [access, setAccess] = useState<AccessState>('probing');
  const [fontSize, setFontSize] = useState(12);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<null | (() => void)>(null);
  /** The other active rc files, when PyMOL loaded more than one. */
  const [choices, setChoices] = useState<readonly string[]>([]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  /**
   * The in-flight probe, so an action can WAIT for it instead of guessing.
   *
   * Ctrl+S half a second after the window opened is a completely ordinary
   * thing to do, and on a loaded host the probe is still in the air then. The
   * old panel read its `access` state — initialised to `'browser'` — and
   * downloaded the buffer to ~/Downloads, which is not what the user asked for
   * and not what the status line implied. Waiting costs one await and makes
   * the keystroke land where the settled answer says it should.
   */
  const probeRef = useRef<Promise<FileAccess> | null>(null);
  /** Mount lifetime. The effect's own `alive` flag is per-RUN, not per-panel. */
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const dirty = text !== saved;

  /* --------------------------------------------------------------- actions */

  /**
   * Where the bytes go, decided AT THE MOMENT OF THE ACTION.
   *
   * `probing` waits for the probe; that much is obvious. `browser` is the
   * interesting one, and it is PROVISIONAL rather than a verdict — this is the
   * half of the defect that no amount of extra probing reaches.
   * {@link probeServerFiles} is bounded on purpose, so on a slow enough host it
   * WILL run out of rounds; what turned that from a slow start into data going
   * to the wrong place was that the answer was permanent. `access` was written
   * once and every later Open and Save read it, so a window that lost the race
   * saved to ~/Downloads for the rest of its life — while `cmd.tenmol_files`
   * sat installed on the bridge, put there a second later by the app itself
   * (`FileDropTarget`'s `armPluginDialogs`, five attempts a second apart).
   * MEASURED with the bridge made to behave like the CI runner's software
   * rasteriser: the editor's probe started asking at ~2.4 s and that install
   * did not land until 4.775 s.
   *
   * So a `browser` answer costs one extra bootstrap-and-ask before the download
   * path is taken, and a success upgrades the whole panel — badge, status line,
   * Run button. A bridge that genuinely serves no files pays two round trips
   * per action and still gets the browser picker.
   */
  const whereTo = useCallback(async (): Promise<FileAccess> => {
    const settled = access === 'probing' ? ((await probeRef.current) ?? 'browser') : access;
    if (settled === 'server') return 'server';
    const recheck = probeServerFiles(session, {
      ...RECHECK,
      alive: () => mountedRef.current,
    }).then((ok): FileAccess => (ok ? 'server' : 'browser'));
    // Parked too, so a second click made while this one is in the air waits for
    // the same answer instead of starting a third bootstrap.
    probeRef.current = recheck;
    const now = await recheck;
    if (now === 'server' && mountedRef.current) {
      setAccess('server');
      setStatus((current) => (current === NO_FILES_NOTICE ? '' : current));
      setError((current) => (current.startsWith('cannot open ') ? '' : current));
    }
    return now;
  }, [access, session]);

  const doSaveAs = useCallback(async () => {
    setError('');
    if ((await whereTo()) === 'server') {
      const target = window.prompt('Save As…', path || 'untitled.pml');
      if (!target) return;
      try {
        await writeServerFile(session, target, text);
        setPath(target);
        setSaved(text);
        setStatus(`wrote ${target}`);
      } catch (e: unknown) {
        setError(messageOf(e));
      }
      return;
    }
    const name = downloadFile(path || 'untitled.pml', text);
    setSaved(text);
    setStatus(`downloaded ${name} (browser fallback — not written to the PyMOL host)`);
  }, [session, whereTo, path, text]);

  const doSave = useCallback(async () => {
    if (!path) {
      await doSaveAs();
      return;
    }
    setError('');
    if ((await whereTo()) === 'server') {
      try {
        await writeServerFile(session, path, text);
        setSaved(text);
        setStatus(`wrote ${path}`);
      } catch (e: unknown) {
        setError(messageOf(e));
      }
      return;
    }
    const name = downloadFile(path, text);
    setSaved(text);
    setStatus(`downloaded ${name} (browser fallback — not written to the PyMOL host)`);
  }, [session, whereTo, path, text, doSaveAs]);

  const load = useCallback((nextPath: string, nextText: string) => {
    setPath(nextPath);
    setText(nextText);
    setSaved(nextText);
    // `_open` picks the syntax from the extension (TextEditor.py:36-42).
    setSyntax(syntaxForFilename(nextPath));
    setStatus(nextPath ? editorTitle(nextPath) : '');
    setError('');
  }, []);

  /**
   * Open the file this window was asked for — `spec.arg`.
   *
   * THE WHOLE OF ROW 61's REMAINDER LIVED HERE. `dialogs/store.ts` has carried
   * an `arg` per window since it was written (it keys them `texteditor:<arg>`),
   * and this panel ignored it: every editor opened EMPTY. That is why
   * `features/files/menuHooks.ts` deliberately left `edit_pymolrc` unbound —
   * binding it would have shown a window titled `~/.pymolrc` that had not
   * loaded ~/.pymolrc.
   *
   * The probe runs first and in the SAME effect, not beside it: which access
   * path is live decides whether `arg` can be honoured at all, and two effects
   * racing meant a server read issued while `access` still said `browser`.
   *
   * Its promise is ALSO parked in `probeRef` before the first await, so a
   * toolbar click that arrives while it is still in the air waits for the
   * answer rather than taking the fallback (`whereTo`).
   */
  useEffect(() => {
    const wanted = spec.arg;
    let alive = true;
    const probe = probeServerFiles(session, { alive: () => alive }).then((ok): FileAccess =>
      ok ? 'server' : 'browser',
    );
    probeRef.current = probe;
    void (async () => {
      const settled = await probe;
      if (!alive) return;
      setAccess(settled);
      if (settled !== 'server') {
        setStatus(NO_FILES_NOTICE);
        // A window opened ON a path by another feature cannot fall back to the
        // browser picker: the picker cannot reach the PyMOL host's filesystem,
        // so pretending would show an empty buffer titled with a path it never
        // read. Say so instead.
        if (wanted) {
          setError(
            `cannot open ${wanted === PYMOLRC_ARG ? 'pymolrc' : wanted}: this bridge serves no ` +
              'files (cmd.tenmol_files is not installed)',
          );
        }
        return;
      }
      if (!wanted) return;
      try {
        // `@pymolrc` is a REQUEST, not a path — `openEditor.ts` explains why the
        // menu hook cannot resolve it itself.
        const target = wanted === PYMOLRC_ARG ? await resolvePymolrc(session) : null;
        if (!alive) return;
        const result = await openServerFile(session, target ? target.path : wanted);
        if (!alive) return;
        load(result.path, result.text);
        setChoices(target && target.candidates.length > 1 ? target.candidates : []);
        if (!result.exists) {
          // `_edit_pymolrc`'s "Create new pymolrc?" prompt (`TextEditor.py:176`)
          // without the modal: the buffer is aimed at the path and Save creates it.
          setStatus(`${result.path} does not exist yet — Save will create it`);
        } else if (target && target.candidates.length > 1) {
          setStatus(`${result.path} — ${target.candidates.length} active pymolrc files`);
        }
      } catch (error: unknown) {
        if (alive) setError(messageOf(error));
      }
    })();
    return () => {
      alive = false;
    };
  }, [session, spec.arg, load]);

  const doOpen = useCallback(async () => {
    setError('');
    if ((await whereTo()) === 'server') {
      const target = window.prompt('Open file', path || '');
      if (!target) return;
      try {
        const result = await readServerFile(session, target);
        load(result.path, result.text);
      } catch (e: unknown) {
        setError(messageOf(e));
      }
      return;
    }
    const picked = await pickBrowserFile();
    if (picked) load(picked.path, picked.text);
  }, [session, whereTo, path, load]);

  /**
   * `check_ask_save` (`TextEditor.py:120-135`). Yes saves and continues, No
   * continues, Cancel aborts — and it guards BOTH open and close.
   */
  const guard = useCallback(
    (proceed: () => void) => {
      if (!dirty) {
        proceed();
        return;
      }
      setPending(() => proceed);
    },
    [dirty],
  );

  /* ------------------------------------------------------------- shortcuts */

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'o') {
      event.preventDefault();
      guard(() => void doOpen());
    } else if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) void doSaveAs();
      else void doSave();
    }
  };

  /* --------------------------------------------------------------- render */

  const lines = useMemo(() => highlight(text, syntax), [text, syntax]);

  const syncScroll = () => {
    if (areaRef.current && preRef.current) {
      preRef.current.scrollTop = areaRef.current.scrollTop;
      preRef.current.scrollLeft = areaRef.current.scrollLeft;
    }
  };

  return (
    <DialogWindow spec={{ ...spec, title: path ? editorTitle(path) : spec.title }}>
      <div className="txted modern:bg-pm-panel modern:text-pm-text" onKeyDown={onKeyDown}>
        <div className="txted__menu modern:border-b modern:border-line modern:pb-1">
          <span className="txted__menu-label modern:text-pm-text-dim">File</span>
          <Button
            variant="bare"
            type="button"
            data-txted-open=""
            onClick={() => guard(() => void doOpen())}
          >
            Open <kbd className="modern:border-line">Ctrl+O</kbd>
          </Button>
          <Button variant="bare" type="button" data-txted-save="" onClick={() => void doSave()}>
            Save <kbd className="modern:border-line">Ctrl+S</kbd>
          </Button>
          <Button variant="bare" type="button" data-txted-saveas="" onClick={() => void doSaveAs()}>
            Save as … <kbd className="modern:border-line">Ctrl+Shift+S</kbd>
          </Button>
          <span className="txted__sep modern:bg-line" />
          <span className="txted__menu-label modern:text-pm-text-dim">Syntax</span>
          {SYNTAX_MODES.map((mode) => (
            <label key={mode} className="txted__radio">
              <input
                type="radio"
                name={`syntax-${spec.key}`}
                data-txted-syntax={mode}
                checked={syntax === mode}
                onChange={() => setSyntax(mode)}
              />
              {MODE_LABEL[mode]}
            </label>
          ))}
          <span className="txted__sep modern:bg-line" />
          <label className="txted__radio" title="Select Font… (the Qt context-menu entry)">
            Font
            <TextInput
              type="number"
              data-txted-font=""
              min={8}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Math.min(24, Math.max(8, Number(e.target.value) || 12)))}
            />
          </label>
          <Button
            variant="bare"
            type="button"
            data-txted-run=""
            disabled={!path || access !== 'server'}
            title="cmd.run(path) for .py, cmd.do('@path') otherwise"
            onClick={() => void runScript(session, path).catch((e) => setError(messageOf(e)))}
          >
            Run
          </Button>
        </div>

        <div className="txted__bar">
          <span className="txted__path" data-txted-path={path}>
            {path || '(unsaved)'}
          </span>
          {dirty && (
            <span className="txted__dirty" data-txted-dirty="">
              • modified
            </span>
          )}
          <span className="txted__spacer" />
          {/*
           * `data-txted-access` is the machine-readable half: 'probing' is a
           * real, transient value and anything watching this badge has to be
           * able to tell it apart from a settled answer without matching on
           * an ellipsis. The e2e spec waits on exactly this.
           */}
          <span className="txted__access modern:text-pm-text-dim" data-txted-access={access}>
            {ACCESS_LABEL[access]}
          </span>
        </div>

        {error && <div className="txted__error modern:text-danger">{error}</div>}
        {!error && status && (
          <div className="txted__status modern:text-pm-text-dim">{status}</div>
        )}
        {/*
         * pymolrc is read ONCE, at startup (`invocation.get_user_config()` is
         * consumed before the GUI exists), so editing it changes nothing in
         * the running session. Qt does not say this and the inventory row
         * asks for it: a file you edit and save, that visibly does nothing,
         * reads as a broken editor.
         */}
        {isPymolrc(path) && (
          <div
            className="txted__note modern:border-line modern:bg-pm-panel-alt modern:text-pm-text-dim"
            role="note"
          >
            pymolrc is read at startup — restart PyMOL to apply, or paste the lines into the command
            line to try them now.
          </div>
        )}
        {/*
         * `edit_pymolrc`'s `QInputDialog.getItem` (`TextEditor.py:161-165`):
         * with two or more active rc files Qt ASKS which one. A modal before
         * the window exists is the wrong shape here — the window is already
         * open on the first file — so the same choice is a control inside it.
         */}
        {choices.length > 1 && (
          <div
            className="txted__note modern:border-line modern:bg-pm-panel-alt modern:text-pm-text-dim"
            role="note"
          >
            <label>
              Active pymolrc files:{' '}
              <Select
                data-txted-pymolrc=""
                value={path}
                onChange={(e) => {
                  const next = e.target.value;
                  guard(() => {
                    void openServerFile(session, next)
                      .then((result) => load(result.path, result.text))
                      .catch((error: unknown) => setError(messageOf(error)));
                  });
                }}
              >
                {choices.map((file) => (
                  <option key={file} value={file}>
                    {file}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}

        <div className="txted__editor" style={{ fontSize }}>
          <pre className="txted__pre" ref={preRef} aria-hidden="true">
            {lines.map((tokens, i) => (
              <div className="txted__line" key={i}>
                {tokens.length === 0
                  ? '​'
                  : tokens.map((token, j) => (
                      <span className={`tok tok--${token.kind}`} key={j}>
                        {token.text}
                      </span>
                    ))}
              </div>
            ))}
          </pre>
          <textarea
            ref={areaRef}
            className="txted__area"
            data-txted-area=""
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onScroll={syncScroll}
          />
        </div>
      </div>

      {pending && (
        <ConfirmPrompt
          title="Save?"
          message="Save changes?"
          onDone={(answer) => {
            const proceed = pending;
            setPending(null);
            if (answer === 'cancel') return;
            if (answer === 'yes') {
              void doSave().then(() => proceed());
              return;
            }
            proceed();
          }}
        />
      )}
    </DialogWindow>
  );
}

/** The kinds this slot hosts when the `dialogs` slot is not mounted. */
const HOSTS = ['texteditor'] as const;

/** Slot panel. */
export function TextEditorSlot() {
  const windows = useHostedWindows(HOSTS);
  return (
    <>
      {windows.map((w) => (
        <TextEditorPanel key={w.key} spec={w} />
      ))}
    </>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
