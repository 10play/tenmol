import { describe, it } from 'vitest';
import { createRemoteBackend, type WebSocketCtor } from '@tenmol/client';
import { generateRefs } from '../src/generate-refs';

/**
 * Regenerate the committed PyMOL reference images from the LIVE bridge. Skipped
 * unless `TENMOL_VISUAL_REMOTE` is set (it needs real PyMOL). `TENMOL_VISUAL_ONLY`
 * (comma-separated scene ids) narrows the run while iterating.
 */
const REMOTE = process.env['TENMOL_VISUAL_REMOTE'];
const ORIGIN = process.env['TENMOL_VISUAL_ORIGIN'];
const ONLY = process.env['TENMOL_VISUAL_ONLY'];

(REMOTE ? describe : describe.skip)('visual reference generation (real PyMOL)', () => {
  it('renders every corpus scene and writes refs + views.json', async () => {
    const { default: WS } = await import('ws');
    const WsCtor = class extends WS {
      constructor(u: string) {
        super(u, { origin: ORIGIN });
      }
    } as unknown as WebSocketCtor;
    const backend = createRemoteBackend({ url: REMOTE!, autoReconnect: false, WebSocketImpl: WsCtor });
    const only = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : undefined;
    await generateRefs(backend as never, only);
    backend.close();
  }, 600000);
});
