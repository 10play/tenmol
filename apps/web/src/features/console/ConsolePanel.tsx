/**
 * The External GUI: output pane + command line + quick buttons.
 *
 * `modules/pmg_qt/pymol_qt_gui.py:118-284` — a dock widget holding a
 * `QPlainTextEdit`, a `QLabel("PyMOL>")` + `CommandLineEdit`, and a 4-row grid
 * of quick buttons with a progress row.
 *
 * It also mounts {@link OrthoConsole}, which is NOT part of this dock: it is
 * PyMOL's own in-viewport console (`layer1/Ortho.cpp:1623-1693`), portalled
 * over `.shell__viewport`. Both consoles exist in the Qt build at the same
 * time, reading the same 256-line ring, and they are mounted together here
 * because the slot registry gives one feature exactly one region.
 */

import { useEffect, useState } from 'react';
import { useSession, useStore } from '../../app';
import { BusyOverlay } from './BusyOverlay';
import { CommandLine } from './CommandLine';
import { FeedbackLog } from './FeedbackLog';
import { OrthoConsole } from './OrthoConsole';
import { OrthoLoopRect } from './OrthoLoopRect';
import { QuickButtons } from './QuickButtons';
import { getConsoleSource } from './consoleSource';
import { showSplash } from './orthoOverlays';
import './console.css';

/**
 * `getMonospaceFont()` (`modules/pmg_qt/pymol_qt_gui.py:53-63`) picks Monaco on
 * macOS, Consolas on Windows and "Monospace" elsewhere, and the output pane has
 * a `Select Font...` context-menu entry (`:963-975`). A browser cannot
 * enumerate installed fonts, so the choice is offered as the same three
 * families plus the CSS generic.
 */
const FONTS: readonly { label: string; css: string }[] = [
  { label: 'default', css: 'var(--pm-font-mono)' },
  { label: 'Monaco', css: 'Monaco, monospace' },
  { label: 'Consolas', css: 'Consolas, monospace' },
  { label: 'Menlo', css: 'Menlo, monospace' },
  { label: 'monospace', css: 'monospace' },
];

export function ConsolePanel() {
  const session = useSession();
  const source = getConsoleSource();
  const ui = session.stores.ui;
  const follow = useStore(ui, (s) => s.followOutput);
  const fontSize = useStore(ui, (s) => s.consoleFontSize);
  const lineCount = useStore(session.stores.feedback, (s) => s.lines.length);
  const orthoVisible = useStore(source.store, (s) => s.visible);
  const orthoLines = useStore(source.store, (s) => s.lines.length);
  const [font, setFont] = useState(FONTS[0]?.css ?? 'var(--pm-font-mono)');

  // The eight console settings have no push feed yet (see consoleSource.ts);
  // read them as soon as this panel exists rather than waiting for the tick.
  useEffect(() => {
    void source.refreshSettings();
  }, [source]);

  return (
    <>
      {/* The font choice is scoped to this dock, not to `:root`: Qt's
          `Select Font...` is a context-menu entry on `feedback_browser` alone
          (`pymol_qt_gui.py:963-975`), and the in-viewport console draws in
          PyMOL's own bitmap font whatever this says. */}
      <div className="extgui__console" style={{ ['--pm-font-mono' as string]: font }}>
        <div className="console__bar">
          <span className="console__bar-title">Output</span>
          <span className="console__bar-count" title="ortho ring: 256 lines (layer1/Ortho.cpp:62)">
            {lineCount} lines · ortho {orthoLines}/256
          </span>
          <span className="console__bar-spacer" />
          <button
            type="button"
            className={`console__bar-btn${orthoVisible ? ' is-on' : ''}`}
            title="draw PyMOL's in-viewport console over the scene (layer1/Ortho.cpp:1623)"
            onClick={() => source.store.setVisible(!orthoVisible)}
          >
            ortho
          </button>
          <button
            type="button"
            className={`console__bar-btn${follow ? ' is-on' : ''}`}
            title="follow new output when already scrolled to the bottom"
            onClick={() => ui.set({ followOutput: !follow })}
          >
            follow
          </button>
          <select
            className="console__bar-font"
            title="Select Font... (pymol_qt_gui.py:963-975 — getMonospaceFont)"
            value={font}
            onChange={(e) => setFont(e.target.value)}
          >
            {FONTS.map((choice) => (
              <option key={choice.label} value={choice.css}>
                {choice.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="console__bar-btn"
            title="font size"
            onClick={() => ui.set({ consoleFontSize: Math.max(9, fontSize - 0.5) })}
          >
            A-
          </button>
          <button
            type="button"
            className="console__bar-btn"
            title="font size"
            onClick={() => ui.set({ consoleFontSize: Math.min(20, fontSize + 0.5) })}
          >
            A+
          </button>
          <button
            type="button"
            className="console__bar-btn"
            title="clear the client scrollback (PyMOL keeps none of its own)"
            onClick={() => {
              session.stores.feedback.clear();
              source.store.clear();
            }}
          >
            clear
          </button>
          {/* The splash, made reachable. `OrthoInit` raises `SplashFlag` only
              when it is given `showSplash` (`layer1/Ortho.cpp:2729-2731`) and
              the bridge boots with `options.show_splash = 0`
              (`engine.py:132`, measured in `test_wf_ortho.py`), so a browser
              never inherits one. `cmd.splash(0)` runs the real `OrthoSplash`
              and the banner arrives as ordinary feedback; raising the store's
              flag then reproduces what the flag DOES — force the whole
              scrollback visible over the scene until the first click or Esc
              (`:1638`, `:967`, `:2523`). */}
          <button
            type="button"
            className="console__bar-btn"
            title="cmd.splash(0) — show PyMOL's banner over the viewport (click or Esc to dismiss)"
            onClick={() => showSplash((fn, args) => session.call(fn, args), source.store)}
          >
            splash
          </button>
        </div>
        <FeedbackLog />
        <CommandLine />
      </div>
      <QuickButtons />
      <OrthoConsole />
      <BusyOverlay />
      <OrthoLoopRect />
    </>
  );
}
