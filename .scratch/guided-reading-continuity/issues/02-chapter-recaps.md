# 02: Chapter recaps in Guided sessions

**Status:** resolved

**What to build:** After the guide finishes a chapter, a recap is generated and recorded on the branch; it survives Compaction in the model context and shows in the transcript as a collapsible marker (see the spec).

- [x] Due chapters derived from the active branch's guided steps; one recap per background run, before context maintenance
- [x] Recap entry (`custom_message`, `guideRecap`) with chapter details; failures swallowed and retried later
- [x] `contextBranch` keeps recaps cut off by a Compaction; summaries skip them
- [x] Guided prompt tells the model what recaps are
- [x] Transcript marker `role: "recap"`, anchored in lockstep with `visibleMessages`; collapsible, en + zh-CN labels
- [x] Tests: due-chapter derivation (full steps, skim, partial, branch), projection after compaction, runtime writes one recap after the last part, UI marker

## Comments

- Due chapter: `dueRecapChapter` (`guide.ts`); retellings: `guidedTurns` (`pi-session.ts`); model call and prompt: `src/agent/runtime/recap.ts`; written by `writeDueRecap` in the runtime's background task, before `maintainContext`.
- The entry stores the model-facing text in `content` and the reader-facing recap in `details.text`.
- Title generation's "nothing but maintenance since" guard also accepts recap entries, so a one-part first chapter still gets its auto title.
- New event `guide_recap_added`; the reducer shares marker insertion with `compaction_completed` (`withLandedMarker`).
- Not yet tuned on real chapters: the recap prompt is a first version.
