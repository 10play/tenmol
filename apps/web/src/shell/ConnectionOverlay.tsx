/**
 * What the window shows when there is no usable bridge.
 *
 * It appears only when the situation is not self-healing, i.e. never while a
 * reconnect is pending — a blinking modal over a working reconnect is noise.
 * It appears when:
 *
 *   * the bridge rejected us (4401 / 4403) and retrying is pointless;
 *   * the socket has been down long enough that "it will come back" stopped
 *     being a reasonable thing to assume (three failed attempts).
 *
 * `GET /healthz` needs no token (`server.py`), so the panel can distinguish "the
 * bridge is not running" from "the bridge is running and does not like your
 * token" — and say which, instead of showing one spinner for both.
 */

import { useCallback, useState } from 'react';
import { useSession, useStoreState } from '../app';

/** Full-screen overlay for connecting to the bridge, distinguishing an unreachable bridge from a bad token. */
export function ConnectionOverlay() {
  const session = useSession();
  const connection = useStoreState(session.stores.connection);
  const [token, setToken] = useState('');
  const [health, setHealth] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);

  const probe = useCallback(() => {
    setProbing(true);
    setHealth(null);
    session
      .probeHealth()
      .then((data) => {
        setHealth(
          `bridge IS running: state=${String(data['state'])} pymol=${String(
            data['pymolVersion'],
          )} clients=${String(data['clients'])}`,
        );
      })
      .catch((error: unknown) => {
        setHealth(
          `no answer on /healthz — ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => setProbing(false));
  }, [session]);

  const rejected = connection.phase === 'unauthorized' || connection.phase === 'forbidden';
  const stuck = connection.phase === 'closed' || connection.attempt >= 3;
  if (!rejected && !stuck) return null;

  return (
    <div className="connpanel" role="dialog" aria-label="bridge connection">
      <div className="connpanel__box">
        <div className="connpanel__title">no PyMOL bridge</div>

        <dl className="connpanel__facts">
          <dt>state</dt>
          <dd>{connection.phase}</dd>
          <dt>url</dt>
          <dd>{connection.url}</dd>
          <dt>token</dt>
          <dd>{connection.hasToken ? 'supplied' : 'none supplied'}</dd>
          {connection.closeCode !== null && (
            <>
              <dt>close</dt>
              <dd>
                {connection.closeCode}
                {connection.closeReason ? ` ${connection.closeReason}` : ''}
              </dd>
            </>
          )}
          {connection.lastError && (
            <>
              <dt>error</dt>
              <dd>{connection.lastError}</dd>
            </>
          )}
        </dl>

        <p className="connpanel__hint">
          Start it with <code>pnpm dev:bridge</code> (or{' '}
          <code>python -m tenmol_bridge --no-token</code>). The bridge mints a session token at
          startup and prints it to stderr; paste it below, or launch the browser with{' '}
          <code>?token=…</code>.
        </p>

        {rejected && (
          <div className="connpanel__row">
            <input
              className="connpanel__input"
              type="password"
              placeholder="session token"
              value={token}
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && token) session.useToken(token);
              }}
            />
            <button
              type="button"
              className="quickbutton"
              disabled={!token}
              onClick={() => session.useToken(token)}
            >
              use token
            </button>
          </div>
        )}

        <div className="connpanel__row">
          <button type="button" className="quickbutton" onClick={() => session.reconnect()}>
            reconnect
          </button>
          <button type="button" className="quickbutton" onClick={probe} disabled={probing}>
            {probing ? 'probing…' : 'probe /healthz'}
          </button>
        </div>

        {health && <div className="connpanel__health">{health}</div>}
      </div>
    </div>
  );
}
