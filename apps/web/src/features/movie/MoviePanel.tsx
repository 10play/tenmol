/**
 * Slot `movie`, region `internal-gui`. Plan §6 WP-20.
 *
 * Everything PyMOL's movie surface does, as DOM:
 *   the nine-button control bar (`packages/engine/layer1/Control.cpp:288`)
 *   the frame scrollbar and the frame/state readout
 *   the movie panel / timeline (`packages/engine/layer1/Movie.cpp:1488`)
 *   the Movie menu (`_gui.py:234`)
 *   mset / mdo / mview / mmove editors
 *   rock + sweep settings (`packages/engine/layer1/Control.cpp:415`)
 *   export (`cmd.mpng`, `cmd.movie.produce`)
 *
 * THE CLIENT NEVER ADVANCES A FRAME. Every number below is read back from
 * `cmd.get_movie_status()`; play/stop are `cmd.mplay`/`cmd.mstop` and the
 * frame you see is the frame PyMOL is on.
 */

import { useEffect, useState } from 'react';
import { useSession } from '../../app';
import { useMovie } from './useMovie';
import { TransportBar } from './TransportBar';
import { MovieTimeline } from './MovieTimeline';
import { MovieEditors } from './MovieEditors';
import { MovieMenu, MotionMenu } from './MenuViews';
import { ExportDialog } from './ExportDialog';
import { cameraMotionMenu, objectMotionMenu, type MotionItem } from './motionMenu';
import { beginProgram, MVPRG_INITIAL, removeLastProgram, type MvprgState } from './mvprg';
import { camera, transport } from './movieSource';
import './movie.css';

type Tab = 'timeline' | 'edit' | 'menu' | 'sweep';

interface Popup {
  items: MotionItem[];
  at: { x: number; y: number };
}

