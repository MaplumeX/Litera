/**
 * How the Book pane lays out text: turned page by page, or one continuous
 * scroll per chapter. A device preference (localStorage), not synced: the
 * right choice depends on the screen more than on the book.
 */
export type ReaderFlow = "paginated" | "scrolled";

export const READER_FLOW_KEY = "litera.readerFlow";
export const DEFAULT_READER_FLOW: ReaderFlow = "paginated";

export function parseReaderFlow(value: unknown): ReaderFlow {
  return value === "paginated" || value === "scrolled" ? value : DEFAULT_READER_FLOW;
}

export function loadReaderFlow(): ReaderFlow {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_READER_FLOW;
    return parseReaderFlow(localStorage.getItem(READER_FLOW_KEY));
  } catch {
    return DEFAULT_READER_FLOW;
  }
}

export function saveReaderFlow(flow: ReaderFlow): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(READER_FLOW_KEY, flow);
  } catch {
    // private mode / quota
  }
}
