# 05: Guide marks in the Book pane, and exact "Guide up to here"

**Status:** resolved

**What to build:** Show in the Book what the guide has covered, everywhere, and make "Guide up to here" end at the paragraph the reader actually selected in.

- [x] TOC guide progress in reader mode and on mobile too (was desktop Agent mode only)
- [x] Paragraphs the guide read are faded (62% of their own color), skimmed ones more (48%); a centered "已带读到这里" divider after the Guide cursor's paragraph
- [x] Marks change only attributes, one style element and a color variable, never the text, so highlights' CFIs stay valid; only colors change, so nothing moves
- [x] "Guide up to here" matches the page paragraph around the selection's end, falling back to the selected text, and of several matches prefers the first at or after the step's start
- [x] Tests: mark plan, DOM marking (wrappers, lists, footnote numbers, clearing), runtime keys per file, selection paragraph, paragraph-first matching

## Comments

- Problem found: matching only the selected characters took the first block in the chapter containing them, so a short selection (e.g. "地方政府") could end the step at an earlier paragraph or be refused as already read.
- `selectionParagraph` (src/lib) takes the paragraph-like element around the selection's real end (a triple click ending at offset 0 of the next paragraph counts as the one before). `locateGuideBlock` tries that paragraph first, then the selection's last line (page text can carry footnote numbers the chapter text keeps only as markers).
- Marks: `guidePageMarkPlan` (pure) gives read / skimmed / cursor blocks per chapter and its files; the runtime turns them into opening-text keys (`guideMarkKey`, 32 non-space chars) per file; `applyGuideMarks` marks matching page elements on load and when marks change. `useGuideBookMarks` feeds both App and mobile.
- Checked against 《置身事内》: every text block in the sampled chapters is found on the page except the book-title running header that opens each file.
- Not verified in the running app.
- Style went through several rounds with the reader: a margin rail (spilled into the column gap on WebKit when absolutely positioned, then looked like a blockquote as a border), dots and a timeline (rejected), then fading. Each paragraph fades from its own computed color (`--litera-guide-ink`), so a dimmed blockquote stays dimmer than the text around it, and the cursor divider is drawn from the unfaded ink. Elements with a color of their own (links, footnote numbers) keep it.
