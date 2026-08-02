/**
 * Topic -> store, with sequence-gap detection.
 *
 * `EventMessage.seq` is monotonic PER TOPIC PER CONNECTION
 * (`packages/bridge/tenmol_bridge/session.py: Subscriptions.next_seq`), and it exists for
 * exactly one reason: a client that misses an event must be able to tell, and
 * force a resync, rather than render stale state forever. That check lives here.
 *
 * *** KNOWN LIMITATION, MEASURED, NOT GUESSED ***
 * `@tenmol/client` currently drops `seq` on the floor:
 *
 *     // packages/client/src/connection.ts, handleText()
 *     this.emitter.emit(message.topic, message.payload as never);
 *
 * — the payload is forwarded, `message.seq` is not. So today every binding runs
 * with `seq === undefined` and gap detection is INERT (it reports
 * `seqAvailable: false` rather than pretending everything is fine). The moment
 * WP-05/WP-06 forward the seq, `bind()` starts working with no change here. This
 * is reported upstream in `needsFromOthers`; the binding is written now so the
 * fix is a one-line change on their side, not a new feature on mine.
 */

export type TopicUnsubscribe = () => void;

export interface TopicBindingOptions<P> {
  topic: string;
  /** Called for every payload, in arrival order. */
  apply: (payload: P) => void;
  /**
   * Called when `seq` jumps. The handler must re-read the whole topic (or force
   * a full poll pass); resuming from a gap is never safe, because every topic
   * payload is a diff or a snapshot of live PyMOL state, not a log.
   */
  onGap?: (info: { topic: string; expected: number; received: number }) => void;
}

export interface TopicBinding<P> {
  /** Feed one event. `seq` is optional until the client forwards it. */
  receive(payload: P, seq?: number): void;
  /** Reset after a reconnect: the bridge restarts `seq` at 1 per connection. */
  reset(): void;
  readonly lastSeq: number;
  readonly gaps: number;
  readonly seqAvailable: boolean;
}

export function createTopicBinding<P>(options: TopicBindingOptions<P>): TopicBinding<P> {
  let lastSeq = 0;
  let gaps = 0;
  let seqAvailable = false;

  return {
    receive(payload: P, seq?: number): void {
      if (typeof seq === 'number') {
        seqAvailable = true;
        if (lastSeq !== 0 && seq !== lastSeq + 1) {
          gaps += 1;
          options.onGap?.({ topic: options.topic, expected: lastSeq + 1, received: seq });
        }
        lastSeq = seq;
      }
      options.apply(payload);
    },

    reset(): void {
      lastSeq = 0;
    },

    get lastSeq() {
      return lastSeq;
    },
    get gaps() {
      return gaps;
    },
    get seqAvailable() {
      return seqAvailable;
    },
  };
}

/**
 * The `invalidates` classes a `{t:'ok'}` frame carries (plan §1.5, the
 * command-echo channel — the only mechanism that can see per-atom colour and
 * per-atom reps, which polling provably cannot).
 *
 * NOTE the field name. `packages/protocol` declares `OkMessage.inval`, the
 * running bridge emits `invalidates`:
 *
 *     <- {"id":112,"t":"ok","result":null,"invalidates":["reps"]}
 *
 * Both are accepted here so whichever way that disagreement is settled, this
 * keeps working. (Reported upstream: `@tenmol/client.call()` discards the whole
 * frame except `result`, so today the app supplies these itself from the action
 * it just issued.)
 */
export type InvalidationClass = 'color' | 'reps' | 'geometry' | 'coords' | 'names' | 'resync';

export function invalidationsOf(frame: unknown): readonly InvalidationClass[] {
  if (typeof frame !== 'object' || frame === null) return [];
  const record = frame as Record<string, unknown>;
  const raw = record['invalidates'] ?? record['inval'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is InvalidationClass => typeof v === 'string') as InvalidationClass[];
}
