# Fix footnote noteref style for a>sup structure

## Background

The reader injects a noteref superscript style via `noterefCss()` in
`src/lib/reader-styles.ts` (commit f5ff0ea). Its selectors are:

```css
a[epub\:type~="noteref"], a[epub|type~="noteref"], sup > a[href^="#"]
```

Real-world EPUBs use a different DOM structure, so the style never applies:

- 《黑格尔小逻辑绎注》: `<a id="s7-ref-1" href="#s7-note-1"><sup>1</sup></a>`
  — no `epub:type="noteref"` attribute, and the `sup` is INSIDE the `a`
  (selector assumed `sup > a`, i.e. `a` inside `sup`).
- 《置身事内》: `<a id="jzyy_4_130" href="part0032.xhtml#jz_4_130"><sup class="calibre1">(13)</sup></a>`
  — same `a > sup` structure, plus a cross-file href so `[href^="#"]`
  can never match even with the right nesting direction.

All three current selectors miss both books.

## Requirements

- The noteref accent style (0.72em superscript, no underline, theme-aware
  blue color) must apply to footnote reference marks written as
  `<a href="..."><sup>...</sup></a>`, for both same-file (`#id`) and
  cross-file (`file.xhtml#id`) hrefs.
- Existing selectors keep working (no regression for `epub:type` based
  books or `sup > a` structures).
- Must not accidentally style the note-body side: 《黑格尔小逻辑绎注》 note
  bodies are `<a id="s7-note-1"></a><sup>①</sup>` — a sibling `sup`, not a
  child, so a child-combinator selector is naturally safe.

## Acceptance criteria

- `generateStylesCss` output contains a selector matching `a[href] > sup`.
- Unit test in `src/lib/reader-styles.test.ts` covers the new structure
  (and ideally the sibling-sup non-match on the note-body side).
- All existing tests pass.

## Notes

Lightweight task: PRD-only, no design.md/implement.md needed.