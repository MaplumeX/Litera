# 01: `list_guide_blocks` tool

**Status:** resolved

**Blocked by:** —

**What to build:** A model tool that lists a chapter's blocks, so the model can map "第1-3段" or a section name to block numbers.

- [x] Tool `list_guide_blocks({ chapterIndex, fromBlock? })` in `EmbeddedAgentRuntime.tools`, on top of `chapterGuideBlocks` (cached `BookContentPort.guideBlocks`)
- [x] Each block: `block` (index), `part`, `chars`, `snippet`, `heading` (level, only for headings), `kind` when image or blank
- [x] Paged for long chapters (`GUIDE_OUTLINE_BLOCKS` per page); the result's `next` says where the next page starts
- [x] Description says what a block is (a paragraph, a heading, an image or blank, or a piece of a very long paragraph) and that paragraph counting should skip headings, images and blanks
- [x] Tests: listing, paging, past the end (`guide.test.ts`); tool result and unknown chapter (`embedded-runtime.test.ts`)

## Comments

- The page parameter is `fromBlock`, not `after`, to match `read_chapter`.
- Paging lives in a pure `guideBlockPage(entry, blocks, fromBlock, size)` in `guide.ts`.
- Registered in every Session, not only Guided ones: `read_chapter` takes `fromBlock`/`toBlock` everywhere, and the list helps there too.
- Answer process: shown as "查看段落列表" / "Looked at the paragraph list" (ListTree icon), and as "段落列表" in the sources summary. Added to `PRUNABLE_TOOLS` like `get_toc`.
