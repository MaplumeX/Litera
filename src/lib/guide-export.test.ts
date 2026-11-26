import { describe, expect, it } from "vitest";
import { projectGuideDocument } from "./guide-document";
import {
  cleanGuideCitations,
  defaultGuideExportFileName,
  extractGuideProseSegments,
  formatGuideExportMarkdown,
} from "./guide-export";
import type { AgentMessage, GuideStep } from "@/types/agent";

const step0: GuideStep = {
  from: { chapterIndex: 0, chapterTitle: "第一章 起源", block: 0, paragraph: 1 },
  to: { chapterIndex: 0, chapterTitle: "第一章 起源", block: 5, paragraph: 6 },
};

describe("guide-export", () => {
  it("cleans internal cite:N links and extracts pure prose segments", () => {
    expect(cleanGuideCitations("作者说[存在先于本质](cite:0)。")).toBe("作者说“存在先于本质”。");

    const messages: AgentMessage[] = [
      { role: "user", content: "继续", guideRequest: {} },
      {
        role: "assistant",
        content: "## 核心论点\n\n作者指出[历史是连续的](cite:0)。",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "t1", tool: "guide_step", params: {}, done: true, guide: step0 } },
          { type: "text", text: "## 核心论点\n\n作者指出[历史是连续的](cite:0)。" },
        ],
      },
      { role: "user", content: "这里的连续指什么？" },
      { role: "assistant", content: "指制度的[路径依赖](cite:0)。" },
    ];

    const doc = projectGuideDocument({ bookId: "b1", sessionId: "g1", messages });
    const segments = extractGuideProseSegments(doc);
    expect(segments).toHaveLength(1);
    expect(segments[0].markdown).toBe("## 核心论点\n\n作者指出“历史是连续的”。");
    expect(segments[0].plainText).toBe("核心论点\n\n作者指出“历史是连续的”。");

    const md = formatGuideExportMarkdown(doc, { bookTitle: "大转型", includeSideQuestions: true });
    expect(md).toContain("# 大转型");
    expect(md).toContain("## 第一章 起源");
    expect(md).toContain("作者指出“历史是连续的”。");
    expect(md).toContain("> **Q:** 这里的连续指什么？");
    expect(md).toContain("> 指制度的“路径依赖”。");

    const mdNoQa = formatGuideExportMarkdown(doc, { bookTitle: "大转型", includeSideQuestions: false });
    expect(mdNoQa).not.toContain("**Q:**");
  });

  it("sanitizes filenames safely for save_text_file", () => {
    expect(defaultGuideExportFileName("A/B:C*D")).toBe("A B C D-guide.md");
    expect(defaultGuideExportFileName("   ")).toBe("litera-guide-guide.md");
  });
});
