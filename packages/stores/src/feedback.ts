/**
 * The console scrollback.
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE: `cmd._get_feedback()` is a DESTRUCTIVE,
 * single-consumer read (`packages/engine/modules/pymol/internal.py:596-606`; plan §1.2 measured
 * two interleaved consumers as `consumerA saw: [468]`, `consumerB saw: []`).
 * The bridge is that consumer, and PyMOL keeps no readable scrollback of its own
 * (`I->Line[]` is a 256-entry ring at `packages/engine/layer1/Ortho.cpp:62` with no Python
 * route). So the scrollback, its ordering, its sequence numbers and the handling
 * of the bridge's replay-on-subscribe are ALL the client's problem. They are
 * this file.
 *
 * The bridge replays its own ring buffer (up to 2000 lines) on every
 * `{t:'sub',topic:'feedback'}` — verified against the running bridge:
 *
 *     -> {"id":1,"t":"sub","topic":"feedback"}
 *     <- {"id":1,"t":"ok","result":{"topic":"feedback","subscribed":true}}
 *     <- {"t":"feedback","lines":[" Detected OpenGL version 2.1. ...", ...]}
 *
 * That is exactly right for a first connect and exactly wrong for a RECONNECT,
 * where every line we already have comes back. `beginReplayWindow()` opens a
 * short window during which incoming batches are overlap-deduplicated against
 * the tail of what we already hold, so a reconnect appends only what was said
 * while we were away.
 *
 * Severity is INFERRED, never carried: `packages/engine/modules/pymol/colorprinting.py` routes
 * `error`, `warning`, `suggest` and `parrot` all to plain `print`, so severity
 * is gone before the string reaches the Ortho queue (plan §1.2). The patterns
 * below are the ones observed in spike 02 §8 (`e13.out`), not invented.
 */

import type { FeedbackSeverity } from '@tenmol/protocol';
import { createStore, type Store } from './createStore';

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

/**
 * `prompt` and `client` are additions to the protocol's four severities:
 *
 *   prompt — `PyMOL>...`, the bridge's echo of a `{t:'do'}` command line.
 *   client — emitted by THIS client (a button's equivalent command line, a
 *            transport notice). Rendered differently on purpose: the user must
 *            always be able to tell what PyMOL said from what the UI said.
 */
export type FeedbackKind = FeedbackSeverity | 'prompt' | 'client';

/** One console line with its classified kind and origin. */
export interface FeedbackEntry {
  /** Monotonic, assigned by this client. Never reused, never reordered. */
  seq: number;
  text: string;
  kind: FeedbackKind;
  /** True when the kind was reconstructed from the text (always true for server lines). */
  inferred: boolean;
  origin: 'server' | 'client';
}

/** spike 02 §8: `" Error:"`, `" Selector-Error:"`, `"NameError:"`, tracebacks. */
const RE_ERROR =
  /^(?:\s*Error:|\s*[\w-]+-Error:|Traceback \(most recent call last\):|\s*\w*(?:Error|Exception):)/;
/** spike 02 §8: `" Setting-Warning: colored_feedback is not supported ..."`. */
const RE_WARNING = /^\s*(?:[\w-]+-)?Warning:/;
/** The command echo produced by `cmd.do(..., echo=1)`. */
const RE_PROMPT = /^PyMOL>/;
/**
 * The caret continuation lines that follow a selection error
 * (`"( ( ( (<--"`, `"nonexistent_object<--"`). internal-gui.md and spike 02 §8:
 * they are unintelligible unless rendered with the error above them.
 */
const RE_CARET = /<--\s*$/;

/**
 * One line -> one kind. `previous` is the kind of the line immediately above,
 * used only to keep caret continuation lines with their error.
 */
