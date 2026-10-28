// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuideRecap } from "./GuideRecap";

afterEach(cleanup);

describe("GuideRecap", () => {
  it("names the chapter of a one-chapter recap", () => {
    const view = render(<GuideRecap recap={{ role: "recap", chapterIndex: 2, chapterTitle: "第三章", text: "要点" }} />);
    expect(view.getByText("本章回顾：第三章")).toBeTruthy();
  });

  it("names the first and last chapters of a recap that covers several", () => {
    const view = render(<GuideRecap recap={{ role: "recap", chapterIndex: 2, chapterTitle: "3.1", throughChapterIndex: 5, text: "要点" }} />);
    expect(view.getByText("回顾：3.1 → 第 6 章")).toBeTruthy();
  });
});
