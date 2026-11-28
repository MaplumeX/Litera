// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectGuideDocument } from "@/lib/guide-document";
import type { AgentMessage, AgentSessionSummary, GuideStep } from "@/types/agent";
import { GuideNavRail } from "./GuideNavRail";

afterEach(() => {
  cleanup();
});

const step0: GuideStep = {
  from: { chapterIndex: 0, chapterTitle: "第一章", block: 0, paragraph: 1 },
  to: { chapterIndex: 0, chapterTitle: "第一章", block: 4, paragraph: 5 },
};

const step1: GuideStep = {
  from: { chapterIndex: 1, chapterTitle: "第二章", block: 0, paragraph: 1 },
  to: { chapterIndex: 1, chapterTitle: "第二章", block: 3, paragraph: 4 },
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

  it("supports nested TOC tree folding, expand/collapse all, and auto-scrolls the active chapter into view", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "讲解内容",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
        ],
      },
    ];
    const nestedToc = [
      {
        id: "p1",
        label: "第一部分",
        href: "part1.xhtml",
        subitems: [{ id: "c1", label: "第一章", href: "ch1.xhtml" }],
      },
      {
        id: "p2",
        label: "第二部分",
        href: "part2.xhtml",
        subitems: [{ id: "c2", label: "第二章", href: "ch2.xhtml" }],
      },
    ];
    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "g1",
      messages,
      toc: [
        { label: "第一部分", href: "part1.xhtml" },
        { label: "第一章", href: "ch1.xhtml" },
        { label: "第二部分", href: "part2.xhtml" },
        { label: "第二章", href: "ch2.xhtml" },
      ],
    });

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset?.active === "true") {
          return { top: 420, bottom: 448, left: 0, right: 200, width: 200, height: 28, x: 0, y: 420, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 200, left: 0, right: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });

    try {
      const { container } = render(
        <GuideNavRail
          toc={nestedToc}
          document={doc}
          activeChapterIndex={0}
          archivedSessions={[]}
          viewingArchivedId={null}
          isStreaming={false}
          onScrollToChapter={vi.fn()}
          onScrollToStep={vi.fn()}
          onScrollToQuestion={vi.fn()}
          onGuideChapter={vi.fn()}
          onOpenSettings={vi.fn()}
          onViewArchived={vi.fn()}
          onReturnToCanonical={vi.fn()}
        />,
      );

      // Active row outside viewport triggers centering scroll on the list container.
      const scrollList = container.querySelector(".overflow-y-auto") as HTMLDivElement;
      expect(scrollList.scrollTop).toBe(334);

      // Ancestor of active Chapter 1 is auto-expanded; unrelated Part 2 starts collapsed.
      expect(screen.getByRole("button", { name: "第一章" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "第二章" })).toBeNull();

      // Expand all reveals Chapter 2; collapse all folds back to the active branch.
      fireEvent.click(screen.getByRole("button", { name: "全部展开" }));
      expect(screen.getByRole("button", { name: "第二章" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "全部折叠" }));
      expect(screen.getByRole("button", { name: "第一章" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "第二章" })).toBeNull();

      // Toggling Part 1 directly collapses Chapter 1.
      fireEvent.click(screen.getByRole("button", { name: "折叠" }));
      expect(screen.queryByRole("button", { name: "第一章" })).toBeNull();
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("groups side questions by chapter and switches between all chapters and current chapter", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "第一章讲解",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
        ],
      },
      { role: "user", content: "第一章的问题", selection: "关键摘录句子" },
      { role: "assistant", content: "第一章的回答" },
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "第二章讲解",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t2", tool: "guide_step", params: {}, done: true, guide: step1 } },
        ],
      },
      { role: "user", content: "第二章的问题" },
      { role: "assistant", content: "第二章的回答" },
    ];
    const doc = projectGuideDocument({
      bookId: "b1",
      sessionId: "g1",
      messages,
    });
    const onScrollToQuestion = vi.fn();

    render(
      <GuideNavRail
        toc={[]}
        document={doc}
        activeChapterIndex={1}
        archivedSessions={[]}
        viewingArchivedId={null}
        isStreaming={false}
        onScrollToChapter={vi.fn()}
        onScrollToStep={vi.fn()}
        onScrollToQuestion={onScrollToQuestion}
        onGuideChapter={vi.fn()}
        onOpenSettings={vi.fn()}
        onViewArchived={vi.fn()}
        onReturnToCanonical={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /追问/ }));

    // All-chapters scope shows both chapter groups and the selection excerpt.
    const groups = screen.getAllByTestId("guide-question-group");
    expect(groups).toHaveLength(2);
    expect(screen.getByText("第一章的问题")).toBeTruthy();
    expect(screen.getByText("关键摘录句子")).toBeTruthy();
    expect(screen.getByText("第二章的问题")).toBeTruthy();

    // Switching to "仅当前章" filters down to Chapter 2 only.
    const scopeBar = screen.getByTestId("guide-questions-scope");
    fireEvent.click(within(scopeBar).getByRole("button", { name: /仅当前章/ }));
    expect(screen.queryByText("第一章的问题")).toBeNull();
    expect(screen.getByText("第二章的问题")).toBeTruthy();

    // Clicking the filtered question still scrolls to the exact message index.
    fireEvent.click(screen.getByText("第二章的问题"));
    expect(onScrollToQuestion).toHaveBeenCalledWith(6);

    // Collapsing the chapter group header hides its questions.
    const activeGroup = screen.getByTestId("guide-question-group");
    fireEvent.click(within(activeGroup).getByRole("button", { expanded: true }));
    expect(screen.queryByText("第二章的问题")).toBeNull();
  });

  it("supports archived guide metadata, rename, export, restore, and delete actions", async () => {
    const archived: AgentSessionSummary = {
      id: "g-old",
      title: "一刷精读",
      createdAt: "2026-11-20T08:00:00Z",
      updatedAt: "2026-11-20T09:30:00Z",
      kind: "guided",
      guide: step0,
      archived: true,
    };
    const doc = projectGuideDocument({ bookId: "b1", sessionId: "g1", messages: [] });
    const onRenameArchived = vi.fn();
    const onExportArchived = vi.fn();
    const onRestoreArchived = vi.fn();
    const onDeleteArchived = vi.fn();

    render(
      <GuideNavRail
        toc={[]}
        document={doc}
        activeChapterIndex={null}
        archivedSessions={[archived]}
        viewingArchivedId={null}
        isStreaming={false}
        onScrollToChapter={vi.fn()}
        onScrollToStep={vi.fn()}
        onScrollToQuestion={vi.fn()}
        onGuideChapter={vi.fn()}
        onOpenSettings={vi.fn()}
        onViewArchived={vi.fn()}
        onReturnToCanonical={vi.fn()}
        onRenameArchived={onRenameArchived}
        onExportArchived={onExportArchived}
        onRestoreArchived={onRestoreArchived}
        onDeleteArchived={onDeleteArchived}
      />,
    );

    // Expand archived list and verify progress metadata is rendered.
    fireEvent.click(screen.getByRole("button", { name: /历史归档带读/ }));
    expect(screen.getByText("一刷精读")).toBeTruthy();
    expect(screen.getByText(/第一章/)).toBeTruthy();

    const openArchiveMenu = async () => {
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      fireEvent.pointerDown(screen.getByRole("button", { name: "归档操作" }), {
        button: 0,
        ctrlKey: false,
      });
    };

    // Rename via inline input.
    await openArchiveMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "重命名" }));
    const input = await screen.findByRole("textbox", { name: "重命名" });
    fireEvent.change(input, { target: { value: "二刷笔记" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameArchived).toHaveBeenCalledWith("g-old", "二刷笔记");

    // Export archived guide directly.
    await openArchiveMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出伴读讲义" }));
    expect(onExportArchived).toHaveBeenCalledWith(archived);

    // Restore archived guide after confirmation.
    await openArchiveMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "恢复为当前带读" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    expect(onRestoreArchived).toHaveBeenCalledWith("g-old");

    // Delete archived guide after confirmation.
    await openArchiveMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    expect(onDeleteArchived).toHaveBeenCalledWith("g-old");
  });
});
