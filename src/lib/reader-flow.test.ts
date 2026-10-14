// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadReaderFlow, parseReaderFlow, READER_FLOW_KEY, saveReaderFlow } from "./reader-flow";

afterEach(() => localStorage.clear());

describe("reader flow preference", () => {
  it("defaults to paginated", () => {
    expect(loadReaderFlow()).toBe("paginated");
    expect(parseReaderFlow("sideways")).toBe("paginated");
  });

  it("round-trips through localStorage", () => {
    saveReaderFlow("scrolled");
    expect(localStorage.getItem(READER_FLOW_KEY)).toBe("scrolled");
    expect(loadReaderFlow()).toBe("scrolled");
  });
});
