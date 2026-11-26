// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageGuideCard } from "./PageGuideCard";
import { extractGuideStepCards } from "@/lib/guide-step-cards";
import type { AgentMessage, GuideStep } from "@/types/agent";

afterEach(cleanup);

const step: GuideStep = {
  from: { chapterIndex: 1, chapterTitle: "第二章", block: 0, paragraph: 1 },
  to: { chapterIndex: 1, chapterTitle: "第二章", block: 3, paragraph: 4 },
  part: { index: 0, total: 2 },
};

describe("extractGuideStepCards and PageGuideCard", () => {
  it("extracts explanations and side Q&As aligned with taken steps", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "继续带读", guideRequest: {} },
      {
        role: "assistant",
        content: "本部分剖析了**核心命题**。",
        blocks: [
          { type: "toolCall", toolCall: { toolCallId: "c1", tool: "guide_step", params: {}, done: true, guide: step } },
          { type: "text", text: "本部分剖析了**核心命题**。" },
        ],
      },
      { role: "user", content: "这里针对的是哪个学派？" },
      { role: "assistant", content: "作者主要在批判古典自由主义假设。" },
    ];
    const cards = extractGuideStepCards(messages);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      stepIndex: 0,
      messageIndex: 1,
      explanation: "本部分剖析了**核心命题**。",
      sideQuestions: [{ question: "这里针对的是哪个学派？", answer: "作者主要在批判古典自由主义假设。" }],
    });

    const onClose = vi.fn();
    const onOpenInGuide = vi.fn();
    const onAskPassage = vi.fn();
    const view = render(
      <PageGuideCard
        card={cards[0]}
        x={200}
        y={180}
        passage="原文关键段落"
        onClose={onClose}
        onOpenInGuide={onOpenInGuide}
        onAskPassage={onAskPassage}
      />,
    );
    expect(view.getByText("核心命题")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "相关追问（1）" }));
    expect(view.getByText("作者主要在批判古典自由主义假设。")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "在带读中定位" }));
    expect(onOpenInGuide).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalled();
  });
});
