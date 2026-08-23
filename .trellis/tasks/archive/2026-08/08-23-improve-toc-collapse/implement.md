# Implement: TOC nested collapse

## Checklist

1. **Helpers** (`src/lib/toc-items.ts`)
   - `tocPathKey(path: number[]): string` — join with `"."`.
   - `collapsibleKeys(toc: TocTreeItem[]): string[]` — DFS keys where `subitems?.length > 0`.
   - `ancestorKeysForHref(toc, href?: string): string[]` — collapsible ancestors of every `href` match; `[]` if href missing/unmatched.
   - `unionKeys(current: string[], extra: string[]): string[]` — stable unique union.
   - Reuse `TocTreeItem`. Do not walk the tree inline in `App.tsx`.

2. **App state**
   - `tocExpanded: string[]` next to `toc`.
   - Reset to `[]` wherever `setToc([])` / back-to-library already runs.
   - On `setToc(bookToc)`, set `ancestorKeysForHref(bookToc, progress.chapterHref)`.
   - When `progress.chapterHref` changes after TOC is loaded, union `ancestorKeysForHref`.
   - Chevron → toggle that key. Expand-all → `collapsibleKeys(toc)`. Collapse-all → `ancestorKeysForHref(toc, progress.chapterHref)`.
   - Keep `handleTocGoTo` as jump + close. Do not persist expand state.

3. **TocSidebar**
   - Props: `expanded: string[]`, `onToggle(key)`, `onExpandAll`, `onCollapseAll`.
   - Split chevron vs title (no nested buttons). Spacer on leaves. Whole-row current highlight. Existing auto-center on the row.
   - Render `subitems` only when parent key is in `expanded`.
   - Empty href: no `onGoTo`. Title bar: `h-12` + icon-xs expand-all / collapse-all.

4. **i18n**
   - Add `toc.expandAll` / `toc.collapseAll` / `toc.expand` / `toc.collapse` to both catalogs.

5. **Tests**
   - `toc-items.test.ts`: path keys, collapsible keys, ancestors of nested/duplicate hrefs, missing href → `[]`, union does not drop extras.
   - `TocSidebar.test.tsx`: chevron vs title click; collapsed hides descendants; empty href does not jump; expand-all / collapse-all callbacks; current highlight + auto-center still hold for a visible current row.
   - App-level: reopen drawer keeps extra expansions; book switch / back-to-library resets. Prefer extending an existing reader test that already opens TOC (`App.annotations.test.tsx` / `App.reader-mode.test.tsx`) over a new harness. If that is too coupled, cover reset at the helper + `setToc([])` call sites and still add one drawer close/reopen case.

6. **Do not**
   - Persist expand state.
   - Change overlay mount, width helpers, or `tocVisible`.
   - Change `flattenToc` / `chapterNavAt` prev/next.
   - Edit `src/foliate-js/**`.
   - Edit `.trellis/spec/` here — spec update is Phase 3.3.

## Validation

- `npx vitest run src/lib/toc-items.test.ts src/components/TocSidebar.test.tsx`
- App reader tests that open TOC, if touched
- `npm test`
- `npm run build`

## Risks

- `currentHref` often arrives after `setToc`. R5 on book-ready may start all-collapsed; R6 union on first relocate must still expand the path.
- Duplicate hrefs: expand ancestors of every match so every highlighted row can show.
- Nested buttons fail a11y and click targeting — split controls.
- Auto-center tests mock `getBoundingClientRect`; new row wrappers must keep the list class `overflow-y-auto` and a measurable current row.

## Rollback

Revert `toc-items` helpers, `App` `tocExpanded`, `TocSidebar` row split, and the four i18n keys. No stored user data to migrate.
