# Spec: Guided steps as block spans, the Guide cursor as the furthest point

Status: resolved

## Problem Statement

- A `GuideStep` had two shapes in one type: a part (`chapterIndex`, `part`/`totalParts`) or a block range (`range`), whose part fields then only repeated where `from` was. A part step counted parts of the chapter as it was cut when recorded; once the chapter was cut differently, it could only be mapped by its share of the chapter, in two places that did not agree (cursor and coverage).
- Recorded steps had to be found again in the open Book (`currentGuideSteps`) and new steps given their snippets (`withGuideEnds`) by hand at every runtime entry point; the pure functions in `guide.ts` were right only if the caller remembered.
- The Guide cursor was the latest step. Going back over a chapter moved it back, and the `guide_step` description said a step "never goes back", which the tool did not enforce.

## Solution

1. **Steps are block spans.** A step is recorded as `{ from, to, skim?, part? }`: its ends with chapter title, block, snippet and paragraph. `part` is for the label only (the step is one whole part), never to find it. Steps from before (parts on user messages) are read as `LegacyGuideStep` and turned into spans in one place (`legacySpan`); ranges recorded under `range` are decoded as spans.
2. **One way in, one way out.** `guide.ts` works on `GuideSpan` (TOC entries and blocks of the open Book). `locateGuideStep` turns any recorded step into a span (chapter by title, block by snippet, clamped); `recordGuideSpan` records a span. The runtime goes through `locateStep` / `recordSpan` only; passing a recorded step to a span function is a type error.
3. **The Guide cursor is the furthest point.** It is the furthest end of the steps on the branch (`guideCursor`). A step may start at an earlier chapter's start, to go over it again; the cursor stays. The reading state, TOC progress, Book marks and the Session list summary (Rust `furthest_guide_on_branch`) all use it. It is separate from the Book's reading position.

## Decisions

1. **Label part kept on the step.** _Decided:_ the UI labels steps without the TOC, so a whole-part step records which part it was. Alternative: label every step by paragraphs.
2. **Legacy part steps re-cut.** _Decided:_ end before the first part that starts past the step's share, so text repeats rather than being skipped; one mapping for cursor and coverage.
3. **Mixed ends in the Rust summary.** A block-range end and a legacy part end in one chapter cannot be compared without the Book; the newer one counts.