export function MoviePanel() {
  const session = useSession();
  const { status, panel, source, error, run, runLine, refreshPanel } = useMovie();
  const [tab, setTab] = useState<Tab>('timeline');
  const [mvprg, setMvprg] = useState<MvprgState>(MVPRG_INITIAL);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [exporting, setExporting] = useState(false);
  const [scenes, setScenes] = useState<string[]>([]);
  const [viewText, setViewText] = useState('');

  const objects = (panel?.rows ?? []).map((row) => row.object).filter(Boolean);

  useEffect(() => {
    let alive = true;
    void source.scenes().then((payload) => {
      if (alive) setScenes(payload.order);
    });
    return () => {
      alive = false;
    };
  }, [source, status.sceneCurrent]);

  const setSetting = (name: string, value: number) =>
    void session
      .act({
        fn: 'cmd.set',
        args: [name, value],
        kwargs: {},
        echo: `cmd.set('${name}', ${value})`,
      })
      .then(() => void refreshPanel());

  const openProgram = async (template: string) => {
    const { state, command } = beginProgram(template, status.length);
    setMvprg(state);
    await runLine(command);
  };

  const updateProgram = async () => {
    if (!mvprg.movieCommand) return;
    await runLine(mvprg.movieCommand);
  };

  const removeProgram = async () => {
    const args = removeLastProgram(mvprg);
    if (!args) return;
    await run({
      fn: 'cmd.mdelete',
      args: [args.count, args.frame],
      echo: `cmd.mdelete(${args.count}, ${args.frame})`,
      invalidatesPanel: true,
    });
  };

  const openMotionMenu = async (frame: number, object: string, at: { x: number; y: number }) => {
    const selector = object ? `%${object}` : '';
    let nStates = 1;
    try {
      nStates = await session.call<number>('cmd.count_states', [selector]);
    } catch {
      nStates = 1;
    }
    // `menu.py` passes the 0-based frame straight into `mview first=`.
    const zero = String(frame - 1);
    setPopup({
      items: object
        ? objectMotionMenu(object, nStates, zero)
        : cameraMotionMenu(scenes, nStates, zero),
      at,
    });
  };

  const getView = async () => {
    const text = await session.call<string>('cmd.get_view', [3], { quiet: 1 });
    setViewText(String(text));
    session.stores.feedback.appendClient(String(text));
  };

  const setView = async () => {
    const numbers = viewText
      .replace(/[^-0-9.eE+]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (numbers.length < 18) {
      session.stores.feedback.appendClient(
        ` set_view needs exactly 18 floats, got ${numbers.length}`,
        'error',
      );
      return;
    }
    await run(camera.setView(numbers.slice(0, 18), 0));
  };

  const nframes = status.nframes;

  return (
    <div className="mvpanel">
      <div className="mvpanel__head">
        <span className="mvpanel__title">Movie</span>
        <span className="mvpanel__clock">
          frame {status.frame}/{nframes || 0} · state {status.state}
          {status.fps ? ` · ${status.fps} fps` : ''}
          {status.locked ? ' · LOCKED' : ''}
        </span>
        <span className="mvpanel__spacer" />
        <button type="button" className="mvpanel__tabbtn" onClick={() => setExporting(true)}>
          export
        </button>
      </div>

      {error && <div className="mvpanel__error">{error}</div>}
      {!source.ready && source.lastError && (
        <div className="mvpanel__error">
          movie panel endpoint unavailable ({source.lastError}) — transport still works
        </div>
      )}

      <TransportBar
        status={status}
        run={run}
        onLog={(line) => session.stores.feedback.appendClient(line)}
      />

      <div className="mvpanel__seek">
        <input
          type="range"
          className="mvpanel__range"
          min={1}
          max={Math.max(1, nframes)}
          value={Math.min(status.frame, Math.max(1, nframes))}
          disabled={nframes < 1}
          aria-label="movie frame"
          onChange={(event) => void run(transport.seek(Number(event.target.value)))}
        />
      </div>

      <nav className="mvpanel__tabs">
        {(['timeline', 'edit', 'menu', 'sweep'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            className={`mvpanel__tabbtn${tab === name ? ' is-on' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>

      <div className="mvpanel__body">
        {tab === 'timeline' && (
          <MovieTimeline
            panel={panel}
            frame={status.frame}
            run={run}
            onSelectFrame={(frame) => void run(transport.frame(frame))}
            onContextMenu={(frame, object, at) => void openMotionMenu(frame, object, at)}
          />
        )}

        {tab === 'edit' && (
          <MovieEditors
            panel={panel}
            frame={status.frame}
            state={status.state}
            objects={objects}
            run={run}
          />
        )}

        {tab === 'menu' && (
          <MovieMenu
            settings={status.settings}
            onCommand={(line) => void runLine(line)}
            onCall={(fn, args) =>
              void run({ fn: `cmd.${fn}`, args, echo: `cmd.${fn}(${args.join(', ')})`, invalidatesPanel: true })
            }
            onProgram={(template) => void openProgram(template)}
            onProgramUpdate={() => void updateProgram()}
            onProgramRemove={() => void removeProgram()}
            onSetting={setSetting}
          />
        )}

        {tab === 'sweep' && (
          <div className="mvedit">
            <section className="mvedit__block">
              <header className="mvedit__head">rock / spin / nutate — ControlRock</header>
              <div className="mvedit__row mvedit__row--wrap">
                <button type="button" onClick={() => void run(transport.rock(status.rocking ? 0 : 1))}>
                  {status.rocking ? 'stop rocking' : 'start rocking'}
                </button>
                {(
                  [
                    ['Y-rock', 0],
                    ['X-rock', 1],
                    ['Z-rock', 2],
                    ['nutate', 3],
                  ] as const
                ).map(([label, mode]) => (
                  <button
                    key={label}
                    type="button"
                    className={status.settings.sweep_mode === mode ? 'is-on' : ''}
                    onClick={() => setSetting('sweep_mode', mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mvedit__row mvedit__row--wrap">
                <span className="mvedit__note">
                  sweep_angle {status.settings.sweep_angle ?? '?'} · sweep_speed{' '}
                  {status.settings.sweep_speed ?? '?'} · rock_delay {status.settings.rock_delay ?? '?'}
                  {status.settings.sweep_angle !== null &&
                  (status.settings.sweep_angle ?? 1) <= 0
                    ? ' · angle<=0 degenerates into a continuous spin'
                    : ''}
                </span>
              </div>
              <div className="mvedit__row mvedit__row--wrap">
                {[10, 30, 60, 90, 0].map((angle) => (
                  <button key={angle} type="button" onClick={() => setSetting('sweep_angle', angle)}>
                    angle {angle === 0 ? '0 (spin)' : angle}
                  </button>
                ))}
              </div>
            </section>

            <section className="mvedit__block">
              <header className="mvedit__head">camera — get_view / set_view</header>
              <div className="mvedit__row">
                <button type="button" onClick={() => void getView()}>
                  get_view
                </button>
                <button type="button" onClick={() => void setView()}>
                  set_view
                </button>
                <button type="button" onClick={() => void run(camera.reset())}>
                  reset
                </button>
                <button type="button" onClick={() => void run(camera.zoom())}>
                  zoom
                </button>
                <button type="button" onClick={() => void run(camera.orient())}>
                  orient
                </button>
              </div>
              <textarea
                className="mvedit__view"
                value={viewText}
                spellCheck={false}
                placeholder="18 floats, or paste a set_view (...) block"
                onChange={(event) => setViewText(event.target.value)}
                aria-label="camera view"
              />
              <p className="mvedit__note">
                `get_view` returns 25 floats from C and slices to 18; `set_view` requires exactly 18
                (viewing.py:634).
              </p>
            </section>
          </div>
        )}
      </div>

      {popup && (
        <MotionMenu
          items={popup.items}
          at={popup.at}
          onCommand={(line) => void runLine(line)}
          onClose={() => setPopup(null)}
        />
      )}
      {exporting && (
        <ExportDialog
          status={status}
          source={source}
          call={session.call}
          onClose={() => setExporting(false)}
          log={(line) => session.stores.feedback.appendClient(line)}
        />
      )}
    </div>
  );
}
