# Litera

An EPUB reader for desktop and Android with a built-in reading assistant. Each platform is a full, standalone reader; Sync between them is optional. This glossary defines the language of the app's domain.

## Language

**Library**:
The user's full collection of imported books, with metadata and reading state.
_Avoid_: Bookshelf, book list

**Book**:
A single imported EPUB, together with its metadata, reading state, curation, and per-book data directory.
_Avoid_: File, document

**Reading status**:
Where a Book stands for the reader — unread, reading, paused (on hold), or finished. Every Book has one: import sets unread, the first page turn of an open moves unread or paused to reading, and finished is set only with the reader's confirmation. The reader can override it at any time. Stored, not computed from progress on each read.
_Avoid_: State, progress, finished flag, unset

**Starred**:
The reader's shortlist flag on a Book, independent of its Reading status. Absent means not starred.
_Avoid_: Favourite, pinned, bookmark (a Bookmark is a page marker)

**Annotations**:
The bookmarks, highlights, and notes attached to a book. An append-oriented list keyed by annotation id.
_Avoid_: Notes (too narrow — notes are one kind of annotation), marks

**Session**:
One assistant conversation about a book. A book has many sessions; a session can branch.
_Avoid_: Chat, conversation (too generic)

**Guided session**:
A Session in which the assistant takes the reader through the Book part by part, in order, explaining each part in full. Fixed at creation; a book can have several, next to ordinary Sessions. Side questions in it do not move the reading on.
_Avoid_: Tutor mode, read-along, guided mode

**Guide cursor**:
The chapter part a Guided session has reached: the latest guided step on the Session's active branch. Derived, never stored; skipping or picking a chapter only changes the next step until it is sent.
_Avoid_: Bookmark, reading position (that is the Book's)

**Compaction**:
A Session event that replaces older messages in the model's context with a summary entry. The full transcript stays visible to the user; only the model-facing projection is truncated. The transcript marks the point with a compaction notice (a collapsible divider showing the summary).
_Avoid_: Summarization, truncation, context limit

**Pruning**:
A Session event that clears older Book-reading tool results (chapter text, search hits, TOC) from the model's context, leaving placeholders that tell the model how to read them again. No model call and no transcript marker; the transcript and its tool cards are unchanged. Tried before Compaction.
_Avoid_: Trimming, clearing, eviction

**Trash**:
The local-only recovery window holding a deleted Book's directory, its Sessions, and a descriptor carrying the deleted record, kept for 30 days. Never synced. A Book deleted by another device's Tombstone lands here too, but cannot be restored — the next Sync would delete it again. The English UI calls it "Recently deleted"; the Simplified Chinese UI calls it 回收站.
_Avoid_: Deleted items, archive

**Sync**:
The opt-in feature that mirrors the Library and Sessions across the user's devices via a Sync Backend.
_Avoid_: Backup, cloud storage

**Sync Backend**:
The S3-compatible object store the user configures as the destination for Sync. Litera runs no server of its own.
_Avoid_: Cloud, server

**KOReader Sync**:
The opt-in feature that exchanges a Book's reading position with a Progress Server. Progress only, never Annotations; independent of Sync. Litera pushes after reading and, on open, asks before jumping to a newer position from another device.
_Avoid_: Sync (that is the S3 feature), kosync (the protocol's name, fine in code)

**Progress Server**:
A kosync-compatible server KOReader Sync talks to: KOReader's own sync server, a self-hosted one, or BookOrbit. Books are matched by KOReader's partial-MD5 file fingerprint; positions travel as CREngine XPointers.
_Avoid_: Sync Backend (that is the S3 bucket)

**Manifest**:
The single JSON object on the Sync Backend holding all small sync data: book metadata, reading positions, annotations, tombstones, and per-item timestamps. Book files and covers live as separate objects referenced by it.
_Avoid_: Index, sync database

**Mind Map**:
A visual outline rendered inside a Session's message flow, derived from a single tool call's markdown outline. Not a stored object; it lives exactly as long as the tool call entry that produced it.
_Avoid_: Note, diagram, knowledge graph

**Citation**:
A verbatim quote from the Book inside an assistant message, marked with the chapter it came from. Checked against the Book text whenever it is shown (verified, relocated to another chapter, or unverified); the check is never stored. Paraphrase is not a Citation.
_Avoid_: Reference, source, footnote

**Tombstone**:
A sync record marking a deletion, kept in the Manifest so deletions propagate to other devices instead of being resurrected by merges.
_Avoid_: Deletion record, kill bit
