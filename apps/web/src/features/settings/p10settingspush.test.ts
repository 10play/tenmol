/**
 * The client half of the `settings` push — rows 00:208 and 00:209.
 *
 * For four waves this topic accepted a subscription and NOTHING anywhere
 * published to it. Waves 4, 7, 8 and 9 each wrote the same sentence against
 * these two rows and each named the same unreachable line,
 * `BridgeServer._on_status`. That line now publishes (proved over the socket in
 * `packages/bridge/tests/test_p10_infra.py`), so this is the other end: the service
 * subscribes exactly once, and a pushed event KICKS the cursor-addressed poll
 * instead of waiting up to 200 ms for the next tick of it.
 *
 * WHY KICK RATHER THAN APPLY. The apply path lives in `@tenmol/stores/settings`
 * behind `source.poll()`; the tap it reads is cursor-addressed and therefore
 * idempotent, so a push and a poll describing the same write cost one re-read,
 * not two, and a push that went missing loses nothing at all. It also keeps the
 * number of consumers of `cmd.get_setting_updates()` at exactly one — both
 * channels are fan-outs of the single drain the bridge status thread makes.
 */

import { describe, expect, it, vi } from 'vitest';

import { getSettingsService } from './service';

type Handler = (payload: unknown) => void;

function fakeSession() {
  const handlers = new Map<string, Handler[]>();
  const subs: string[] = [];
  const call = vi.fn(async (fn: string) => {
    if (fn === 'setting.tenmol_settings_status') {
      throw new Error('setting.tenmol_settings_status: no such symbol');
    }
    if (fn === 'setting.tenmol_settings_drain') {
      return { cursor: 0, indices: [], batches: 0, full: false, lost: false, observing: true };
    }
    return null;
  });
  const session = {
    call: call as never,
    conn: {
      do: vi.fn(() => Promise.resolve()),
      isOpen: true,
      on: vi.fn((topic: string, handler: Handler) => {
        const list = handlers.get(topic) ?? [];
        list.push(handler);
        handlers.set(topic, list);
        return () => undefined;
      }),
      sub: vi.fn((topic: string) => {
        subs.push(topic);
        return Promise.resolve();
      }),
    },
    poller: { kick: vi.fn() },
    stores: {},
  };
  const emit = (topic: string, payload: unknown) => {
    for (const handler of handlers.get(topic) ?? []) handler(payload);
  };
  return { session, subs, emit };
}

/** One real payload, as `_enrich_settings` builds it (index 254 in the C table). */
const PUSH = {
  changed: {
    '254': {
      index: 254,
      name: 'cartoon_ring_mode',
      kind: 'int',
      value: 3,
      text: '3',
    },
  },
  full: false,
  indices: [254],
};

describe('the settings push (rows 208 and 209)', () => {
  it('subscribes to the topic exactly once per session', () => {
    const { session, subs } = fakeSession();
    const service = getSettingsService(session as never);
    // A second lookup must not subscribe again: the connection re-sends live
    // subscriptions itself after a reconnect, and a double subscribe was a
    // real, measured bug (WP-05).
    expect(getSettingsService(session as never)).toBe(service);
    expect(subs).toEqual(['settings']);
    expect(session.conn.on).toHaveBeenCalledTimes(1);
    expect((session.conn.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('settings');
  });

  it('kicks the tap poll the moment a change is pushed', async () => {
    const { session, emit } = fakeSession();
    const service = getSettingsService(session as never);
    const kick = vi.spyOn(service.poller, 'kick');

    expect(service.pushes()).toBe(0);
    emit('settings', PUSH);
    expect(service.pushes()).toBe(1);
    expect(kick).toHaveBeenCalledTimes(1);

    // A full resync carries no values at all — the flag IS the message.
    emit('settings', { changed: {}, full: true, indices: [1, 2, 3] });
    expect(service.pushes()).toBe(2);
    expect(kick).toHaveBeenCalledTimes(2);
  });

  it('does not drain get_setting_updates itself, on either channel', () => {
    const { session, emit } = fakeSession();
    getSettingsService(session as never);
    emit('settings', PUSH);
    const called = (session.call as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (args) => args[0] as string,
    );
    expect(called).not.toContain('cmd.get_setting_updates');
    // And the bridge refuses it anyway (`EXCLUSIVE_TO_BRIDGE`,
    // `policy/base.py:122-128`), asserted over the socket in
    // `packages/bridge/tests/test_p10_infra.py::test_the_push_does_not_open_a_second_drain`.
  });
});
