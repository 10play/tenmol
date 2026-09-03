/**
 * The blob-download helper is browser-only plumbing, so it is verified in jsdom:
 * it must create exactly one object URL, hand the anchor the basename, click
 * once, and revoke — with no host filesystem and no bridge in sight.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob, downloadBytes, downloadText } from './download';

/**
 * Capture the Blob handed to createObjectURL and the anchor that was clicked.
 * jsdom implements neither createObjectURL nor revokeObjectURL, so we DEFINE
 * them (spyOn can't hook a method that does not exist) and delete them after.
 */
function harness() {
  const blobs: Blob[] = [];
  const create = vi.fn((b: Blob) => {
    blobs.push(b);
    return `blob:mock/${blobs.length}`;
  });
  const revoke = vi.fn();
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revoke;
  const clicks: HTMLAnchorElement[] = [];
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
  return { blobs, create, revoke, clicks, click };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe('download helper', () => {
  it('downloadBytes: one object URL, basename filename, one click, PNG mime', () => {
    const h = harness();
    const name = downloadBytes('/srv/renders/image.png', [137, 80, 78, 71, 13, 10], 'image/png');

    expect(name).toBe('image.png'); // basename, not the server path
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.blobs[0]!.type).toBe('image/png');
    expect(h.clicks).toHaveLength(1);
    expect(h.clicks[0]!.download).toBe('image.png');
  });

  it('downloadText: serializes text into the blob', () => {
    const h = harness();
    const text = '{"kind":"tenmol-session"}';
    downloadText('session.pse', text, 'application/octet-stream');

    // jsdom's Blob exposes size/type but not .text(); size == the UTF-8 length.
    expect(h.blobs[0]!.type).toBe('application/octet-stream');
    expect(h.blobs[0]!.size).toBe(new TextEncoder().encode(text).length);
    expect(h.clicks[0]!.download).toBe('session.pse');
  });

  it('downloadBlob: strips a windows path, revokes after the click', () => {
    const h = harness();
    vi.useFakeTimers();
    downloadBlob('C:\\\\Users\\\\me\\\\model.pdb', new Blob(['ATOM']));
    expect(h.clicks[0]!.download).toBe('model.pdb');
    expect(h.revoke).not.toHaveBeenCalled(); // deferred
    vi.runAllTimers();
    expect(h.revoke).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
