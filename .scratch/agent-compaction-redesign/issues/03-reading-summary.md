# 03: Reading-oriented summary and cut points

**Status:** resolved

**What to build:** Replace the coding-agent summary prompts with a template for conversations about a Book, and make the input to the summarizer smaller and cleaner.

- [x] New initial and update prompts with sections: Book & scope discussed (chapters, by title and chapterIndex); Reader's questions and positions; Key points and conclusions; Citations worth keeping (verbatim, with chapterIndex, `[quote](cite:N)` form); Open questions. Summary written in the language of the conversation
- [x] `serializeConversation`: drop thinking blocks; compact book tool calls (`read_chapter(ch 3, part 1)`); omit `read_chapter` result text; truncate search results; skip `bookSnapshot` custom messages
- [x] Cut points: a cut on a user message also keeps its immediately preceding `readingContext` entry
- [x] Tests in `compaction.test.ts`: serialization cases, cut point with `readingContext`, update prompt carries previous summary

## Comments

- Also: token estimates count CJK characters as one token each (chars/4 undercounted Chinese books several times over), and when the latest turn alone exceeds `keepRecent` the cut keeps just that turn instead of compacting nothing.
