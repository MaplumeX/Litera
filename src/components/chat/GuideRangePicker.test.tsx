// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideOutline } from "@/agent/runtime/guide";
import type { GuideStep } from "@/types/agent";
import { GuideRangePicker } from "./GuideRangePicker";

const block = (snippet: string, chars: number, heading = 0, kind?: "image" | "blank") => ({ snippet, chars, heading, part: 0, ...(kind ? { kind } : {}) });

const first: GuideOutline = {
  chapters: [{
    chapterIndex: 2,
    chapterTitle: "第三章",
    firstBlock: 3,
    blocks: [block("甲段", 100), block("小节一", 10, 2), block("乙段", 200), block("小节二", 10, 2), block("丙段", 300)],
  }],
  more: 2,
};
const later: GuideOutline = {
  chapters: [{ chapterIndex: 4, chapterTitle: "第五章", firstBlock: 0, blocks: [block("丁段", 30_000)] }],
  more: null,
};

const step: GuideStep = { chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "第三章" };
const loadOutline = vi.fn(async (after?: number) => (after === undefined ? first : later));
const onPick = vi.fn();

function renderPicker() {
  return render(<GuideRangePicker open onOpenChange={() => {}} step={step} loadOutline={loadOutline} onPick={onPick} />);
}

const row = (view: ReturnType<typeof render>, text: string) => view.getByText(text).closest("button")!;

beforeEach(() => {
  loadOutline.mockClear();
  onPick.mockClear();
});
afterEach(cleanup);

describe("GuideRangePicker", () => {
  it("lists the blocks from the step's start and reads up to a picked paragraph", async () => {
    const view = renderPicker();
    await view.findByText("甲段");
    expect(loadOutline).toHaveBeenCalledWith(undefined);
    expect(view.getByText("从「第三章」第 4 段开始。点一段，读到那一段为止；点标题，读完那一节或那一章。")).toBeTruthy();
    const read = view.getByRole("button", { name: "带读" }) as HTMLButtonElement;
    expect(read.disabled).toBe(true);
    fireEvent.click(row(view, "乙段"));
    expect(view.getByText("读到：第三章（第 6 段），约 310 字")).toBeTruthy();
    fireEvent.click(read);
    expect(onPick).toHaveBeenCalledWith({ chapterIndex: 2, block: 5 }, false);
  });

  it("reads to the end of a section when its heading is picked, and can skim it", async () => {
    const view = renderPicker();
    fireEvent.click(row(view, await view.findByText("小节一").then((node) => node.textContent!)));
    expect(view.getByText("读到：第三章（第 6 段），约 310 字")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "略读" }));
    expect(onPick).toHaveBeenCalledWith({ chapterIndex: 2, block: 5 }, true);
  });

  it("reads to the end of a chapter when its title is picked", async () => {
    const view = renderPicker();
    await view.findByText("甲段");
    fireEvent.click(view.getByRole("button", { name: /^第三章/ }));
    fireEvent.click(view.getByRole("button", { name: "带读" }));
    expect(onPick).toHaveBeenCalledWith({ chapterIndex: 2, block: 7 }, false);
  });

  it("loads later chapters and warns about a long step", async () => {
    const view = renderPicker();
    fireEvent.click(await view.findByRole("button", { name: "显示后面的章节" }));
    await waitFor(() => expect(loadOutline).toHaveBeenCalledWith(2));
    fireEvent.click(row(view, await view.findByText("丁段").then((node) => node.textContent!)));
    expect(view.getByText("这一步约 30,620 字，比平时长不少，讲解可能会比较概括。")).toBeTruthy();
    expect(view.queryByRole("button", { name: "显示后面的章节" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "带读" }));
    expect(onPick).toHaveBeenCalledWith({ chapterIndex: 4, block: 0 }, false);
  });

  it("shows images by their alt text, hides blank blocks and a heading that repeats the chapter title", async () => {
    const outline: GuideOutline = {
      chapters: [{
        chapterIndex: 6,
        chapterTitle: "第一节 政府治理的特点",
        firstBlock: 0,
        blocks: [block("第一节 政府治理的特点", 14, 2), block("图1-1 描绘了", 300), block("", 34, 0, "image"), block("行政区划图", 34, 0, "image"), block("", 1, 0, "blank"), block("尾段", 50)],
      }],
      more: null,
    };
    const view = render(<GuideRangePicker open onOpenChange={() => {}} step={step} loadOutline={async () => outline} onPick={onPick} />);
    await view.findByText("图1-1 描绘了");
    expect(view.getAllByText("第一节 政府治理的特点")).toHaveLength(1);
    expect(view.getByText("〔图片〕")).toBeTruthy();
    expect(view.getByText("〔图片〕行政区划图")).toBeTruthy();
    expect(view.getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(row(view, "尾段"));
    expect(view.getByText("读到：第一节 政府治理的特点（第 6 段），约 433 字")).toBeTruthy();
  });
});
