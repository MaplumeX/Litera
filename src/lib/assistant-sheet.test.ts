import { describe, expect, it } from "vitest";
import { readerModeForSnap, snapAfterDrag, snapForReaderMode } from "./assistant-sheet";

describe("assistant sheet ↔ reader mode", () => {
  it("opens full screen for a Book last used in Agent mode, collapsed otherwise", () => {
    expect(snapForReaderMode("agent")).toBe("full");
    expect(snapForReaderMode("reader")).toBe("collapsed");
  });

  it("remembers full screen as Agent mode and anything with the Book visible as Reading", () => {
    expect(readerModeForSnap("full")).toBe("agent");
    expect(readerModeForSnap("half")).toBe("reader");
    expect(readerModeForSnap("collapsed")).toBe("reader");
  });
});

describe("snapAfterDrag", () => {
  const height = 800;

  it("stays put after a small drag", () => {
    expect(snapAfterDrag("half", 20, height)).toBe("half");
    expect(snapAfterDrag("full", -20, height)).toBe("full");
  });

  it("goes full screen when dragged up from half", () => {
    expect(snapAfterDrag("half", -250, height)).toBe("full");
  });

  it("goes back to half when dragged down from full", () => {
    expect(snapAfterDrag("full", 300, height)).toBe("half");
  });

  it("collapses when dragged down from half", () => {
    expect(snapAfterDrag("half", 250, height)).toBe("collapsed");
  });

  it("collapses on a long drag down from full", () => {
    expect(snapAfterDrag("full", 700, height)).toBe("collapsed");
  });

  it("keeps the snap when the container has no height yet", () => {
    expect(snapAfterDrag("half", 300, 0)).toBe("half");
  });
});
