# Litera

A desktop EPUB reader with a built-in reading assistant. This glossary defines the language of the app's domain.

## Language

**Library**:
The user's full collection of imported books, with metadata and reading state.
_Avoid_: Bookshelf, book list

**Book**:
A single imported EPUB, together with its metadata, reading state, and per-book data directory.
_Avoid_: File, document

**Annotations**:
The bookmarks, highlights, and notes attached to a book. An append-oriented list keyed by annotation id.
_Avoid_: Notes (too narrow — notes are one kind of annotation), marks

**Session**:
One assistant conversation about a book. A book has many sessions; a session can branch.
_Avoid_: Chat, conversation (too generic)

**Sync**:
The opt-in feature that mirrors the Library and Sessions across the user's devices via a Sync Backend.
_Avoid_: Backup, cloud storage

**Sync Backend**:
The S3-compatible object store the user configures as the destination for Sync. Litera runs no server of its own.
_Avoid_: Cloud, server

**Manifest**:
The single JSON object on the Sync Backend holding all small sync data: book metadata, reading positions, annotations, tombstones, and per-item timestamps. Book files and covers live as separate objects referenced by it.
_Avoid_: Index, sync database

**Tombstone**:
A sync record marking a deletion, kept in the Manifest so deletions propagate to other devices instead of being resurrected by merges.
_Avoid_: Deletion record, kill bit
