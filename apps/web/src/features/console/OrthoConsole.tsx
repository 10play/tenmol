/**
 * PyMOL's OTHER console — the one it draws inside the GL viewport.
 *
 * `OrthoDrawText` (`layer1/Ortho.cpp:1623-1693`) paints the tail of a 256-line
 * ring bottom-left over the scene, with a black band behind the
 * `internal_feedback` lines (`OrthoDrawInternalFeedbackBG`, `:1506-1540`) and
 * a `_` cursor on the input line. This component is that, in DOM, portalled on
 * top of `.shell__viewport` so it sits over whichever render mode is running
 * (Mode P pixels or the Mode G three.js canvas) without either feature knowing.
 *
 * ---------------------------------------------------------------------------
 * WHY IT CAN BE INVISIBLE, AND WHY THAT IS NOT A BUG.
 *
 * `showLines = internal_feedback + numOverlayLines` when `text` is off
 * (`:1637-1642`), so with all three of `internal_feedback`, `text` and
 * `overlay` at 0 PyMOL itself draws NOTHING here. That is exactly what a stock
 * PyMOL looks like after `set internal_feedback, 0`.
 *
 * The bridge FORCES `internal_feedback = 0` at startup
 * (`bridge/tenmol_bridge/engine.py:129-130`, `:175-183`) because
 * `OrthoReshape` subtracts the feedback band from the scene rectangle and the
 * web client needs `cmd.get_viewport()` to equal its canvas. So the raw value
 * read back from PyMOL is a statement about the BRIDGE's geometry, not about
 * what the user asked for; `consoleSource.ts` therefore ignores the FIRST
 * sample of that one setting and adopts every later change. `set
 * internal_feedback, 3` from the command line works; the boot-time 0 does not
 * silently hide the console.
 * ---------------------------------------------------------------------------
 *
 * KEYS. The whole `OrthoKey` / `OrthoSpecial` switch is in `./orthoKeys.ts`;
 * this component only performs the actions. It captures keys only while
 * focused — click the band to focus, click anywhere else to give them back —
 * because global key capture belongs to WP-23, and two features fighting over
 * `keydown` on `window` is how a viewport stops rotating.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ORTHO_BOTTOM_MARGIN,
  ORTHO_LINE_HEIGHT,
  ORTHO_PROMPT,
  ansiColorCss,
  parseAnsi,
  stripAnsiEscapes,
} from '@tenmol/protocol/topics/console';
import {
  backspace,
  caretIndex,
  cursorLeft,
  cursorRight,
  deleteForward,
  end,
  home,
  insertChar,
  orthoLineColor,
  textVisible,
  truncate,
  visibleOrthoLines,
  type ConsoleSettings,
  type ConsoleState,
} from '@tenmol/stores/console';
import { errorText, useSession, useStoreState } from '../../app';
import { getConsoleSource } from './consoleSource';
import { mapOrthoKey, movieKeyframeCommand, type OrthoAction } from './orthoKeys';

/** `cmd._parser.complete` — granted by `policy/grants/wp-11-console.py`. */
const COMPLETE_FN = 'cmd._parser.complete';

/** `cOrthoBottomSceneMargin` (`layer1/Ortho.h:25`) — the band's extra height. */
const BOTTOM_SCENE_MARGIN = 18;

