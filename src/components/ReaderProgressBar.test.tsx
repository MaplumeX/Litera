// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderProgressBar } from "@/components/ReaderProgressBar";
import { setLocale } from "@/lib/i18n";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

function mockTrackRect(el: HTMLElement) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 0,
    top: 0,
    left: 100,
    right: 300,
    bottom: 36,
    width: 200,
    height: 36,
    toJSON() {
      return {};
    },
  });
}

function fillWidth(container: HTMLElement): string | undefined {
  const fill = container.querySelector(".bg-primary.h-full") as HTMLElement | null;
  return fill?.style.width;
}

describe("ReaderProgressBar", () => {
  it("renders the chapter label and percent separately", () => {
    const { getByText, container } = render(
      <ReaderProgressBar
        fraction={0.42}
        chapterLabel="第一章"
        onSeek={() => {}}
      />,
    );
    expect(getByText("第一章")).toBeTruthy();
    expect(getByText("42%")).toBeTruthy();
    expect(fillWidth(container)).toBe("42%");
  });

  it("seeks on pointerup for a click that stays within slop", () => {
    const onSeek = vi.fn();
    const { getByLabelText } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="第一章"
        onSeek={onSeek}
      />,
    );
    const track = getByLabelText("阅读进度");
    mockTrackRect(track);
    fireEvent.pointerDown(track, { clientX: 150, button: 0 });
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.pointerUp(track, { clientX: 151, button: 0 });
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(0.255);
  });

  it("follows the pointer while dragging and seeks only on pointerup", () => {
    const onSeek = vi.fn();
    const { getByLabelText, container } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="第一章"
        onSeek={onSeek}
      />,
    );
    const track = getByLabelText("阅读进度");
    mockTrackRect(track);
    fireEvent.pointerDown(track, { clientX: 120, button: 0 });
    fireEvent.pointerMove(track, { clientX: 250, button: 0 });
    expect(onSeek).not.toHaveBeenCalled();
    expect(fillWidth(container)).toBe("75%");
    fireEvent.pointerUp(track, { clientX: 280, button: 0 });
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(0.9);
  });

  it("restores the committed fraction on cancel without seeking", () => {
    const onSeek = vi.fn();
    const { getByLabelText, container } = render(
      <ReaderProgressBar
        fraction={0.2}
        chapterLabel="第一章"
        onSeek={onSeek}
      />,
    );
    const track = getByLabelText("阅读进度");
    mockTrackRect(track);
    fireEvent.pointerDown(track, { clientX: 140, button: 0 });
    fireEvent.pointerMove(track, { clientX: 260, button: 0 });
    expect(fillWidth(container)).toBe("80%");
    fireEvent.pointerCancel(track);
    expect(onSeek).not.toHaveBeenCalled();
    expect(fillWidth(container)).toBe("20%");
  });

  it("shows a hover preview and tick marks", () => {
    const { getByLabelText, getByTestId, getAllByTestId, queryByTestId } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="第一章"
        ticks={[0, 0.25, 0.5, 1]}
        previewLabelAt={(frac) => (frac >= 0.4 ? "第二章" : "第一章")}
        onSeek={() => {}}
      />,
    );
    expect(getAllByTestId("reader-progress-tick")).toHaveLength(4);
    const track = getByLabelText("阅读进度");
    mockTrackRect(track);
    fireEvent.pointerMove(track, { clientX: 200 });
    expect(getByTestId("reader-progress-preview").textContent).toBe("第二章 · 50%");
    fireEvent.pointerLeave(track);
    expect(queryByTestId("reader-progress-preview")).toBeNull();
  });

  it("falls back to percent-only preview when the chapter is unknown", () => {
    const { getByLabelText, getByTestId } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="第一章"
        onSeek={() => {}}
      />,
    );
    const track = getByLabelText("阅读进度");
    mockTrackRect(track);
    fireEvent.pointerMove(track, { clientX: 200 });
    expect(getByTestId("reader-progress-preview").textContent).toBe("50%");
  });

  it("disables chapter buttons at the ends and does not seek from them", () => {
    const onSeek = vi.fn();
    const onPrevChapter = vi.fn();
    const onNextChapter = vi.fn();
    const { getByLabelText } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="第一章"
        onSeek={onSeek}
        onPrevChapter={onPrevChapter}
        onNextChapter={onNextChapter}
        canPrevChapter={false}
        canNextChapter={false}
      />,
    );
    expect((getByLabelText("上一章") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("下一章") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByLabelText("上一章"));
    fireEvent.click(getByLabelText("下一章"));
    expect(onPrevChapter).not.toHaveBeenCalled();
    expect(onNextChapter).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("calls chapter callbacks instead of onSeek", () => {
    const onSeek = vi.fn();
    const onPrevChapter = vi.fn();
    const onNextChapter = vi.fn();
    const { getByLabelText } = render(
      <ReaderProgressBar
        fraction={0.4}
        chapterLabel="第二章"
        onSeek={onSeek}
        onPrevChapter={onPrevChapter}
        onNextChapter={onNextChapter}
        canPrevChapter
        canNextChapter
      />,
    );
    fireEvent.click(getByLabelText("上一章"));
    fireEvent.click(getByLabelText("下一章"));
    expect(onPrevChapter).toHaveBeenCalledOnce();
    expect(onNextChapter).toHaveBeenCalledOnce();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("uses English aria-labels and preview copy", () => {
    setLocale("en");
    const { getByLabelText, getByTestId } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="Chapter 1"
        previewLabelAt={() => "Chapter 2"}
        onSeek={() => {}}
        canPrevChapter
        canNextChapter
      />,
    );
    expect(getByLabelText("Previous chapter")).toBeTruthy();
    expect(getByLabelText("Next chapter")).toBeTruthy();
    const track = getByLabelText("Reading progress");
    mockTrackRect(track);
    fireEvent.pointerMove(track, { clientX: 200 });
    expect(getByTestId("reader-progress-preview").textContent).toBe("Chapter 2 · 50%");
  });
});