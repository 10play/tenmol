/**
 * `Display ▸ Stereo Mode` — what the nine leaves actually do, and where.
 *
 * THE DECISION THIS FILE RECORDS. Stereo is a property of PyMOL's OWN renderer:
 * `ExecutiveStereo` (`packages/engine/layer3/Executive.cpp:9545-9585`) sets `stereo_mode` and
 * calls `SceneSetStereo`, and everything downstream happens inside the engine's
 * GL context. This client has two ways of putting that scene on screen — the
 * server-rendered pixel stream (Mode P) and client-side three.js geometry
 * (Mode G) — and stereo can only ride the first of them. Waves 4, 8 and 9 left
 * the submenu live and unguarded on the assumption that "the WebGL viewport
 * cannot honour them"; wave 10 measured that assumption wrong for Mode P and
 * right for Mode G. So the honest rule is not "hide the submenu", it is:
 *
 *   a mode is available when BOTH EYES FIT IN ONE 2-D IMAGE, and it is visible
 *   for exactly the reps the server is still drawing.
 *
 * WHY THE TWO REFUSALS ARE PERMANENT, AND NOT A PROPERTY OF THIS BUILD.
 * `quadbuffer` asks the display for two GL colour buffers and `openvr` asks a
 * VR runtime for a head-mounted display. The bridge's frame transport is one
 * `glReadBuffer(GL_COLOR_ATTACHMENT0)` per frame off a single offscreen FBO
 * (`packages/bridge/tenmol_bridge/render/framestream.py:905`) encoded as one JPEG/PNG —
 * there is no second buffer to carry the second eye and no HMD on the far end of
 * a WebSocket. A `pymol -S` build would make PyMOL stop erroring and would still
 * change nothing the browser could show. Every other mode packs both eyes into a
 * single raster (anaglyph into the colour channels, cross-/wall-eye side by
 * side, Zalman into alternate rows), which is precisely why they arrive.
 *
 * MEASURED, this tree, GL-backed bridge (Apple M4 Max, `stereo` and
 * `stereo_mode` saved and restored around the run) — every leaf issued as the
 * menu issues it, `{t:'do'}`, then `cmd.get`:
 *
 *     stereo anaglyph      ok  0.3 ms   stereo=on   stereo_mode=10
 *     stereo crosseye      ok  0.4 ms   stereo=on   stereo_mode=2
 *     stereo walleye       ok  0.3 ms   stereo=on   stereo_mode=3
 *     stereo byrow         ok  0.5 ms   stereo=on   stereo_mode=6
 *     stereo chromadepth   ok  0.4 ms   stereo=OFF  stereo_mode unchanged
 *     stereo swap          ok  0.3 ms   stereo unchanged, stereo_mode unchanged
 *     stereo quadbuffer    ok  0.4 ms   nothing changed;
 *                                       " Error: no 'quadbuffer' support detected (force with 'pymol -S')"
 *     stereo openvr        ok  0.4 ms   nothing changed;
 *                                       " Error: 'openvr' stereo mode not available in this build"
 *     stereo off           ok  0.3 ms   stereo=off, stereo_mode LATCHED at the last mode
 *
 * Note `{t:'do'}` answers `ok` even for the two the engine refused — the error
 * only appears as a feedback line. A client that watched the reply would call
 * both of them successes, which is half of why they looked live.
 *
 * TWO LABELS THAT LIE ON THEIR OWN TERMS, kept live and annotated rather than
 * renamed (the tree is harvested, not hand-written):
 *   `Chromadepth` is not a stereo mode at all — flag -3 sets `chromadepth 1`
 *      and `SceneSetStereo(G, 0)`, i.e. it turns stereo OFF.
 *   `Swap Sides` negates `stereo_shift` (flag -1) and touches neither `stereo`
 *      nor `stereo_mode`, so it does nothing observable while stereo is off.
 */

import { repName, type RepId } from '@tenmol/protocol/geometry';
import { walkMenu, type MenuNode } from '@tenmol/protocol/topics/menus';

/** How the two eyes reach the client. Only `composite` can cross a WebSocket. */
export type StereoCarrier = 'composite' | 'two-buffers' | 'hmd' | 'monoscopic';

