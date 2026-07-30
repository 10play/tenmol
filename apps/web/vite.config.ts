import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Deployment model: local desktop replacement.
 * One PyMOL process, one browser client, localhost only.
 *
 * The bridge WebSocket is a fixed, absolute URL (ws://127.0.0.1:8765/ws) per the
 * agreed wire protocol, so no dev proxy is configured here -- the client connects
 * to the bridge directly and CORS does not apply to WebSockets.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
