/**
 * PyMOL reference-image generator. Drives the LIVE bridge (real PyMOL) over the
 * WebSocket, renders each corpus scene with `_bridge.ray` (PyMOL's own renderer
 * — "how PyMOL looks when you install it"), and writes:
 *
 *   docs/screenshots/visual/refs/<id>.png   — the committed PyMOL reference
 *   apps/web/public/visual/views.json        — the exact camera PyMOL framed each
 *                                              scene with (18-float set_view),
 *                                              so the TS render frames identically
 *
 * Run (manual/occasional — needs the bridge; the committed PNGs are what CI reads):
 *   TENMOL_VISUAL_REMOTE=ws://100.71.244.15:8006/ws \
 *   TENMOL_VISUAL_ORIGIN=http://100.71.244.15:3007 \
 *   node node_modules/vitest/vitest.mjs run tools/visual/test/generate-refs.test.ts
 *
 * Image bytes come back via `cmd.tenmol_files.copy_image_png` (the prior-image
 * PNG the Render dialog uses for clipboard); `_bridge.ray` sets that prior.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCENES, type Scene } from './scenes';

const REFS_DIR = 'docs/screenshots/visual/refs';
const VIEWS_JSON = 'apps/web/public/visual/views.json';
const PDB_DIR = 'apps/web/public/visual';

interface Backend {
  connect(): Promise<unknown>;
  call<T = unknown>(fn: string, args?: readonly unknown[], kwargs?: Record<string, unknown>): Promise<T>;
  do(line: string): Promise<unknown> | void;
  close(): void;
}

interface CopyResult {
  ok: boolean;
  base64: string;
  error: string | null;
}

/** Render one scene in PyMOL and return {png bytes, the 18-float view used}. */
async function renderScene(b: Backend, scene: Scene): Promise<{ png: Buffer; view: number[] }> {
  const obj = scene.obj ?? scene.pdb.replace(/\.pdb$/, '');
  const pdb = readFileSync(resolve(PDB_DIR, scene.pdb), 'utf8');
  await b.call('reinitialize', []);
  await b.call('viewport', [scene.width, scene.height]);
  await b.call('read_pdbstr', [pdb, obj]);
  for (const [method, ...args] of scene.ops) await b.call(method, args);
  for (const [name, value] of scene.settings ?? []) await b.call('set', [name, value]);
  await b.call('bg_color', [scene.bg]);
  await b.call('set', ['opaque_background', 1]);
  if (scene.view && scene.view.length === 18) {
    await b.call('set_view', [scene.view]);
  } else {
    await b.call('orient', []);
    await b.call('zoom', []);
  }
  const view = (await b.call<number[]>('get_view', [])).map(Number);
  await b.call('_bridge.ray', [scene.width, scene.height]);
  const r = await b.call<CopyResult>('cmd.tenmol_files.copy_image_png', [0]);
  if (!r?.ok || !r.base64) throw new Error(`copy_image_png failed for ${scene.id}: ${r?.error}`);
  return { png: Buffer.from(r.base64, 'base64'), view };
}

/** Generate every reference; returns the id->view map. */
export async function generateRefs(b: Backend, only?: Set<string>): Promise<Record<string, number[]>> {
  mkdirSync(REFS_DIR, { recursive: true });
  const views: Record<string, number[]> = {};
  for (const scene of SCENES) {
    if (only && !only.has(scene.id)) continue;
    const { png, view } = await renderScene(b, scene);
    writeFileSync(resolve(REFS_DIR, `${scene.id}.png`), png);
    views[scene.id] = view;
    console.log(`ref ${scene.id}: ${png.length} bytes`);
  }
  mkdirSync(dirname(VIEWS_JSON), { recursive: true });
  writeFileSync(VIEWS_JSON, JSON.stringify(views, null, 2) + '\n');
  return views;
}