export interface StereoLeaf {
  /** The `stereo <word>` argument, i.e. the `stereo_dict` key. */
  word: string;
  /** `stereo_dict` value (`packages/engine/modules/pymol/constants.py:130-137`). */
  code: number;
  /** `stereo_mode` the engine ends in, or null when the leaf sets none. */
  mode: number | null;
  /** `true` leaves the `stereo` setting on, `false` off, `null` unchanged. */
  stereoOn: boolean | null;
  carrier: StereoCarrier;
  /** One sentence, present tense, for the tooltip. */
  effect: string;
}

/** Keyed by the exact command the harvested tree carries. */
export const STEREO_LEAVES: Readonly<Record<string, StereoLeaf>> = {
  'stereo anaglyph': {
    word: 'anaglyph',
    code: 10,
    mode: 10,
    stereoOn: true,
    carrier: 'composite',
    effect: 'both eyes in one frame, split across the colour channels (red/cyan glasses)',
  },
  'stereo crosseye': {
    word: 'crosseye',
    code: 2,
    mode: 2,
    stereoOn: true,
    carrier: 'composite',
    effect: 'both eyes side by side in one frame, right image on the left',
  },
  'stereo walleye': {
    word: 'walleye',
    code: 3,
    mode: 3,
    stereoOn: true,
    carrier: 'composite',
    effect: 'both eyes side by side in one frame, left image on the left',
  },
  'stereo quadbuffer': {
    word: 'quadbuffer',
    code: 1,
    mode: 1,
    stereoOn: true,
    carrier: 'two-buffers',
    effect: 'two GL colour buffers, one per eye, on a stereo-capable display',
  },
  'stereo byrow': {
    word: 'byrow',
    code: 6,
    mode: 6,
    stereoOn: true,
    carrier: 'composite',
    effect: 'both eyes interlaced by row in one frame (Zalman panels)',
  },
  'stereo openvr': {
    word: 'openvr',
    code: 13,
    mode: 13,
    stereoOn: true,
    carrier: 'hmd',
    effect: 'PyMOL drives a head-mounted display through the OpenVR runtime',
  },
  'stereo swap': {
    word: 'swap',
    code: -1,
    mode: null,
    stereoOn: null,
    carrier: 'composite',
    effect: 'negates stereo_shift — swaps the eyes of whatever mode is already on',
  },
  'stereo chromadepth': {
    word: 'chromadepth',
    code: -3,
    mode: null,
    stereoOn: false,
    carrier: 'monoscopic',
    effect: 'NOT stereo: sets chromadepth 1 and turns stereo off (one image, depth as hue)',
  },
  'stereo off': {
    word: 'off',
    code: 0,
    mode: null,
    stereoOn: false,
    carrier: 'monoscopic',
    effect: 'stereo off; stereo_mode stays latched at the last mode chosen',
  },
};

/**
 * Why this leaf can never be honoured by a browser client, or `null`.
 *
 * Keyed by command so `MenuBar` can consult it for a `do` action without
 * knowing anything about stereo. See the module note: this is a property of the
 * TRANSPORT (one 2-D raster per frame), not of the PyMOL build, so it does not
 * probe anything and does not change when the engine's own refusal changes.
 */
export const STEREO_UNAVAILABLE: Readonly<Record<string, string>> = {
  'stereo quadbuffer':
    'quad-buffered stereo needs two GL colour buffers on the display; this client is sent ' +
    'ONE image per frame off a single offscreen FBO, so there is nothing to carry the second eye ' +
    "(PyMOL also refuses it on this build: \"no 'quadbuffer' support detected\")",
  'stereo openvr':
    'OpenVR drives a head-mounted display from the PyMOL process; there is no HMD at the far end ' +
    "of a WebSocket (PyMOL also refuses it on this build: \"'openvr' stereo mode not available\")",
};

/** Every command in the Stereo Mode submenu, in tree order. */
export const STEREO_COMMANDS: readonly string[] = Object.keys(STEREO_LEAVES);

export function stereoLeaf(command: string): StereoLeaf | null {
  return STEREO_LEAVES[command] ?? null;
}

