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
 * THE HISTOGRAM CROSSES THE WIRE. This file used to say the opposite, and the
 * inventory rows that depend on it were left PARTIAL for that reason, so the
 * correction is recorded rather than quietly applied.
 *
 * The defect was real: `get_volume_histogram` was listed in
 * `packages/bridge/tenmol_bridge/codec.py`'s `BLOB_RETURNS`, and
 * `EngineBlobWriter._array_blob` insists on a numpy array, while
 * `CmdGetVolumeHistogram` (`packages/engine/layer4/Cmd.cpp:738-752`) returns a plain Python
 * list of `bins + 4` floats — so every call answered
 *
 *     NotSerializable: get_volume_histogram returned list, expected a numpy array
 *
 * `codec.py` no longer lists it (it carries a comment saying why), and the call
 * now answers 68 inline floats. Measured over a real socket in
 * `packages/bridge/tests/test_p8_a10.py`, which also RE-CREATES the old defect with a
 * monkeypatch and gets that exact message back, so "fixed" is a measurement of
 * this build and not a memory of a commit.
 *
 * The lower tiers stay: they are the answer to a bridge that is older than this
 * file or is running with a different codec, and tier 3 is what keeps the panel
 * usable for a volume whose map has been deleted.
 */

import type { Session } from '../../app';
import {
  BUILTIN_VOLUME_RAMPS,
  HISTOGRAM_BINS,
  type FlatVolumeRamp,
} from '@tenmol/protocol/topics/dialogs';
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

/**
 * The named ramps, READ LIVE — the `A > volume` submenu's own source.
 *
 * The inventory row said "the list is a client constant, not a live read of
 * `pymol.colorramping.namedramps` (no cmd getter exists)". The second half is
 * wrong, and the refutation is `packages/engine/modules/pymol/menu.py:643-653`:
 *
 *     def vol_color(self_cmd, sele):
 *         from pymol.colorramping import namedramps
 *         ...  + [[1, p, 'cmd.volume_color(%s, "%s")' % (rsele, p)]
 *                 for p in sorted(namedramps)]
 *
 * `menu` IS in `policy/base.py`'s `DEFAULT_ROOTS`, so this resolves through the
 * ordinary dispatcher, while `colorramping` is not and answers `NotAllowed:
 * 'colorramping' is not an addressable namespace` (both measured in
 * `packages/bridge/tests/test_p8_a10.py`). `self_cmd` is unused by this particular
 * provider, which is why `null` is a legal first argument.
 *
 * It is a LIVE read and not a prettier constant: registering a ramp with
 * `cmd.volume_ramp_new` makes it appear here on the next call, measured.
 *
 * Row kinds are PyMOL's popup kinds (`packages/engine/layer4/PopUp.cpp`): 2 title, 0
 * separator, 1 leaf. The `panel` leaf is filtered out of the DROPDOWN because
 * it is not a ramp — it opens the editor, and it is live now, wired through
 * `menuBridge.ts` where the menu that owns it is dispatched.
 */
export async function listPresets(session: Session, name: string): Promise<string[]> {
  const rows = await session.call<[number, string, string][]>('menu.vol_color', [null, name]);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row) => Array.isArray(row) && row[0] === 1 && String(row[2]).startsWith('cmd.volume_color('),
    )
    .map((row) => String(row[1]));
}

/** Which of the three sources answered. Shown in the panel, never hidden. */
export type PresetSource = 'tenmol_volume.ramps' | 'menu.vol_color' | 'constant';

export interface PresetList {
  names: readonly string[];
  source: PresetSource;
  /** Names NOT among PyMOL's five built-ins — `volume_ramp_new` registrations. */
  extra: readonly string[];
}

/**
 * The preset list, three tiers, tried in order. NEVER THROWS.
 *
 *   1. `cmd.tenmol_volume.ramps()` — `sorted(pymol.colorramping.namedramps)`,
 *      read server-side by `packages/bridge/tenmol_bridge/panels/volume.py`. This is the
 *      "bridge getter returning `namedramps` keys" the inventory row's target
 *      column asked for, and the only tier that can tell a registered ramp from
 *      a built-in one.
 *   2. `menu.vol_color` — the same dict, wrapped in popup rows. `colorramping`
 *      is not an addressable namespace and `menu` is (`policy/base.py`), so this
 *      is the way round on a bridge with no volume module.
 *   3. `BUILTIN_VOLUME_RAMPS` — the compiled-in five, for a backend that
 *      refuses both.
 *
 * Tier 1 is not free (one call) and not always available, which is exactly why
 * the tier that answered is reported rather than assumed.
 */
export async function presetList(session: Session, name: string): Promise<PresetList> {
  try {
    const reply = await session.call<{ names?: string[]; extra?: string[] }>(
      'cmd.tenmol_volume.ramps',
    );
    if (Array.isArray(reply?.names) && reply.names.length > 0) {
      return {
        names: reply.names,
        source: 'tenmol_volume.ramps',
        extra: Array.isArray(reply.extra) ? reply.extra : [],
      };
    }
  } catch {
    /* no volume module on this bridge — tier 2 */
  }
  try {
    const names = await listPresets(session, name);
    if (names.length > 0) {
      return {
        names,
        source: 'menu.vol_color',
        // Without the server-side split this is the honest answer: the row
        // format carries no such flag, so nothing is claimed about it.
        extra: [],
      };
    }
  } catch {
    /* refused, or an older engine — tier 3 */
  }
  return { names: BUILTIN_VOLUME_RAMPS, source: 'constant', extra: [] };
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
 * THREE TIERS, tried in order.
 *
 *   1. `cmd.get_volume_histogram(name)` — the real thing, and on this build it
 *      is the one that runs: 68 inline floats, `[min, max, mean, stdev, h0..h63]`,
 *      of which `min` and `max` arrive bit-identical to the captured fixture
 *      (`packages/bridge/tests/test_p8_a10.py`). 2956 of the field's 2992 voxels are
 *      binned — the rest fall outside PyMOL's own +/- `volume_data_range` trim.
 *   2. `cmd.get_volume_field(name)` + `histogramFromField` — a verbatim port of
 *      the C histogram, proved bar-for-bar in `ramp.test.ts`. The array arrives
 *      as a blob handle, and `GET /blob/{id}` from the page is CROSS-ORIGIN
 *      (`http://localhost:5210` -> `http://127.0.0.1:8810`) while
 *      `packages/bridge/tenmol_bridge/server.py` installs no CORS middleware (grep:
 *      no `add_middleware` at all), so the browser refuses to read the
 *      response: measured in wave 4, `TypeError: Failed to fetch`. One
 *      `Access-Control-Allow-Origin` header on `/blob` turns this tier on.
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
  // (`packages/engine/layer3/Executive.cpp:4730-4733`), so the per-object setting has to be read
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