export function OrthoConsole() {
  const source = getConsoleSource();
  const store = source.store;
  const state = useStoreState(store);
  const [host, setHost] = useState<HTMLElement | null>(null);

  /* The portal target: the viewport region of the shell grid. Looked up rather
   * than passed, because `AppShell` belongs to WP-08 and the registry gives a
   * feature no way to nominate a second region. */
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.shell__viewport'));
  }, []);

  /* `I->ShowLines = height / cOrthoLineHeight` (`layer1/Ortho.cpp:2380`). */
  useLayoutEffect(() => {
    if (!host) return;
    const measure = () => store.setShowLines(host.clientHeight / ORTHO_LINE_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host, store]);

  const perform = useOrthoActions();

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const action = mapOrthoKey(event, store.get());
      if (action.kind === 'none') return;
      event.preventDefault();
      event.stopPropagation();
      void perform(action);
    },
    [perform, store],
  );

  if (!host || !state.visible) return null;

  const lines = visibleOrthoLines(state);
  const feedback = state.settings.internal_feedback;
  // `sceneBottom = textBottom + (internal_feedback - 1) * cOrthoLineHeight +
  //  cOrthoBottomSceneMargin` (`layer1/Ortho.cpp:2385-2389`); the band is drawn
  // from 0 to that height (`:1517-1520`).
  const bandHeight = feedback > 0 ? (feedback - 1) * ORTHO_LINE_HEIGHT + BOTTOM_SCENE_MARGIN : 0;
  // `OverlayColor = 1 - bg_rgb` (`layer1/Ortho.cpp:1876-1880`). The viewport
  // background is black here (`--pm-bg-viewport`), so the overlay colour is
  // white and `length3f(OverlayColor) < 0.5` is false. Honouring a user-set
  // `bg_rgb` needs the colour table, which is WP-22's store.
  const overlayIsDark = false;

  return createPortal(
    <div
      className="ortho"
      data-testid="ortho-console"
      tabIndex={0}
      role="textbox"
      aria-label="PyMOL in-viewport command prompt"
      aria-multiline="true"
      style={{ paddingBottom: ORTHO_BOTTOM_MARGIN }}
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        // `case 22` routes a non-empty line to `cmd.paste()`
        // (`layer1/Ortho.cpp:1013-1024`). In a browser the clipboard text is
        // right here in the event, so this IS that paste; the empty-line case
        // is the `CTRL-V` chord and never produces an onPaste, because
        // `orthoKeys` preventDefaults it.
        const text = event.clipboardData.getData('text/plain');
        if (!text) return;
        event.preventDefault();
        let line = store.get().line;
        for (const ch of text.replace(/[\r\n]+/g, ' ')) line = insertChar(line, ch);
        store.setLine(line);
      }}
      onMouseDown={() => {
        // `OrthoButton` (`layer1/Ortho.cpp:2523-2524`).
        store.removeSplash();
        store.removeAutoOverlay();
      }}
    >
      {bandHeight > 0 && (
        <div className="ortho__band" style={{ height: bandHeight }} aria-hidden="true" />
      )}
      <div className="ortho__lines">
        {[...lines].reverse().map((line) => {
          const colour = orthoLineColor(line, state.settings, overlayIsDark);
          return (
            <div
              key={`${line.seq}:${line.lcount}`}
              className={`ortho__line ortho__line--${colour}${line.gapAbove ? ' is-gap' : ''}`}
            >
              <OrthoText
                text={line.text}
                colored={state.settings.colored_feedback > 0}
                cursorAt={line.isInput ? ORTHO_PROMPT.length + caretIndex(state.line) : -1}
              />
            </div>
          );
        })}
      </div>
      {lines.length === 0 && <HiddenNote settings={state.settings} />}
    </div>,
    host,
  );
}

/**
 * One drawn line. Renders ANSI as styled runs when `colored_feedback` is on
 * (the escapes survive `OrthoFeedbackOut`, `layer1/Ortho.cpp:1148-1150`) and
 * strips them exactly like `UtilStripANSIEscapes` when it is off — the second
 * case is belt and braces, since PyMOL already stripped them.
 *
 * `cursorAt` draws PyMOL's `_` (`:1676-1684`) at the same column the GLUT build
 * puts it in: on top of the character under the cursor, or after the last one.
 */
function OrthoText({
  text,
  colored,
  cursorAt,
}: {
  text: string;
  colored: boolean;
  cursorAt: number;
}) {
  if (cursorAt >= 0) {
    const clean = stripAnsiEscapes(text);
    const at = Math.min(cursorAt, clean.length);
    return (
      <>
        <span>{clean.slice(0, at)}</span>
        <span className="ortho__caret">{clean[at] ?? '_'}</span>
        <span>{clean.slice(at + 1)}</span>
      </>
    );
  }
  if (!colored) return <>{stripAnsiEscapes(text) || ' '}</>;
  return (
    <>
      {parseAnsi(text).map((span, i) => (
        <span
          key={i}
          style={{
            color: span.fg === null ? undefined : (ansiColorCss(span.fg) ?? undefined),
            background: span.bg === null ? undefined : (ansiColorCss(span.bg) ?? undefined),
            fontWeight: span.bold ? 700 : undefined,
            opacity: span.dim ? 0.6 : undefined,
            fontStyle: span.italic ? 'italic' : undefined,
            textDecoration: span.underline ? 'underline' : undefined,
            filter: span.inverse ? 'invert(1)' : undefined,
          }}
        >
          {span.text}
        </span>
      ))}
    </>
  );
}

