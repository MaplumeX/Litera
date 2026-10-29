// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuideStep } from "@/types/agent";
import { GuideBar, guidePositionLabel, guideStepLabel } from "./GuideBar";

afterEach(cleanup);

const three = { chapterIndex: 2, chapterTitle: "第三章" };
const five = { chapterIndex: 4, chapterTitle: "第五章" };
const within: GuideStep = { ...three, part: 1, totalParts: 3, range: { from: { ...three, block: 4 }, to: { ...three, block: 6 } } };
const across: GuideStep = { ...three, part: 1, totalParts: 3, range: { from: { ...three, block: 4 }, to: { ...five, block: 0 } } };

describe("guided step labels", () => {
  it("name the paragraphs of a range within one chapter", () => {
    expect(guideStepLabel(within)).toBe("带读：第三章（第 5–7 段）");
    expect(guideStepLabel({ ...within, skim: true })).toBe("略读：第三章（第 5–7 段）");
    expect(guideStepLabel({ ...within, range: { from: { ...three, block: 4 }, to: { ...three, block: 4 } } })).toBe("带读：第三章（第 5 段）");
  });

  it("count the paragraphs a range's ends hold, as the reader does", () => {
    const counted: GuideStep = { ...within, range: { from: { ...three, block: 4, paragraph: 3 }, to: { ...three, block: 6, paragraph: 4 } } };
    expect(guideStepLabel(counted)).toBe("带读：第三章（第 3–4 段）");
    expect(guidePositionLabel(counted)).toBe("第三章 · 第 4 段");
    // A range holding no paragraph names the one it stops before.
    expect(guideStepLabel({ ...within, range: { from: { ...three, block: 4, paragraph: 3 }, to: { ...three, block: 4, paragraph: 2 } } })).toBe("带读：第三章（第 3 段）");
  });

  it("name both chapters of a range across chapters", () => {
    expect(guideStepLabel(across)).toBe("带读：第三章 → 第五章");
    expect(guideStepLabel({ ...across, skim: true })).toBe("略读：第三章 → 第五章");
  });

  it("place the Session where a range ended", () => {
    expect(guidePositionLabel(across)).toBe("第五章 · 第 1 段");
    expect(guidePositionLabel({ ...across, skim: true })).toBe("第五章 · 已略读");
  });

  it("fall back to the chapter number without a title", () => {
    expect(guidePositionLabel({ ...across, range: { from: { chapterIndex: 2, block: 4 }, to: { chapterIndex: 4, block: 2 } } })).toBe("第 5 章 · 第 3 段");
  });

  it("keep part steps as they were", () => {
    expect(guideStepLabel({ ...three, part: 1, totalParts: 3 })).toBe("带读：第三章（第 2/3 部分）");
    expect(guidePositionLabel({ ...three, part: 1, totalParts: 3 })).toBe("第三章 · 2/3");
  });
});

describe("GuideBar", () => {
  const props = { started: true, disabled: false, onContinue: vi.fn(), onSkim: vi.fn(), onSkip: vi.fn(), onPick: vi.fn() };

  it("labels Continue with a range's paragraphs", () => {
    const view = render(<GuideBar {...props} nextStep={within} />);
    expect(view.getByRole("button", { name: "继续：第三章 · 第 5–7 段" })).toBeTruthy();
    expect(view.getByRole("button", { name: "读到…" })).toBeTruthy();
  });
});
