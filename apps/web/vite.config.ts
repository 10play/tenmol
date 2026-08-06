import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve, sep } from 'node:path';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * The GIT root, two levels up from `apps/web/`. It was two before this
 * project's code moved under `web/`, and the name matters: paths built on it
 * are written `packages/...` (ours) or `packages/engine/test/dat/...` (upstream), so it has
 * to be the root both of those are relative to.
 */
const repoRoot = resolve(here, '..', '..');

/**
 * Deployment model: local desktop replacement.
 * One PyMOL process, one browser client, localhost only.
 *
 * The bridge WebSocket is a fixed, absolute URL (ws://127.0.0.1:8765/ws) per the
 * agreed wire protocol, so no dev proxy is configured here -- the client connects
 * to the bridge directly and CORS does not apply to WebSockets.
 */

/**
 * Dev-only static file bridge for viewport frame data.
 *
 * Two things need to reach the browser from the filesystem while the bridge's
 * own producers are being built:
 *
 *   * Mode P pull-mode frames -- `cmd.png(path)` writes a PNG the browser then
 *     GETs (`@tenmol/viewport`'s `createPngPullSource`). This is the fallback
 *     path that keeps the viewport alive when the WebSocket pixel stream is
 *     absent or stalls.
 *   * Mode G fixtures -- binary geometry frames produced by
 *     `packages/viewport/tools/pull_geometry.py` straight out of
 *     `_cmd.web_get_rep_geometry`.
 *
 * Scope: `apply: 'serve'` (never in a build), one directory (`TENMOL_FRAME_DIR`,
 * default `<tmpdir>/tenmol-frames` — NOT inside the repo, so no `.gitignore`
 * entry is needed and no build turd can be committed), path traversal refused,
 * and only the extensions below. A development affordance, not a file server.
 */
export const FRAME_ENDPOINT = '/__tenmol/frame';

const FRAME_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
};

function frameDir(): string {
  return resolve(process.env['TENMOL_FRAME_DIR'] ?? join(tmpdir(), 'tenmol-frames'));
}

function tenmolDevFrames(): Plugin {
  return {
    name: 'tenmol-dev-frames',
    apply: 'serve',
    configureServer(server) {
      const root = frameDir();
      mkdirSync(root, { recursive: true });
      server.config.logger.info(`  tenmol frames  ${FRAME_ENDPOINT}?path= -> ${root}`);
      server.middlewares.use(FRAME_ENDPOINT, (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const requested = url.searchParams.get('path') ?? '';
        const target = resolve(root, requested.startsWith('/') ? requested.slice(1) : requested);
        const inRoot = target === root || target.startsWith(root + sep);
        const ext = extname(target).toLowerCase();
        if (!inRoot || FRAME_MIME[ext] === undefined || !existsSync(target)) {
          res.statusCode = 404;
          res.end('no such frame');
          return;
        }
        const size = statSync(target).size;
        if (size === 0) {
          // A frame caught mid-write. The client retries; a truncated image
          // would be presented as a corrupt frame.
          res.statusCode = 404;
          res.end('empty');
          return;
        }
        res.setHeader('content-type', FRAME_MIME[ext]);
        res.setHeader('content-length', String(size));
        res.setHeader('cache-control', 'no-store');
        createReadStream(target).pipe(res);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), tenmolDevFrames()],
  define: {
    // The absolute directory the bridge writes frames into and the dev server
    // reads them from. Empty in a production build: the pull-mode fallback is a
    // development affordance, and an absolute path has no business in a bundle.
    __TENMOL_FRAME_DIR__: JSON.stringify(command === 'serve' ? frameDir() : ''),
    __TENMOL_FRAME_ENDPOINT__: JSON.stringify(FRAME_ENDPOINT),
  },
  resolve: {
    alias: {
      // The workspace packages are consumed as TypeScript SOURCE (they have no
      // build step). `@tenmol/client` and `@tenmol/protocol` resolve through
      // apps/web's own dependencies; `@tenmol/viewport` is aliased here because
      // apps/web/package.json is owned by another work package -- remove this
      // alias once `"@tenmol/viewport": "workspace:*"` is listed there.
      '@tenmol/viewport': resolve(repoRoot, 'packages/viewport/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // WP-00 measured an unrelated Vite server already holding [::1]:5173, and
    // `strictPort: true` turns that into a hard boot failure. Probing up from
    // 5173 is the desktop-app behaviour: the browser is opened by us anyway.
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