/** Says WHY nothing is drawn, instead of leaving an invisible dead widget. */
function HiddenNote({ settings }: { settings: ConsoleSettings }) {
  if (textVisible(settings)) return null;
  return (
    <div className="ortho__hidden" title="layer1/Ortho.cpp:1637-1642">
      in-viewport console hidden — internal_feedback, text and overlay are all 0
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function useOrthoActions() {
  const session = useSession();
  const source = getConsoleSource();
  const store = source.store;
  const completing = useRef(false);

  return useCallback(
    async (action: OrthoAction): Promise<void> => {
      const snapshot: ConsoleState = store.get();
      const line = snapshot.line;
      const settings = snapshot.settings;

      switch (action.kind) {
        case 'insert':
          store.setLine(insertChar(line, action.ch));
          return;
        case 'backspace':
          store.setLine(backspace(line));
          return;
        case 'deleteForward':
          store.setLine(deleteForward(line));
          return;
        case 'home':
          store.setLine(home(line));
          return;
        case 'end':
          store.setLine(end(line));
          return;
        case 'truncate':
          store.setLine(truncate(line));
          return;
        case 'left':
          store.setLine(cursorLeft(line));
          return;
        case 'right':
          store.setLine(cursorRight(line));
          return;
        case 'historyBack':
          store.historyBack();
          return;
        case 'historyForward':
          store.historyForward();
          return;

        case 'submit': {
          const text = store.submit();
          if (text === '') return;
          // `OrthoParseCurrentLine` (`:1035-1059`) pushes history, PLogs
          // everything except `quit`, then PParses. `session.run` is the
          // `{t:'do'}` path, which is what PLog + PParse amounts to here.
          await session.run(text);
          void source.refreshSettings();
          return;
        }

        case 'complete':
        case 'completePrint': {
          if (completing.current) return;
          completing.current = true;
          try {
            const completed = await session.call<string | null>(COMPLETE_FN, [line.text]);
            // Ctrl-D is "just print, don't complete" (`layer1/Ortho.cpp:924-930`):
            // the candidate list is a side effect on the feedback queue and the
            // return value is deliberately dropped.
            if (action.kind === 'completePrint') return;
            if (typeof completed !== 'string' || completed === '') return;
            if (store.get().line.text !== line.text) return; // the user typed on
            store.setLine({ text: completed, cursor: -1 });
          } catch (error) {
            session.stores.feedback.appendClient(` ${errorText(error)}`, 'error');
          } finally {
            completing.current = false;
          }
          return;
        }

        case 'paste':
          // Reached only if the browser produced no clipboard event; ask
          // PyMOL, exactly as `case 22` does.
          await session.call('cmd.paste').catch(() => undefined);
          return;

        case 'command':
          await session.run(action.line);
          void source.refreshSettings();
          return;

        case 'movieKeyframe': {
          // `MovieGetLength(G)` guards the whole branch (`:966`).
          const frames = await session.call<number>('cmd.count_frames').catch(() => 0);
          if (!frames) return;
          await session.run(movieKeyframeCommand(action, settings));
          return;
        }

        case 'escape': {
          if (settings.presentation && !action.shift) {
            // `PParse(G, "_quit")` (`:957`). The bridge ROUTES quit to its own
            // shutdown instead of the C `exit()` path (`policy/base.py` ROUTED).
            await session.call('quit').catch(() => undefined);
            return;
          }
          if (snapshot.splash) {
            store.removeSplash();
            return;
          }
          const name = action.shift ? 'overlay' : 'text';
          const next = settings[name] ? 0 : 1;
          // `SettingSetGlobal_*` is silent, so this is `cmd.set`, not `do`.
          await session.call('cmd.set', [name, next]).catch(() => undefined);
          store.setSettings({ [name]: next });
          return;
        }

        case 'chord': {
          // `OrthoKeyControl` / `OrthoKeyAlt` / `OrthoKeyCtSh` PLog + PParse
          // `cmd._ctrl(chr(N))` (`layer1/Ortho.cpp:760-820`). All three symbols
          // are explicitly reachable (`policy/base.py` DEFAULT_PRIVATE).
          await session.call(`cmd.${action.fn}`, [action.key]).catch((error: unknown) => {
            session.stores.feedback.appendClient(` ${errorText(error)}`, 'error');
          });
          void source.refreshSettings();
          return;
        }

        case 'none':
          return;
      }
    },
    [session, source, store],
  );
}
