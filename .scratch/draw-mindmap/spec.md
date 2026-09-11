# Spec: draw_mindmap — Mind Maps in the Session message flow

Status: ready-for-agent

## Problem Statement

A reader using Litera's built-in reading assistant asks for structural overviews of a book — chapter structures, character relationships, argument maps — and today the assistant can only answer in prose. Long hierarchical answers are hard to scan and remember. The reader wants the assistant to be able to draw a mind map inline in the Session, and to be able to revisit it later in the same conversation (including after branching or on another device via Sync).

## Solution

Give the agent runtime a new tool, `draw_mindmap`. When the user asks for a visual overview or summary, the assistant calls the tool with a title and a markdown outline. The tool call renders inside the Session's message flow as a collapsible card: collapsed by default, expanding into an interactive mind map (pan, zoom, fold/unfold nodes) with an SVG export. The mind map is a purely derived view of the tool call's parameters — no new persisted entity, no new storage — so history, branching, regeneration, and Sync all inherit it for free.

## User Stories

1. As a reader, I want to ask the assistant to summarize a chapter's structure as a mind map, so that I can absorb the hierarchy at a glance instead of reading prose.
2. As a reader, I want to ask for a character-relationship map of the book, so that I can keep track of who relates to whom.
3. As a reader, I want the mind map to appear directly in the conversation flow, so that I don't lose context of what was discussed around it.
4. As a reader, I want the mind map card collapsed by default, so that a large map doesn't push the rest of the conversation off screen.
5. As a reader, I want to expand the card with one click, so that I can study the full map when I'm ready.
6. As a reader, I want to fold and unfold individual nodes, so that I can progressively explore a large outline.
7. As a reader, I want to pan and zoom the mind map, so that I can read dense regions comfortably.
8. As a reader, I want to export the mind map as an SVG file, so that I can keep it or use it elsewhere.
9. As a reader, I want historical mind maps in a Session to stay viewable, so that I can scroll back and re-read a map from earlier turns.
10. As a reader, I want each `draw_mindmap` call in a single answer to render as its own independent map, so that multiple maps don't overwrite each other.
11. As a reader on another device, I want synced Sessions to show their mind maps, so that I can continue reading conversations with full fidelity.
12. As a reader, I want a branched or regenerated answer to show the map for the branch I'm viewing, so that old and new versions coexist correctly.
13. As a reader using dark mode, I want the mind map to follow the app theme, so that it remains readable on a dark background.
14. As a reader, I want the assistant to be told when its outline is too large to draw, so that it retries with a smaller, valid outline instead of drawing something broken.
15. As a reader, I want the assistant to prefer drawing a map over writing a wall of text when I ask for a visual overview, so that I get the format I asked for.
16. As a developer, I want the tool to return only a lightweight receipt to the model, so that context tokens aren't wasted on echoing the outline back.
17. As a developer, I want mind maps to be a derived view with zero new persisted entities, so that no Manifest, tombstone, or sync-schema changes are needed.

## Implementation Decisions

- **Tool**: `draw_mindmap`, added to the existing agent tool list in the embedded runtime alongside the book tools (same `AgentTool` shape, TypeBox parameter schema).
- **Parameters**: `{ title: string, outline: string }` where `outline` is a markdown heading/list outline. Full-replacement semantics: one call = one complete, independent map; no incremental editing tools.
- **Validation limits** (enforced by the tool; violations return a structured error with `isError` so the model retries smaller): outline depth ≤ 4 levels, total node count ≤ 100, single line length ≤ 200 characters.
- **Tool result**: lightweight receipt `{ status, title, nodes }` — never echoes the outline.
- **Rendering**: markmap (`markmap-lib` for markdown→tree transformation, `markmap-view` for rendering) inside the tool-call card component. The card keeps its existing collapsed-by-default interaction pattern; expanding reveals the interactive map. Expanded state is not persisted.
- **Derived view**: the mind map is rendered from the tool call's persisted parameters. No new data directory, no Manifest changes, no tombstones. Rendering reads the params that already flow through tool-call entries, session rebuild, and Sync.
- **Export**: SVG export via markmap's built-in export, offered from the expanded card.
- **Theming**: markmap color palette and background bound to the app's existing CSS theme tokens so dark mode works; re-render on theme change.
- **Model guidance**: usage guidance lives only in the tool description (e.g. "use when the user asks for a visual overview or summary"), not in the system prompt.
- **Term**: the glossary entry **Mind Map** has been added to CONTEXT.md (a visual outline derived from a single tool call's markdown outline; not a stored object).

## Testing Decisions

A good test observes external behavior through existing seams — what the tool persists and what the card renders — never internal validation helpers or markmap internals. Two existing seams, no new ones:

1. **Embedded runtime tests** (prior art: the `list_annotations` / `get_toc` tool-result tests): drive the runtime with a mocked agent, execute `draw_mindmap` —
   - valid params → a `toolResult` entry is persisted with the lightweight receipt shape (status/title/nodes)
   - over-limit outline (depth > 4, or > 100 nodes, or a > 200-char line) → a structured error with `isError`
   - the original title + outline params are persisted intact on the tool-call entry (the derived view's data source)
2. **Tool-call card component tests** (jsdom; prior art: `ToolCallCard.test.tsx`): mindmap card renders collapsed by default with tool name + title only; expands on click to reveal the map container (markmap's SVG internals are not asserted — third-party detail); re-render returns to collapsed; the SVG export affordance is present; error state reuses the existing destructive styling path.

## Out of Scope

- Editing mind maps in the UI (user-directed node editing, renaming, re-parenting)
- Persisting mind maps as standalone entities (a Library-level "my maps" view)
- Additional diagram types (flowcharts, mermaid diagrams other than mind maps)
- PNG export or other export formats beyond SVG
- Incremental/fine-grained drawing tools (add_node/update_node/remove_node)
- Any changes to the system prompt, Manifest, or sync protocol

## Further Notes

- All decisions above were stress-tested in a grilling session before this spec; the design tree is fully resolved.
- No ADR recorded: the decisions are readily reversible (rendering library is swappable behind the card component) and the derived-view approach is the low-cost path, failing the "hard to reverse" bar.
