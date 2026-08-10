import { describe, expect, it } from 'vitest';
import { createRemoteBackend, type WebSocketCtor } from '@tenmol/client';
import { runCorpus, runLocalCorpus, diffCorpus } from '../src/index';

/**
 * THE LIVE DIFFERENTIAL. Runs the exact same corpus through real PyMOL (over the
 * WebSocket bridge) and through the TypeScript engine, and asserts zero
 * divergence — so a golden fixture can never silently drift away from PyMOL.
 *
 * Skipped unless `TENMOL_PARITY_REMOTE=<ws url>` is set, because it needs a
 * running bridge. That env is set by the "engine parity -- live differential"
 * step in `.github/workflows/webclient-e2e.yml` — the one CI job with a PyMOL
 * bridge — which boots a bridge and gates on this test. When
 * `TENMOL_PARITY_REGEN=1` is also set, the remote run is written back to
 * `fixtures/golden.json`, making real PyMOL the authority for the fast gate.
 */
const REMOTE = process.env['TENMOL_PARITY_REMOTE'];
/** The bridge enforces an Origin allow-list; a Node ws client must send it. */
const ORIGIN = process.env['TENMOL_PARITY_ORIGIN'];
const suite = REMOTE ? describe : describe.skip;

suite('live differential — TypeScript engine vs. real PyMOL', () => {
  it('produces identical observables for every script', async () => {
    const { default: WS } = await import('ws');
    // Inject the allowed Origin header so the bridge accepts a non-browser client.
    const WsCtor = ORIGIN
      ? (class extends WS {
          constructor(url: string) {
            super(url, { origin: ORIGIN });
          }
        } as unknown as WebSocketCtor)
      : (WS as unknown as WebSocketCtor);
    const remote = createRemoteBackend({
      url: REMOTE!,
      autoReconnect: false,
      WebSocketImpl: WsCtor,
    });
    await remote.connect();
    // The bridge is a persistent singleton; wipe any residual objects, named
    // selections, settings and colours from earlier work so the run is
    // deterministic (per-script `delete all` alone leaves those behind).
    await remote.call('reinitialize', []).catch(() => undefined);

    const remoteSnaps = await runCorpus(remote);
    const localSnaps = await runLocalCorpus();
    remote.close();

    if (process.env['TENMOL_PARITY_REGEN'] === '1') {
      const { writeFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const path = fileURLToPath(new URL('../fixtures/golden.json', import.meta.url));
      writeFileSync(path, JSON.stringify(remoteSnaps, null, 2) + '\n');
    }

    const diffs = diffCorpus(remoteSnaps, localSnaps);
    expect(diffs).toEqual([]);
  });
});
