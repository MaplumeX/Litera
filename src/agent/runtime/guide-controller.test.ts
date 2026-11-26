import { describe, expect, it, vi } from "vitest";
import { GuideController, type GuideRuntimePort } from "./guide-controller";
import { guideRequestContext } from "./guide";
import type { BookTocEntry } from "@/agent/book/book-content";

function mockRuntimePort(): GuideRuntimePort {
  return {
    subscribe: vi.fn(() => () => {}),
    syncBook: vi.fn(),
    listSessions: vi.fn(),
    loadCanonicalGuide: vi.fn(),
    ensureCanonicalGuideSession: vi.fn(async () => "guided-1"),
    newSession: vi.fn(),
    switchSession: vi.fn(),
    switchBranchAtAnchor: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    updateSessionConfig: vi.fn(),
    restartGuidedSession: vi.fn(),
    guideContextStats: vi.fn(() => ({ recapCount: 2, activeTokens: 1200, windowTarget: 35000 })),
    resetGuideContext: vi.fn(),
    nextGuideStep: vi.fn(),
    guideStepAfterChapter: vi.fn(),
    guideStepAtHref: vi.fn(),
    guideOutline: vi.fn(),
    guideStepTo: vi.fn(),
    guideStepToSelection: vi.fn(),
    guideStepAnchor: vi.fn(),
    guideStepImages: vi.fn(),
    readStepImageUrl: vi.fn(),
    guideTocProgress: vi.fn(),
    guidePageMarks: vi.fn(),
    locateQuote: vi.fn(),
    prompt: vi.fn(),
    abort: vi.fn(),
    refreshAfterSync: vi.fn(),
  };
}

describe("GuideController", () => {
  it("injects structured GuideStepOptions (pace & styleOverride) on takeStep", async () => {
    const port = mockRuntimePort();
    const controller = new GuideController(port);

    await controller.takeStep(
      "继续带读",
      {},
      { pace: "deep", styleOverride: "重点梳理逻辑链" },
      "p-1",
      "r-1",
    );

    expect(port.prompt).toHaveBeenCalledWith(
      "继续带读",
      { guideRequest: { pace: "deep", styleOverride: "重点梳理逻辑链" } },
      "p-1",
      "r-1",
      undefined,
    );
  });

  it("omits standard pace so default requests stay minimal", async () => {
    const port = mockRuntimePort();
    const controller = new GuideController(port);

    await controller.takeStep("继续带读", {}, { pace: "standard" }, "p-2");

    expect(port.prompt).toHaveBeenCalledWith("继续带读", { guideRequest: {} }, "p-2", undefined, undefined);
  });

  it("ensures canonical guide session and forwards askSideQuestion without guideRequest", async () => {
    const port = mockRuntimePort();
    const controller = new GuideController(port);

    expect(await controller.ensureCanonicalGuide("req-1")).toBe("guided-1");
    await controller.askSideQuestion("这个术语什么意思？", { selection: "异化", chapterHref: "ch1.xhtml" }, "p-3");

    expect(port.prompt).toHaveBeenCalledWith(
      "这个术语什么意思？",
      { selection: "异化", chapterHref: "ch1.xhtml" },
      "p-3",
      undefined,
      undefined,
    );
  });

  it("formats pace and styleOverride cleanly into guideRequestContext", () => {
    const toc: BookTocEntry[] = [
      { index: 0, label: "Ch 1", href: "ch1.xhtml", hrefs: ["ch1.xhtml"], ancestors: [], depth: 0, chars: 1000, parts: 1, blocks: 5, partStarts: [0] },
    ];
    const compact = guideRequestContext(toc, null, undefined, { pace: "compact" });
    expect(compact).toContain("Explanation pace for this step: compact");

    const deep = guideRequestContext(toc, null, undefined, { pace: "deep", styleOverride: "Use bullet chains" });
    expect(deep).toContain("Explanation pace for this step: deep");
    expect(deep).toContain("Additional style guidance for this step: Use bullet chains");
  });
});
