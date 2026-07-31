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

export function modePDisabled(): boolean {
  return params().get('viewportModeP') === 'off';
}

/** A source that produces nothing, for `?viewportModeP=off`. */
export const NULL_PIXEL_SOURCE: PixelSource = {
  name: 'disabled',
  start(): void {},
  stop(): void {},
};
