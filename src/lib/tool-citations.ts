export type BookCitation =
  | { kind: "chapter"; chapterIndex: number }
  | { kind: "cfi"; cfi: string; fraction?: number };

export interface ToolCitation {
  citation: BookCitation;
  label: string;
}

export function citationsFromToolCall(input: {
  tool: string;
  result?: unknown;
  params?: unknown;
  isError?: boolean;
  done?: boolean;
}): ToolCitation[] {
  if (input.isError || input.done === false) return [];
  switch (input.tool) {
    case "search_in_book":
      return searchCitations(input.result);
    case "read_chapter":
      return readChapterCitations(input.result, input.params);
    case "list_annotations":
      return annotationCitations(input.result);
    default:
      return [];
  }
}

function searchCitations(result: unknown): ToolCitation[] {
  const parsed = parseResult(result);
  if (!Array.isArray(parsed)) return [];
  const rows: ToolCitation[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const chapterIndex = chapterIndexOf(item.chapterIndex);
    if (chapterIndex === undefined) continue;
    rows.push({
      citation: { kind: "chapter", chapterIndex },
      label: firstText(item.chapterTitle, item.snippet),
    });
  }
  return rows;
}

function readChapterCitations(result: unknown, params: unknown): ToolCitation[] {
  const parsed = parseResult(result);
  const fromResult = isRecord(parsed) ? chapterIndexOf(parsed.chapterIndex) : undefined;
  const fromParams = isRecord(params) ? chapterIndexOf(params.chapterIndex) : undefined;
  const chapterIndex = fromResult ?? fromParams;
  if (chapterIndex === undefined) return [];
  return [{ citation: { kind: "chapter", chapterIndex }, label: "" }];
}

function annotationCitations(result: unknown): ToolCitation[] {
  const parsed = parseResult(result);
  if (!isRecord(parsed)) return [];
  const rows: ToolCitation[] = [];
  appendAnnotationRows(rows, parsed.bookmarks, (item) => firstText(item.label));
  appendAnnotationRows(rows, parsed.highlights, (item) => firstText(item.excerpt));
  return rows;
}

function appendAnnotationRows(
  rows: ToolCitation[],
  value: unknown,
  labelOf: (item: Record<string, unknown>) => string,
): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    const cfi = typeof item.cfi === "string" ? item.cfi.trim() : "";
    if (!cfi) continue;
    const fraction =
      typeof item.fraction === "number" && Number.isFinite(item.fraction)
        ? item.fraction
        : undefined;
    rows.push({
      citation: fraction === undefined ? { kind: "cfi", cfi } : { kind: "cfi", cfi, fraction },
      label: labelOf(item),
    });
  }
}

function parseResult(result: unknown): unknown {
  const text = resultText(result);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function resultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!isRecord(result) || !Array.isArray(result.content)) return undefined;
  for (const block of result.content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") continue;
    return block.text;
  }
  return undefined;
}

function chapterIndexOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
