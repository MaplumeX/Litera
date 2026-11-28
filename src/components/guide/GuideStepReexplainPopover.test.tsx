// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORIGINAL_STEP_REVISION_ID } from "@/agent/sessions/pi-session";
import type { GuideStepNode } from "@/lib/guide-document";
import { GuideStepReexplainPopover } from "./GuideStepReexplainPopover";

function makeStepNode(overrides?: Partial<GuideStepNode>): GuideStepNode {
  return {
    stepIndex: 0,
    id: "step-0",
    step: {
      from: { chapterIndex: 0, chapterTitle: "第一章", block: 0, paragraph: 1 },
      to: { chapterIndex: 0, chapterTitle: "第一章", block: 4, paragraph: 5 },
    },
    label: "第一章 · 第 1–5 段",
    chapterIndex: 0,
    chapterTitle: "第一章",
    endChapterIndex: 0,
    messageIndex: 1,
    requestMessageIndex: 0,
    explanation: "第一章原始讲解。",
    streaming: false,
    revisionAnchorId: "a-ch1",
    revisions: [{ id: ORIGINAL_STEP_REVISION_ID, isOriginal: true }],
    activeRevisionId: ORIGINAL_STEP_REVISION_ID,
    isLatestStep: false,
    sideThreads: [],
    ...overrides,
  };
}

describe("GuideStepReexplainPopover", () => {
  afterEach(() => {
    cleanup();
  });

  it("dispatches 1-click retry, depth quick-pills, model override, and steering instructions", () => {
    const onRevise = vi.fn();
    render(
      <GuideStepReexplainPopover
        step={makeStepNode()}
        disabled={false}
        availableModels={["gpt-4o", "claude-sonnet", "gemini-2.5-pro"]}
        currentModel="gpt-4o"
        onRevise={onRevise}
      />,
    );

    // 1. 1-click same-settings retry
    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    fireEvent.click(screen.getByTestId("guide-reexplain-same"));
    expect(onRevise).toHaveBeenLastCalledWith({});

    // 2. Depth quick-pill ("deep")
    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    fireEvent.click(screen.getByTestId("guide-reexplain-pace-deep"));
    expect(onRevise).toHaveBeenLastCalledWith({ pace: "deep" });

    // 3. Model override select
    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    fireEvent.change(screen.getByTestId("guide-reexplain-model-select"), {
      target: { value: "claude-sonnet" },
    });
    expect(onRevise).toHaveBeenLastCalledWith({ modelOverride: "claude-sonnet" });

    // 4. Custom steering instruction
    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    const input = screen.getByTestId("guide-reexplain-instruction");
    fireEvent.change(input, { target: { value: "多举生活化的例子" } });
    fireEvent.submit(input.closest("form")!);
    expect(onRevise).toHaveBeenLastCalledWith({ styleOverride: "多举生活化的例子" });

    // Non-latest step never exposes undo
    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    expect(screen.queryByTestId("guide-step-undo-latest")).toBeNull();
  });

  it("shows Undo step strictly on the latest step and invokes onUndoLatestStep", () => {
    const onRevise = vi.fn();
    const onUndoLatestStep = vi.fn();
    render(
      <GuideStepReexplainPopover
        step={makeStepNode({ isLatestStep: true })}
        disabled={false}
        onRevise={onRevise}
        onUndoLatestStep={onUndoLatestStep}
      />,
    );

    fireEvent.click(screen.getByTestId("guide-step-reexplain-trigger"));
    const undoBtn = screen.getByTestId("guide-step-undo-latest");
    fireEvent.click(undoBtn);
    expect(onUndoLatestStep).toHaveBeenCalledTimes(1);
    expect(onRevise).not.toHaveBeenCalled();
  });
});
