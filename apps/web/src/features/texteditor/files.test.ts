/**
 * The text editor's "do the bridge file endpoints exist?" probe.
 *
 * This is the one decision in the editor that must not be optimistic: getting
 * it wrong makes the panel claim it wrote to the PyMOL host when the bytes
 * actually went to ~/Downloads. The strings below are the bridge's real ones,
 * captured from this tree.
 */

import { describe, expect, it } from 'vitest';
import { MISSING_ROUTE, probeServerFiles } from './files';
import type { Session } from '../../app';

const fakeSession = (behaviour: () => Promise<unknown>): Session =>
  ({ call: () => behaviour() }) as unknown as Session;

describe('MISSING_ROUTE', () => {
  it('recognises the bridge answers that mean "the endpoint does not exist"', () => {
    // measured: `{t:'call', fn:'_bridge.read_text_file'}` on this tree
    expect(MISSING_ROUTE.test("no render route for '_bridge.read_text_file'")).toBe(true);
    // policy/base.py, for an un-granted namespace
    expect(MISSING_ROUTE.test("'_bridge' is not an addressable namespace")).toBe(true);
    expect(MISSING_ROUTE.test('cmd.foo: no such symbol (bar)')).toBe(true);
  });

  it('does NOT swallow a real path error, which means the route is there', () => {
    expect(MISSING_ROUTE.test('[Errno 2] No such file or directory: /tmp/x')).toBe(false);
    expect(MISSING_ROUTE.test('IsADirectoryError: /tmp')).toBe(false);
    expect(MISSING_ROUTE.test('PermissionError: /etc/shadow')).toBe(false);
  });
});

describe('probeServerFiles', () => {
  it('is true when the endpoint answers', async () => {
    expect(await probeServerFiles(fakeSession(() => Promise.resolve({ text: '' })))).toBe(true);
  });

  it('is false when the endpoint is not routed', async () => {
    const session = fakeSession(() =>
      Promise.reject(new Error("no render route for '_bridge.read_text_file'")),
    );
    expect(await probeServerFiles(session)).toBe(false);
  });

  it('is TRUE when the endpoint exists and only the path was bad', async () => {
    const session = fakeSession(() =>
      Promise.reject(new Error('[Errno 2] No such file or directory: ')),
    );
    expect(await probeServerFiles(session)).toBe(true);
  });
});
