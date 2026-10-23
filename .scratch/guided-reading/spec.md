# Spec: Guided reading — the assistant reads the Book to the reader

Status: resolved

## Problem Statement

In Agent mode the reader no longer reads the Book; they read the assistant's explanations instead. Agent mode is built for asking: the reader prompts, the assistant answers. That leaves two gaps for a reader who wants the assistant's explanation to *replace* reading:

1. **Nobody leads.** The reader has to come up with a prompt for every stretch of text ("explain the next part of chapter 5"), and keep track themselves of where they are.
2. **No guarantee of coverage.** An answer may summarize, compress or skip. The reader does not see the text, so they cannot tell what they missed.

## Solution

Add a second kind of Session, a **Guided session**, next to the ordinary one. In a Guided session the assistant reads the Book to the reader in order, one part at a time, and the reader just follows along:

- The app keeps a **guide cursor** (chapterIndex, part). Pressing **Continue** sends the next part. The app picks the part, not the model, so nothing is skipped or repeated.
- Each step is a **guided retelling**: the part retold in the original order, keeping every argument, example, turn and rebuttal. Explanations are woven into the narration, and the author's key sentences are quoted as Citations. It is not a summary and not an outline.
- The reader can still ask free questions in the same Session; they do not move the cursor.
- Ordinary Sessions are unchanged.

### Retelling style (the target)

The prompt fixes the **content**, not the form:

- Complete and in the original order: every argument, example, piece of evidence, turn and rebuttal; only true filler dropped. Overrides the default "be concise".
- Explanations where the reader needs them, kept distinct from what the author says.
- The author's key sentences quoted as `cite:` Citations.
- Anything left out is named at the end.

Form is left to the model, as in any well-formatted answer: headings, lists, tables, bold and blockquotes used freely, preferred to long paragraphs.

History: prescribing the style failed in both directions. "Outline first, then explain" and terse keyword outlines read too thin; pure prose, then "narration with light structure", then "structure as skeleton, full sentences as content" all read too narrative. Constraints like "full sentences, never keywords" suppressed the lists and tables a model uses by default.

## User Stories

1. As a reader, I want to start a Guided session from a chapter I pick, so that the assistant reads the Book to me from there.
2. As a reader, I want to keep using ordinary Sessions for questions, so that guided reading does not replace free conversation.
3. As a reader, I want to press Continue to get the next part, so that I never have to write "explain the next part".
4. As a reader, I want each part retold in full and in order, so that I do not miss the content of the original.
5. As a reader, I want the author's key sentences quoted and verifiable, so that I still meet the author's own words.
6. As a reader, I want to be told what was left out of a part, so that omissions are never silent.
7. As a reader, I want to ask a side question in a Guided session without losing my place, so that Continue picks up where the guide left off.
8. As a reader, I want to skim a chapter or skip to the next one, so that I can move fast through parts I care less about; a skimmed chapter says it was compressed.
9. As a reader, I want the TOC to show which chapters the guide has covered, so that I can see my progress.
10. As a reader, I want Guided sessions marked in the Session list with their position, so that I can find them.
11. As a reader, I want Agent mode to open my latest Guided session for a book that has one, so that I resume reading without hunting for it.
12. As a reader, I want to edit the retelling style prompt in settings, so that I can tune the style without a code change.

## Implementation Decisions

- **Session kind.** A Session is either ordinary or guided, fixed at creation; no switching later. A book can have several Guided sessions (e.g. a second pass in a different style). The kind must be visible in `AgentSessionSummary` so the Session list can mark it.
- **Cursor is derived, not stored.** Each guided step is a user-message entry carrying a `guide` field (`{ chapterIndex, part, totalParts, chapterTitle?, skim? }`), the same way entries already carry `selection`. The cursor is the latest `guide` field on the active branch, so branching and editing behave naturally and there is no new persisted entity, mirroring how Source summaries and Mind Maps are derived.
- **The app builds the step prompt.** Continue computes the next (chapterIndex, part) from the cursor and the TOC's part counts, crossing into the next chapter after the last part, and stops at the end of the Book. The visible user message is a short label ("Continue: Chapter 5, part 2/3"); the model-facing text names the exact chapter and part to read.
- **Style prompt.** Guided sessions append `guidedPrompt(style)` to `SYSTEM_PROMPT`: fixed mechanics around an editable style. Settings › AI can override the style; the override is a local preference. A Session's own `session_config` prompt still applies on top.
- **Skim and skip.** "Skim this chapter" sends one step (`skim: true`) covering the rest of the next step's chapter; the answer is compressed and says so. "Skip this chapter" and picking a chapter in the TOC only change the step Continue will send; nothing is persisted until it is sent.
- **Default Session on open.** In Agent mode, opening a book selects the most recently updated Guided session if one exists; otherwise behaviour is unchanged.
- **Reading mode is unchanged.**

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | Guided session kind | resolved | — |
| 02 | Guided step and Continue | resolved | 01 |
| 03 | Guided retelling style prompt | resolved | 02 |
| 04 | Skim chapter and next chapter | resolved | 02 |
| 05 | Guide progress in the TOC | resolved | 02 |
| 06 | Open the latest Guided session by default | resolved | 01 |
| 07 | Tune the style on real chapters | resolved | 03 |

## Out of Scope (possible phase 2)

- A persisted per-book retelling (a cross-Session record of what has been retold, usable in new Sessions, for callbacks to earlier chapters, and for export). Needs a new entity and Sync/Manifest changes.
- Driving the Book's reading position, Reading status or KOReader Sync from the guide cursor.
- A separate "retold book" view outside the message flow.
- Comprehension checks ("quiz me").

## Proposed glossary additions (CONTEXT.md, once built)

- **Guided session**: a Session in which the assistant reads the Book to the reader part by part, in order. Fixed at creation. _Avoid_: tutor mode, read-along.
- **Guide cursor**: the (chapter, part) a Guided session has reached, derived from its latest guided step. _Avoid_: bookmark, reading position (that is the Book's).
- **Guided retelling**: one guided step's output — the part retold in full, in order, with explanations woven in. _Avoid_: summary, explanation.
