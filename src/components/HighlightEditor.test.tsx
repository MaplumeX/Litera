// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { HighlightEditor } from "./HighlightEditor";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

describe("HighlightEditor", () => {
  it("changes color, commits a note, and deletes", () => {
    const onColorChange = vi.fn();
    const onNoteCommit = vi.fn();
    const onDelete = vi.fn();
    const { getByLabelText } = render(
      <HighlightEditor
        x={10}
        y={20}
        color="yellow"
        note=""
        highlightId="h1"
        onColorChange={onColorChange}
        onNoteCommit={onNoteCommit}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(getByLabelText("绿色"));
    expect(onColorChange).toHaveBeenCalledWith("green");
    const note = getByLabelText("笔记");
    fireEvent.change(note, { target: { value: "why I marked" } });
    fireEvent.blur(note);
    expect(onNoteCommit).toHaveBeenCalledWith("h1", "why I marked");
    fireEvent.click(getByLabelText("删除高亮"));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("uses English color names when the locale is en", () => {
    setLocale("en");
    const { getByLabelText } = render(
      <HighlightEditor
        x={10}
        y={20}
        color="blue"
        note="kept"
        highlightId="h1"
        onColorChange={() => {}}
        onNoteCommit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(getByLabelText("Edit highlight")).toBeTruthy();
    expect(getByLabelText("Blue").getAttribute("aria-pressed")).toBe("true");
    expect(getByLabelText("Note")).toBeTruthy();
  });
});
