/**
 * @tenmol/protocol — the topic registry.  ** FROZEN — WRITTEN ONCE BY WP-01 **
 *
 * Plan §5.2: `src/topics.ts` becomes `src/topics/`, one file per topic, one
 * owner each, with the barrel written once in wave 0 and never touched again
 * (§A8: "every would-be shared file becomes a directory of one-file-per-owner
 * modules with a barrel written once in wave 0").
 *
 * THIS FILE AND `./index.ts` ARE FROZEN. A later work package fills in its own
 * `topics/<name>.ts` and nothing else. If you believe you need a new topic,
 * that is a protocol change: it goes through WP-01's owner, not through an edit
 * here.
 *
 * This module deliberately has NO imports, so nothing can create a cycle
 * through it.
 */

/**
 * The complete topic set.
 *
 * 18 v1 topics, one per plan §6 assignment, PLUS `geometry` — which the plan
 * scheduled post-v1 under WP-26 but the product owner has since promoted onto
 * the critical path (Mode G is built in parallel with Mode P from the start).
 * That promotion is the only difference from the "18 files" of plan §5.2.
 */
export const TOPICS = [
  'feedback', // WP-03
  'progress', // WP-03
  'redisplay', // WP-03
  'pixels', // WP-04
  'view', // WP-09
  'selection', // WP-10
  'objects', // WP-12
  'menu', // WP-13
  'settings', // WP-15
  'wizard', // WP-16
  'editor', // WP-17
  'dialog', // WP-18
  'frame', // WP-20
  'scenes', // WP-20
  'movie_panel', // WP-20
  'seqview', // WP-21
  'colors', // WP-22
  'plugin', // WP-25
  'geometry', // WP-26 (promoted: Mode G is critical path)
] as const;

/** A valid wire-protocol topic name. */
export type Topic = (typeof TOPICS)[number];

const TOPIC_SET: ReadonlySet<string> = new Set<string>(TOPICS);

/** Type guard: is `v` one of the registered topic names? */
export function isTopic(v: unknown): v is Topic {
  return typeof v === 'string' && TOPIC_SET.has(v);
}

/* ------------------------------------------------------------------ *
 * Metadata
 * ------------------------------------------------------------------ */

/**
 * Which bridge clock produces a topic. Plan §1.1 (two threads only) and §1.5
 * (polling, 30 Hz / 4 Hz hidden).
 *
 *   status   — the 10 Hz status thread, restricted to the three
 *              lock-*attempting* calls (`get_progress`, `_get_feedback`,
 *              `get_setting_updates`). Nothing else may run there.
 *   state    — the 30 Hz (4 Hz when `document.hidden`) snapshot/diff tick on
 *              the engine thread.
 *   frame    — the 60 Hz draw pump.
 *   ondemand — pushed only in response to a client request or an invalidation.
 */
export type TopicSource = 'status' | 'state' | 'frame' | 'ondemand';

/** Per-topic metadata: which bridge clock produces it, ownership, and delivery quirks. */
export interface TopicMeta {
  topic: Topic;
  /** Work package that owns `topics/<topic>.ts` and the bridge producer. */
  owner: string;
  source: TopicSource;
  /**
   * True when the underlying PyMOL call DESTROYS the data it reads, so the
   * bridge must be its sole consumer and a dropped event is a lost event
   * (plan §1.2: two interleaved consumers gave `consumerA saw: [468]`,
   * `consumerB saw: []`).
   */
  destructiveDrain: boolean;
  /** True when the JSON event only ANNOUNCES data that arrives as a binary frame. */
  binarySidecar: boolean;
  note: string;
}

