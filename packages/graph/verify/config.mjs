// Shared config for the feature-verification graph.
// The oracle is REAL PyMOL behind the tenmol bridge. In this sandbox the managed
// bridge is only reachable over the tailscale IP (a separate net namespace), and it
// runs --no-gl, so the oracle surface is STATE observables (counts, view, colors,
// settings, model) — not pixels. Override via env for other environments.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERIFY_DIR = dirname(fileURLToPath(import.meta.url));
export const GRAPH_DIR = dirname(VERIFY_DIR); // packages/graph
export const REPO_DIR = dirname(dirname(GRAPH_DIR)); // repo root

export const STATUS_DIR = join(VERIFY_DIR, 'status'); // one <id>.json per feature (the ledger)
export const PROBES_DIR = join(VERIFY_DIR, 'probes'); // committed e2e probe per verified feature
export const REPORTS_DIR = join(VERIFY_DIR, 'reports'); // blocked/failure reports

export const MANIFEST = join(GRAPH_DIR, 'manifest.json');

export const ORACLE_WS = process.env.TENMOL_ORACLE_WS || 'ws://100.71.244.15:8002/ws';
export const ORACLE_ORIGIN = process.env.TENMOL_ORACLE_ORIGIN || 'http://100.71.244.15:3002';
export const ORACLE_HAS_GL = process.env.TENMOL_ORACLE_GL === '1'; // managed bridge is --no-gl

export const CHROME_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/ms-playwright';

// A feature id is stable & filesystem-safe: "<kind>__<name>".
export function featureId(kind, name) {
  return `${kind}__${String(name).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
}
