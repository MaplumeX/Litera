# Implement: bookmarks, highlights, and progress jump

Do **not** `task.py start` this parent. Start the next child. Parent is integration review only.

## Order

1. `08-14-reader-progress-scrubber` — restore always-on bar, make it a scrubber, update reader-chrome specs.
2. `08-14-reader-bookmarks-highlights` — annotations.json + drawer + foliate paint.
3. Parent integration check (below), then archive children and parent.

## Per-child ready gate

Each child must have its own `prd.md`. The annotations child also needs `design.md` + `implement.md` + curated jsonl. Progress child may stay PRD-only plus its jsonl.

Before any child `task.py start`: `git submodule update --init src/foliate-js` (needed for annotations; harmless for progress).

## Integration check (parent, after both children)

- Scrubber, TOC, bookmark, and highlight jumps each move the book and update the bar’s percent/label.
- TOC and 标注 drawers are exclusive; neither remounts `ReaderView`.
- 「问 agent」 still fills chat when chat is collapsed.
- Overwrite same book keeps annotations; delete book removes them.
- `npm test` && `npm run build`.

## Spec updates (Phase 3.3, owning child)

- Progress child: `component-guidelines.md` / `state-management.md` — reader may have a full-width progress scrubber under the header.
- Annotations child: `database-guidelines.md` layout (`annotations.json`); `tauri-commands.md` `get_annotations` / `save_annotations`; frontend chrome for the 标注 drawer.

## Rollback points

- After progress: revert bar + spec sentences.
- After annotations: revert commands/UI; leftover `annotations.json` is inert.
