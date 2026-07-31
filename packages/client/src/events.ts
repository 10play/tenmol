/**
 * @tenmol/client — typed event emitter.
 *
 * Deliberately tiny (no `eventemitter3`, no Node `events`): the client must run
 * in the browser, in a worker and in vitest without a shim.
 *
 * Event keys are either a protocol topic (`objects`, `view`, ...) or a
 * namespaced lifecycle key (`connection:open`, `server:hello`,
 * `geometry:frame`). Topics contain no ':' so the two spaces cannot collide.
 */

import type { BinaryFrame, GeometryFrame, HelloMessage, PixelFrame, TopicPayloads } from '@tenmol/protocol';

export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/** Non-topic events emitted by {@link PymolConnection}. */
export interface ConnectionEvents {
  'connection:open': { url: string; attempt: number };
  'connection:close': { code: number; reason: string; wasClean: boolean };
  'connection:error': { error: Error };
  'connection:reconnecting': { attempt: number; delayMs: number };
  /** Emitted once per connection, on the server's first frame. */
  'server:hello': HelloMessage;
  /** A decoded binary geometry frame. */
  'geometry:frame': GeometryFrame;
  /** A decoded binary Mode-P pixel frame. */
  'pixels:frame': PixelFrame;
  /**
   * EVERY decoded binary frame, geometry and pixels alike, before the
   * per-kind split above. The viewport subscribes here so one listener sees
   * both modes in arrival order.
   */
  'binary:frame': BinaryFrame;
}

/**
 * Everything a client can listen to: one entry per protocol topic plus the
 * lifecycle events above.
 */
export type ClientEvents = TopicPayloads & ConnectionEvents;

export type ClientEventName = keyof ClientEvents & string;

/**
 * Minimal typed emitter.
 *
 * - `on` returns an unsubscribe function (also removable with `off`).
 * - A listener that throws does not prevent the other listeners from running;
 *   the error goes to `onListenerError`.
 * - Mutating the listener set during `emit` is safe (the set is snapshotted).
 */
export class TypedEmitter<Events extends object> {
  private readonly listeners = new Map<string, Set<Listener<never>>>();

  /** Called when a listener throws. Override for logging/telemetry. */
  onListenerError: (error: unknown, event: string) => void = (error, event) => {
    console.error(`[tenmol] listener for "${event}" threw:`, error);
  };

  on<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const wrapped: Listener<Events[K]> = (payload) => {
      this.off(event, wrapped);
      listener(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof Events & string>(event: K, listener: Listener<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener<never>);
    if (set.size === 0) this.listeners.delete(event);
  }

  /** Resolves the next time `event` fires. */
  next<K extends keyof Events & string>(event: K): Promise<Events[K]> {
    return new Promise<Events[K]>((resolve) => {
      this.once(event, resolve);
    });
  }

  /** Returns the number of listeners invoked. */
  emit<K extends keyof Events & string>(event: K, payload: Events[K]): number {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return 0;
    let count = 0;
    for (const listener of [...set]) {
      count++;
      try {
        (listener as unknown as Listener<Events[K]>)(payload);
      } catch (error) {
        this.onListenerError(error, event);
      }
    }
    return count;
  }

  listenerCount(event?: keyof Events & string): number {
    if (event === undefined) {
      let total = 0;
      for (const set of this.listeners.values()) total += set.size;
      return total;
    }
    return this.listeners.get(event)?.size ?? 0;
  }

  eventNames(): string[] {
    return [...this.listeners.keys()];
  }

  removeAllListeners(event?: keyof Events & string): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }
}