/** The metadata table for every registered topic. */
export const TOPIC_META: Readonly<Record<Topic, TopicMeta>> = {
  feedback: {
    topic: 'feedback',
    owner: 'WP-03',
    source: 'status',
    destructiveDrain: true,
    binarySidecar: false,
    note: '`cmd._get_feedback()` (packages/engine/modules/pymol/internal.py:596-606). None means "locked, retry", not "empty".',
  },
  progress: {
    topic: 'progress',
    owner: 'WP-03',
    source: 'status',
    destructiveDrain: false,
    binarySidecar: false,
    note: '`cmd.get_progress()` — the ONLY liveness signal while PyMOL is in a long C++ call (measured through a 4.3 s ray).',
  },
  redisplay: {
    topic: 'redisplay',
    owner: 'WP-03',
    source: 'state',
    destructiveDrain: true,
    binarySidecar: false,
    note: '`getRedisplay(reset=True)` — the dirty gate for Mode P.',
  },
  pixels: {
    topic: 'pixels',
    owner: 'WP-04',
    source: 'frame',
    destructiveDrain: false,
    binarySidecar: true,
    note: 'Mode P. The bitmap rides a binary frame; this event carries only the descriptor.',
  },
  view: {
    topic: 'view',
    owner: 'WP-09',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: '`cmd.get_view()` returns 25 floats, `cmd.set_view` takes exactly 18.',
  },
  selection: {
    topic: 'selection',
    owner: 'WP-10',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'Names always; counts only on a debounced request (`count_atoms` is 5,902 us at 500k atoms — banned from the hot tick).',
  },
  objects: {
    topic: 'objects',
    owner: 'WP-12',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'No Python data feed exists upstream; panels/objects.py is a NEW endpoint built from get_names/get_type/get_vis.',
  },
  menu: {
    topic: 'menu',
    owner: 'WP-13',
    source: 'ondemand',
    destructiveDrain: false,
    binarySidecar: false,
    note: '`pymol.menu.*` resolved over the wire; leaves are command STRINGS (packages/engine/layer4/PopUp.cpp:471-475) run via t:"do".',
  },
  settings: {
    topic: 'settings',
    owner: 'WP-15',
    source: 'status',
    destructiveDrain: true,
    binarySidecar: false,
    note: '`cmd.get_setting_updates()` — [] on a lock miss is indistinguishable from "nothing changed"; never build settle detection on it.',
  },
  wizard: {
    topic: 'wizard',
    owner: 'WP-16',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: '`cmd.get_wizard()` polled. The wizard EVENT MASK is not a transport (plan §1.5, measured unusable).',
  },
  editor: {
    topic: 'editor',
    owner: 'WP-17',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'Builder pick state. `cmd.clean` is IncentiveOnly — the button ships disabled, not broken.',
  },
  dialog: {
    topic: 'dialog',
    owner: 'WP-18',
    source: 'ondemand',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'Blocking Python dialogs resolve via this event + a Future. The request must come from a worker thread, never the engine thread.',
  },
  frame: {
    topic: 'frame',
    owner: 'WP-20',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'The BACKEND is the movie clock; the client never runs a frame timer.',
  },
  scenes: {
    topic: 'scenes',
    owner: 'WP-20',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: '`scenes_changed` (setting 254, packages/engine/layer1/SettingInfo.h:339) rides the settings drain — no new PyMOL event.',
  },
  movie_panel: {
    topic: 'movie_panel',
    owner: 'WP-20',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'The movie panel is a C++ Block::draw surface upstream; this is a new bridge endpoint.',
  },
  seqview: {
    topic: 'seqview',
    owner: 'WP-21',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'v1 renders the sequence viewer THROUGH MODE P; the Seeker model has no Python readout without C++ Task 5.',
  },
  colors: {
    topic: 'colors',
    owner: 'WP-22',
    source: 'state',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'Colour table and ramps. Index -> rgb is needed to interpret every `color` field on every other topic.',
  },
  plugin: {
    topic: 'plugin',
    owner: 'WP-25',
    source: 'ondemand',
    destructiveDrain: false,
    binarySidecar: false,
    note: 'READ-ONLY for v1 (product owner decision): list + preferences + startup paths, no network install.',
  },
  geometry: {
    topic: 'geometry',
    owner: 'WP-26',
    source: 'ondemand',
    destructiveDrain: false,
    binarySidecar: true,
    note: 'Mode G invalidation notices. The buffers ride binary frames, keyed per object/rep/state.',
  },
};

/** Topics whose real payload arrives as a binary frame, not inside the event. */
export const BINARY_SIDECAR_TOPICS: readonly Topic[] = TOPICS.filter(
  (t) => TOPIC_META[t].binarySidecar,
);

/** Topics backed by a destructive PyMOL drain (bridge must be sole consumer). */
export const DESTRUCTIVE_DRAIN_TOPICS: readonly Topic[] = TOPICS.filter(
  (t) => TOPIC_META[t].destructiveDrain,
);