/** Does this menu contain any Stereo Mode leaf? Decides whether to pay for the probe. */
export function hasStereoLeaves(nodes: readonly MenuNode[]): boolean {
  for (const node of walkMenu(nodes)) {
    if (node.kind === 'command' && node.action.type === 'do' && stereoLeaf(node.action.command)) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Where it will be visible
 * ------------------------------------------------------------------ */

/**
 * The reps this browser has told the bridge it is drawing itself.
 *
 * `null` means "not asked / the bridge did not say", which is NOT the same as
 * "none" and must not be reported as if it were. The compositor declares the
 * list on `_bridge.set_pixel_stream {geometryReps}` whenever the per-rep policy
 * changes (`packages/viewport/src/compositor/wiring.ts:125`) and the bridge
 * echoes it back in `_bridge.render_stats().modeP.params.geometryReps` — a
 * route with no side effects at all.
 */
export type ClientReps = readonly RepId[] | null;

export const RENDER_STATS_FN = '_bridge.render_stats';

/** Pull `geometryReps` out of a `render_stats` payload. Tolerant by design. */
export function clientRepsFrom(stats: unknown): ClientReps {
  const params = (stats as { modeP?: { params?: { geometryReps?: unknown } } } | null)?.modeP
    ?.params;
  const reps = params?.geometryReps;
  if (!Array.isArray(reps)) return null;
  return reps.filter((rep): rep is RepId => typeof rep === 'number');
}

/**
 * One clause naming where a server-side stereo mode will and will not show.
 *
 * This is the sentence waves 8-10 could not write, and it is a measurement
 * rather than a guess: with nothing declared the server is drawing everything
 * and the whole viewport is stereo; with reps declared, those reps are three.js
 * geometry in the browser and no server setting touches them.
 */
export function stereoScope(reps: ClientReps): string {
  if (reps === null) return 'applies to whatever the server is drawing (Mode P)';
  if (reps.length === 0) {
    return 'the server is drawing the whole scene (Mode P), so this applies to all of it';
  }
  const names = reps.map((rep) => repName(rep)).join(', ');
  return `${names} ${reps.length === 1 ? 'is' : 'are'} drawn by this browser (Mode G) and will NOT be in stereo`;
}

/** Tooltip suffix for a live Stereo Mode leaf. */
export function stereoTooltip(command: string, reps: ClientReps): string | null {
  const leaf = stereoLeaf(command);
  if (!leaf) return null;
  return `${leaf.effect} — ${stereoScope(reps)}`;
}

/* ------------------------------------------------------------------ *
 * What the engine actually did
 * ------------------------------------------------------------------ */

export interface StereoState {
  /** `cmd.get('stereo')` — 'on' / 'off'. */
  stereo: string;
  /** `cmd.get('stereo_mode')` — the STRING form of an int setting. */
  stereoMode: string;
}

/**
 * The console line to write after a Stereo Mode leaf ran, or `null` when the
 * label already told the whole truth and there is nothing to add.
 *
 * A menu click that changes a setting the user cannot see is the failure mode
 * this row exists to remove, so the note fires exactly when what happened is
 * not what the leaf's own label promises.
 */
export function stereoNote(command: string, after: StereoState, reps: ClientReps): string | null {
  const leaf = stereoLeaf(command);
  if (!leaf) return null;
  const on = after.stereo === 'on';

  // The engine refused it: `stereo` is still off although the leaf turns it on.
  if (leaf.stereoOn === true && !on) {
    return (
      ` stereo ${leaf.word}: the engine did not enable stereo (stereo is still off) — ` +
      'see the error above'
    );
  }
  if (leaf.word === 'chromadepth') {
    return (
      ' stereo chromadepth is not a stereo mode: it sets chromadepth 1 and turns stereo OFF ' +
      `(packages/engine/layer3/Executive.cpp:9548) — ${stereoScope(reps)}`
    );
  }
  if (leaf.word === 'swap' && !on) {
    return ' stereo swap negated stereo_shift, but stereo is off, so nothing on screen changed';
  }
  if (leaf.stereoOn === true && on) {
    const hidden = reps !== null && reps.length > 0;
    return (
      ` stereo ${leaf.word}: stereo on, stereo_mode ${after.stereoMode} — ${stereoScope(reps)}` +
      (hidden ? '; switch those reps back to P in the viewport HUD to see them in stereo' : '')
    );
  }
  if (leaf.word === 'off') {
    return ` stereo off — stereo_mode stays latched at ${after.stereoMode}`;
  }
  return null;
}
