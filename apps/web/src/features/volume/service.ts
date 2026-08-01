/**
 * Every bridge call the volume ramp editor makes. Nothing here is invented:
 * each function names the real PyMOL symbol and where it lives.
 *
 *   cmd.get_names_of_type('object:volume')   the object list (querying.py:1459)
 *   cmd.volume_color(name)                   ramp GETTER   (colorramping.py:120)
 *   cmd.volume_color(name, flat)             ramp SETTER   (colorramping.py:156)
 *   cmd.volume_color(name, '2fofc')          named preset  (colorramping.py:150)
 *   cmd.get_volume_histogram(name)           histogram     (querying.py:62)
 *   cmd.get_volume_field(name)               raw field     (querying.py:40)
 *   cmd.volume_ramp_new(name, flat)          register      (colorramping.py:56)
 *
 * MEASURED BRIDGE DEFECT, worked around here rather than hidden:
 * `get_volume_histogram` is listed in `bridge/tenmol_bridge/codec.py`'s
 * `BLOB_RETURNS`, and `EngineBlobWriter._array_blob` then insists the value is
 * a numpy array — but `CmdGetVolumeHistogram` (`layer4/Cmd.cpp:738-752`) returns
 * a plain Python list of `bins + 4` floats. The call therefore answers
 *
 *     NotSerializable: get_volume_histogram returned list, expected a numpy array
 *
 * verbatim, on this tree, today. So `fetchHistogram` tries it, and on failure
 * derives the identical `[min, max, mean, stdev, h0..h63]` vector from
 * `cmd.get_volume_field`, which IS a numpy array and does arrive (as a blob).
 * When the bridge is fixed the fast path simply starts working.
 */

import type { Session } from '../../app';
import { HISTOGRAM_BINS, type FlatVolumeRamp } from '@tenmol/protocol/topics/dialogs';
import { histogramFromField } from './ramp';

export interface BlobHandle {
  __blob__: true;
  id: string;
  mime: string;
  size: number;
  url: string;
  meta?: { shape?: number[]; dtype?: string };
}

function isBlob(value: unknown): value is BlobHandle {
  return typeof value === 'object' && value !== null && '__blob__' in value;
}

/** Volume objects only. `get_names_of_type` is a real API (`querying.py:1459`). */
export async function listVolumes(session: Session): Promise<string[]> {
  const names = await session.call<string[]>('get_names_of_type', ['object:volume']);
  return Array.isArray(names) ? names : [];
}

/** The GETTER form of `cmd.volume_color` — no ramp argument. */
export async function getRamp(session: Session, name: string): Promise<FlatVolumeRamp> {
  const flat = await session.call<number[] | number>('volume_color', [name]);
  // The C setter returns an int status; the getter returns the list. A number
  // here means "not a volume object" and must not be mistaken for an empty ramp.
  return Array.isArray(flat) ? flat : [];
}

/** The SETTER form. `_guiupdate=False`: there is no Qt panel to call back into. */
export async function setRamp(
  session: Session,
  name: string,
  flat: readonly number[],
): Promise<void> {
  await session.call('volume_color', [name, flat], { _guiupdate: 0 });
}

/** `cmd.volume_color(name, '<rampname>')` — the named presets of `A > volume`. */
export async function applyPreset(session: Session, name: string, preset: string): Promise<void> {
  await session.call('volume_color', [name, preset], { _guiupdate: 0 });
}

/** `cmd.volume_ramp_new(rname, flat)` — registers the current ramp by name. */
export async function registerRamp(
  session: Session,
  rname: string,
  flat: readonly number[],
): Promise<void> {
  await session.call('volume_ramp_new', [rname, flat]);
}

export interface HistogramFetch {
  histogram: number[];
  /** Which path produced it — surfaced in the panel so the fallback is visible. */
  source: 'get_volume_histogram' | 'get_volume_field' | 'ramp';
  note?: string;
}

/**
 * THREE TIERS, tried in order, because the first two are both blocked by bridge
 * gaps that are not this work package's to fix:
 *
 *   1. `cmd.get_volume_histogram(name)` — the real thing. Currently answers
 *      `NotSerializable: ... expected a numpy array` (see the module header).
 *   2. `cmd.get_volume_field(name)` + `histogramFromField` — a verbatim port of
 *      the C histogram, proved bar-for-bar in `ramp.test.ts`. The array arrives
 *      as a blob handle, and `GET /blob/{id}` from the page is CROSS-ORIGIN
 *      (`http://localhost:5210` -> `http://127.0.0.1:8810`) while
 *      `bridge/tenmol_bridge/server.py` installs no CORS middleware, so the
 *      browser refuses to read the response: measured, `TypeError: Failed to
 *      fetch`. One `Access-Control-Allow-Origin` header on `/blob` turns this
 *      tier on.
 *   3. The ramp's own stops. No bars, but a data range that spans the colour
 *      map with a 10 % margin, so every interaction in the panel keeps working
 *      and the axes mean something.
 *
 * The tier that ran is reported to the panel and shown, never hidden.
 */
export async function fetchHistogram(
  session: Session,
  name: string,
  ramp: FlatVolumeRamp = [],
): Promise<HistogramFetch> {
  let firstError = '';
  try {
    const direct = await session.call<number[]>('get_volume_histogram', [name]);
    if (Array.isArray(direct) && direct.length >= 4) {
      return { histogram: direct, source: 'get_volume_histogram' };
    }
  } catch (error) {
    firstError = messageOf(error);
  }

  try {
    const field = await histogramViaField(session, name);
    if (firstError) field.note = `get_volume_histogram unavailable (${firstError})`;
    return field;
  } catch (error) {
    return {
      histogram: rangeFromRamp(ramp),
      source: 'ramp',
      note:
        `no histogram: get_volume_histogram -> ${firstError || 'n/a'}; ` +
        `get_volume_field -> ${messageOf(error)}`,
    };
  }
}

/** Tier 3: `[min, max, 0, 0]` spanning the ramp stops with a 10 % margin. */
export function rangeFromRamp(ramp: FlatVolumeRamp): number[] {
  const values: number[] = [];
  for (let i = 0; i + 4 < ramp.length; i += 5) values.push(ramp[i]!);
  if (values.length === 0) return [0, 1, 0, 0];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return [low - 1, high + 1, 0, 0];
  const margin = (high - low) * 0.1;
  return [low - margin, high + margin, 0, 0];
}

async function histogramViaField(session: Session, name: string): Promise<HistogramFetch> {
  const value = await session.call<unknown>('get_volume_field', [name]);
  if (!isBlob(value)) throw new Error('get_volume_field did not return a blob handle');
  const response = await fetch(`${session.config.httpOrigin}${value.url}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GET ${value.url} -> HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const dtype = value.meta?.dtype ?? 'float32';
  if (dtype !== 'float32') throw new Error(`unsupported volume field dtype ${dtype}`);
  // `ExecutiveGetHistogram` trims to +/- `volume_data_range` standard deviations
  // (`layer3/Executive.cpp:4730-4733`), so the per-object setting has to be read
  // or the reported range will not match PyMOL's.
  const limit = await session
    .call<string>('get', ['volume_data_range', name])
    .then((text) => Number(text))
    .catch(() => 5.0);
  return {
    histogram: histogramFromField(
      new Float32Array(buffer),
      HISTOGRAM_BINS,
      Number.isFinite(limit) ? limit : 5.0,
    ),
    source: 'get_volume_field',
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
