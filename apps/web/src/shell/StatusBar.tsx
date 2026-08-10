/**
 * The status strip.
 *
 * Qt PyMOL has no status bar (`docs/qt-main-window.md` §5), so this is
 * an addition — justified by the one thing a desktop PyMOL never had to show: a
 * transport. It reports, left to right:
 *
 *   * the socket phase, colour-coded, never euphemistic;
 *   * the engine state behind it (`running` / `headless` / `degraded`) from the
 *     bridge's `hello` frame, because an open socket to a PyMOL-less bridge is
 *     not "connected" in any sense the user cares about;
 *   * the live `cmd.get_progress()` bar — spike 05 / plan §1.1 measured this as
 *     the ONLY liveness signal available while PyMOL is inside a long C++ call;
 *   * object count, poll rate, and the GL renderer.
 *
 * Nothing else may grow here.
 */

import { describeConnection, engineState } from '@tenmol/stores';
import { useSession, useStore, useStoreState } from '../app';

/** The bottom status bar: connection state, object count and feedback summary. */
export function StatusBar() {
  const session = useSession();
  const connection = useStoreState(session.stores.connection);
  const objectCount = useStore(session.stores.objects, (s) => s.rows.length);
  const source = useStore(session.stores.objects, (s) => s.source);
  const deduped = useStore(session.stores.feedback, (s) => s.deduped);

  const engine = engineState(connection);
  const gl = connection.hello?.gl;
  const busy = connection.progress >= 0;

  return (
    <div className="statusbar">
      <span className={`statusbar__dot statusbar__dot--${connection.phase}`} />
      <span className="statusbar__text" title={connection.lastError ?? undefined}>
        {describeConnection(connection)}
      </span>
      <span className="statusbar__sep">·</span>
      <span className="statusbar__text statusbar__text--dim">{connection.url}</span>

      {busy && (
        <>
          <span className="statusbar__sep">·</span>
          <span
            className="statusbar__progress"
            title={`cmd.get_progress() = ${connection.progress.toFixed(3)}`}
          >
            <span
              className="statusbar__progress-fill"
              style={{ width: `${Math.round(Math.min(1, connection.progress) * 100)}%` }}
            />
          </span>
        </>
      )}

      <span className="statusbar__spacer" />

      <span className="statusbar__text statusbar__text--dim" title={`row source: ${source}`}>
        {objectCount} {objectCount === 1 ? 'row' : 'rows'}
        {source === 'poll' ? ` @ ${Math.round(session.poller.stats().hz)} Hz` : ''}
      </span>
      {deduped > 0 && (
        <>
          <span className="statusbar__sep">·</span>
          <span
            className="statusbar__text statusbar__text--dim"
            title="feedback lines suppressed as replay duplicates after a (re)subscribe"
          >
            {deduped} replayed
          </span>
        </>
      )}
      {gl?.renderer && (
        <>
          <span className="statusbar__sep">·</span>
          <span className="statusbar__text statusbar__text--dim" title={gl.version ?? ''}>
            {gl.renderer}
          </span>
        </>
      )}
      <span className="statusbar__sep">·</span>
      <span className="statusbar__text statusbar__text--dim">
        {connection.hello ? `tenmol · ${connection.hello.pymolVersion}` : 'tenmol —'}
        {engine !== 'running' && engine !== 'unknown' ? ` (${engine})` : ''}
      </span>
    </div>
  );
}
