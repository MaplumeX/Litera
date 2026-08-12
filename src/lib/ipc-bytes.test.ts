import { describe, expect, it } from "vitest";
import { epubBytesFromIpc } from "./ipc-bytes";

describe("epubBytesFromIpc", () => {
  it("creates a Uint8Array view without copying the Raw IPC buffer", () => {
    const buffer = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;

    const bytes = epubBytesFromIpc(buffer);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.buffer).toBe(buffer);
    expect([...bytes]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