export function classifyLine(text: string, previous?: FeedbackKind): FeedbackKind {
  if (RE_PROMPT.test(text)) return 'prompt';
  if (RE_ERROR.test(text)) return 'error';
  if (RE_WARNING.test(text)) return 'warning';
  if (RE_CARET.test(text) && (previous === 'error' || previous === 'warning')) return previous;
  return 'info';
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

/** The console store's state: the capped ring plus dedup/replay bookkeeping. */
export interface FeedbackState {
  /** Newest last. Capped at `capacity` (plan §6 WP-11: 5,000 lines). */
  lines: readonly FeedbackEntry[];
  /** Next sequence number to hand out. */
  nextSeq: number;
  /** Lines evicted from the head of the ring since the session started. */
  evicted: number;
  /** Server lines accepted (post-deduplication) since the session started. */
  serverLines: number;
  /** Server lines dropped as replay duplicates. Shown in the status bar. */
  deduped: number;
  /** Epoch ms until which incoming batches are treated as a possible replay. */
  replayUntil: number;
}

/** The console store: appends server/client lines and manages replay. */
export interface FeedbackStore extends Store<FeedbackState> {
  /** Lines drained from PyMOL by the bridge. */
  appendServer(lines: readonly string[]): void;
  /** A line this client generated (command echo when offline, transport notices). */
  appendClient(text: string | readonly string[], kind?: FeedbackKind): void;
  /**
   * Open the replay-suppression window. Call this immediately before sending
   * `{t:'sub',topic:'feedback'}` — the bridge answers with its whole ring.
   */
  beginReplayWindow(ms?: number): void;
  clear(): void;
}

const DEFAULT_CAPACITY = 5000;
/** Bridge-side replay is `status_poller.lines(limit=2000)` (server.py). */
const MAX_OVERLAP = 2000;
const DEFAULT_REPLAY_WINDOW_MS = 1500;

/** Construction options for {@link createFeedbackStore}. */
export interface FeedbackStoreOptions {
  capacity?: number;
  /** Injectable clock so the replay window is testable without timers. */
  now?: () => number;
}

/** Build a {@link FeedbackStore} — the console line ring with replay dedup. */
export function createFeedbackStore(options: FeedbackStoreOptions = {}): FeedbackStore {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const now = options.now ?? (() => Date.now());

  const store = createStore<FeedbackState>({
    lines: [],
    nextSeq: 1,
    evicted: 0,
    serverLines: 0,
    deduped: 0,
    replayUntil: 0,
  });

  function push(
    state: FeedbackState,
    texts: readonly string[],
    origin: 'server' | 'client',
    kind?: FeedbackKind,
  ) {
    const lines = [...state.lines];
    let seq = state.nextSeq;
    let previous = lines.length > 0 ? lines[lines.length - 1]?.kind : undefined;
    for (const text of texts) {
      const resolved = kind ?? classifyLine(text, previous);
      lines.push({ seq: seq++, text, kind: resolved, inferred: kind === undefined, origin });
      previous = resolved;
    }
    const overflow = Math.max(0, lines.length - capacity);
    return {
      lines: overflow > 0 ? lines.slice(overflow) : lines,
      nextSeq: seq,
      evicted: state.evicted + overflow,
    };
  }

  return {
    ...store,

    appendServer(incoming: readonly string[]): void {
      if (incoming.length === 0) return;
      store.set((state) => {
        let lines = incoming;
        let deduped = 0;
        if (now() < state.replayUntil) {
          const skip = overlapLength(state.lines, incoming);
          if (skip > 0) {
            lines = incoming.slice(skip);
            deduped = skip;
          }
        }
        if (lines.length === 0) {
          return { deduped: state.deduped + deduped };
        }
        return {
          ...push(state, lines, 'server'),
          serverLines: state.serverLines + lines.length,
          deduped: state.deduped + deduped,
        };
      });
    },

    appendClient(text: string | readonly string[], kind: FeedbackKind = 'client'): void {
      const texts = typeof text === 'string' ? [text] : text;
      if (texts.length === 0) return;
      store.set((state) => push(state, texts, 'client', kind));
    },

    beginReplayWindow(ms: number = DEFAULT_REPLAY_WINDOW_MS): void {
      store.set({ replayUntil: now() + ms });
    },

    clear(): void {
      store.set({ lines: [], evicted: 0, deduped: 0 });
    },
  };
}

/**
 * Longest k such that the last k texts we hold equal the first k of `incoming`.
 *
 * This is the reconnect resync: the bridge's replay is a suffix of the whole
 * stream, so the part we already have is a prefix of the replay. Bounded at
 * `MAX_OVERLAP` because the bridge never replays more than that.
 */
export function overlapLength(
  existing: readonly FeedbackEntry[],
  incoming: readonly string[],
): number {
  const serverTail: string[] = [];
  for (let i = existing.length - 1; i >= 0 && serverTail.length < MAX_OVERLAP; i--) {
    const entry = existing[i];
    if (entry && entry.origin === 'server') serverTail.push(entry.text);
  }
  serverTail.reverse();

  const max = Math.min(serverTail.length, incoming.length, MAX_OVERLAP);
  for (let k = max; k > 0; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (serverTail[serverTail.length - k + i] !== incoming[i]) {
        match = false;
        break;
      }
    }
    if (match) return k;
  }
  return 0;
}
