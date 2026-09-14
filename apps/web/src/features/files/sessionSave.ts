/**
 * The browser-only `Save Session` download, shared by `File ▸ Save Session`
 * (`FilesPanel`) and the Ctrl+S accelerator (`FileDropTarget`).
 *
 * A "save" is a download, not a host-filesystem write: `cmd.get_session`
 * produces what the engine reloads, and `downloadText`/`downloadBytes` never
 * touch `cmd.tenmol_files.*`, so there is no `save <path>` (which writes to disk
 * and THROWS in the browser).
 *
 * TWO BACKENDS, one path. On the LOCAL engine `cmd.get_session` returns the
 * session OBJECT and we download its JSON. On the REMOTE PyMOL bridge the same
 * call is in `BLOB_RETURNS` (`packages/bridge/tenmol_bridge/codec.py`) and
 * resolves to a blob HANDLE — a tiny stub referencing a server temp blob, not
 * the `.pse` bytes — so JSON-stringifying it would download the stub. When the
 * snapshot is a blob handle we fetch the REAL bytes from
 * `session.config.httpOrigin + url` (the same pattern `volume/service.ts` uses
 * for `get_volume_field`) and download those.
 */

import type { Session } from '../../app';
import { downloadBytes, downloadText } from './download';

/** A wire reference to a binary blob the bridge holds: its fetch URL and MIME. */
interface BlobHandle {
  __blob__: true;
  url: string;
  mime?: string;
}

/**
 * A local minimal type guard rather than a cross-feature import: the shape is
 * tiny and `volume/service.ts` keeps its own copy too, so this keeps coupling
 * between the two features at zero.
 */
function isBlob(value: unknown): value is BlobHandle {
  return typeof value === 'object' && value !== null && '__blob__' in value;
}

/** Serialize the engine's session snapshot and download it as `name`. */
export async function saveSession(session: Session, name: string): Promise<void> {
  const snap = await session.call('cmd.get_session');
  if (isBlob(snap)) {
    const bytes = new Uint8Array(
      await (await fetch(`${session.config.httpOrigin}${snap.url}`)).arrayBuffer(),
    );
    downloadBytes(name, bytes, snap.mime || 'application/octet-stream');
    return;
  }
  downloadText(name, JSON.stringify(snap), 'application/octet-stream');
}
