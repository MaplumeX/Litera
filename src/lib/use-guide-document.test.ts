// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, GuideStep } from "@/types/agent";
import type { CanonicalGuideSnapshot } from "@/agent/runtime/embedded-runtime";

const listeners = new Set<(event: AgentEvent) => void>();
const loadCanonicalGuide = vi.fn<(bookId: string) => Promise<CanonicalGuideSnapshot | null>>();
const guideTocProgress = vi.fn();
const guidePageMarks = vi.fn();

vi.mock("@/agent/runtime/embedded-runtime", () => ({
  embeddedAgentRuntime: {
    subscribe: (listener: (event: AgentEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadCanonicalGuide: (bookId: string) => loadCanonicalGuide(bookId),
    guideTocProgress: (...args: unknown[]) => guideTocProgress(...args),
    guidePageMarks: (...args: unknown[]) => guidePageMarks(...args),
  },
}));

import { useGuideDocument } from "./use-guide-document";

const step0: GuideStep = {
  from: { chapterIndex: 0, chapterTitle: "第一章", block: 0, paragraph: 1 },
  to: { chapterIndex: 0, chapterTitle: "第一章", block: 4, paragraph: 5 },
};

describe("useGuideDocument", () => {
  beforeEach(() => {
    listeners.clear();
    loadCanonicalGuide.mockReset();
    guideTocProgress.mockReset();
    guidePageMarks.mockReset();
    guideTocProgress.mockResolvedValue({
      "ch1.xhtml": { coveredBlocks: 5, totalBlocks: 10, current: true },
    });
    guidePageMarks.mockResolvedValue({
      "ch1.xhtml": { read: ["opening"], cursor: "opening", steps: { opening: 0 } },
    });
  });

  it("loads Book-scoped canonical Guide marks and cards independently of active chat session", async () => {
    loadCanonicalGuide.mockResolvedValue({
      bookId: "book-1",
      sessionId: "guided-1",
      messages: [
        { role: "user", content: "继续带读", guideRequest: {} },
        {
          role: "assistant",
          content: "第一章讲解",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "tc-1", tool: "guide_step", params: {}, done: true, guide: step0 } },
            { type: "text", text: "第一章讲解" },
          ],
        },
      ],
      anchors: ["a0", ""],
      navigation: {},
    });

    const toc = [{ id: "1", label: "第一章", href: "ch1.xhtml" }];
    const { result } = renderHook(() => useGuideDocument("book-1", toc));

    await waitFor(() => expect(result.current.steps).toHaveLength(1));
    expect(result.current.canonicalSessionId).toBe("guided-1");
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0].explanation).toBe("第一章讲解");
    expect(result.current.pageMarks?.["ch1.xhtml"]?.read).toEqual(["opening"]);
    expect(result.current.tocProgress?.["ch1.xhtml"]?.current).toBe(true);

    // Switching to an ordinary Q&A session emits session_switched: Book-scoped marks MUST stay intact.
    act(() => {
      for (const listener of listeners) {
        listener({
          version: 1,
          type: "session_switched",
          bookId: "book-1",
          sessionId: "chat-ordinary",
          messages: [{ role: "user", content: "普通问题" }],
        });
      }
    });

    expect(result.current.steps).toHaveLength(1);
    expect(result.current.pageMarks?.["ch1.xhtml"]?.read).toEqual(["opening"]);
    expect(result.current.cards).toHaveLength(1);
    expect(loadCanonicalGuide).toHaveBeenCalledTimes(1);
  });

  it("refreshes when a prompt ends or sessions sync", async () => {
    loadCanonicalGuide.mockResolvedValueOnce({
      bookId: "book-1",
      sessionId: null,
      messages: [],
      anchors: [],
      navigation: {},
    });

    const { result } = renderHook(() => useGuideDocument("book-1", []));
    await waitFor(() => expect(result.current.hasGuide).toBe(false));

    loadCanonicalGuide.mockResolvedValueOnce({
      bookId: "book-1",
      sessionId: "guided-new",
      messages: [
        { role: "user", content: "继续", guideRequest: {} },
        {
          role: "assistant",
          content: "新的讲解",
          blocks: [
            { type: "toolCall", toolCall: { toolCallId: "tc-2", tool: "guide_step", params: {}, done: true, guide: step0 } },
          ],
        },
      ],
      anchors: ["a0", ""],
      navigation: {},
    });

    act(() => {
      for (const listener of listeners) {
        listener({
          version: 2,
          type: "prompt_end",
          bookId: "book-1",
          sessionId: "guided-new",
          promptId: "p1",
        });
      }
    });

    await waitFor(() => expect(result.current.canonicalSessionId).toBe("guided-new"));
    expect(result.current.steps).toHaveLength(1);
  });
});
