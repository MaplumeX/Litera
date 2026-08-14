// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderProgressBar } from "@/components/ReaderProgressBar";

afterEach(() => {
  cleanup();
});

function mockTrackRect(el: HTMLElement) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 0,
    top: 0,
    left: 100,
    right: 300,
    bottom: 20,
    width: 200,
    height: 20,
    toJSON() {
      return {};
    },
  });
}

describe("ReaderProgressBar", () => {
  it("renders the chapter label and percent", () => {
    const { getByText, container } = render(
      <ReaderProgressBar
        fraction={0.42}
        chapterLabel="第一章"
        onSeek={() => {}}
      />,
    );
    expect(getByText("第一章 · 42%")).toBeTruthy();
    const fill = container.querySelector(".bg-primary") as HTMLElement | null;
    expect(fill?.style.width).toBe("42%");
  });

  it("falls back to the provided Chapter N label", () => {
    const { getByText } = render(
      <ReaderProgressBar
        fraction={0}
        chapterLabel="Chapter 3"
        onSeek={() => {}}
      />,
    );
    expect(getByText("Chapter 3 · 0%")).toBeTruthy();
  });

  it("seeks from a click on the strip", () => {
    const onSeek = vi.fn();
    const { getByLabelText } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="第一章"
        onSeek={onSeek}
      />,
    );
    const track = getByLabelText("第一章 · 10%");
    mockTrackRect(track);
    fireEvent.pointerDown(track, { clientX: 150, button: 0 });
    expect(onSeek).toHaveBeenCalledWith(0.25);
  });

  it("seeks again on pointerup after a drag", () => {
    const onSeek = vi.fn();
    const { getByLabelText } = render(
      <ReaderProgressBar
        fraction={0.1}
        chapterLabel="第一章"
        onSeek={onSeek}
      />,
    );
    const track = getByLabelText("第一章 · 10%");
    mockTrackRect(track);
    fireEvent.pointerDown(track, { clientX: 120, button: 0, timeStamp: 0 });
    fireEvent.pointerMove(track, { clientX: 250, button: 0, timeStamp: 80 });
    fireEvent.pointerUp(track, { clientX: 280, button: 0 });
    expect(onSeek).toHaveBeenLastCalledWith(0.9);
  });
});
