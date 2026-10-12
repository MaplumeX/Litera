# 06: Semantic search over the Book

**Status:** wontfix

**What to build:** Conceptual questions should find relevant passages even when the wording does not match the text. Today `search_in_book` returns only `exact` / `partial` lexical matches.

**Needs info from the maintainer:**

- Where embeddings come from: a provider embedding API (needs config UI, cost, and a provider that offers it) vs. a local model bundled or downloaded by the app (size, performance on WSL/macOS/Windows).
- Where the index lives: per-book data directory (local only, never synced?) and when it is built (import, first Agent use, background).
- Whether to extend `search_in_book` (hybrid lexical + semantic ranking) or add a separate tool.

**Acceptance (draft, once the above is decided):**

- [ ] Index built per Book and invalidated if the Book file changes
- [ ] Search returns semantically related passages with chapter and part, in the existing `SearchHit` shape
- [ ] Works offline if a local model is chosen
- [ ] Book deletion / Trash removes the index

## Comments

- Dropped by the maintainer (2026-10-12): semantic search is not wanted. Retrieval stays lexical (`search_in_book`).
