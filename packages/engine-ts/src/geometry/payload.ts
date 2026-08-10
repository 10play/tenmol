/**
 * Shared Mode-G frame-building scaffolding, used by every rep geometry builder
 * (`frames.ts` and the per-rep modules `cartoon.ts`, `ribbon.ts`, …). Keeping
 * this here — rather than file-private in `frames.ts` — lets each rep builder
 * live in its OWN module and still pack payloads the identical, 4-byte-aligned,
 * zero-copy way the protocol requires.
 */

import {
  alignUp,
  encodeBinaryFrame,
  type BinaryFrameHeader,
  type BufferRef,
} from '@tenmol/protocol';

/** A pending buffer to place into the payload. */
interface Pending {
  bytes: Uint8Array;
  dtype: BufferRef['dtype'];
  itemSize: number;
  assign: (ref: BufferRef) => void;
}

/**
 * Accumulates typed sub-buffers, then `build()`s them into one payload with each
 * buffer at a 4-byte-aligned offset (so `viewOf()` on the client is zero-copy),
 * patching each {@link BufferRef} back via its `assign` callback.
 */
export class PayloadBuilder {
  private readonly pending: Pending[] = [];

  addF32(data: Float32Array, itemSize: number, assign: (ref: BufferRef) => void): void {
    this.pending.push({
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      dtype: 'f32',
      itemSize,
      assign,
    });
  }

  addI32(data: Int32Array, itemSize: number, assign: (ref: BufferRef) => void): void {
    this.pending.push({
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      dtype: 'i32',
      itemSize,
      assign,
    });
  }

  addU32(data: Uint32Array, itemSize: number, assign: (ref: BufferRef) => void): void {
    this.pending.push({
      bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      dtype: 'u32',
      itemSize,
      assign,
    });
  }

  /** Pack every buffer 4-byte aligned; returns the concatenated payload. */
  build(): Uint8Array {
    let offset = 0;
    for (const p of this.pending) offset = alignUp(offset) + p.bytes.byteLength;
    const out = new Uint8Array(offset);
    let cursor = 0;
    for (const p of this.pending) {
      cursor = alignUp(cursor);
      out.set(p.bytes, cursor);
      p.assign({
        byteOffset: cursor,
        byteLength: p.bytes.byteLength,
        dtype: p.dtype,
        itemSize: p.itemSize,
      });
      cursor += p.bytes.byteLength;
    }
    return out;
  }
}

/** Wrap a header + packed payload into the wire frame. */
export function encode(header: BinaryFrameHeader, payload: Uint8Array): ArrayBuffer {
  return encodeBinaryFrame(header, payload);
}
