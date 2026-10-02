# Litera

A desktop EPUB reader with a built-in reading assistant. This glossary defines the language of the app's domain.

## Language

**Library**:
The user's full collection of imported books, with metadata and reading state.
_Avoid_: Bookshelf, book list

**Book**:
A single imported EPUB, together with its metadata, reading state, curation, and per-book data directory.
_Avoid_: File, document

**Reading status**:
The reader's explicit placement of a Book — unread, reading, or finished. Absent is distinct from unread (absent means the reader has not curated the Book) and is never derived from reading progress.
_Avoid_: State, progress, finished flag

**Starred**:
The reader's shortlist flag on a Book, independent of its Reading status. Absent means not starred.
_Avoid_: Favourite, pinned, bookmark (a Bookmark is a page marker)

**Annotations**:
The bookmarks, highlights, and notes attached to a book. An append-oriented list keyed by annotation id.
_Avoid_: Notes (too narrow — notes are one kind of annotation), marks

**Session**:
One assistant conversation about a book. A book has many sessions; a session can branch.
_Avoid_: Chat, conversation (too generic)

**Compaction**:
A Session event that replaces older messages in the model's context with a summary entry. The full transcript stays visible to the user; only the model-facing projection is truncated. The transcript marks the point with a compaction notice (a collapsible divider showing the summary).
_Avoid_: Summarization, truncation, context limit

**Trash**:
The local-only recovery window holding a deleted Book's directory, its Sessions, and a descriptor carrying the deleted record, kept for 30 days. Never synced. A Book deleted by another device's Tombstone lands here too, but cannot be restored — the next Sync would delete it again. The English UI calls it "Recently deleted"; the Simplified Chinese UI calls it 回收站.
_Avoid_: Deleted items, archive

**Sync**:
The opt-in feature that mirrors the Library and Sessions across the user's devices via a Sync Backend.
_Avoid_: Backup, cloud storage

**Sync Backend**:
The S3-compatible object store the user configures as the destination for Sync. Litera runs no server of its own.
_Avoid_: Cloud, server

**Manifest**:
The single JSON object on the Sync Backend holding all small sync data: book metadata, reading positions, annotations, tombstones, and per-item timestamps. Book files and covers live as separate objects referenced by it.
_Avoid_: Index, sync database

**Mind Map**:
A visual outline rendered inside a Session's message flow, derived from a single tool call's markdown outline. Not a stored object; it lives exactly as long as the tool call entry that produced it.
_Avoid_: Note, diagram, knowledge graph

**Tombstone**:
A sync record marking a deletion, kept in the Manifest so deletions propagate to other devices instead of being resurrected by merges.
_Avoid_: Deletion record, kill bit
