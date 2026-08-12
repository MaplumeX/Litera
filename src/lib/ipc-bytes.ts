/** Create a byte view over a Tauri Raw IPC response without copying the EPUB. */
export function epubBytesFromIpc(buffer: ArrayBuffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}
