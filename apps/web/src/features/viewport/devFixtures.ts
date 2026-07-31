/**
 * Development switches for driving Mode G before the bridge producer exists.
 *
 *   ?viewportFixtures=ubq.cartoon.bin,ubq.sticks.bin
 *        Load pre-encoded geometry frames from the dev frame directory instead
 *        of waiting for the WebSocket. The bytes are REAL: produced by
 *        `_cmd.web_get_rep_geometry` and encoded with
 *        `packages/protocol/python/tenmol_wire.py` via
 *        `packages/viewport/tools/pull_geometry.py`. Nothing is synthesised.
 *
 *   ?viewportHandle=1
 *        Publish the live `ViewportHandle` on `window.__tenmolViewport`, so a
 *        headless browser can drive `setRepMode`/`requestGeometry` for the reps
 *        that have no HUD toggle (mesh, dots, nonbonded, cell, ellipsoids,
 *        CGO). Read-only diagnostics otherwise; nothing in the app uses it.
 *
 *   ?viewportPull=off
 *        Do not use the dev PNG pull source as a fallback. It matters for
 *        testing a GL-FREE bridge: without it, `withFallback` quietly switches
 *        to the pull source, `cmd.png(ray=0)` on a context-free PyMOL silently
 *        RAY-TRACES instead (measured: 188 ms for 400x300), and the app looks
 *        like it is working when what it is really doing is CPU ray tracing at
 *        a few frames a second while Mode G stays suppressed. A production
 *        build has no pull source at all, so this switch makes dev match it.
 *
 *   ?viewportModeP=off
 *        Do not start a Mode-P source, so Mode G is on a black canvas and any
 *        gap in it is visible rather than covered by the server-rendered image.
 *
 * Both are no-ops in a production build (`FRAME_DIR` is empty) and both are
 * inert unless the query parameter is present.
 */

import {
  createStaticGeometrySource,
  type GeometrySource,
  type PixelSource,
} from '@tenmol/viewport';

import { FRAME_ENDPOINT, pullSourceAvailable } from './devFrames';

function params(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
}

export function fixtureGeometrySource(): GeometrySource | null {
  const raw = params().get('viewportFixtures');
  if (raw === null || raw.trim() === '' || !pullSourceAvailable()) return null;
  const urls = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => `${FRAME_ENDPOINT}?path=${encodeURIComponent(name)}&v=1`);
  return createStaticGeometrySource({ urls });
}

export function pullDisabled(): boolean {
  return params().get('viewportPull') === 'off';
}

export function handleExposed(): boolean {
  return params().get('viewportHandle') === '1';
}

export function modePDisabled(): boolean {
  return params().get('viewportModeP') === 'off';
}

/** A source that produces nothing, for `?viewportModeP=off`. */
export const NULL_PIXEL_SOURCE: PixelSource = {
  name: 'disabled',
  // Nothing will ever arrive, so the compositor must not wait for a
  // `PixelFrameHeader.reps` to tell it what the server is drawing: with no
  // stream the server draws NOTHING and Mode G owns the whole scene.
  rasterizes: false,
  start(): void {},
  stop(): void {},
};
