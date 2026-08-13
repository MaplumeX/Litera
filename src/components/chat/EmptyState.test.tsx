// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(() => {
  cleanup();
});

describe("EmptyState", () => {
  it("does not ask to open a book when the book is ready", () => {
    const { getByText, queryByText } = render(
      <EmptyState hasSelection={false} bookReady onSuggestion={() => {}} />,
    );
    expect(getByText("选中段落，或直接提问。")).toBeTruthy();
    expect(queryByText("打开一本书", { exact: false })).toBeNull();
  });

  it("prompts to open a book when the book is not ready", () => {
    const { getByText } = render(
      <EmptyState hasSelection={false} bookReady={false} onSuggestion={() => {}} />,
    );
    expect(getByText("打开一本书，选中段落或直接提问。")).toBeTruthy();
  });
});
