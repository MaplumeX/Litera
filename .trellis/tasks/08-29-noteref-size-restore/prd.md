# Restore noteref mark size to browser-default 0.83em

## Background

Commit f5ff0ea (#32) introduced the theme-aware academic superscript style for
footnote reference marks, fixing their size at `0.72em`. Before that change,
the size was governed by the book's own CSS, or the browser's `<sup>` default
(`font-size: smaller`, ≈0.83em). Users report the marks now feel too small.

## Requirement

Restore the noteref mark size to match the browser default:

- Change `font-size: 0.72em` → `0.83em` in `noterefCss()` in
  `src/lib/reader-styles.ts` (both rule blocks: the noteref selectors and the
  `a[href] > sup` fallback).
- Keep everything else unchanged: `vertical-align: super`, `line-height: 1`,
  no underline, theme accent colors (`#2563eb` light / `#6db4ff` dark),
  all selectors, and all `!important` declarations.
- Update the existing tests in `src/lib/reader-styles.test.ts` that assert
  `0.72em` so they assert `0.83em` instead.

## Scope

- In: `src/lib/reader-styles.ts`, `src/lib/reader-styles.test.ts`
- Out: popup content styles, theme colors, selector list, any new
  configurability.

## Acceptance Criteria

1. `noterefCss()` output (light and dark) contains `font-size: 0.83em` and no
   longer contains `0.72em`.
2. All tests in `src/lib/reader-styles.test.ts` pass, including updated
   size assertions.
3. Full frontend test suite passes.

## Notes

Lightweight task: PRD-only planning (no design.md / implement.md needed).