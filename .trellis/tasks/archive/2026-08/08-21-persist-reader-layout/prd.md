# Persist per-book reader layout panel states

## Goal

Reopening a book restores its last reader chrome layout — AI chat pane, Agent book pane, and chat session rail — so layout memory follows the book.

## Background

Opening a book (`App.tsx` ~437) and returning to the library (`App.tsx` ~492) currently force `chatCollapsed = true`, `sessionRailOpen = true`, and `bookCollapsed = false`. Switching into Agent mode also resets the last two (`App.tsx` ~531–534).

Pane widths already persist globally in `localStorage`. Per-book mode already persists as `BookRecord.lastReaderMode` via `update_reading_state`. Spec currently documents the three collapse flags as process-only (`.trellis/spec/frontend/state-management.md`).

Opening TOC or annotations in Agent mode expands the book pane so those drawers have a surface (`App.tsx` ~803, ~816). That is a functional constraint, not drawer persistence.

## Requirements

- **LAY-1**: Layout open/closed state is stored per book, not as a single app-wide preference.
- **LAY-2**: Persist and restore these three flags independently per book:
  - `chatCollapsed` (Reader-mode AI chat pane)
  - `bookCollapsed` (Agent-mode book pane)
  - `sessionRailOpen` (chat session list rail)
- **LAY-3**: Reopening the same book restores the last saved values of those three flags. A different book does not inherit them.
- **LAY-4**: Books with no saved layout keep today's first-open defaults (chat collapsed, book expanded, session rail open).
- **LAY-5**: Returning to the library or restarting the app, then opening the same book, still restores the saved layout.
- **LAY-6**: Saving layout must not clobber `lastFraction`, typography `settings`, or `lastReaderMode`.
- **LAY-7**: Switching Reader ↔ Agent in the same session must **not** reset the three flags. Mode only swaps which chrome is primary; this book's last layout stays.
- **LAY-8**: Opening TOC or annotations in Agent mode may still expand the book pane. Drawer visibility itself is not persisted. If that expansion changes `bookCollapsed`, the resulting value is the last layout.

## Acceptance Criteria

- [ ] AC-1: Open a book, toggle chat pane / book pane / session rail, leave the reader (back to library or restart), reopen that book → all three controls restore.
- [ ] AC-2: After changing book A's layout, open book B with no saved layout → book B uses first-open defaults, not book A's layout.
- [ ] AC-3: A book that has never had layout saved still opens with chat collapsed / book expanded / session rail open.
- [ ] AC-4: Updating layout does not clear or rewrite unrelated reading state (position, typography, last mode).
- [ ] AC-5: In one session, collapse the book pane (or session rail) in Agent, switch to Reader, switch back to Agent → those panels stay as last set, not force-expanded.

## Out of Scope

- Moving pane **widths** from global `localStorage` to per-book storage.
- Persisting TOC / annotation **drawer** visibility.
- Changing default reader/Agent mode, typography, TTS, chrome font, or theme persistence.
- Cloud sync or exporting layout separately from library data.
