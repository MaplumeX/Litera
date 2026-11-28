import type { AgentMessage as PiAgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type {
  AgentMessage as UiAgentMessage,
  AnchorBranchInfo,
  AgentSessionSummary,
  AgentToolCall,
  AssistantBlock,
  BranchOption,
  GuidePosition,
  GuideRecapMarker,
  GuideRequest,
  GuideStepPace,
  RecordedGuideStep,
  SessionKind,
  SideThreadRef,
  SideThreadSnapshot,
  StepRevisionEntry,
  StepRevisionRef,
  StepRevisionSnapshot,
} from "@/types/agent";

export interface PiSessionHeader {
  type: "session";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
  kind?: SessionKind;
}

export interface PiSessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export interface DecodedPiSession {
  header: PiSessionHeader;
  entries: PiSessionEntry[];
  leafId: string | null;
}

export interface PiSessionPayload {
  header: unknown;
  entries: unknown;
  leafId?: unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function decodeGuidePosition(value: unknown): GuidePosition | null {
  const position = object(value);
  if (!position || !nonNegativeInteger(position.chapterIndex) || !nonNegativeInteger(position.block)) return null;
  const chapterTitle = string(position.chapterTitle);
  const snippet = string(position.snippet);
  return {
    chapterIndex: position.chapterIndex,
    ...(chapterTitle ? { chapterTitle } : {}),
    block: position.block,
    ...(snippet ? { snippet } : {}),
    ...(nonNegativeInteger(position.paragraph) ? { paragraph: position.paragraph } : {}),
  };
}

/** A persisted guide request (an object, with optional step and step options), or null when absent or malformed. */
function decodeGuideRequest(value: unknown): GuideRequest | null {
  const request = object(value);
  if (!request) return null;
  const step = decodeGuide(request.step);
  const pace =
    request.pace === "standard" || request.pace === "compact" || request.pace === "deep"
      ? request.pace
      : undefined;
  const styleOverride = string(request.styleOverride) ?? undefined;
  return {
    ...(step ? { step } : {}),
    ...(pace ? { pace } : {}),
    ...(styleOverride ? { styleOverride } : {}),
  };
}

/**
 * A persisted guided step, or null when absent or malformed. A step from
 * before steps were block ranges is a part of a chapter; one from before they
 * kept their ends at the top level names them in `range`.
 */
export function decodeGuide(value: unknown): RecordedGuideStep | null {
  const guide = object(value);
  if (!guide) return null;
  const ends = guide.from !== undefined || guide.to !== undefined ? guide : object(guide.range);
  if (ends) {
    const from = decodeGuidePosition(ends.from);
    const to = decodeGuidePosition(ends.to);
    if (!from || !to) return null;
    const part = object(guide.part);
    const labelPart = part && nonNegativeInteger(part.index) && nonNegativeInteger(part.total) && part.index < part.total
      ? { part: { index: part.index, total: part.total } }
      : {};
    return { from, to, ...labelPart };
  }
  if (!nonNegativeInteger(guide.chapterIndex) || !nonNegativeInteger(guide.part)
    || !nonNegativeInteger(guide.totalParts) || guide.part >= guide.totalParts) return null;
  const chapterTitle = string(guide.chapterTitle);
  const legacySkim = guide.skim === true ? { skim: true as const } : {};
  return {
    chapterIndex: guide.chapterIndex,
    part: guide.part,
    totalParts: guide.totalParts,
    ...(chapterTitle ? { chapterTitle } : {}),
    ...legacySkim,
  };
}

function validContent(content: unknown, role: string): boolean {
  if (role === "user" && typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.every((part) => {
    const block = object(part);
    if (!block || typeof block.type !== "string") return false;
    if (block.type === "text") return typeof block.text === "string";
    if (block.type === "image") return typeof block.data === "string" && typeof block.mimeType === "string";
    if (role === "assistant" && block.type === "thinking") return typeof block.thinking === "string";
    if (role === "assistant" && block.type === "toolCall") {
      return !!string(block.id) && !!string(block.name) && !!object(block.arguments);
    }
    return false;
  });
}

function decodeMessage(value: unknown): Record<string, unknown> {
  const message = object(value);
  const role = string(message?.role);
  if (!message || !role) throw new Error("Invalid Pi session message");
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return message;
  const content = message.content == null ? [] : message.content;
  if (!validContent(content, role)) throw new Error("Invalid Pi session message content");
  if (role === "toolResult" && (!string(message.toolCallId) || !string(message.toolName) || typeof message.isError !== "boolean")) {
    throw new Error("Invalid Pi tool result");
  }
  return { ...message, content };
}

export function decodePiSession(value: unknown): DecodedPiSession {
  const payload = object(value);
  const rawHeader = object(payload?.header);
  if (!payload || !rawHeader || rawHeader.type !== "session" || rawHeader.version !== 3) {
    throw new Error("Unsupported Pi session payload");
  }
  const id = string(rawHeader.id);
  const timestamp = string(rawHeader.timestamp);
  if (!id || !timestamp || typeof rawHeader.cwd !== "string" || !Array.isArray(payload.entries)) {
    throw new Error("Invalid Pi session header");
  }
  const entries: PiSessionEntry[] = [];
  const ids = new Set<string>();
  for (const raw of payload.entries) {
    const entry = object(raw);
    const entryId = string(entry?.id);
    const type = string(entry?.type);
    const entryTimestamp = string(entry?.timestamp);
    const parentId = entry?.parentId;
    if (!entry || !entryId || !type || !entryTimestamp || (parentId !== null && typeof parentId !== "string")) {
      throw new Error("Invalid Pi session entry");
    }
    if (ids.has(entryId) || (typeof parentId === "string" && !ids.has(parentId))) {
      throw new Error("Invalid Pi session tree");
    }
    ids.add(entryId);
    const normalized: PiSessionEntry = { ...entry, type, id: entryId, parentId, timestamp: entryTimestamp };
    if (type === "message") normalized.message = decodeMessage(entry.message);
    if (type === "custom_message" && !string(entry.customType)) throw new Error("Invalid Pi custom message");
    entries.push(normalized);
  }
  const leafId = payload.leafId == null ? null : string(payload.leafId);
  if (leafId && !ids.has(leafId)) throw new Error("Invalid Pi session leaf");
  return {
    header: {
      type: "session", version: 3, id, timestamp, cwd: rawHeader.cwd,
      ...(rawHeader.kind === "guided" ? { kind: "guided" as const } : {}),
    },
    entries,
    leafId,
  };
}

/**
 * Full durable leaf-to-root path: the session's active history, unfiltered.
 *
 * This is the display/session truth and must never apply compaction rewiring,
 * or compacting context would silently hide past conversation from the user.
 * The model-facing projection is `contextBranch`.
 */
export function activeBranch(session: DecodedPiSession): PiSessionEntry[] {
  const byId = new Map(session.entries.map((entry) => [entry.id, entry]));
  // A null leafId means "before the first entry" (fresh session, or a rewind to
  // the branch root): the active branch is empty. Sessions with entries always
  // carry a non-null leafId (Rust load/create and runtime appends guarantee it).
  let current = session.leafId ? byId.get(session.leafId) : undefined;
  const path: PiSessionEntry[] = [];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();
  return path;
}

/**
 * Tools whose results are Book content the model can fetch again, so Pruning
 * may clear them from the model context.
 */
export const PRUNABLE_TOOLS: ReadonlySet<string> = new Set(["read_chapter", "search_in_book", "get_toc", "list_guide_blocks", "view_image", "guide_step"]);

/** A toolResult entry of a prunable tool that the projection has not cleared yet. */
export function isPrunableEntry(entry: PiSessionEntry): boolean {
  if (entry.type !== "message" || entry.pruned === true) return false;
  const message = object(entry.message);
  return message?.role === "toolResult" && PRUNABLE_TOOLS.has(string(message.toolName) ?? "");
}

/** A chapter recap of a Guided session. */
export function isGuideRecapEntry(entry: PiSessionEntry): boolean {
  return entry.type === "custom_message" && entry.customType === GUIDE_RECAP;
}

export const GUIDE_RECAP = "guideRecap";
export const GUIDE_WINDOW_CUT = "guide_window_cut";
export const ROOT_SIDE_THREAD_KEY = "__root__";
export const ORIGINAL_STEP_REVISION_ID = "__original__";

/** Stable map key for a side-thread anchor (`null` -> pre-guide root). */
export function sideThreadKeyFor(anchorId: string | null): string {
  return anchorId ?? ROOT_SIDE_THREAD_KEY;
}

/** Decode a side-thread map key back to its persisted `anchorId` (`null` for pre-guide root). */
export function sideThreadAnchorFromKey(key: string): string | null {
  return key === ROOT_SIDE_THREAD_KEY ? null : key;
}

/** Decode an entry's `sideThread` tag, or null when the entry sits on the spine. */
export function decodeSideThread(entry: PiSessionEntry): SideThreadRef | null {
  const ref = object(entry.sideThread);
  if (!ref) return null;
  if (ref.anchorId === null) return { anchorId: null };
  const anchorId = string(ref.anchorId);
  return anchorId ? { anchorId } : null;
}

/** True when `entry` belongs to a chapter side-thread rather than the guided spine. */
export function isSideThreadEntry(entry: PiSessionEntry): boolean {
  return decodeSideThread(entry) !== null;
}

/** Map key of `entry`'s side-thread, or null when `entry` sits on the spine. */
export function entrySideThreadKey(entry: PiSessionEntry): string | null {
  const ref = decodeSideThread(entry);
  return ref ? sideThreadKeyFor(ref.anchorId) : null;
}

/** Decode an entry's `stepRevision` tag, or null when not an off-spine step revision. */
export function decodeStepRevision(entry: PiSessionEntry): StepRevisionRef | null {
  const ref = object(entry.stepRevision);
  if (!ref) return null;
  const targetAnchorId = string(ref.targetAnchorId);
  const revisionId = string(ref.revisionId);
  if (!targetAnchorId || !revisionId) return null;
  const pace: GuideStepPace | undefined =
    ref.pace === "standard" || ref.pace === "compact" || ref.pace === "deep"
      ? ref.pace
      : undefined;
  const styleOverride = string(ref.styleOverride) ?? undefined;
  const modelId = string(ref.modelId) ?? undefined;
  const provider = string(ref.provider) ?? undefined;
  return {
    targetAnchorId,
    revisionId,
    ...(pace ? { pace } : {}),
    ...(styleOverride ? { styleOverride } : {}),
    ...(modelId ? { modelId } : {}),
    ...(provider ? { provider } : {}),
  };
}

/** True when `entry` belongs to an off-spine step revision. */
export function isStepRevisionEntry(entry: PiSessionEntry): boolean {
  return decodeStepRevision(entry) !== null;
}

/** True when `entry` lives off the guided spine (`sideThread` or `stepRevision`). */
export function isOffSpineEntry(entry: PiSessionEntry): boolean {
  return isSideThreadEntry(entry) || isStepRevisionEntry(entry);
}

/** A sliding-window advance or manual context reset in a Guided session. */
export function isGuideWindowCutEntry(entry: PiSessionEntry): boolean {
  return entry.type === GUIDE_WINDOW_CUT;
}

/** Canonical Guided session for a Book: the newest non-archived Guided session, if any. */
export function canonicalGuidedSession(sessions: readonly AgentSessionSummary[]): AgentSessionSummary | undefined {
  return sessions.find((session) => session.kind === "guided" && !session.archived);
}

/**
 * A recap entry's chapters and reader-facing text, or null when malformed.
 * A recap of several chapters names the last as `throughChapterIndex`; one
 * not after the first is dropped.
 */
function decodeRecap(entry: PiSessionEntry): Omit<GuideRecapMarker, "role"> | null {
  if (!isGuideRecapEntry(entry)) return null;
  const details = object(entry.details);
  const text = string(details?.text);
  if (!details || !nonNegativeInteger(details.chapterIndex) || !text) return null;
  const chapterTitle = string(details.chapterTitle);
  const through = nonNegativeInteger(details.throughChapterIndex) && details.throughChapterIndex > details.chapterIndex
    ? details.throughChapterIndex
    : undefined;
  const throughChapterTitle = through !== undefined ? string(details.throughChapterTitle) : null;
  return {
    chapterIndex: details.chapterIndex,
    ...(chapterTitle ? { chapterTitle } : {}),
    ...(through !== undefined ? { throughChapterIndex: through } : {}),
    ...(throughChapterTitle ? { throughChapterTitle } : {}),
    text,
  };
}

function recapRangeKey(entry: PiSessionEntry): string | null {
  const decoded = decodeRecap(entry);
  if (!decoded) return null;
  return `${decoded.chapterIndex}:${decoded.throughChapterIndex ?? decoded.chapterIndex}`;
}

/** Keep only the latest recap entry for each chapter range (preserving order). */
function dedupeRecapEntries(entries: readonly PiSessionEntry[]): PiSessionEntry[] {
  const lastIndexByKey = new Map<string, number>();
  entries.forEach((entry, index) => {
    const key = recapRangeKey(entry);
    if (key !== null) lastIndexByKey.set(key, index);
  });
  return entries.filter((entry, index) => {
    const key = recapRangeKey(entry);
    return key === null || lastIndexByKey.get(key) === index;
  });
}

function prunedPlaceholder(toolName: string, args: Record<string, unknown> | undefined, guide: RecordedGuideStep | null): string {
  if (toolName === "guide_step" && guide) {
    const where = "from" in guide
      ? `chapterIndex ${guide.from.chapterIndex} block ${guide.from.block} through chapterIndex ${guide.to.chapterIndex} block ${guide.to.block}`
      : `chapterIndex ${guide.chapterIndex} part ${guide.part}`;
    return `[Guided step source text (${where}) was cleared to save context. Call read_chapter if you need the source text again.]`;
  }
  const call = `${toolName}(${Object.entries(args ?? {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ")})`;
  return `[Result of ${call} was cleared to save context. Call ${toolName} again if you need it.]`;
}

/**
 * Model-context projection of the active branch: the entries the LLM sees.
 *
 * Applies the branch's latest compaction or `guide_window_cut` (whichever is
 * newer), keeping all earlier chapter recaps in context, then applies the
 * latest `context_prune`, replacing prunable tool results up to its
 * `throughEntryId` with placeholders (marked `pruned: true`; the tool call
 * pairing and any `guide` metadata are kept).
 * Use this only for model-facing concerns (context messages, snapshot/model-
 * change bookkeeping, maintenance cut points); UI and session-level logic use
 * `activeBranch`.
 */
export function contextBranch(session: DecodedPiSession): PiSessionEntry[] {
  const path = activeBranch(session);
  const latestCompaction = [...path].reverse().find((entry) => entry.type === "compaction");
  const latestWindowCut = [...path].reverse().find(isGuideWindowCutEntry);
  // A prune before the latest compaction/cut still applies to the entries kept.
  const latestPrune = [...path].reverse().find((entry) => entry.type === "context_prune");
  const compactIndex = latestCompaction ? path.indexOf(latestCompaction) : -1;
  const cutIndex = latestWindowCut ? path.indexOf(latestWindowCut) : -1;
  let projected = path;
  if (cutIndex > compactIndex && latestWindowCut) {
    const firstKeptId = string(latestWindowCut.firstKeptEntryId);
    const keptIndex = firstKeptId ? path.findIndex((entry) => entry.id === firstKeptId) : -1;
    const beforeCut = keptIndex >= 0 ? keptIndex : cutIndex;
    const earlier = path.slice(0, beforeCut);
    const snapshot = [...earlier].reverse().find((entry) => entry.type === "custom_message" && entry.customType === "bookSnapshot");
    const recaps = earlier.filter(isGuideRecapEntry);
    const keptBefore = keptIndex >= 0 ? path.slice(keptIndex, cutIndex) : [];
    const keptAfter = path.slice(cutIndex + 1);
    const hasSnapshotAfter = [...keptBefore, ...keptAfter].some((entry) => entry.type === "custom_message" && entry.customType === "bookSnapshot");
    projected = [
      ...(!hasSnapshotAfter && snapshot ? [snapshot] : []),
      ...recaps,
      ...keptBefore.filter((entry) => !isGuideWindowCutEntry(entry)),
      ...keptAfter.filter((entry) => !isGuideWindowCutEntry(entry)),
    ];
  } else if (latestCompaction) {
    const firstKeptId = string(latestCompaction.firstKeptEntryId);
    const keptIndex = firstKeptId ? path.findIndex((entry) => entry.id === firstKeptId) : -1;
    // Chapter recaps outlive the turns they followed: the model keeps every
    // one, right after the summary, which leaves them out.
    const recaps = path.slice(0, keptIndex >= 0 ? keptIndex : compactIndex).filter(isGuideRecapEntry);
    projected = [
      latestCompaction,
      ...recaps,
      ...(keptIndex >= 0 ? path.slice(keptIndex, compactIndex) : []),
      ...path.slice(compactIndex + 1),
    ].filter((entry) => !isGuideWindowCutEntry(entry));
  }
  projected = dedupeRecapEntries(projected);
  const throughIndex = latestPrune ? path.findIndex((entry) => entry.id === latestPrune.throughEntryId) : -1;
  if (throughIndex < 0) return projected;
  const prunedIds = new Set(path.slice(0, throughIndex + 1).filter(isPrunableEntry).map((entry) => entry.id));
  if (prunedIds.size === 0) return projected;
  const callArgs = new Map<string, Record<string, unknown>>();
  for (const entry of path) {
    const message = object(entry.message);
    if (entry.type !== "message" || message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const block = object(part);
      if (block?.type === "toolCall" && typeof block.id === "string") callArgs.set(block.id, object(block.arguments) ?? {});
    }
  }
  return projected.map((entry) => {
    if (!prunedIds.has(entry.id)) return entry;
    const message = object(entry.message)!;
    const text = prunedPlaceholder(string(message.toolName) ?? "tool", callArgs.get(string(message.toolCallId) ?? ""), decodeGuide(entry.guide));
    return { ...entry, pruned: true, message: { ...message, content: [{ type: "text", text }] } };
  });
}

export function entriesToPiContextMessages(entries: readonly PiSessionEntry[]): PiAgentMessage[] {
  return entries.flatMap((entry): PiAgentMessage[] => {
    if (entry.type === "message" && object(entry.message)) return [entry.message as PiAgentMessage];
    if (entry.type === "custom_message") {
      return [{
        role: "custom",
        customType: typeof entry.customType === "string" ? entry.customType : "litera",
        content: entry.content ?? [],
        display: entry.display === true,
        details: entry.details,
        timestamp: Date.parse(entry.timestamp),
      } as PiAgentMessage];
    }
    if (entry.type === "branch_summary" && typeof entry.summary === "string") {
      return [{
        role: "branchSummary",
        summary: entry.summary,
        fromId: typeof entry.fromId === "string" ? entry.fromId : "",
        timestamp: Date.parse(entry.timestamp),
      } as PiAgentMessage];
    }
    if (entry.type === "compaction" && typeof entry.summary === "string") {
      return [{
        role: "compactionSummary",
        summary: entry.summary,
        tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : 0,
        timestamp: Date.parse(entry.timestamp),
      } as PiAgentMessage];
    }
    return [];
  });
}

export function piContextMessages(
  session: DecodedPiSession,
  preferredRevisions?: ReadonlyMap<string, string>,
): PiAgentMessage[] {
  return entriesToPiContextMessages(
    applyActiveStepRevisions(contextBranch(session), session, preferredRevisions),
  );
}

export function convertPiContextToLlm(messages: PiAgentMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    const custom = message as unknown as Record<string, unknown>;
    // `system` carries the prompt and tool declarations since pi-ai 0.87, so it
    // must pass through: dropping it removes both from the model request.
    if (message.role === "system" || message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
      return [message];
    }
    const timestamp = typeof custom.timestamp === "number" ? custom.timestamp : Date.now();
    if (custom.role === "custom") {
      const content = typeof custom.content === "string"
        ? [{ type: "text" as const, text: custom.content }]
        : Array.isArray(custom.content) ? custom.content : [];
      return [{ role: "user", content, timestamp } as Message];
    }
    if (custom.role === "compactionSummary" && typeof custom.summary === "string") {
      return [{ role: "user", content: [{ type: "text", text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${custom.summary}\n</summary>` }], timestamp }];
    }
    if (custom.role === "branchSummary" && typeof custom.summary === "string") {
      return [{ role: "user", content: [{ type: "text", text: `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${custom.summary}\n</summary>` }], timestamp }];
    }
    return [];
  });
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const block = object(part);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("");
}

function messageRole(entry: PiSessionEntry | undefined): string | null {
  if (!entry || entry.type !== "message") return null;
  return string(object(entry.message)?.role);
}

/**
 * Shared traversal backing both `visibleMessageEntries` and `visibleMessages`:
 * exactly one anchor entry per visible UI bubble. User entries anchor their
 * own bubble; only the first entry of a consecutive assistant run (agent
 * loop iterations, with toolResult entries in between) anchors the merged
 * bubble; a compaction entry anchors its own transcript divider; toolResult
 * and other non-message entries never anchor. Both exported functions must
 * stay in lockstep — the UI edit index is resolved against these anchors.
 */
function visibleMessageAnchors(session: DecodedPiSession): PiSessionEntry[] {
  const anchors: PiSessionEntry[] = [];
  for (const entry of activeBranch(session)) {
    // A compaction entry anchors its own transcript divider, but only when it
    // actually yields one — `visibleMessages` skips summary-less compactions,
    // and the two functions must stay index-aligned.
    if (entry.type === "compaction") {
      if (typeof entry.summary === "string") anchors.push(entry);
      continue;
    }
    // Manual context resets in Guided sessions appear as a subtle divider.
    if (isGuideWindowCutEntry(entry) && entry.reason === "manual") {
      anchors.push(entry);
      continue;
    }
    const role = messageRole(entry);
    if (role !== "user" && role !== "assistant") continue;
    if (role === "assistant" && messageRole(anchors[anchors.length - 1]) === "assistant") continue;
    anchors.push(entry);
  }
  return anchors;
}

/**
 * Entries corresponding one-to-one (same length, same order) with
 * `visibleMessages(session)`: the entry that anchors each visible bubble.
 * The runtime edit flow resolves UI bubble indices against these anchors.
 * Compaction entries anchor their transcript divider and have no `.message`,
 * so the edit flow's role check rejects them.
 */
export function visibleMessageEntries(session: DecodedPiSession): PiSessionEntry[] {
  return visibleMessageAnchors(session);
}

export function visibleMessages(session: DecodedPiSession): UiAgentMessage[] {
  const output: UiAgentMessage[] = [];
  const toolOwners = new Map<string, { messageIndex: number; blockIndex: number }>();
  const anchorIds = new Set(visibleMessageAnchors(session).map((anchor) => anchor.id));
  for (const entry of activeBranch(session)) {
    // A compaction entry renders as a transcript divider at its position on
    // the durable branch; the full history around it stays visible.
    if (entry.type === "compaction" && typeof entry.summary === "string") {
      output.push({ role: "notice", summary: entry.summary, tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : 0 });
      continue;
    }
    if (isGuideWindowCutEntry(entry) && entry.reason === "manual") {
      output.push({ role: "guide_cut", reason: "manual" });
      continue;
    }
    if (entry.type !== "message") continue;
    const message = object(entry.message);
    if (!message) continue;
    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const owner = toolOwners.get(message.toolCallId);
      const guide = decodeGuide(entry.guide);
      if (owner) {
        const ownerMessage = output[owner.messageIndex];
        const block = ownerMessage?.role === "assistant" ? ownerMessage.blocks?.[owner.blockIndex] : undefined;
        if (block?.type === "toolCall") {
          block.toolCall = {
            ...block.toolCall,
            result: contentText(message.content),
            ...(message.isError === true ? { isError: true } : {}),
            ...(guide ? { guide } : {}),
          };
        }
      }
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.role === "user") {
      // Prompt context (selection / chapterHref) is persisted on the entry
      // payload next to `message` — the LLM-facing PiMessage protocol stays
      // untouched. Old entries without these fields degrade to undefined.
      const selection = string(entry.selection) ?? undefined;
      const chapterHref = string(entry.chapterHref) ?? undefined;
      const guide = decodeGuide(entry.guide);
      const guideRequest = decodeGuideRequest(entry.guideRequest);
      output.push({ role: "user", content: contentText(message.content), ...(selection ? { selection } : {}), ...(chapterHref ? { chapterHref } : {}), ...(guide ? { guide } : {}), ...(guideRequest ? { guideRequest } : {}) });
      continue;
    }
    const stopReason = message.stopReason === "aborted" || message.stopReason === "error" ? message.stopReason : undefined;
    const errorMessage = stopReason === "error" ? string(message.errorMessage) ?? undefined : undefined;
    const blocks: AssistantBlock[] = Array.isArray(message.content)
      ? message.content.flatMap((part): AssistantBlock[] => {
          const block = object(part);
          if (!block) return [];
          if (block.type === "thinking" && typeof block.thinking === "string") {
            return [{ type: "thinking", text: block.thinking }];
          }
          if (block.type === "text" && typeof block.text === "string") {
            return [{ type: "text", text: block.text }];
          }
          if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
            const toolCall: AgentToolCall = {
              toolCallId: block.id,
              tool: block.name,
              params: block.arguments,
              done: true,
            };
            return [{ type: "toolCall", toolCall }];
          }
          return [];
        })
      : [];
    const last = output[output.length - 1];
    if (!anchorIds.has(entry.id) && last?.role === "assistant" && last.blocks) {
      // Non-anchor assistant entry: continuation of the merged bubble opened
      // by the run's first assistant entry (agent loop iterations).
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const block = blocks[blockIndex];
        if (block.type === "toolCall") {
          toolOwners.set(block.toolCall.toolCallId, { messageIndex: output.length - 1, blockIndex: last.blocks.length });
        }
        last.blocks.push(block);
      }
      last.content = textBlocksContent(last.blocks);
      // The bubble's terminal state is the run's last persisted entry.
      if (stopReason) last.stopReason = stopReason;
      else delete last.stopReason;
      if (errorMessage) last.errorMessage = errorMessage;
      else delete last.errorMessage;
    } else {
      output.push({ role: "assistant", content: textBlocksContent(blocks), blocks, ...(stopReason ? { stopReason } : {}), ...(errorMessage ? { errorMessage } : {}) });
      blocks.forEach((block, blockIndex) => {
        if (block.type === "toolCall") {
          toolOwners.set(block.toolCall.toolCallId, { messageIndex: output.length - 1, blockIndex });
        }
      });
    }
  }
  return output;
}

function textBlocksContent(blocks: AssistantBlock[]): string {
  return blocks
    .filter((block): block is Extract<AssistantBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export interface SessionConfig {
  systemPrompt: string;
}

// BranchOption / AnchorBranchInfo live in @/types/agent (the AgentEvent
// contract carries them); re-exported here for existing importers.
export type { AnchorBranchInfo, BranchOption };

/** Serializable navigation snapshot carried by runtime events. */
export interface SessionNavigation {
  anchors: string[];
  navigation: Record<string, AnchorBranchInfo>;
}

/**
 * Event payload helper: visible-message anchor ids plus the branch navigation
 * map serialized to a plain record. `anchors[i]` corresponds one-to-one with
 * `visibleMessages(session)[i]`.
 */
export function sessionNavigation(session: DecodedPiSession): SessionNavigation {
  const navigation: Record<string, AnchorBranchInfo> = {};
  for (const [anchorId, info] of branchNavigation(session)) navigation[anchorId] = info;
  return {
    anchors: visibleMessageEntries(session).map((entry) => entry.id),
    navigation,
  };
}

function isUserMessageEntry(entry: PiSessionEntry | undefined): boolean {
  return !!entry && entry.type === "message" && string(object(entry.message)?.role) === "user";
}

function hasSubstantiveAssistantOutput(message: Record<string, unknown> | null): boolean {
  if (!message) return false;
  const content = message.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    const block = object(part);
    if (!block) return false;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) return true;
    if (block.type === "toolCall") return true;
    return false;
  });
}

/**
 * True when an assistant turn starting at `anchorId` ended in `error` or
 * `aborted` without producing any substantive output (text or tool calls) and
 * has no subsequent user follow-up on its subtree.
 */
function isEmptyFailedAssistantAttempt(
  anchorId: string,
  byId: ReadonlyMap<string, PiSessionEntry>,
  children: ReadonlyMap<string, PiSessionEntry[]>,
): boolean {
  const start = byId.get(anchorId);
  if (!start || messageRole(start) !== "assistant") return false;
  const stack: PiSessionEntry[] = [start];
  const visited = new Set<string>();
  let terminalAssistantCount = 0;
  let allTerminalFailed = true;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    const role = messageRole(current);
    if (role === "user") return false;
    if (role === "assistant" && hasSubstantiveAssistantOutput(object(current.message))) {
      return false;
    }
    const kids = children.get(current.id) ?? [];
    if (kids.some((kid) => messageRole(kid) === "user")) return false;
    if (kids.length === 0) {
      let cursor: PiSessionEntry | undefined = current;
      while (cursor && messageRole(cursor) !== "assistant") {
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      if (cursor && messageRole(cursor) === "assistant") {
        terminalAssistantCount += 1;
        const stop = string(object(cursor.message)?.stopReason);
        if (stop !== "error" && stop !== "aborted") allTerminalFailed = false;
      }
    } else {
      for (const kid of kids) stack.push(kid);
    }
  }
  return terminalAssistantCount > 0 && allTerminalFailed;
}

/**
 * True for a legacy retry-via-edit user branch whose only outcome was an
 * empty error attempt (no substantive output and no subsequent user turns).
 */
function isLegacyEmptyErrorUserBranch(
  userEntry: PiSessionEntry,
  byId: ReadonlyMap<string, PiSessionEntry>,
  children: ReadonlyMap<string, PiSessionEntry[]>,
): boolean {
  const stack: PiSessionEntry[] = [...(children.get(userEntry.id) ?? [])];
  const visited = new Set<string>();
  const assistantAnchors: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    const role = messageRole(current);
    if (role === "user") return false;
    if (role === "assistant") {
      assistantAnchors.push(current.id);
      continue;
    }
    for (const kid of children.get(current.id) ?? []) stack.push(kid);
  }
  return assistantAnchors.length > 0
    && assistantAnchors.every((id) => isEmptyFailedAssistantAttempt(id, byId, children));
}

/**
 * True when an assistant turn in a Guided session ended in `error`, `aborted`,
 * or `length` without committing a `guide` step and has no subsequent user turn.
 */
function isUncommittedGuidedAssistantAttempt(
  anchorId: string,
  byId: ReadonlyMap<string, PiSessionEntry>,
  children: ReadonlyMap<string, PiSessionEntry[]>,
): boolean {
  const start = byId.get(anchorId);
  if (!start || messageRole(start) !== "assistant") return false;
  const stack: PiSessionEntry[] = [start];
  const visited = new Set<string>();
  let terminalAssistantCount = 0;
  let allTerminalFailed = true;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (messageRole(current) === "user") return false;
    if (decodeGuide(current.guide) !== null) return false;
    const kids = children.get(current.id) ?? [];
    if (kids.some((kid) => messageRole(kid) === "user")) return false;
    if (kids.length === 0) {
      let cursor: PiSessionEntry | undefined = current;
      while (cursor && messageRole(cursor) !== "assistant") {
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      if (cursor && messageRole(cursor) === "assistant") {
        terminalAssistantCount += 1;
        const stop = string(object(cursor.message)?.stopReason);
        if (stop !== "error" && stop !== "aborted" && stop !== "length") allTerminalFailed = false;
      }
    } else {
      for (const kid of kids) stack.push(kid);
    }
  }
  return terminalAssistantCount > 0 && allTerminalFailed;
}

/**
 * True when an inactive user branch in a Guided session was an uncommitted
 * guided-step attempt (aborted, errored, or replied without committing `guide`)
 * with no subsequent user turns.
 */
function isUncommittedGuidedUserBranch(
  userEntry: PiSessionEntry,
  children: ReadonlyMap<string, PiSessionEntry[]>,
): boolean {
  const hasGuideRequest = userEntry.guideRequest !== undefined && userEntry.guideRequest !== null;
  let calledGuideStep = false;
  const stack: PiSessionEntry[] = [...(children.get(userEntry.id) ?? [])];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (messageRole(current) === "user") return false;
    if (decodeGuide(current.guide) !== null) return false;
    if (messageRole(current) === "assistant") {
      const content = object(current.message)?.content;
      if (
        Array.isArray(content) &&
        content.some((part) => {
          const block = object(part);
          return block?.type === "toolCall" && block.name === "guide_step";
        })
      ) {
        calledGuideStep = true;
      }
    }
    for (const kid of children.get(current.id) ?? []) stack.push(kid);
  }
  return hasGuideRequest || calledGuideStep;
}

const BRANCH_PREVIEW_CHARS = 40;

function branchPreview(content: unknown): string {
  const text = contentText(content).replace(/\s+/g, " ").trim();
  return text.length > BRANCH_PREVIEW_CHARS ? `${text.slice(0, BRANCH_PREVIEW_CHARS)}…` : text;
}

/**
 * Enumerates both user-message forks (created by editing a user message) and
 * assistant-response forks (created by regenerating a reply under the same
 * user message):
 *
 * - User forks group user-message entries by their nearest ancestor user
 *   message ("" at the session root). Legacy identical-text retries whose only
 *   outcome was an empty error are suppressed when inactive.
 * - Assistant forks group turn-opening assistant entries (those whose nearest
 *   user/assistant ancestor is a user message, never an intermediate tool-loop
 *   continuation) by that parent user message. Inactive empty failed attempts
 *   (`error` or `aborted` with no text or tool calls and no follow-up) are
 *   suppressed so retrying a failed turn never creates a dead branch.
 *
 * Keys of the returned Map are each branch's own anchor entry id; every member
 * of a fork maps to the same AnchorBranchInfo.
 */
export function branchNavigation(session: DecodedPiSession): Map<string, AnchorBranchInfo> {
  return computeBranchNavigation(session, false);
}

function computeBranchNavigation(
  session: DecodedPiSession,
  includeSideThreads: boolean,
): Map<string, AnchorBranchInfo> {
  const entries = includeSideThreads
    ? session.entries.filter((entry) => !isStepRevisionEntry(entry))
    : session.entries.filter((entry) => !isOffSpineEntry(entry));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const children = new Map<string, PiSessionEntry[]>();
  for (const entry of entries) {
    if (!entry.parentId || !byId.has(entry.parentId)) continue;
    const list = children.get(entry.parentId) ?? [];
    list.push(entry);
    children.set(entry.parentId, list);
  }

  const userGroups = new Map<string, PiSessionEntry[]>();
  const assistantGroups = new Map<string, PiSessionEntry[]>();
  for (const entry of entries) {
    if (isUserMessageEntry(entry)) {
      let previousUserId = "";
      let current = entry.parentId ? byId.get(entry.parentId) : undefined;
      while (current) {
        if (isUserMessageEntry(current)) {
          previousUserId = current.id;
          break;
        }
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      const group = userGroups.get(previousUserId) ?? [];
      group.push(entry);
      userGroups.set(previousUserId, group);
      continue;
    }
    if (messageRole(entry) === "assistant") {
      let parentUserId: string | null = null;
      let current = entry.parentId ? byId.get(entry.parentId) : undefined;
      while (current) {
        const role = messageRole(current);
        if (role === "assistant") {
          parentUserId = null;
          break;
        }
        if (role === "user") {
          parentUserId = current.id;
          break;
        }
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      if (parentUserId) {
        const group = assistantGroups.get(parentUserId) ?? [];
        group.push(entry);
        assistantGroups.set(parentUserId, group);
      }
    }
  }

  const activeIds = new Set(activeBranch({ ...session, entries }).map((entry) => entry.id));
  const isGuidedSpine = !includeSideThreads && session.header.kind === "guided";
  const navigation = new Map<string, AnchorBranchInfo>();

  for (const group of userGroups.values()) {
    if (group.length < 2) continue;
    const textCounts = new Map<string, number>();
    for (const entry of group) {
      const normalized = contentText(object(entry.message)?.content).trim();
      textCounts.set(normalized, (textCounts.get(normalized) ?? 0) + 1);
    }
    const visible = group.filter((entry) => {
      if (activeIds.has(entry.id)) return true;
      if (isGuidedSpine && isUncommittedGuidedUserBranch(entry, children)) return false;
      const normalized = contentText(object(entry.message)?.content).trim();
      if ((textCounts.get(normalized) ?? 0) < 2) return true;
      return !isLegacyEmptyErrorUserBranch(entry, byId, children);
    });
    if (visible.length < 2) continue;
    const options = [...visible]
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .map((entry) => ({
        anchorId: entry.id,
        preview: branchPreview(object(entry.message)?.content),
      }));
    const info: AnchorBranchInfo = {
      options,
      activeIndex: options.findIndex((option) => activeIds.has(option.anchorId)),
    };
    for (const option of options) navigation.set(option.anchorId, info);
  }

  for (const [parentUserId, group] of assistantGroups.entries()) {
    if (group.length < 2) continue;
    const parentUser = byId.get(parentUserId);
    const isGuidedRequestTurn =
      isGuidedSpine &&
      Boolean(parentUser && parentUser.guideRequest !== undefined && parentUser.guideRequest !== null);
    const visible = group.filter((entry) => {
      if (activeIds.has(entry.id)) return true;
      if (isEmptyFailedAssistantAttempt(entry.id, byId, children)) return false;
      if (isGuidedRequestTurn && isUncommittedGuidedAssistantAttempt(entry.id, byId, children)) {
        return false;
      }
      return true;
    });
    if (visible.length < 2) continue;
    const options = [...visible]
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .map((entry) => ({
        anchorId: entry.id,
        preview: branchPreview(object(entry.message)?.content),
      }));
    const info: AnchorBranchInfo = {
      options,
      activeIndex: options.findIndex((option) => activeIds.has(option.anchorId)),
    };
    for (const option of options) navigation.set(option.anchorId, info);
  }

  return navigation;
}

/**
 * Deepest leaf of the branch that starts at `anchorId`: walk child links from
 * the anchor, following the latest-timestamp child at each fork, until a
 * node without children. Returns null when the anchor entry does not exist.
 */
export function branchLeafId(session: DecodedPiSession, anchorId: string): string | null {
  return computeBranchLeafId(session.entries, anchorId, false);
}

function computeBranchLeafId(
  allEntries: readonly PiSessionEntry[],
  anchorId: string,
  includeSideThreads: boolean,
): string | null {
  const entries = includeSideThreads
    ? allEntries.filter((entry) => !isStepRevisionEntry(entry))
    : allEntries.filter((entry) => !isOffSpineEntry(entry));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const anchor = byId.get(anchorId);
  if (!anchor) return null;
  const children = new Map<string, PiSessionEntry[]>();
  for (const entry of entries) {
    if (!entry.parentId || !byId.has(entry.parentId)) continue;
    const list = children.get(entry.parentId) ?? [];
    list.push(entry);
    children.set(entry.parentId, list);
  }
  let current = anchor;
  for (;;) {
    const kids = children.get(current.id);
    if (!kids || kids.length === 0) return current.id;
    let next = kids[0];
    for (const kid of kids.slice(1)) {
      if (Date.parse(kid.timestamp) > Date.parse(next.timestamp)) next = kid;
    }
    current = next;
  }
}

function sideThreadMiniSession(
  session: DecodedPiSession,
  key: string,
  preferredLeafId?: string | null,
): DecodedPiSession {
  const entries = session.entries.filter((entry) => entrySideThreadKey(entry) === key);
  const leafId =
    preferredLeafId === null
      ? null
      : preferredLeafId && entries.some((entry) => entry.id === preferredLeafId)
        ? preferredLeafId
        : (entries[entries.length - 1]?.id ?? null);
  return { header: session.header, entries, leafId };
}

/** Active leaf entry id of a chapter side-thread (preferred if valid, else newest). */
export function sideThreadActiveLeaf(
  session: DecodedPiSession,
  key: string,
  preferredLeafId?: string | null,
): string | null {
  return sideThreadMiniSession(session, key, preferredLeafId).leafId;
}

/** Active leaf-to-root path strictly within side-thread `key`, oldest first. */
export function sideThreadActiveBranch(
  session: DecodedPiSession,
  key: string,
  preferredLeafId?: string | null,
): PiSessionEntry[] {
  return activeBranch(sideThreadMiniSession(session, key, preferredLeafId));
}

/** Visible-message anchor entries for side-thread `key` (1:1 with `visibleSideThreadMessages`). */
export function visibleSideThreadEntries(
  session: DecodedPiSession,
  key: string,
  preferredLeafId?: string | null,
): PiSessionEntry[] {
  return visibleMessageEntries(sideThreadMiniSession(session, key, preferredLeafId));
}

/** Visible UI messages for side-thread `key`. */
export function visibleSideThreadMessages(
  session: DecodedPiSession,
  key: string,
  preferredLeafId?: string | null,
): UiAgentMessage[] {
  return visibleMessages(sideThreadMiniSession(session, key, preferredLeafId));
}

/** Internal branch navigation snapshot for side-thread `key`. */
export function sideThreadNavigation(
  session: DecodedPiSession,
  key: string,
  preferredLeafId?: string | null,
): SessionNavigation {
  const mini = sideThreadMiniSession(session, key, preferredLeafId);
  const navigation: Record<string, AnchorBranchInfo> = {};
  for (const [anchorId, info] of computeBranchNavigation(mini, true)) {
    navigation[anchorId] = info;
  }
  return {
    anchors: visibleMessageEntries(mini).map((entry) => entry.id),
    navigation,
  };
}

/** Deepest leaf of a sibling branch inside side-thread `key`. */
export function sideThreadBranchLeafId(
  session: DecodedPiSession,
  key: string,
  anchorEntryId: string,
): string | null {
  const entries = session.entries.filter((entry) => entrySideThreadKey(entry) === key);
  return computeBranchLeafId(entries, anchorEntryId, true);
}

/** Snapshots of every side-thread present in `session`, keyed by `anchorId ?? "__root__"`. */
export function sideThreadSnapshots(
  session: DecodedPiSession,
  preferredLeaves?: ReadonlyMap<string, string>,
): Record<string, SideThreadSnapshot> {
  const keys = new Set<string>();
  for (const entry of session.entries) {
    const key = entrySideThreadKey(entry);
    if (key !== null) keys.add(key);
  }
  const snapshots: Record<string, SideThreadSnapshot> = {};
  for (const key of keys) {
    const preferred = preferredLeaves?.get(key);
    const mini = sideThreadMiniSession(session, key, preferred);
    const navigation: Record<string, AnchorBranchInfo> = {};
    for (const [anchorId, info] of computeBranchNavigation(mini, true)) {
      navigation[anchorId] = info;
    }
    snapshots[key] = {
      messages: visibleMessages(mini),
      anchors: visibleMessageEntries(mini).map((entry) => entry.id),
      navigation,
    };
  }
  return snapshots;
}

export interface GuideSpineRunInfo {
  /** Stable spine entry id anchoring this chapter run (first step's user request entry, or step entry). */
  anchorEntryId: string;
  /** Last spine entry belonging to this run's final step turn (before any recap / next chapter). */
  endEntryId: string;
  chapterIndex: number;
  chapterTitle?: string;
  /** All step-related entry ids belonging to this run (for flexible anchor lookup). */
  memberEntryIds: Set<string>;
}

function stepChapterMeta(step: RecordedGuideStep): { chapterIndex: number; chapterTitle?: string } {
  const start = "from" in step ? step.from : step;
  return {
    chapterIndex: start.chapterIndex,
    ...(start.chapterTitle ? { chapterTitle: start.chapterTitle } : {}),
  };
}

/**
 * Resolve every chronological chapter run on the active guided spine with its
 * stable `anchorEntryId` and its terminal `endEntryId` (last assistant/tool
 * entry of the run's final guided step, excluding later recaps or chapters).
 */
export function guideSpineRuns(session: DecodedPiSession): GuideSpineRunInfo[] {
  const spine = activeBranch(session);
  const runs: GuideSpineRunInfo[] = [];

  let lastUserEntryId: string | null = null;
  let currentTurnFirstAssistantId: string | null = null;
  let currentStepTurnRun: GuideSpineRunInfo | null = null;

  for (const entry of spine) {
    const role = messageRole(entry);
    if (role === "user") {
      currentTurnFirstAssistantId = null;
      currentStepTurnRun = null;
      lastUserEntryId = entry.id;

      const legacyStep = decodeGuide(entry.guide);
      if (legacyStep) {
        const meta = stepChapterMeta(legacyStep);
        const lastRun = runs[runs.length - 1];
        if (lastRun && lastRun.chapterIndex === meta.chapterIndex) {
          lastRun.endEntryId = entry.id;
          lastRun.memberEntryIds.add(entry.id);
          currentStepTurnRun = lastRun;
        } else {
          const run: GuideSpineRunInfo = {
            anchorEntryId: entry.id,
            endEntryId: entry.id,
            chapterIndex: meta.chapterIndex,
            chapterTitle: meta.chapterTitle,
            memberEntryIds: new Set([entry.id]),
          };
          runs.push(run);
          currentStepTurnRun = run;
        }
      }
      continue;
    }

    if (role === "assistant") {
      if (!currentTurnFirstAssistantId) currentTurnFirstAssistantId = entry.id;
      if (currentStepTurnRun) {
        currentStepTurnRun.endEntryId = entry.id;
        currentStepTurnRun.memberEntryIds.add(entry.id);
      }
      continue;
    }

    if (role === "toolResult") {
      const step = decodeGuide(entry.guide);
      if (step) {
        const meta = stepChapterMeta(step);
        const stepAnchor = lastUserEntryId ?? currentTurnFirstAssistantId ?? entry.id;
        const lastRun = runs[runs.length - 1];
        if (lastRun && lastRun.chapterIndex === meta.chapterIndex) {
          lastRun.endEntryId = entry.id;
          lastRun.memberEntryIds.add(stepAnchor);
          if (currentTurnFirstAssistantId) lastRun.memberEntryIds.add(currentTurnFirstAssistantId);
          lastRun.memberEntryIds.add(entry.id);
          currentStepTurnRun = lastRun;
        } else {
          const members = new Set<string>([stepAnchor, entry.id]);
          if (currentTurnFirstAssistantId) members.add(currentTurnFirstAssistantId);
          const run: GuideSpineRunInfo = {
            anchorEntryId: stepAnchor,
            endEntryId: entry.id,
            chapterIndex: meta.chapterIndex,
            chapterTitle: meta.chapterTitle,
            memberEntryIds: members,
          };
          runs.push(run);
          currentStepTurnRun = run;
        }
      } else if (currentStepTurnRun) {
        currentStepTurnRun.endEntryId = entry.id;
      }
      continue;
    }

    // Non-message entries (recap, window cut, compaction, readingContext) end the step turn.
    currentStepTurnRun = null;
  }

  return runs;
}

/** Find the spine chapter run owning `anchorId` (null when not found). */
export function resolveGuideRunForAnchor(
  session: DecodedPiSession,
  anchorId: string,
): GuideSpineRunInfo | null {
  for (const run of guideSpineRuns(session)) {
    if (run.anchorEntryId === anchorId || run.memberEntryIds.has(anchorId)) return run;
  }
  return null;
}

/**
 * Model-context projection for a chapter side-thread:
 *   contextBranch(spine prefix through `spineEndEntryId`) + contextBranch(side-thread).
 *
 * Keeps the guided spine prefix byte-identical through the chapter's latest
 * step (maximizing Prompt Cache hits and excluding later chapters / later spine
 * window cuts), applying active step revisions, then appends the chapter's
 * active side-thread Q&A chain.
 */
export function sideThreadContextEntries(
  session: DecodedPiSession,
  key: string,
  spineEndEntryId: string | null,
  preferredSideLeafId?: string | null,
  preferredRevisions?: ReadonlyMap<string, string>,
): PiSessionEntry[] {
  const spineEntries = session.entries.filter((entry) => !isOffSpineEntry(entry));
  const spineContext = spineEndEntryId
    ? applyActiveStepRevisions(
        contextBranch({ header: session.header, entries: spineEntries, leafId: spineEndEntryId }),
        session,
        preferredRevisions,
      )
    : [];
  const sideMini = sideThreadMiniSession(session, key, preferredSideLeafId);
  const sideContext = contextBranch(sideMini);
  const spineHasSnapshot = spineContext.some(
    (entry) => entry.type === "custom_message" && entry.customType === "bookSnapshot",
  );
  const filteredSide = spineHasSnapshot
    ? sideContext.filter(
        (entry) => !(entry.type === "custom_message" && entry.customType === "bookSnapshot"),
      )
    : sideContext;
  return [...spineContext, ...filteredSide];
}

/** PiAgentMessage projection for a chapter side-thread. */
export function piSideThreadContextMessages(
  session: DecodedPiSession,
  key: string,
  spineEndEntryId: string | null,
  preferredSideLeafId?: string | null,
  preferredRevisions?: ReadonlyMap<string, string>,
): PiAgentMessage[] {
  return entriesToPiContextMessages(
    sideThreadContextEntries(session, key, spineEndEntryId, preferredSideLeafId, preferredRevisions),
  );
}

interface GroupedRevisionBucket {
  ref: StepRevisionRef;
  timestamp: string;
  entries: PiSessionEntry[];
}

function collectStepRevisionBuckets(
  session: DecodedPiSession,
): Map<string, GroupedRevisionBucket[]> {
  const byTarget = new Map<string, Map<string, GroupedRevisionBucket>>();
  for (const entry of session.entries) {
    const ref = decodeStepRevision(entry);
    if (!ref) continue;
    let targetMap = byTarget.get(ref.targetAnchorId);
    if (!targetMap) {
      targetMap = new Map();
      byTarget.set(ref.targetAnchorId, targetMap);
    }
    let bucket = targetMap.get(ref.revisionId);
    if (!bucket) {
      bucket = { ref, timestamp: entry.timestamp, entries: [] };
      targetMap.set(ref.revisionId, bucket);
    }
    bucket.entries.push(entry);
  }
  const result = new Map<string, GroupedRevisionBucket[]>();
  for (const [targetAnchorId, map] of byTarget) {
    result.set(targetAnchorId, [...map.values()]);
  }
  return result;
}

function projectRevisionBucket(bucket: GroupedRevisionBucket): StepRevisionEntry {
  const blocks: AssistantBlock[] = [];
  const toolOwners = new Map<string, number>();
  let stopReason: "aborted" | "error" | undefined;
  let errorMessage: string | undefined;

  for (const entry of bucket.entries) {
    if (entry.type !== "message") continue;
    const message = object(entry.message);
    if (!message) continue;
    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const idx = toolOwners.get(message.toolCallId);
      const block = idx !== undefined ? blocks[idx] : undefined;
      if (block?.type === "toolCall") {
        block.toolCall = {
          ...block.toolCall,
          result: contentText(message.content),
          ...(message.isError === true ? { isError: true } : {}),
        };
      }
      continue;
    }
    if (message.role !== "assistant") continue;
    const nextStop =
      message.stopReason === "aborted" || message.stopReason === "error"
        ? message.stopReason
        : undefined;
    const nextError = nextStop === "error" ? (string(message.errorMessage) ?? undefined) : undefined;
    if (nextStop) stopReason = nextStop;
    else stopReason = undefined;
    if (nextError) errorMessage = nextError;
    else errorMessage = undefined;

    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const block = object(part);
        if (!block) continue;
        if (block.type === "thinking" && typeof block.thinking === "string") {
          blocks.push({ type: "thinking", text: block.thinking });
        } else if (block.type === "text" && typeof block.text === "string") {
          blocks.push({ type: "text", text: block.text });
        } else if (
          block.type === "toolCall" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          toolOwners.set(block.id, blocks.length);
          blocks.push({
            type: "toolCall",
            toolCall: {
              toolCallId: block.id,
              tool: block.name,
              params: block.arguments,
              done: true,
            },
          });
        }
      }
    }
  }

  return {
    revisionId: bucket.ref.revisionId,
    timestamp: bucket.timestamp,
    ...(bucket.ref.pace ? { pace: bucket.ref.pace } : {}),
    ...(bucket.ref.styleOverride ? { styleOverride: bucket.ref.styleOverride } : {}),
    ...(bucket.ref.modelId ? { modelId: bucket.ref.modelId } : {}),
    ...(bucket.ref.provider ? { provider: bucket.ref.provider } : {}),
    content: textBlocksContent(blocks),
    blocks,
    ...(stopReason ? { stopReason } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function isEmptyFailedRevision(item: StepRevisionEntry): boolean {
  if (item.stopReason !== "error" && item.stopReason !== "aborted") return false;
  if (item.content.trim().length > 0) return false;
  if ((item.blocks ?? []).some((block) => block.type === "toolCall")) return false;
  return true;
}

/**
 * Snapshots of every off-spine step revision present in `session`, keyed by
 * `targetAnchorId` (the spine step's assistant anchor entry id).
 */
export function stepRevisionSnapshots(
  session: DecodedPiSession,
  preferredRevisions?: ReadonlyMap<string, string>,
): Record<string, StepRevisionSnapshot> {
  const bucketsByTarget = collectStepRevisionBuckets(session);
  const snapshots: Record<string, StepRevisionSnapshot> = {};

  for (const [targetAnchorId, buckets] of bucketsByTarget) {
    const preferred = preferredRevisions?.get(targetAnchorId);
    const projected = buckets.map(projectRevisionBucket);
    const visible = projected.filter(
      (item) => item.revisionId === preferred || !isEmptyFailedRevision(item),
    );
    if (visible.length === 0) continue;

    let activeRevisionId: string;
    if (preferred === ORIGINAL_STEP_REVISION_ID) {
      activeRevisionId = ORIGINAL_STEP_REVISION_ID;
    } else if (preferred && visible.some((item) => item.revisionId === preferred)) {
      activeRevisionId = preferred;
    } else {
      const latestGood = [...visible]
        .reverse()
        .find((item) => item.stopReason !== "error" && item.stopReason !== "aborted");
      activeRevisionId = (latestGood ?? visible[visible.length - 1]).revisionId;
    }

    snapshots[targetAnchorId] = {
      targetAnchorId,
      revisions: visible,
      activeRevisionId,
    };
  }

  return snapshots;
}

/**
 * Substitute the active off-spine `stepRevision` assistant entries into a
 * projected spine context entry list, keeping `guide_step` tool calls/results
 * intact so step boundaries and `Guide cursor` never change.
 */
export function applyActiveStepRevisions(
  entries: readonly PiSessionEntry[],
  session: DecodedPiSession,
  preferredRevisions?: ReadonlyMap<string, string>,
): PiSessionEntry[] {
  const snapshots = stepRevisionSnapshots(session, preferredRevisions);
  if (Object.keys(snapshots).length === 0) return [...entries];

  const bucketsByTarget = collectStepRevisionBuckets(session);
  const activeEntriesByTarget = new Map<string, PiSessionEntry[]>();
  for (const [targetAnchorId, snapshot] of Object.entries(snapshots)) {
    if (snapshot.activeRevisionId === ORIGINAL_STEP_REVISION_ID) continue;
    const bucket = bucketsByTarget
      .get(targetAnchorId)
      ?.find((item) => item.ref.revisionId === snapshot.activeRevisionId);
    if (!bucket) continue;
    const messageEntries = bucket.entries.filter((entry) => {
      const role = messageRole(entry);
      return role === "assistant" || role === "toolResult";
    });
    if (messageEntries.length > 0) {
      activeEntriesByTarget.set(targetAnchorId, messageEntries);
    }
  }
  if (activeEntriesByTarget.size === 0) return [...entries];

  const output: PiSessionEntry[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    const role = messageRole(entry);
    const replacement = role === "assistant" ? activeEntriesByTarget.get(entry.id) : undefined;
    if (!replacement) {
      output.push(entry);
      index += 1;
      continue;
    }

    // Collect the entire spine assistant turn starting at `entry` (including any
    // interleaved toolResult entries) until the next user or non-message entry.
    const turnEntries: PiSessionEntry[] = [entry];
    let end = index + 1;
    while (end < entries.length) {
      const nextRole = messageRole(entries[end]);
      if (nextRole !== "assistant" && nextRole !== "toolResult") break;
      turnEntries.push(entries[end]);
      end += 1;
    }

    // Preserve any `guide_step` toolCall + toolResult prefix so tool pairing and
    // step records remain valid; replace only the trailing explanation entries.
    let lastGuideResultIdx = -1;
    for (let i = 0; i < turnEntries.length; i += 1) {
      if (messageRole(turnEntries[i]) === "toolResult" && decodeGuide(turnEntries[i].guide)) {
        lastGuideResultIdx = i;
      }
    }

    if (lastGuideResultIdx >= 0) {
      output.push(...turnEntries.slice(0, lastGuideResultIdx + 1), ...replacement);
    } else {
      output.push(...replacement);
    }
    index = end;
  }

  return output;
}

/**
 * Spoiler-free model-context prefix for revising a spine step anchored at
 * `targetAnchorId`: takes `contextBranch` strictly *before* the owning step
 * turn (preserving `bookSnapshot` and earlier `Chapter recap`s, excluding the
 * target step's old explanation and all later chapters/steps), with active
 * revisions applied to earlier steps in that prefix.
 */
export function stepRevisionContextEntries(
  session: DecodedPiSession,
  targetAnchorId: string,
  preferredRevisions?: ReadonlyMap<string, string>,
): PiSessionEntry[] {
  const spineEntries = session.entries.filter((entry) => !isOffSpineEntry(entry));
  const spine = activeBranch({ header: session.header, entries: spineEntries, leafId: session.leafId });
  const targetIdx = spine.findIndex((entry) => entry.id === targetAnchorId);
  if (targetIdx < 0) return [];

  // Walk backward past the owning user request and any immediately preceding
  // `readingContext` custom_message so we land on the entry before this turn
  // (keeping `bookSnapshot` on the very first turn intact).
  let beforeIdx = targetIdx - 1;
  if (beforeIdx >= 0 && messageRole(spine[beforeIdx]) === "user") {
    beforeIdx -= 1;
  }
  if (
    beforeIdx >= 0 &&
    spine[beforeIdx].type === "custom_message" &&
    spine[beforeIdx].customType === "readingContext"
  ) {
    beforeIdx -= 1;
  }
  if (beforeIdx < 0) return [];

  const prefixLeafId = spine[beforeIdx].id;
  const prefixContext = contextBranch({
    header: session.header,
    entries: spineEntries,
    leafId: prefixLeafId,
  });
  return applyActiveStepRevisions(prefixContext, session, preferredRevisions);
}

/**
 * Latest session_config entry on the active branch, or null when the session
 * has none. Absent systemPrompt -> "" (empty string means unset -> default
 * SYSTEM_PROMPT at runtime).
 */
export function sessionConfig(session: DecodedPiSession): SessionConfig | null {
  const branch = activeBranch(session);
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "session_config") continue;
    return {
      systemPrompt: string(entry.systemPrompt) ?? "",
    };
  }
  return null;
}

export function sessionSummary(value: unknown): AgentSessionSummary {
  const item = object(value);
  if (!item || !string(item.id) || typeof item.title !== "string" || !string(item.createdAt) || !string(item.updatedAt)) {
    throw new Error("Invalid session summary");
  }
  const summary: AgentSessionSummary = { id: item.id as string, title: item.title, createdAt: item.createdAt as string, updatedAt: item.updatedAt as string };
  const systemPrompt = string(item.systemPrompt);
  if (systemPrompt !== null) summary.systemPrompt = systemPrompt;
  if (item.kind === "guided") {
    summary.kind = "guided";
    const guide = decodeGuide(item.guide);
    if (guide) summary.guide = guide;
  }
  if (item.archived === true) summary.archived = true;
  return summary;
}

/**
 * The guided steps on the active branch, oldest first, each with the text of
 * the explanation that followed it (respecting active off-spine step revisions
 * when present). Side questions are left out.
 */
export function guidedTurns(
  session: DecodedPiSession,
  preferredRevisions?: ReadonlyMap<string, string>,
): Array<{ step: RecordedGuideStep; text: string }> {
  const turns: Array<{ step: RecordedGuideStep; text: string }> = [];
  let current: { step: RecordedGuideStep; text: string } | null = null;
  const entries = applyActiveStepRevisions(activeBranch(session), session, preferredRevisions);
  for (const entry of entries) {
    const role = messageRole(entry);
    const step = role ? decodeGuide(entry.guide) : null;
    if (step) {
      current = { step, text: "" };
      turns.push(current);
    } else if (role === "user") {
      current = null;
    } else if (role === "assistant" && current) {
      current.text += contentText(object(entry.message)?.content);
    }
  }
  return turns;
}

/** All decoded chapter recaps (with text) on the active branch, oldest first (latest wins per chapter range). */
export function guideRecaps(session: DecodedPiSession): Array<Omit<GuideRecapMarker, "role">> {
  return dedupeRecapEntries(activeBranch(session)).flatMap((entry) => {
    const recap = decodeRecap(entry);
    return recap ? [recap] : [];
  });
}

/** The chapters of each recap on the active branch. */
export function guideRecapChapters(session: DecodedPiSession): Array<Omit<GuideRecapMarker, "role" | "text">> {
  return guideRecaps(session).map(({ text: _text, ...chapters }) => chapters);
}

export function newEntry(type: string, parentId: string | null, fields: Record<string, unknown>): PiSessionEntry {
  return { type, id: crypto.randomUUID(), parentId, timestamp: new Date().toISOString(), ...fields };
}
