// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectGuideDocument } from "@/lib/guide-document";
import type { AgentMessage, GuideStep } from "@/types/agent";
import { GuideNavRail } from "./GuideNavRail";

afterEach(() => {
  cleanup();
});

const step0: GuideStep = {
  from: { chapterIndex: 0, chapterTitle: "第一章", block: 0, paragraph: 1 },
  to: { chapterIndex: 0, chapterTitle: "第一章", block: 4, paragraph: 5 },
};

describe("GuideNavRail", () => {
  it("renders chapter progress, jumps to covered chapters, starts unread chapters, and lists side questions", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "讲解内容",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
        ],
      },
      { role: "user", content: "这里是什么意思？" },
      { role: "assistant", content: "意思是……" },
    ];
    const toc = [
      { id: "c1", label: "第一章", href: "ch1.xhtml" },
      { id: "c2", label: "第二章", href: "ch2.xhtml" },
    ];
    const tocProgress = {
      "ch1.xhtml": { coveredBlocks: 5, totalBlocks: 10, current: true },
    };
    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "g1",
      messages,
      toc: toc.map((t) => ({ label: t.label, href: t.href })),
      tocProgress,
    });

    const onScrollToChapter = vi.fn();
    const onScrollToStep = vi.fn();
    const onScrollToQuestion = vi.fn();
    const onGuideChapter = vi.fn();
    const onOpenSettings = vi.fn();
    const onExportMarkdown = vi.fn();

    render(
      <GuideNavRail
        toc={toc}
        tocProgress={tocProgress}
        document={doc}
        activeChapterIndex={0}
        archivedSessions={[{ id: "g-old", title: "旧带读", createdAt: "1", updatedAt: "1", kind: "guided", archived: true }]}
        viewingArchivedId={null}
        isStreaming={false}
        onScrollToChapter={onScrollToChapter}
        onScrollToStep={onScrollToStep}
        onScrollToQuestion={onScrollToQuestion}
        onGuideChapter={onGuideChapter}
        onOpenSettings={onOpenSettings}
        onViewArchived={vi.fn()}
        onReturnToCanonical={vi.fn()}
        onExportMarkdown={onExportMarkdown}
      />,
    );

    // Chapter progress summary & 50% badge on Chapter 1.
    expect(screen.getByText("已带读 1/2 章")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();

    // Clicking covered Chapter 1 scrolls to chapter 0; clicking unread Chapter 2 starts guiding it.
    fireEvent.click(screen.getByRole("button", { name: "第一章" }));
    expect(onScrollToChapter).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByRole("button", { name: "第二章" }));
    expect(onGuideChapter).toHaveBeenCalledWith("ch2.xhtml");

    // Switch to Questions tab and click the indexed side question.
    fireEvent.click(screen.getByRole("tab", { name: /追问/ }));
    fireEvent.click(screen.getByText("这里是什么意思？"));
    expect(onScrollToQuestion).toHaveBeenCalledWith(2);

    // Export and settings actions work.
    fireEvent.click(screen.getByRole("button", { name: "导出伴读讲义" }));
    expect(onExportMarkdown).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "带读设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
