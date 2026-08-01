/**
 * The Text Editor — `modules/pmg_qt/TextEditor.py:18-195`.
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
  downloadFile,
  pickBrowserFile,
  probeServerFiles,
  readServerFile,
  runScript,
  writeServerFile,
  type FileAccess,
} from './files';
import { editorTitle, highlight, syntaxForFilename } from './syntax';
import './texteditor.css';

const MODE_LABEL: Record<SyntaxMode, string> = {
  python: 'Python',
  pml: 'PML',
  plain: 'Plain Text',
};

export function TextEditorPanel({ spec }: { spec: DialogWindowSpec }) {
  const session = useSession();
  const [path, setPath] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [syntax, setSyntax] = useState<SyntaxMode>('plain');
  const [access, setAccess] = useState<FileAccess>('browser');
  const [fontSize, setFontSize] = useState(12);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<null | (() => void)>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const dirty = text !== saved;

  useEffect(() => {
    void probeServerFiles(session).then((ok) => {
      setAccess(ok ? 'server' : 'browser');
      if (!ok) {
        setStatus(
          'no bridge file endpoints (_bridge.read_text_file / _bridge.write_text_file) — ' +
            'using the browser picker and download',
        );
      }
    });
  }, [session]);

  /* --------------------------------------------------------------- actions */

  const doSaveAs = useCallback(async () => {
    setError('');
    if (access === 'server') {
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
  }, [session, access, path, text]);

  const doSave = useCallback(async () => {
    if (!path) {
      await doSaveAs();
      return;
    }
    setError('');
    if (access === 'server') {
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
  }, [session, access, path, text, doSaveAs]);

  const load = useCallback((nextPath: string, nextText: string) => {
    setPath(nextPath);
    setText(nextText);
    setSaved(nextText);
    // `_open` picks the syntax from the extension (TextEditor.py:36-42).
    setSyntax(syntaxForFilename(nextPath));
    setStatus(nextPath ? editorTitle(nextPath) : '');
    setError('');
  }, []);

  const doOpen = useCallback(async () => {
    setError('');
    if (access === 'server') {
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
  }, [session, access, path, load]);

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
      <div className="txted" onKeyDown={onKeyDown}>
        <div className="txted__menu">
          <span className="txted__menu-label">File</span>
          <button type="button" data-txted-open="" onClick={() => guard(() => void doOpen())}>
            Open <kbd>Ctrl+O</kbd>
          </button>
          <button type="button" data-txted-save="" onClick={() => void doSave()}>
            Save <kbd>Ctrl+S</kbd>
          </button>
          <button type="button" data-txted-saveas="" onClick={() => void doSaveAs()}>
            Save as … <kbd>Ctrl+Shift+S</kbd>
          </button>
          <span className="txted__sep" />
          <span className="txted__menu-label">Syntax</span>
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
          <span className="txted__sep" />
          <label className="txted__radio" title="Select Font… (the Qt context-menu entry)">
            Font
            <input
              type="number"
              data-txted-font=""
              min={8}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Math.min(24, Math.max(8, Number(e.target.value) || 12)))}
            />
          </label>
          <button
            type="button"
            data-txted-run=""
            disabled={!path || access !== 'server'}
            title="cmd.run(path) for .py, cmd.do('@path') otherwise"
            onClick={() => void runScript(session, path).catch((e) => setError(messageOf(e)))}
          >
            Run
          </button>
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
          <span className="txted__access">{access === 'server' ? 'bridge fs' : 'browser fs'}</span>
        </div>

        {error && <div className="txted__error">{error}</div>}
        {!error && status && <div className="txted__status">{status}</div>}

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
