// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { BookmarkRecord, HighlightRecord } from "@/types/library";
import { AnnotationsSidebar } from "./AnnotationsSidebar";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

const bookmark: BookmarkRecord = {
  id: "b1",
  cfi: "epubcfi(/6/8)",
  fraction: 0.42,
  createdAt: "2026-08-14T12:00:00+00:00",
  label: "第三章",
};

const highlight: HighlightRecord = {
  id: "h1",
  cfi: "epubcfi(/6/8!/4/2)",
  excerpt: "选中的句子",
  createdAt: "2026-08-14T12:01:00+00:00",
};

const noop = {
  onAddBookmark: () => {},
  onJumpBookmark: () => {},
  onDeleteBookmark: () => {},
  onJumpHighlight: () => {},
  onDeleteHighlight: () => {},
};

describe("AnnotationsSidebar", () => {
  it("shows empty states for both sections", () => {
    const { getByText } = render(
      <AnnotationsSidebar bookmarks={[]} highlights={[]} {...noop} />,
    );
    expect(getByText("还没有书签")).toBeTruthy();
    expect(getByText("还没有高亮")).toBeTruthy();
  });

  it("adds a bookmark from the top action", () => {
    const onAddBookmark = vi.fn();
    const { getByLabelText } = render(
      <AnnotationsSidebar bookmarks={[]} highlights={[]} {...noop} onAddBookmark={onAddBookmark} />,
    );
    fireEvent.click(getByLabelText("添加书签"));
    expect(onAddBookmark).toHaveBeenCalledOnce();
  });

  it("jumps from a row and deletes without jumping", () => {
    const onJumpBookmark = vi.fn();
    const onDeleteBookmark = vi.fn();
    const onJumpHighlight = vi.fn();
    const onDeleteHighlight = vi.fn();
    const { getByText, getByLabelText } = render(
      <AnnotationsSidebar
        bookmarks={[bookmark]}
        highlights={[highlight]}
        {...noop}
        onJumpBookmark={onJumpBookmark}
        onDeleteBookmark={onDeleteBookmark}
        onJumpHighlight={onJumpHighlight}
        onDeleteHighlight={onDeleteHighlight}
      />,
    );
    fireEvent.click(getByText("第三章"));
    expect(onJumpBookmark).toHaveBeenCalledWith(bookmark);
    fireEvent.click(getByLabelText("删除书签"));
    expect(onDeleteBookmark).toHaveBeenCalledWith("b1");
    expect(onJumpBookmark).toHaveBeenCalledOnce();

    fireEvent.click(getByText("选中的句子"));
    expect(onJumpHighlight).toHaveBeenCalledWith(highlight);
    fireEvent.click(getByLabelText("删除高亮"));
    expect(onDeleteHighlight).toHaveBeenCalledWith("h1");
  });

  it("switches the empty copy when the locale is en", () => {
    setLocale("en");
    const { getByText, getByLabelText } = render(
      <AnnotationsSidebar bookmarks={[]} highlights={[]} {...noop} />,
    );
    expect(getByText("No bookmarks yet")).toBeTruthy();
    expect(getByLabelText("Add bookmark")).toBeTruthy();
  });
});
