/**
 * Browser-native "save a file" — the single blob-download helper.
 *
 * Browser-only builds have no host filesystem: a "save" is a download. Three
 * ad-hoc copies of this had accreted (`filesApi.saveToBrowser`,
 * `texteditor/files.downloadFile`, an inline PNG blob in `RenderDialog`); this
 * is the one they should all route through. It is deliberately bridge-free — it
 * takes bytes/text the caller already has (from `cmd.get_session`,
 * `cmd.get_str`, `cmd.png`, …) and never touches `cmd.tenmol_files`.
 */

/** Trigger a download of `blob` as `name`. Returns the filename used. */
export function downloadBlob(name: string, blob: Blob): string {
  const filename = (name || 'download').split(/[\\/]/).pop() || 'download';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoke after the click has been dispatched; a 0ms task is enough and keeps
  // the URL alive for the synchronous navigation the click starts.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/** Download raw bytes (e.g. a PNG from `cmd.png`) with an explicit MIME type. */
export function downloadBytes(name: string, bytes: Uint8Array | number[], mime: string): string {
  const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  // Copy into a fresh ArrayBuffer-backed view so the Blob part is a plain
  // BlobPart regardless of how the caller allocated `bytes`.
  return downloadBlob(name, new Blob([u8], { type: mime }));
}

/** Download text (e.g. a PDB/session string) as `name`. */
export function downloadText(name: string, text: string, mime = 'text/plain;charset=utf-8'): string {
  return downloadBlob(name, new Blob([text], { type: mime }));
}
