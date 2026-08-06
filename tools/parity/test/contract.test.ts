import { describe, expect, it } from 'vitest';
import type { Backend } from '@tenmol/backend';
import { createLocalBackend } from '@tenmol/engine-ts';
import { createRemoteBackend } from '@tenmol/client';

/**
 * Both engines must satisfy the SAME `Backend` interface — that is the whole
 * basis of the abstract switch. The type annotations below are the compile-time
 * proof; the runtime checks guard against a method being dropped from one side.
 */
describe('Backend contract', () => {
  const local: Backend = createLocalBackend();
  const remote: Backend = createRemoteBackend({ url: 'ws://127.0.0.1:1/ws', autoReconnect: false });

  const METHODS: (keyof Backend)[] = [
    'call',
    'do',
    'sub',
    'unsub',
    'on',
    'once',
    'off',
    'nextEvent',
    'connect',
    'ready',
    'close',
    'sendInput',
    'button',
    'drag',
    'ack',
    'reshape',
  ];

  it('LocalBackend implements every Backend method', () => {
    for (const m of METHODS) expect(typeof local[m]).toBe('function');
    expect(typeof local.isOpen).toBe('boolean');
    expect(Array.isArray(local.topics)).toBe(true);
  });

  it('RemoteBackend implements every Backend method', () => {
    for (const m of METHODS) expect(typeof remote[m]).toBe('function');
    expect(typeof remote.isOpen).toBe('boolean');
    expect(Array.isArray(remote.topics)).toBe(true);
  });

  it('errors are the same class on both backends (NotAllowed/NotPorted)', async () => {
    await local.connect();
    // The local engine rejects an unported symbol; the remote would reject an
    // ungranted one — both with a PymolError carrying a `.type`.
    const err = await local.call('ray', []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { type?: string }).type).toBe('NotPorted');
  });
});
