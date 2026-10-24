use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::library::{AnnotationsFile, LibraryStore};

/// Mirrors the TS SyncManifest (src/lib/sync-merge.ts) over IPC.
/// The TS merge engine owns merge semantics; Rust only stores and transports.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifestData {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(default)]
    pub books: std::collections::BTreeMap<String, SyncedBookData>,
    #[serde(default)]
    pub tombstones: Vec<SyncTombstoneData>,
    /// Written only by older clients: app preferences and LLM provider
    /// configuration are per-device now. Kept on the wire so those clients
    /// still converge among themselves.
    #[serde(default)]
    pub preferences: Option<SyncEnvelopeData>,
    #[serde(default)]
    pub provider: Option<SyncEnvelopeData>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncedBookData {
    pub metadata: SyncBookMetadata,
    pub position: Option<SyncPositionData>,
    pub annotations: AnnotationsFile,
    #[serde(rename = "annotationsUpdatedAt")]
    pub annotations_updated_at: String,
    #[serde(rename = "fileRevision", default)]
    pub file_revision: Option<String>,
    #[serde(rename = "coverRevision", default)]
    pub cover_revision: Option<String>,
    /// Last edit to the record itself (metadata, curation, Restore). The TS
    /// merge engine orders metadata by this and treats a book newer than its
    /// Tombstone as a revival. Empty on manifests from older versions, which
    /// fall back to position/annotation activity.
    #[serde(rename = "bookUpdatedAt", default)]
    pub book_updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncBookMetadata {
    pub title: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    /// The Book's Reading status. Unlike the rest of the metadata it orders
    /// on its own `statusUpdatedAt`, which travels beside it so the pair stays
    /// together through merges by older versions.
    #[serde(
        rename = "readingStatus",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reading_status: Option<String>,
    /// Absent on a backfilled status, which any timestamped status beats.
    #[serde(
        rename = "statusUpdatedAt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub status_updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPositionData {
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub fraction: f64,
    pub cfi: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncTombstoneData {
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "bookId")]
    pub book_id: String,
    #[serde(
        rename = "annotationId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub annotation_id: Option<String>,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "deletedAt")]
    pub deleted_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnvelopeData {
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub data: serde_json::Value,
}

/// The result of downloading the remote Manifest.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedManifest {
    /// Etag of the downloaded object, used as the If-Match precondition
    /// when uploading the merged Manifest back.
    pub etag: String,
    pub manifest: SyncManifestData,
}

pub const MANIFEST_OBJECT_KEY: &str = "litera/manifest.json";

/// Tombstones older than this no longer suppress and may be purged.
/// Mirrors TOMBSTONE_TTL_MS in the TS merge engine.
pub const TOMBSTONE_TTL_SECS: i64 = 30 * 24 * 60 * 60;

fn is_tombstone_active(tombstone: &SyncTombstoneData) -> bool {
    let Ok(deleted_at) = chrono::DateTime::parse_from_rfc3339(&tombstone.deleted_at) else {
        return true;
    };
    chrono::Utc::now().signed_duration_since(deleted_at).num_seconds() < TOMBSTONE_TTL_SECS
}

/// Annotation ids present before but gone after a save — the deletions the
/// merge engine must remember as Tombstones.
pub fn removed_annotation_ids(
    before: &AnnotationsFile,
    after: &AnnotationsFile,
) -> Vec<String> {
    let live: std::collections::HashSet<&str> = after
        .highlights
        .iter()
        .map(|item| item.id.as_str())
        .chain(after.bookmarks.iter().map(|item| item.id.as_str()))
        .collect();
    before
        .highlights
        .iter()
        .map(|item| &item.id)
        .chain(before.bookmarks.iter().map(|item| &item.id))
        .filter(|id| !live.contains(id.as_str()))
        .cloned()
        .collect()
}

/// Union of the currently-stored and the merged Tombstones, newest
/// deletedAt per key. Expired annotation Tombstones drop out (they are
/// inert and own no objects); expired book Tombstones are kept so their
/// objects can still be purged.
fn merge_local_tombstones(
    current: Vec<SyncTombstoneData>,
    incoming: Vec<SyncTombstoneData>,
) -> Vec<SyncTombstoneData> {
    let mut by_key: std::collections::BTreeMap<String, SyncTombstoneData> =
        std::collections::BTreeMap::new();
    for tombstone in current.into_iter().chain(incoming) {
        let keep = !(tombstone.kind == "annotation" && !is_tombstone_active(&tombstone));
        if !keep {
            continue;
        }
        let key = tombstone_key(&tombstone);
        match by_key.get(&key) {
            Some(existing) if existing.deleted_at >= tombstone.deleted_at => {}
            _ => {
                by_key.insert(key, tombstone);
            }
        }
    }
    by_key.into_values().collect()
}

fn tombstone_key(tombstone: &SyncTombstoneData) -> String {
    if tombstone.kind == "book" {
        format!("book:{}", tombstone.book_id)
    } else {
        format!(
            "annotation:{}:{}",
            tombstone.book_id,
            tombstone.annotation_id.clone().unwrap_or_default()
        )
    }
}

fn upsert_tombstones(state: &mut SyncState, additions: Vec<SyncTombstoneData>) {
    for addition in additions {
        state.tombstones.retain(|existing| {
            tombstone_key(existing) != tombstone_key(&addition)
        });
        state.tombstones.push(addition);
    }
    // Opportunistic purge of expired annotation Tombstones: they never
    // resurrect anything and own no objects. Expired book Tombstones stay
    // until sync_sessions purges their objects from the Sync Backend.
    state
        .tombstones
        .retain(|tombstone| tombstone.kind == "book" || is_tombstone_active(tombstone));
}

/// Record that a book was deleted locally, so other devices learn of the
/// deletion instead of resurrecting the book from their own copies.
pub fn record_book_tombstone(root: &Path, book_id: &str) -> AppResult<()> {
    validate_sync_id(book_id)?;
    update_sync_state(root, |state| {
        let device_id = state.device_id.clone();
        upsert_tombstones(
            state,
            vec![SyncTombstoneData {
                kind: "book".to_string(),
                book_id: book_id.to_string(),
                annotation_id: None,
                device_id,
                deleted_at: chrono::Utc::now().to_rfc3339(),
            }],
        );
        Ok(())
    })
}

/// Revoke a locally recorded book Tombstone. Used by Restore: a book that
/// comes back must not be deleted again by the Tombstone its own deletion
/// wrote.
pub fn remove_book_tombstone(root: &Path, book_id: &str) -> AppResult<()> {
    validate_sync_id(book_id)?;
    update_sync_state(root, |state| {
        state
            .tombstones
            .retain(|tombstone| !(tombstone.kind == "book" && tombstone.book_id == book_id));
        Ok(())
    })
}

/// A book was (re-)imported locally: like Restore, its own deletion
/// Tombstone is revoked, and the imported file is now this device's truth,
/// so any pending "newer file on the Sync Backend" marker is dropped. Its
/// Sessions went to the Trash with the old copy, so their revisions are
/// forgotten too: the next pass downloads them again.
pub fn note_book_imported(root: &Path, book_id: &str) -> AppResult<()> {
    validate_sync_id(book_id)?;
    update_sync_state(root, |state| {
        state
            .tombstones
            .retain(|tombstone| !(tombstone.kind == "book" && tombstone.book_id == book_id));
        state.stale_files.remove(book_id);
        let prefix = format!("{book_id}/");
        state
            .session_revisions
            .retain(|key, _| !key.starts_with(&prefix));
        Ok(())
    })
}

/// Record an annotations save: bump the book's annotationsUpdatedAt and
/// remember removed ids as Tombstones.
pub fn note_annotations_saved(root: &Path, book_id: &str, removed_ids: &[String]) -> AppResult<()> {
    validate_sync_id(book_id)?;
    update_sync_state(root, |state| {
        let device_id = state.device_id.clone();
        let now = chrono::Utc::now().to_rfc3339();
        let additions = removed_ids
            .iter()
            .map(|annotation_id| SyncTombstoneData {
                kind: "annotation".to_string(),
                book_id: book_id.to_string(),
                annotation_id: Some(annotation_id.clone()),
                device_id: device_id.clone(),
                deleted_at: now.clone(),
            })
            .collect();
        upsert_tombstones(state, additions);
        state
            .annotations_updated_at
            .insert(book_id.to_string(), now);
        Ok(())
    })
}

/// Rebase an annotations save onto the file currently on disk.
///
/// `base` is what the writer loaded before editing, `next` what it wants
/// stored. Only ids the writer saw and dropped count as deletions; entries
/// that reached the disk after the writer loaded (a Sync landing while the
/// reader was open) are kept rather than silently deleted — and, crucially,
/// never recorded as Tombstones that would delete them on every device.
/// Returns the data to store and the removed ids.
pub fn rebase_annotations(
    current: &AnnotationsFile,
    base: &AnnotationsFile,
    mut next: AnnotationsFile,
) -> (AnnotationsFile, Vec<String>) {
    let removed = removed_annotation_ids(base, &next);
    let known: std::collections::HashSet<&str> = base
        .highlights
        .iter()
        .map(|item| item.id.as_str())
        .chain(base.bookmarks.iter().map(|item| item.id.as_str()))
        .chain(next.highlights.iter().map(|item| item.id.as_str()))
        .chain(next.bookmarks.iter().map(|item| item.id.as_str()))
        .collect();
    let highlight_cfis: std::collections::HashSet<String> =
        next.highlights.iter().map(|item| item.cfi.clone()).collect();
    let bookmark_cfis: std::collections::HashSet<String> =
        next.bookmarks.iter().map(|item| item.cfi.clone()).collect();
    // An unseen entry on the same CFI as one the writer stores would make
    // the file invalid; the writer's own entry wins that spot.
    let unseen_highlights: Vec<_> = current
        .highlights
        .iter()
        .filter(|item| !known.contains(item.id.as_str()) && !highlight_cfis.contains(&item.cfi))
        .cloned()
        .collect();
    let unseen_bookmarks: Vec<_> = current
        .bookmarks
        .iter()
        .filter(|item| !known.contains(item.id.as_str()) && !bookmark_cfis.contains(&item.cfi))
        .cloned()
        .collect();
    next.highlights.extend(unseen_highlights);
    next.bookmarks.extend(unseen_bookmarks);
    (next, removed)
}

/// The Sync Backend changed (endpoint, region, bucket, or addressing): what
/// this device knows about the old backend's objects says nothing about the
/// new one. Forget it so every book file and session uploads again, and the
/// first bulk upload asks for confirmation again. Local data — Tombstones,
/// timestamps — is kept and merges into the new backend.
pub fn note_sync_backend_changed(root: &Path) -> AppResult<()> {
    update_sync_state(root, |state| {
        state.book_revisions.clear();
        state.session_revisions.clear();
        state.stale_files.clear();
        state.bulk_upload_confirmed = false;
        state.last_etag.clear();
        state.last_synced_at = None;
        state.last_error = None;
        Ok(())
    })
}

fn validate_sync_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(AppError::invalid_input("Invalid sync id"));
    }
    Ok(())
}

/// Export the local Library (books metadata, positions, annotations) as a
/// Manifest. Local-only view: tombstones and envelopes are managed by the
/// caller, which persists its own sync state.
pub fn export_local_manifest(
    store: &LibraryStore,
    state: &SyncState,
) -> AppResult<SyncManifestData> {
    let device_id = &state.device_id;
    let library = store.read_library_public()?;

    let mut manifest = SyncManifestData {
        schema_version: 1,
        books: std::collections::BTreeMap::new(),
        tombstones: state.tombstones.clone(),
        // App preferences and LLM provider settings are per-device and never
        // sync. The last envelopes seen (written by older clients) pass
        // through untouched so older clients keep converging among themselves.
        preferences: state.preferences.clone(),
        provider: state.provider.clone(),
    };

    for book in &library.books {
        let metadata = SyncBookMetadata {
            title: book.title.clone(),
            author: book.author.clone(),
            description: book.description.clone(),
            publisher: book.publisher.clone(),
            language: book.language.clone(),
            series: book.series.clone(),
            reading_status: book.reading_status.clone(),
            status_updated_at: book.status_updated_at.clone(),
            starred: book.starred,
        };
        let position = match (&book.last_fraction, &book.last_cfi) {
            (Some(fraction), Some(cfi)) => Some(SyncPositionData {
                updated_at: position_timestamp(book).unwrap_or_default().to_string(),
                device_id: device_id.to_string(),
                fraction: *fraction,
                cfi: cfi.clone(),
            }),
            _ => None,
        };
        let annotations = match store.get_annotations(&book.id) {
            Ok(annotations) => annotations,
            Err(_) => AnnotationsFile::empty(),
        };
        let revisions = state.book_revisions.get(&book.id);
        manifest.books.insert(
            book.id.clone(),
            SyncedBookData {
                metadata,
                position,
                annotations,
                annotations_updated_at: state
                    .annotations_updated_at
                    .get(&book.id)
                    .cloned()
                    .unwrap_or_default(),
                file_revision: revisions.and_then(|entry| entry.file_revision.clone()),
                cover_revision: revisions.and_then(|entry| entry.cover_revision.clone()),
                // Only an explicit edit timestamp. Filling this in with the
                // reading position would make the TS merge skip its activity
                // fallback and silently change metadata ordering for books
                // that predate the field.
                book_updated_at: book.updated_at.clone().unwrap_or_default(),
            },
        );
    }
    Ok(manifest)
}

/// The explicit timestamp of a book's reading position: when it last moved.
/// Records from before that was tracked fall back to the last-opened time.
fn position_timestamp(book: &crate::library::BookRecord) -> Option<&str> {
    book.position_updated_at
        .as_deref()
        .or(book.last_opened_at.as_deref())
}

/// Mirrors `bookRevision` in the TS merge engine: the explicit record edit
/// time, or reading activity for manifests from before it existed.
fn book_revision(book: &SyncedBookData) -> String {
    if !book.book_updated_at.is_empty() {
        return book.book_updated_at.clone();
    }
    let position = book
        .position
        .as_ref()
        .map(|position| position.updated_at.clone())
        .unwrap_or_default();
    std::cmp::max(position, book.annotations_updated_at.clone())
}

/// Apply a merged Manifest to the local Library.
///
/// `base` is the local Manifest snapshot taken when the sync pass started
/// (before download/merge). It guards against clobbering local edits made
/// while the network round trip was in flight: positions and annotations are
/// only overwritten when the on-disk state still matches the snapshot; a
/// mid-sync local change is left alone and converges on the next sync.
///
/// Books with an active Tombstone are moved into the local trash (which
/// itself never syncs); placeholder-only books lose their directory.
///
/// Returns the ids of local books whose EPUB is older than the file the
/// merged Manifest names (another device re-imported a newer version); the
/// caller marks them so the next open downloads the newer file.
pub fn apply_merged_manifest(
    store: &LibraryStore,
    merged: &SyncManifestData,
    base: &SyncManifestData,
) -> AppResult<Vec<String>> {
    let mut stale_files = Vec::new();
    // Deletions first: a book an active Tombstone names must not survive
    // this pass, even if a stale copy of it appears in the merged books.
    for tombstone in merged
        .tombstones
        .iter()
        .filter(|tombstone| tombstone.kind == "book" && is_tombstone_active(tombstone))
    {
        store.delete_book_for_sync(&tombstone.book_id)?;
    }

    let mut library = store.read_library_public()?;
    let known: std::collections::HashSet<String> =
        library.books.iter().map(|book| book.id.clone()).collect();

    for (book_id, synced) in &merged.books {
        if is_tombstoned_book(merged, book_id) {
            continue;
        }
        if known.contains(book_id) {
            let record = library
                .books
                .iter_mut()
                .find(|book| &book.id == book_id)
                .expect("known book id");
            record.title = synced.metadata.title.clone();
            record.author = synced.metadata.author.clone();
            record.description = synced.metadata.description.clone();
            record.publisher = synced.metadata.publisher.clone();
            record.language = synced.metadata.language.clone();
            record.series = synced.metadata.series.clone();
            // A Manifest from an older version may carry no status; the
            // local one (backfilled on load if need be) then stands.
            if synced.metadata.reading_status.is_some() {
                record.reading_status = synced.metadata.reading_status.clone();
                record.status_updated_at = synced.metadata.status_updated_at.clone();
            }
            record.starred = synced.metadata.starred;
            if !synced.book_updated_at.is_empty() {
                record.updated_at = Some(synced.book_updated_at.clone());
            }
            // Only take the merged position when the book has not moved on
            // locally since the pass started. last_opened_at is the explicit
            // recorded timestamp the export used as the position's updatedAt;
            // a mismatch means a local page turn raced this sync pass and its
            // next export re-asserts the newer position.
            let base_book = base.books.get(book_id);
            let base_position = base_book.and_then(|book| book.position.as_ref());
            let current_position = match (&record.last_fraction, &record.last_cfi) {
                (Some(_), Some(_)) => Some(position_timestamp(record).unwrap_or_default()),
                _ => None,
            };
            let unchanged_since_export =
                current_position == base_position.map(|position| position.updated_at.as_str());
            if unchanged_since_export {
                if let Some(position) = &synced.position {
                    record.last_fraction = Some(position.fraction);
                    record.last_cfi = Some(position.cfi.clone());
                    if !position.updated_at.is_empty() {
                        record.position_updated_at = Some(position.updated_at.clone());
                    }
                }
            }
            // The merged file is a different, newer revision than the local
            // EPUB: another device re-imported the book after this one last
            // edited it. (A local re-import makes the local record newer, so
            // it never marks itself stale.)
            if let Some(revision) = &synced.file_revision {
                let remote_newer = base_book
                    .map(|book| synced.book_updated_at > book.book_updated_at)
                    .unwrap_or(false);
                if remote_newer && record.content_hash.as_deref() != Some(revision.as_str()) {
                    stale_files.push(book_id.clone());
                }
            }
        } else {
            // Placeholder for a book whose file isn't on this device yet.
            // library.json requires every record to have a real book.epub,
            // so placeholders live as per-book sidecar files instead and are
            // merged into list output; the EPUB downloads later.
            store.save_placeholder(
                book_id,
                &synced.metadata.title,
                &synced.metadata.author,
                synced.position.as_ref().map(|p| p.fraction),
                synced.position.as_ref().map(|p| p.cfi.clone()),
                synced.metadata.reading_status.clone(),
                synced.metadata.status_updated_at.clone(),
            )?;
        }
    }

    store.write_library_public(&library)?;
    for (book_id, synced) in &merged.books {
        if is_tombstoned_book(merged, book_id) {
            continue;
        }
        // Annotations converge for both known books and placeholders. A
        // known book whose file changed mid-sync keeps its current file; the
        // next sync re-unions both sides, so nothing is lost either way.
        if known.contains(book_id) {
            let base_annotations = base
                .books
                .get(book_id)
                .map(|book| book.annotations.clone())
                .unwrap_or_else(AnnotationsFile::empty);
            let current = store
                .get_annotations(book_id)
                .unwrap_or_else(|_| AnnotationsFile::empty());
            if current == base_annotations {
                store.save_annotations(book_id, synced.annotations.clone())?;
            }
        } else {
            store.save_annotations(book_id, synced.annotations.clone())?;
        }
    }
    Ok(stale_files)
}

fn is_tombstoned_book(manifest: &SyncManifestData, book_id: &str) -> bool {
    manifest.tombstones.iter().any(|tombstone| {
        tombstone.kind == "book" && tombstone.book_id == book_id && is_tombstone_active(tombstone)
    })
}

#[cfg(test)]
mod placeholder_tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn placeholder_round_trips_and_reports_uncached() {
        let (_dir, store) = temp_store_helper();

        store
            .save_placeholder(
                "remotebook1",
                "Remote Book",
                "Author",
                Some(0.25),
                Some("epubcfi(/4)".to_string()),
                None,
                None,
            )
            .expect("save placeholder");

        let placeholders = store.list_placeholders().expect("list placeholders");
        assert_eq!(placeholders.len(), 1);
        assert_eq!(placeholders[0].id, "remotebook1");
        assert_eq!(placeholders[0].title, "Remote Book");
        assert_eq!(placeholders[0].last_fraction, Some(0.25));
        // No synced status: backfilled from progress, without a timestamp.
        assert_eq!(placeholders[0].reading_status.as_deref(), Some("reading"));
        assert!(placeholders[0].status_updated_at.is_none());
        // Uncached state is observable via the missing epub file.
        assert!(!Path::new(&placeholders[0].file_path).exists());
    }

    #[test]
    fn placeholder_is_removed_when_the_book_becomes_local() {
        let (_dir, store) = temp_store_helper();

        store
            .save_placeholder(
                "remotebook1",
                "Remote Book",
                "Author",
                None,
                None,
                None,
                None,
            )
            .expect("save placeholder");
        // Simulate the real book arriving: a full import writes a library
        // record; applying the manifest must then drop the placeholder.
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub".to_vec(),
            )
            .expect("import");
        assert_ne!(result.book_id, "remotebook1");

        store.remove_placeholder("remotebook1").expect("remove");

        assert!(store.list_placeholders().expect("list").is_empty());
    }

    fn temp_store_helper() -> (tempfile::TempDir, LibraryStore) {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::initialize(directory.path().to_path_buf()).expect("store");
        (directory, store)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (tempfile::TempDir, LibraryStore) {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::initialize(directory.path().to_path_buf()).expect("store");
        (directory, store)
    }

    pub(super) fn synced_book(title: &str, fraction: f64, cfi: &str) -> SyncedBookData {
        SyncedBookData {
            metadata: SyncBookMetadata {
                title: title.to_string(),
                author: "Author".to_string(),
                description: None,
                publisher: None,
                language: None,
                series: None,
                reading_status: None,                status_updated_at: None,                starred: None,
            },
            position: Some(SyncPositionData {
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                device_id: "device-a".to_string(),
                fraction,
                cfi: cfi.to_string(),
            }),
            annotations: AnnotationsFile::empty(),
            annotations_updated_at: String::new(),
            file_revision: None,
            cover_revision: None,
            book_updated_at: String::new(),
        }
    }

    #[test]
    fn manifest_serialization_round_trips_the_ts_contract() {
        let manifest = SyncManifestData {
            schema_version: 1,
            books: [(
                "book-1".to_string(),
                synced_book("Title", 0.5, "epubcfi(/6/4)"),
            )]
            .into_iter()
            .collect(),
            tombstones: vec![SyncTombstoneData {
                kind: "book".to_string(),
                book_id: "book-2".to_string(),
                annotation_id: None,
                device_id: "device-a".to_string(),
                deleted_at: "2026-01-01T00:00:00Z".to_string(),
            }],
            preferences: Some(SyncEnvelopeData {
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                device_id: "device-a".to_string(),
                data: serde_json::json!({ "theme": "dark" }),
            }),
            provider: None,
        };

        let json = serde_json::to_string(&manifest).expect("serialize");
        let parsed: SyncManifestData = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed, manifest);
        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"fileRevision\""));
        assert!(json.contains("\"annotationsUpdatedAt\""));
    }

    #[test]
    fn export_reflects_library_books_and_positions() {
        let (_dir, store) = temp_store();
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub-bytes".to_vec(),
            )
            .expect("import");
        store
            .update_reading_state(
                &result.book_id,
                Some(0.4),
                None,
                None,
                None,
                Some("epubcfi(/2)".into()),
            )
            .expect("state");
        let local = SyncManifestData::default();

        let state = SyncState {
            device_id: "device-a".to_string(),
            tombstones: local.tombstones.clone(),
            preferences: local.preferences.clone(),
            provider: local.provider.clone(),
            ..SyncState::default()
        };
        let manifest = export_local_manifest(&store, &state).expect("export");

        let book = manifest.books.get(&result.book_id).expect("book present");
        let position = book.position.as_ref().expect("position");
        assert_eq!(position.fraction, 0.4);
        assert_eq!(position.device_id, "device-a");
    }

    #[test]
    fn apply_updates_known_books_and_creates_placeholders() {
        let (_dir, store) = temp_store();
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub-bytes".to_vec(),
            )
            .expect("import");

        let merged = SyncManifestData {
            schema_version: 1,
            books: [
                (
                    result.book_id.clone(),
                    SyncedBookData {
                        metadata: SyncBookMetadata {
                            title: "New Title".to_string(),
                            author: "New Author".to_string(),
                            description: None,
                            publisher: None,
                            language: None,
                            series: None,
                            reading_status: None,                            status_updated_at: None,                            starred: None,
                        },
                        position: Some(SyncPositionData {
                            updated_at: "2026-01-01T00:00:00Z".to_string(),
                            device_id: "device-b".to_string(),
                            fraction: 0.9,
                            cfi: "epubcfi(/9)".to_string(),
                        }),
                        annotations: AnnotationsFile::empty(),
                        annotations_updated_at: String::new(),
                        file_revision: None,
                        cover_revision: None,
                        book_updated_at: String::new(),
                    },
                ),
                (
                    "remotebook1".to_string(),
                    synced_book("Remote Book", 0.1, "epubcfi(/1)"),
                ),
            ]
            .into_iter()
            .collect(),
            tombstones: Vec::new(),
            preferences: None,
            provider: None,
        };

        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let library = store.read_library_public().expect("library");
        let known = library
            .books
            .iter()
            .find(|book| book.id == result.book_id)
            .expect("known book");
        assert_eq!(known.title, "New Title");
        assert_eq!(known.last_fraction, Some(0.9));

        let placeholders = store.list_placeholders().expect("placeholders");
        let placeholder = placeholders
            .iter()
            .find(|book| book.id == "remotebook1")
            .expect("placeholder");
        assert_eq!(placeholder.title, "Remote Book");
        assert!(placeholder.file_path.ends_with("book.epub"));
        assert!(!std::path::Path::new(&placeholder.file_path).exists());
        assert_eq!(placeholder.last_fraction, Some(0.1));
    }
}

// ---------------------------------------------------------------------------
// S3 transport: GET / conditional PUT of the Manifest, with bounded retry.
// ---------------------------------------------------------------------------

use object_store::{ObjectStore, ObjectStoreExt};
use object_store::path::Path as ObjectPath;
use object_store::{Error as ObjectStoreError, PutMode, PutOptions, PutPayload, UpdateVersion};

fn manifest_path() -> ObjectPath {
    ObjectPath::from(MANIFEST_OBJECT_KEY)
}

/// Download the remote Manifest plus its etag, for merging and the
/// subsequent conditional upload.
pub async fn download_manifest(
    config: &crate::sync_config::SyncBackendConfig,
) -> AppResult<DownloadedManifest> {
    let store = crate::sync_config::build_sync_store(config)?;
    download_manifest_from(&store).await
}

/// Store-generic core of [`download_manifest`], so the first-sync path
/// (missing object → empty Manifest) is testable without network access.
pub async fn download_manifest_from(
    store: &impl ObjectStore,
) -> AppResult<DownloadedManifest> {
    let result = match store.get(&manifest_path()).await {
        Ok(result) => result,
        // First sync ever on this Sync Backend: no Manifest exists yet.
        // Treat it as an empty one so the pass converges instead of failing.
        Err(ObjectStoreError::NotFound { .. }) => {
            return Ok(DownloadedManifest {
                etag: String::new(),
                manifest: SyncManifestData::default(),
            })
        }
        Err(error) => return Err(map_object_store_error(error)),
    };
    let etag = result
        .meta
        .e_tag
        .clone()
        .unwrap_or_default();
    let bytes = result
        .bytes()
        .await
        .map_err(map_object_store_error)?;
    let manifest: SyncManifestData = serde_json::from_slice(&bytes).map_err(|error| {
        AppError::storage_corrupt(format!("Failed to parse remote manifest: {error}"))
    })?;
    Ok(DownloadedManifest { etag, manifest })
}

/// Conditionally upload the merged Manifest (`If-Match` on the etag we
/// downloaded). Returns Err with retry=true on precondition failure so the
/// caller can re-fetch, re-merge, and retry a bounded number of times.
pub async fn upload_manifest(
    config: &crate::sync_config::SyncBackendConfig,
    manifest: &SyncManifestData,
    etag: &str,
) -> AppResult<()> {
    let store = crate::sync_config::build_sync_store(config)?;
    if etag.is_empty() {
        return upload_manifest_to(&store, manifest, etag)
            .await
            .map_err(UploadError::into_app_error);
    }
    let backend = backend_key(config);
    if !conditional_put_unsupported(&backend) {
        // The conditional PUT goes out once: a backend that rejects If-Match
        // answers 501, which object_store would otherwise retry for minutes.
        let single_shot = crate::sync_config::build_sync_store_without_retries(config)?;
        match upload_manifest_to(&single_shot, manifest, etag).await {
            Err(UploadError::Unsupported(_)) => mark_conditional_put_unsupported(backend),
            result => return result.map_err(UploadError::into_app_error),
        }
    }
    upload_manifest_checked(&store, manifest, etag)
        .await
        .map_err(UploadError::into_app_error)
}

/// Backends (Backblaze B2, for one) that answered a conditional PUT with
/// 501 Not Implemented during this run of the app.
static CONDITIONAL_PUT_UNSUPPORTED: std::sync::Mutex<Vec<String>> =
    std::sync::Mutex::new(Vec::new());

fn backend_key(config: &crate::sync_config::SyncBackendConfig) -> String {
    format!(
        "{}|{}",
        config.endpoint.trim().trim_end_matches('/'),
        config.bucket.trim()
    )
}

fn conditional_put_unsupported(backend: &str) -> bool {
    CONDITIONAL_PUT_UNSUPPORTED
        .lock()
        .is_ok_and(|backends| backends.iter().any(|known| known == backend))
}

fn mark_conditional_put_unsupported(backend: String) {
    if let Ok(mut backends) = CONDITIONAL_PUT_UNSUPPORTED.lock() {
        if !backends.contains(&backend) {
            backends.push(backend);
        }
    }
}

#[derive(Debug)]
pub enum UploadError {
    /// The backend does not implement conditional PUT (`If-Match`).
    Unsupported(ObjectStoreError),
    Other(AppError),
}

impl UploadError {
    fn into_app_error(self) -> AppError {
        match self {
            Self::Unsupported(error) => map_object_store_error(error),
            Self::Other(error) => error,
        }
    }
}

impl From<AppError> for UploadError {
    fn from(error: AppError) -> Self {
        Self::Other(error)
    }
}

fn is_not_implemented(error: &ObjectStoreError) -> bool {
    match error {
        ObjectStoreError::NotImplemented { .. } => true,
        ObjectStoreError::Generic { .. } => {
            let message = error.to_string();
            message.contains("501 Not Implemented")
                || message.contains("<Code>NotImplemented</Code>")
        }
        _ => false,
    }
}

/// Fallback for backends without conditional PUT: compare the etag with a
/// HEAD just before a plain PUT. This narrows, but cannot close, the window
/// in which another device's upload could be overwritten.
pub async fn upload_manifest_checked(
    store: &impl ObjectStore,
    manifest: &SyncManifestData,
    etag: &str,
) -> Result<(), UploadError> {
    let current = match store.head(&manifest_path()).await {
        Ok(meta) => meta.e_tag.unwrap_or_default(),
        Err(ObjectStoreError::NotFound { .. }) => String::new(),
        Err(error) => return Err(map_object_store_error(error).into()),
    };
    if current != etag {
        // Worded so the sync runner treats it as a precondition conflict and
        // re-downloads, re-merges, and retries.
        return Err(AppError::storage_io(
            "Sync backend error: precondition failed, the remote manifest changed",
        )
        .into());
    }
    store
        .put(
            &manifest_path(),
            PutPayload::from(manifest_bytes(manifest)?),
        )
        .await
        .map_err(|error| map_object_store_error(error).into())
        .map(|_| ())
}

fn manifest_bytes(manifest: &SyncManifestData) -> AppResult<Vec<u8>> {
    serde_json::to_vec(manifest)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize manifest: {error}")))
}

/// Store-generic core of [`upload_manifest`], so the create-vs-update
/// etag contract is testable without network access.
pub async fn upload_manifest_to(
    store: &impl ObjectStore,
    manifest: &SyncManifestData,
    etag: &str,
) -> Result<(), UploadError> {
    let bytes = manifest_bytes(manifest)?;
    if etag.is_empty() {
        // No remote Manifest existed when we downloaded: a plain PUT
        // creates it (an If-Match on a missing object cannot succeed).
        store
            .put(&manifest_path(), PutPayload::from(bytes))
            .await
            .map_err(|error| map_object_store_error(error))?;
        return Ok(());
    }
    let version = UpdateVersion {
        e_tag: Some(etag.to_string()),
        version: None,
    };
    let options = PutOptions::from(PutMode::Update(version));
    match store
        .put_opts(&manifest_path(), PutPayload::from(bytes), options)
        .await
    {
        Ok(_) => Ok(()),
        Err(error) if is_not_implemented(&error) => Err(UploadError::Unsupported(error)),
        Err(error) => Err(map_object_store_error(error).into()),
    }
}

pub fn map_object_store_error(error: ObjectStoreError) -> AppError {
    AppError::storage_io(format!("Sync backend error: {error}"))
}

#[cfg(test)]
mod transport_tests {
    use super::*;

    #[test]
    fn manifest_object_key_is_namespaced() {
        assert_eq!(MANIFEST_OBJECT_KEY, "litera/manifest.json");
    }

    #[test]
    fn first_sync_treats_a_missing_manifest_as_empty_and_creates_it() {
        tauri::async_runtime::block_on(async {
            let store = object_store::memory::InMemory::new();

            // Nothing on the Sync Backend yet: the download reports an empty
            // Manifest rather than failing, so the first pass can converge.
            let downloaded = download_manifest_from(&store).await.expect("download");
            assert!(downloaded.etag.is_empty());
            assert_eq!(downloaded.manifest, SyncManifestData::default());

            // A blank etag uploads with a plain PUT (If-Match on a missing
            // object cannot succeed).
            let manifest = SyncManifestData {
                schema_version: 1,
                ..SyncManifestData::default()
            };
            upload_manifest_to(&store, &manifest, "").await.expect("create");

            // The created Manifest downloads back intact.
            let reread = download_manifest_from(&store).await.expect("re-download");
            assert_eq!(reread.manifest, manifest);
        });
    }

    #[test]
    fn a_501_answer_to_if_match_counts_as_unsupported() {
        // Backblaze B2's answer to a conditional PUT, as object_store reports it.
        let b2 = ObjectStoreError::Generic {
            store: "S3",
            source: "Server returned non-2xx status code: 501 Not Implemented: \
                     <Error><Code>NotImplemented</Code><Header>If-Match</Header></Error>"
                .into(),
        };
        let outage = ObjectStoreError::Generic {
            store: "S3",
            source: "Server returned non-2xx status code: 503 Service Unavailable".into(),
        };

        assert!(is_not_implemented(&b2));
        assert!(!is_not_implemented(&outage));
    }

    #[test]
    fn the_fallback_upload_writes_only_over_the_downloaded_manifest() {
        tauri::async_runtime::block_on(async {
            let store = object_store::memory::InMemory::new();
            let first = SyncManifestData {
                schema_version: 1,
                ..SyncManifestData::default()
            };
            upload_manifest_to(&store, &first, "").await.expect("create");
            let downloaded = download_manifest_from(&store).await.expect("download");

            // Unchanged since our download: the plain PUT goes through.
            upload_manifest_checked(&store, &first, &downloaded.etag)
                .await
                .expect("upload over the downloaded manifest");

            // Another device uploaded since: report a precondition conflict
            // so the runner re-merges, and leave the remote alone.
            let error = upload_manifest_checked(&store, &first, &downloaded.etag)
                .await
                .expect_err("stale etag")
                .into_app_error();
            assert!(error.message.contains("precondition"));
        });
    }

    #[test]
    fn manifest_serializes_without_losing_the_etag_contract() {
        // The etag flows through DownloadedManifest to the conditional PUT.
        let downloaded = DownloadedManifest {
            etag: "\"etag-1\"".to_string(),
            manifest: SyncManifestData::default(),
        };

        let json = serde_json::to_string(&downloaded.manifest).expect("serialize");

        assert!(json.contains("\"schemaVersion\""));
        assert_eq!(downloaded.etag, "\"etag-1\"");
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------


fn sync_state_path(root: &Path) -> PathBuf {
    root.join("sync-state.json")
}

/**
 * Revisions of a book's file objects as last seen in the Manifest.
 */
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookRevisionState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_revision: Option<String>,
}

/// Session sync bookkeeping: what we last uploaded, and the backend etag we
/// last saw for the session object. A `seen_etag` without a `content_hash`
/// is an older version's record of a failed merge, retried once.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionRevisionState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen_etag: Option<String>,
    /// Etag of a remote copy that failed to merge: not retried until the
    /// object changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_etag: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncState {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// Local manifest overlay: tombstones and envelopes the TS merge
    /// engine needs to see; books are re-exported from the Library each pass.
    #[serde(default)]
    pub tombstones: Vec<SyncTombstoneData>,
    #[serde(default)]
    pub preferences: Option<SyncEnvelopeData>,
    #[serde(default)]
    pub provider: Option<SyncEnvelopeData>,
    /// Per-book annotations timestamps — explicit recorded fields, never
    /// file mtimes, so the merge engine can order annotation activity.
    #[serde(default)]
    pub annotations_updated_at: std::collections::BTreeMap<String, String>,
    /// Revisions (content hashes) of book EPUBs and covers as the Manifest
    /// knows them; drives upload skip and on-demand download addressing.
    #[serde(default)]
    pub book_revisions: std::collections::BTreeMap<String, BookRevisionState>,
    /// Per-session sync bookkeeping, keyed "<bookId>/<sessionId>".
    #[serde(default)]
    pub session_revisions: std::collections::BTreeMap<String, SessionRevisionState>,
    /// Retired: app preferences no longer sync. Still accepted so state
    /// files written by older versions parse; dropped on the next write.
    #[serde(default, skip_serializing)]
    pub preferences_updated_at: Option<String>,
    /// Retired: LLM provider settings no longer sync. Still accepted so state
    /// files written by older versions parse; dropped on the next write.
    #[serde(default, skip_serializing)]
    pub provider_updated_at: Option<String>,
    /// Local books whose EPUB is older than the revision on the Sync
    /// Backend (another device re-imported a newer file). They are not
    /// uploaded, and the next open downloads the newer file.
    #[serde(default, skip_serializing_if = "std::collections::BTreeSet::is_empty")]
    pub stale_files: std::collections::BTreeSet<String>,
    /// Whether the user confirmed the first bulk upload estimate.
    #[serde(default)]
    pub bulk_upload_confirmed: bool,
    /// The etag of the remote manifest we last saw (blank: never synced).
    #[serde(default)]
    pub last_etag: String,
    #[serde(default)]
    pub last_synced_at: Option<String>,
    /// The last sync failure message, surfaced in Settings (null when the
    /// last run succeeded).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

pub fn read_sync_state(root: &Path) -> AppResult<SyncState> {
    let bytes = match fs::read(sync_state_path(root)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SyncState {
                device_id: uuid::Uuid::new_v4().to_string(),
                ..SyncState::default()
            })
        }
        Err(error) => {
            return Err(AppError::storage_io(format!(
                "Failed to read sync-state.json: {error}"
            )))
        }
    };
    serde_json::from_slice(&bytes).map_err(|error| {
        AppError::storage_corrupt(format!("Failed to parse sync-state.json: {error}"))
    })
}

/// Serializes every read-modify-write of sync-state.json. Sync passes,
/// deletions, annotation saves, and preference edits all update the same
/// file from different threads; without this, a write based on an older read
/// silently drops another writer's Tombstone or timestamp.
static SYNC_STATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Read, modify, and write sync-state.json as one step under
/// [`SYNC_STATE_LOCK`]. Never hold it across network I/O: collect remote
/// results first, then fold them in here against the freshest state.
pub fn update_sync_state<T>(
    root: &Path,
    update: impl FnOnce(&mut SyncState) -> AppResult<T>,
) -> AppResult<T> {
    // A panic elsewhere does not leave the file half-written (writes are
    // atomic), so a poisoned lock is safe to reuse.
    let _guard = SYNC_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = read_sync_state(root)?;
    let result = update(&mut state)?;
    write_sync_state(root, &state)?;
    Ok(result)
}

pub fn write_sync_state(root: &Path, state: &SyncState) -> AppResult<()> {
    let json = serde_json::to_vec_pretty(state).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize sync-state.json: {error}"))
    })?;
    crate::library::atomic_write(&sync_state_path(root), &json, "sync-state.json")
}

#[tauri::command]
pub async fn sync_export_local_manifest(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
) -> AppResult<serde_json::Value> {
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        let manifest = update_sync_state(&root, |state| export_local_manifest(&store, state))?;
        serde_json::to_value(manifest)
            .map_err(|error| AppError::storage_io(format!("Failed to serialize manifest: {error}")))
    })
    .await
}

#[tauri::command]
pub async fn sync_download_manifest(
    app: tauri::AppHandle,
) -> AppResult<serde_json::Value> {
    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let downloaded = download_manifest(&config).await?;
    serde_json::to_value(downloaded)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize: {error}")))
}

#[tauri::command]
pub async fn sync_apply_merged_manifest(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    manifest: SyncManifestData,
    base: SyncManifestData,
    etag: String,
) -> AppResult<()> {
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    run_sync_blocking(move || update_sync_state(&root, |state| {
        let stale_files = apply_merged_manifest(&store, &manifest, &base)?;
        state.stale_files.extend(stale_files);

        // Deletions recorded while the network round trip was in flight must
        // survive: union by tombstone key with the newest deletedAt winning.
        // Expired book Tombstones are retained until their objects are purged.
        state.tombstones = merge_local_tombstones(state.tombstones.clone(), manifest.tombstones.clone());
        // A book Tombstone the merge discarded as a revival (the book was
        // restored or re-imported elsewhere after the deletion) must go from
        // local state too; otherwise it lingers, and once expired its purge
        // would delete the live book's objects from the Sync Backend.
        drop_revived_tombstones(&mut state.tombstones, &manifest);
        state.preferences = manifest.preferences.clone();
        state.provider = manifest.provider.clone();
        state.last_etag = etag;
        state.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
        for (book_id, synced) in &manifest.books {
            // Never move a local annotations timestamp backwards: an edit
            // made while the network round trip was in flight is newer.
            let local = state.annotations_updated_at.entry(book_id.clone()).or_default();
            if synced.annotations_updated_at > *local {
                *local = synced.annotations_updated_at.clone();
            }
            let entry = state.book_revisions.entry(book_id.clone()).or_default();
            if let Some(revision) = &synced.file_revision {
                entry.file_revision = Some(revision.clone());
            }
            if let Some(revision) = &synced.cover_revision {
                entry.cover_revision = Some(revision.clone());
            }
        }
        Ok(())
    }))
    .await
}

/// Drop local book Tombstones for books the merged Manifest keeps alive with
/// a revision newer than the deletion (mirrors the TS revival rule). A
/// Tombstone newer than the book — a deletion made mid-sync — stays.
fn drop_revived_tombstones(tombstones: &mut Vec<SyncTombstoneData>, merged: &SyncManifestData) {
    tombstones.retain(|tombstone| {
        if tombstone.kind != "book" {
            return true;
        }
        match merged.books.get(&tombstone.book_id) {
            Some(book) => book_revision(book) <= tombstone.deleted_at,
            None => true,
        }
    });
}

#[tauri::command]
pub async fn sync_upload_manifest(
    app: tauri::AppHandle,
    manifest: SyncManifestData,
    etag: String,
) -> AppResult<()> {
    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    upload_manifest(&config, &manifest, &etag).await
}

/// Record the outcome of a sync pass for the Settings status area.
#[tauri::command]
pub async fn sync_note_result(
    app: tauri::AppHandle,
    success: bool,
    error: Option<String>,
) -> AppResult<()> {
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        update_sync_state(&root, |state| {
            if success {
                state.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
                state.last_error = None;
            } else {
                state.last_error = error;
            }
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn get_sync_state(app: tauri::AppHandle) -> AppResult<SyncState> {
    let root = sync_root(&app)?;
    run_sync_blocking(move || read_sync_state(&root)).await
}

pub(crate) fn sync_root(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::storage_io(format!("Failed to resolve app data dir: {error}")))
}

async fn run_sync_blocking<T, F>(operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::storage_io(format!("Blocking sync worker failed: {error}")))?
}

#[cfg(test)]
mod timestamp_tests {
    use super::*;
    use chrono::Utc;

    fn temp_store() -> (tempfile::TempDir, LibraryStore) {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::initialize(directory.path().to_path_buf()).expect("store");
        (directory, store)
    }

    #[test]
    fn reading_state_updates_refresh_the_position_timestamp() {
        let (_dir, store) = temp_store();
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub".to_vec(),
            )
            .expect("import");
        store
            .update_reading_state(
                &result.book_id,
                Some(0.3),
                None,
                None,
                None,
                Some("epubcfi(/3)".into()),
            )
            .expect("state");

        let state = SyncState {
            device_id: "device-a".to_string(),
            ..SyncState::default()
        };
        let manifest = export_local_manifest(&store, &state).expect("export");
        let book = manifest.books.get(&result.book_id).expect("book");
        let position = book.position.as_ref().expect("position");

        // The exported updatedAt is a fresh explicit timestamp, not the
        // import time or an empty string.
        let updated = chrono::DateTime::parse_from_rfc3339(&position.updated_at)
            .expect("valid updatedAt");
        assert!(Utc::now().signed_duration_since(updated).num_seconds() < 60);
    }
}

// ---------------------------------------------------------------------------
// Ticket 04: annotation deletions and book deletions propagate as Tombstones.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tombstone_tests {
    use super::*;
    use crate::library::{BookmarkRecord, HighlightRecord};

    fn temp_store() -> (tempfile::TempDir, LibraryStore) {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::initialize(directory.path().to_path_buf()).expect("store");
        (directory, store)
    }

    fn highlight(id: &str, created_at: &str) -> HighlightRecord {
        HighlightRecord {
            id: id.to_string(),
            cfi: "epubcfi(/2)".to_string(),
            excerpt: "text".to_string(),
            created_at: created_at.to_string(),
            color: None,
            note: None,
            updated_at: None,
        }
    }

    fn bookmark(id: &str, created_at: &str) -> BookmarkRecord {
        BookmarkRecord {
            id: id.to_string(),
            cfi: "epubcfi(/4)".to_string(),
            fraction: 0.5,
            created_at: created_at.to_string(),
            label: None,
            updated_at: None,
        }
    }

    #[test]
    fn removed_annotation_ids_reports_only_deletions() {
        let before = AnnotationsFile {
            schema_version: 1,
            bookmarks: vec![bookmark("keep-b", "2026-01-01T00:00:00Z")],
            highlights: vec![
                highlight("keep-h", "2026-01-01T00:00:00Z"),
                highlight("gone-h", "2026-01-01T00:00:00Z"),
            ],
        };
        let after = AnnotationsFile {
            schema_version: 1,
            bookmarks: vec![bookmark("keep-b", "2026-01-01T00:00:00Z")],
            highlights: vec![
                highlight("keep-h", "2026-01-01T00:00:00Z"),
                highlight("new-h", "2026-01-02T00:00:00Z"),
            ],
        };

        let removed = removed_annotation_ids(&before, &after);

        assert_eq!(removed, vec!["gone-h".to_string()]);
    }

    #[test]
    fn deleting_a_book_records_a_tombstone_in_sync_state() {
        let dir = tempfile::tempdir().expect("temp dir");

        record_book_tombstone(dir.path(), "book-1").expect("record");

        let state = read_sync_state(dir.path()).expect("state");
        assert_eq!(state.tombstones.len(), 1);
        assert_eq!(state.tombstones[0].kind, "book");
        assert_eq!(state.tombstones[0].book_id, "book-1");
        assert!(!state.tombstones[0].device_id.is_empty());
    }

    #[test]
    fn removing_a_book_tombstone_revokes_only_that_book() {
        let dir = tempfile::tempdir().expect("temp dir");
        record_book_tombstone(dir.path(), "book-1").expect("record");
        record_book_tombstone(dir.path(), "book-2").expect("record");
        note_annotations_saved(dir.path(), "book-1", &["h-1".to_string()]).expect("note");

        remove_book_tombstone(dir.path(), "book-1").expect("remove");

        let state = read_sync_state(dir.path()).expect("state");
        assert!(!state
            .tombstones
            .iter()
            .any(|tombstone| tombstone.kind == "book" && tombstone.book_id == "book-1"));
        // Other books and this book's annotation tombstones are untouched.
        assert!(state
            .tombstones
            .iter()
            .any(|tombstone| tombstone.kind == "book" && tombstone.book_id == "book-2"));
        assert!(state
            .tombstones
            .iter()
            .any(|tombstone| tombstone.kind == "annotation"
                && tombstone.book_id == "book-1"));

        // Idempotent: revoking an absent tombstone is a no-op.
        remove_book_tombstone(dir.path(), "book-1").expect("no-op");
    }

    #[test]
    fn exporting_a_manifest_carries_the_book_revision_timestamp() {
        let (dir, store) = temp_store();
        let result = store
            .import_bytes(
                Path::new("/source/export-revision.epub"),
                "book.epub".to_string(),
                b"export-revision".to_vec(),
            )
            .expect("import");
        let sync_state = read_sync_state(dir.path()).expect("state");

        // No local edit yet: the field is empty so the TS merge falls back to
        // reading activity exactly as it did before the field existed.
        let manifest = export_local_manifest(&store, &sync_state).expect("export");
        assert!(manifest.books[&result.book_id].book_updated_at.is_empty());

        store
            .update_book_metadata(
                &result.book_id,
                "Edited".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                None,
            )
            .expect("update");

        let manifest = export_local_manifest(&store, &sync_state).expect("export");
        assert!(!manifest.books[&result.book_id].book_updated_at.is_empty());
    }

    #[test]
    fn applying_a_merged_manifest_adopts_the_book_revision_timestamp() {
        let (dir, store) = temp_store();
        let result = store
            .import_bytes(
                Path::new("/source/apply-revision.epub"),
                "book.epub".to_string(),
                b"apply-revision".to_vec(),
            )
            .expect("import");
        let revision = "2026-05-05T00:00:00+00:00".to_string();
        let merged = SyncManifestData {
            schema_version: 1,
            books: [(
                result.book_id.clone(),
                SyncedBookData {
                    metadata: SyncBookMetadata {
                        title: "Merged Title".to_string(),
                        author: String::new(),
                        description: None,
                        publisher: None,
                        language: None,
                        series: None,
                        reading_status: None,                        status_updated_at: None,                        starred: None,
                    },
                    position: None,
                    annotations: AnnotationsFile::empty(),
                    annotations_updated_at: String::new(),
                    file_revision: None,
                    cover_revision: None,
                    book_updated_at: revision.clone(),
                },
            )]
            .into_iter()
            .collect(),
            tombstones: Vec::new(),
            preferences: None,
            provider: None,
        };

        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let library = store.read_library_public().expect("library");
        let record = library
            .books
            .iter()
            .find(|book| book.id == result.book_id)
            .expect("record");
        assert_eq!(record.updated_at.as_deref(), Some(revision.as_str()));
        drop(dir);
    }

    #[test]
    fn curation_round_trips_through_export_and_apply() {
        let (dir, store) = temp_store();
        let result = store
            .import_bytes(
                Path::new("/source/curation-sync.epub"),
                "book.epub".to_string(),
                b"curation-sync".to_vec(),
            )
            .expect("import");
        store
            .update_book_curation(&result.book_id, Some("finished".to_string()), Some(true))
            .expect("curate");

        let sync_state = read_sync_state(dir.path()).expect("state");
        let manifest = export_local_manifest(&store, &sync_state).expect("export");
        let metadata = &manifest.books[&result.book_id].metadata;
        assert_eq!(metadata.reading_status.as_deref(), Some("finished"));
        assert_eq!(metadata.starred, Some(true));

        assert!(metadata.status_updated_at.is_some());

        // A merged manifest from another device overwrites both fields.
        let mut merged = manifest.clone();
        let entry = merged.books.get_mut(&result.book_id).expect("book");
        entry.metadata.reading_status = Some("reading".to_string());
        entry.metadata.status_updated_at = Some("2030-01-01T00:00:00Z".to_string());
        entry.metadata.starred = Some(false);
        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let library = store.read_library_public().expect("library");
        let record = library
            .books
            .iter()
            .find(|book| book.id == result.book_id)
            .expect("record");
        assert_eq!(record.reading_status.as_deref(), Some("reading"));
        assert_eq!(record.status_updated_at.as_deref(), Some("2030-01-01T00:00:00Z"));
        assert_eq!(record.starred, Some(false));
        drop(dir);
    }

    #[test]
    fn a_manifest_without_a_status_keeps_the_local_one() {
        let (dir, store) = temp_store();
        let result = store
            .import_bytes(
                Path::new("/source/statusless.epub"),
                "book.epub".to_string(),
                b"statusless".to_vec(),
            )
            .expect("import");
        store
            .update_book_curation(&result.book_id, Some("paused".to_string()), None)
            .expect("curate");

        let sync_state = read_sync_state(dir.path()).expect("state");
        let mut merged = export_local_manifest(&store, &sync_state).expect("export");
        // An older version's Manifest entry has no status at all.
        let entry = merged.books.get_mut(&result.book_id).expect("book");
        entry.metadata.reading_status = None;
        entry.metadata.status_updated_at = None;
        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let library = store.read_library_public().expect("library");
        assert_eq!(library.books[0].reading_status.as_deref(), Some("paused"));
        assert!(library.books[0].status_updated_at.is_some());
        drop(dir);
    }

    #[test]
    fn placeholders_carry_the_synced_status_into_the_downloaded_book() {
        let (dir, store) = temp_store();
        let mut synced = super::tests::synced_book("Remote Book", 0.5, "epubcfi(/5)");
        synced.metadata.reading_status = Some("paused".to_string());
        synced.metadata.status_updated_at = Some("2026-02-01T00:00:00Z".to_string());
        let merged = SyncManifestData {
            schema_version: 1,
            books: [("remotebook1".to_string(), synced)].into_iter().collect(),
            tombstones: Vec::new(),
            preferences: None,
            provider: None,
        };
        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let placeholder = &store.list_placeholders().expect("placeholders")[0];
        assert_eq!(placeholder.reading_status.as_deref(), Some("paused"));

        store
            .install_synced_book("remotebook1", b"remote-epub".to_vec())
            .expect("install");
        let library = store.read_library_public().expect("library");
        let record = library
            .books
            .iter()
            .find(|book| book.id == "remotebook1")
            .expect("record");
        assert_eq!(record.reading_status.as_deref(), Some("paused"));
        assert_eq!(record.status_updated_at.as_deref(), Some("2026-02-01T00:00:00Z"));
        drop(dir);
    }

    #[test]
    fn saving_annotations_records_tombstones_and_a_timestamp() {
        let dir = tempfile::tempdir().expect("temp dir");

        note_annotations_saved(dir.path(), "book-1", &["h-1".to_string()]).expect("note");
        note_annotations_saved(dir.path(), "book-1", &[]).expect("note again");

        let state = read_sync_state(dir.path()).expect("state");
        // No duplicates from recording twice.
        assert_eq!(state.tombstones.len(), 1);
        assert_eq!(state.tombstones[0].kind, "annotation");
        assert_eq!(state.tombstones[0].annotation_id.as_deref(), Some("h-1"));
        assert_eq!(
            state.annotations_updated_at.get("book-1").cloned(),
            state.annotations_updated_at.get("book-1").cloned()
        );
        assert!(state.annotations_updated_at.contains_key("book-1"));
    }

    #[test]
    fn apply_moves_a_tombstoned_book_into_the_local_trash() {
        let (dir, store) = temp_store();
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub-bytes".to_vec(),
            )
            .expect("import");
        let epub_path = store
            .book_dir_path(&result.book_id)
            .expect("book dir")
            .join("book.epub");

        let merged = SyncManifestData {
            schema_version: 1,
            books: Default::default(),
            tombstones: vec![SyncTombstoneData {
                kind: "book".to_string(),
                book_id: result.book_id.clone(),
                annotation_id: None,
                device_id: "device-b".to_string(),
                deleted_at: chrono::Utc::now().to_rfc3339(),
            }],
            preferences: None,
            provider: None,
        };

        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let library = store.read_library_public().expect("library");
        assert!(!library.books.iter().any(|book| book.id == result.book_id));
        assert!(!epub_path.exists());
        // The staged directory survives in the local trash (recovery window).
        let trash = store.trash_root_path();
        let staged: Vec<_> = std::fs::read_dir(&trash)
            .expect("trash listing")
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.path())
            .collect();
        assert_eq!(staged.len(), 1);
        assert!(staged[0]
            .file_name()
            .and_then(|name| name.to_str())
            .expect("trash name")
            .starts_with(&result.book_id));
        drop(dir);
    }

    #[test]
    fn tombstones_recorded_mid_sync_survive_the_apply_overwrite() {
        let current = vec![SyncTombstoneData {
            kind: "book".to_string(),
            book_id: "book-late".to_string(),
            annotation_id: None,
            device_id: "device-a".to_string(),
            // Deleted while the network round trip was in flight.
            deleted_at: "2026-06-02T00:00:00Z".to_string(),
        }];
        let merged = vec![SyncTombstoneData {
            kind: "book".to_string(),
            book_id: "book-early".to_string(),
            annotation_id: None,
            device_id: "device-a".to_string(),
            deleted_at: "2026-06-01T00:00:00Z".to_string(),
        }];

        let union = merge_local_tombstones(current, merged);

        assert_eq!(union.len(), 2);
        assert!(union.iter().any(|tombstone| tombstone.book_id == "book-late"));
    }

    #[test]
    fn apply_removes_a_tombstoned_placeholder() {
        let (_dir, store) = temp_store();
        store
            .save_placeholder("remotebook1", "Remote Book", "Author", None, None, None, None)
            .expect("placeholder");

        let merged = SyncManifestData {
            schema_version: 1,
            books: Default::default(),
            tombstones: vec![SyncTombstoneData {
                kind: "book".to_string(),
                book_id: "remotebook1".to_string(),
                annotation_id: None,
                device_id: "device-b".to_string(),
                deleted_at: chrono::Utc::now().to_rfc3339(),
            }],
            preferences: None,
            provider: None,
        };

        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        assert!(store.list_placeholders().expect("placeholders").is_empty());
    }

    #[test]
    fn apply_converges_annotations_for_a_known_book() {
        let (_dir, store) = temp_store();
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub-bytes".to_vec(),
            )
            .expect("import");

        let merged = SyncManifestData {
            schema_version: 1,
            books: [(
                result.book_id.clone(),
                SyncedBookData {
                    metadata: SyncBookMetadata {
                        title: "Title".to_string(),
                        author: "Author".to_string(),
                        description: None,
                        publisher: None,
                        language: None,
                        series: None,
                        reading_status: None,                        status_updated_at: None,                        starred: None,
                    },
                    position: None,
                    annotations: AnnotationsFile {
                        schema_version: 1,
                        bookmarks: vec![],
                        highlights: vec![highlight("remote-h", "2026-01-02T00:00:00Z")],
                    },
                    annotations_updated_at: "2026-01-02T00:00:00Z".to_string(),
                    file_revision: None,
                    cover_revision: None,
                    book_updated_at: String::new(),
                },
            )]
            .into_iter()
            .collect(),
            tombstones: Vec::new(),
            preferences: None,
            provider: None,
        };

        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let applied = store.get_annotations(&result.book_id).expect("annotations");
        assert_eq!(applied.highlights.len(), 1);
        assert_eq!(applied.highlights[0].id, "remote-h");
    }

    #[test]
    fn apply_never_clobbers_annotations_changed_mid_sync() {
        let (_dir, store) = temp_store();
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub-bytes".to_vec(),
            )
            .expect("import");
        // The base snapshot the pass started from.
        let base_annotations = AnnotationsFile {
            schema_version: 1,
            bookmarks: vec![],
            highlights: vec![highlight("base-h", "2026-01-01T00:00:00Z")],
        };
        store
            .save_annotations(&result.book_id, base_annotations.clone())
            .expect("base save");
        // A local edit lands while the network round trip is in flight.
        let mid_sync = AnnotationsFile {
            schema_version: 1,
            bookmarks: vec![],
            highlights: vec![highlight("local-h", "2026-01-03T00:00:00Z")],
        };
        store
            .save_annotations(&result.book_id, mid_sync.clone())
            .expect("mid-sync save");

        let merged = SyncManifestData {
            schema_version: 1,
            books: [(
                result.book_id.clone(),
                SyncedBookData {
                    metadata: SyncBookMetadata {
                        title: "Title".to_string(),
                        author: "Author".to_string(),
                        description: None,
                        publisher: None,
                        language: None,
                        series: None,
                        reading_status: None,                        status_updated_at: None,                        starred: None,
                    },
                    position: None,
                    annotations: AnnotationsFile {
                        schema_version: 1,
                        bookmarks: vec![],
                        highlights: vec![highlight("remote-h", "2026-01-02T00:00:00Z")],
                    },
                    annotations_updated_at: "2026-01-02T00:00:00Z".to_string(),
                    file_revision: None,
                    cover_revision: None,
                    book_updated_at: String::new(),
                },
            )]
            .into_iter()
            .collect(),
            tombstones: Vec::new(),
            preferences: None,
            provider: None,
        };
        let base = SyncManifestData {
            schema_version: 1,
            books: [(
                result.book_id.clone(),
                SyncedBookData {
                    metadata: SyncBookMetadata {
                        title: "Title".to_string(),
                        author: "Author".to_string(),
                        description: None,
                        publisher: None,
                        language: None,
                        series: None,
                        reading_status: None,                        status_updated_at: None,                        starred: None,
                    },
                    position: None,
                    annotations: base_annotations,
                    annotations_updated_at: String::new(),
                    file_revision: None,
                    cover_revision: None,
                    book_updated_at: String::new(),
                },
            )]
            .into_iter()
            .collect(),
            tombstones: Vec::new(),
            preferences: None,
            provider: None,
        };

        apply_merged_manifest(&store, &merged, &base).expect("apply");

        let kept = store.get_annotations(&result.book_id).expect("annotations");
        assert_eq!(kept, mid_sync);
    }

    #[test]
    fn an_expired_book_tombstone_no_longer_deletes() {
        let (_dir, store) = temp_store();
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub-bytes".to_vec(),
            )
            .expect("import");

        // 30-day retention long since elapsed.
        let merged = SyncManifestData {
            schema_version: 1,
            books: Default::default(),
            tombstones: vec![SyncTombstoneData {
                kind: "book".to_string(),
                book_id: result.book_id.clone(),
                annotation_id: None,
                device_id: "device-b".to_string(),
                deleted_at: "2020-01-01T00:00:00Z".to_string(),
            }],
            preferences: None,
            provider: None,
        };

        apply_merged_manifest(&store, &merged, &SyncManifestData::default()).expect("apply");

        let library = store.read_library_public().expect("library");
        assert!(library.books.iter().any(|book| book.id == result.book_id));
    }
}

// ---------------------------------------------------------------------------
// Ticket 05: EPUB and cover objects — upload with confirmation, on-demand
// download, and opportunistic purge of expired Tombstones' objects.
// ---------------------------------------------------------------------------

pub const FILE_OBJECT_PREFIX: &str = "litera/files";
/// Fixed part size for multipart uploads: comfortably above the 5 MiB
/// minimum every common S3-compatible backend enforces for non-final parts.
const UPLOAD_PART_BYTES: usize = 8 * 1024 * 1024;
/// Bounded retries so a large book over a flaky connection eventually makes
/// it; each attempt restarts the multipart upload (parts are re-sent).
const MAX_UPLOAD_ATTEMPTS: usize = 3;

fn epub_object_key(book_id: &str, revision: &str) -> ObjectPath {
    ObjectPath::from(format!("{FILE_OBJECT_PREFIX}/{book_id}/{revision}/book.epub"))
}

fn cover_object_key(book_id: &str, revision: &str) -> ObjectPath {
    ObjectPath::from(format!("{FILE_OBJECT_PREFIX}/{book_id}/{revision}/cover.jpg"))
}

/// Upload estimate for the books not yet present on the Sync Backend.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UploadEstimate {
    pub bytes: u64,
    pub books: u64,
    pub confirmed: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UploadSummary {
    pub books: u64,
    pub covers: u64,
    pub bytes: u64,
}

struct PendingUpload {
    book_id: String,
    epub_path: PathBuf,
    revision: String,
    cover_path: Option<PathBuf>,
}

fn pending_uploads(store: &LibraryStore, state: &SyncState) -> AppResult<Vec<PendingUpload>> {
    let library = store.read_library_public()?;
    let mut pending = Vec::new();
    for book in &library.books {
        // An older file than the Sync Backend's must not be pushed back
        // over the newer revision; it is replaced on the next open.
        if state.stale_files.contains(&book.id) {
            continue;
        }
        let (epub_path, cover_path) = store.book_files(&book.id)?;
        if !epub_path.is_file() {
            continue;
        }
        let recorded = state.book_revisions.get(&book.id);
        let revision = book
            .content_hash
            .clone()
            .or_else(|| fs::read(&epub_path).ok().map(|bytes| crate::library::sha256_hex(&bytes)))
            .unwrap_or_default();
        let file_current = recorded.and_then(|entry| entry.file_revision.as_deref())
            == Some(revision.as_str());
        // A cover-only edit must still upload: compare the stored cover's
        // hash with the recorded revision. (Cover removal is not synced.)
        let has_cover = cover_path.is_file();
        let cover_current = if has_cover {
            fs::read(&cover_path)
                .ok()
                .map(|bytes| {
                    recorded.and_then(|entry| entry.cover_revision.as_deref())
                        == Some(crate::library::sha256_hex(&bytes).as_str())
                })
                .unwrap_or(true)
        } else {
            true
        };
        if file_current && cover_current {
            continue;
        }
        pending.push(PendingUpload {
            book_id: book.id.clone(),
            epub_path,
            revision,
            cover_path: if cover_path.is_file() { Some(cover_path) } else { None },
        });
    }
    Ok(pending)
}

/// The uploads this pass may run. The first bulk upload of an existing
/// library happens only after the user confirmed the estimate; until then
/// automatic syncs silently skip file uploads (the Manifest still converges).
fn uploads_to_run(store: &LibraryStore, state: &mut SyncState) -> AppResult<Vec<PendingUpload>> {
    let pending = pending_uploads(store, state)?;
    if !state.bulk_upload_confirmed {
        if !pending.is_empty() {
            return Ok(Vec::new());
        }
        // Nothing to upload, so nothing to confirm: books imported from now
        // on flow automatically.
        state.bulk_upload_confirmed = true;
    }
    Ok(pending)
}

pub fn estimate_pending_upload(store: &LibraryStore, state: &SyncState) -> AppResult<UploadEstimate> {
    let pending = pending_uploads(store, state)?;
    let mut bytes = 0u64;
    let mut books = 0u64;
    for upload in &pending {
        books += 1;
        bytes += fs::metadata(&upload.epub_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
        if let Some(cover) = &upload.cover_path {
            bytes += fs::metadata(cover).map(|meta| meta.len()).unwrap_or(0);
        }
    }
    Ok(UploadEstimate {
        bytes,
        books,
        confirmed: state.bulk_upload_confirmed,
    })
}

async fn put_epub_multipart(
    object_store: &object_store::aws::AmazonS3,
    path: &ObjectPath,
    file: &Path,
) -> AppResult<()> {
    let mut last_error = None;
    for _ in 0..MAX_UPLOAD_ATTEMPTS {
        match upload_multipart_attempt(object_store, path, file).await {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.expect("at least one upload attempt"))
}

async fn upload_multipart_attempt(
    object_store: &object_store::aws::AmazonS3,
    path: &ObjectPath,
    file: &Path,
) -> AppResult<()> {
    use std::io::Read;

    let mut upload = object_store
        .put_multipart(path)
        .await
        .map_err(map_object_store_error)?;
    let mut file = fs::File::open(file)
        .map_err(|error| AppError::storage_io(format!("Failed to open EPUB for upload: {error}")))?;
    let mut buffer = vec![0u8; UPLOAD_PART_BYTES];
    loop {
        let mut filled = 0;
        while filled < buffer.len() {
            let read = file
                .read(&mut buffer[filled..])
                .map_err(|error| AppError::storage_io(format!("Failed to read EPUB: {error}")))?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        if filled == 0 {
            break;
        }
        upload
            .put_part(PutPayload::from(buffer[..filled].to_vec()))
            .await
            .map_err(map_object_store_error)?;
        if filled < buffer.len() {
            break;
        }
    }
    if let Err(error) = upload.complete().await {
        let _ = upload.abort().await;
        return Err(map_object_store_error(error));
    }
    Ok(())
}

/// Delete every object stored under a book's file prefix: the 30-day
/// Tombstone retention has elapsed, so the Sync Backend object set is
/// cleaned up. Session objects for the book are released by the same rule.
async fn purge_book_objects(
    object_store: &impl ObjectStore,
    book_id: &str,
) -> AppResult<()> {
    delete_prefix(
        object_store,
        &ObjectPath::from(format!("{FILE_OBJECT_PREFIX}/{book_id}")),
    )
    .await?;
    purge_session_objects(object_store, book_id).await
}

fn expired_book_tombstones(state: &SyncState) -> Vec<String> {
    state
        .tombstones
        .iter()
        .filter(|tombstone| tombstone.kind == "book" && !is_tombstone_active(tombstone))
        .map(|tombstone| tombstone.book_id.clone())
        .collect()
}

#[tauri::command]
pub async fn sync_estimate_upload(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
) -> AppResult<UploadEstimate> {
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        let state = read_sync_state(&root)?;
        estimate_pending_upload(&store, &state)
    })
    .await
}

#[tauri::command]
pub async fn sync_confirm_bulk_upload(app: tauri::AppHandle) -> AppResult<()> {
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        update_sync_state(&root, |state| {
            state.bulk_upload_confirmed = true;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn sync_upload_book_files(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
) -> AppResult<UploadSummary> {
    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let store = store.inner().clone();
    let state_root = root.clone();
    let (pending, recorded_revisions) = run_sync_blocking(move || {
        update_sync_state(&state_root, |state| {
            let pending = uploads_to_run(&store, state)?;
            Ok((pending, state.book_revisions.clone()))
        })
    })
    .await?;
    if pending.is_empty() {
        return Ok(UploadSummary::default());
    }

    let object_store = crate::sync_config::build_sync_store(&config)?;
    let mut summary = UploadSummary::default();
    let mut revisions: std::collections::BTreeMap<String, BookRevisionState> =
        std::collections::BTreeMap::new();
    for upload in pending {
        // The EPUB only goes out when its revision moved; a cover-only edit
        // reuses the object already stored under the same revision key.
        let recorded_revision = recorded_revisions
            .get(&upload.book_id)
            .and_then(|entry| entry.file_revision.clone());
        if recorded_revision.as_deref() != Some(upload.revision.as_str()) {
            put_epub_multipart(&object_store, &epub_object_key(&upload.book_id, &upload.revision), &upload.epub_path)
                .await?;
            summary.bytes += fs::metadata(&upload.epub_path)
                .map(|meta| meta.len())
                .unwrap_or(0);
        }
        summary.books += 1;
        let entry = revisions
            .entry(upload.book_id.clone())
            .or_default();
        entry.file_revision = Some(upload.revision.clone());
        if let Some(cover_path) = upload.cover_path {
            let bytes = fs::read(&cover_path).map_err(|error| {
                AppError::storage_io(format!("Failed to read cover for upload: {error}"))
            })?;
            summary.bytes += bytes.len() as u64;
            let revision = crate::library::sha256_hex(&bytes);
            object_store
                .put(&cover_object_key(&upload.book_id, &revision), PutPayload::from(bytes))
                .await
                .map_err(map_object_store_error)?;
            entry.cover_revision = Some(revision);
            summary.covers += 1;
        }
    }

    // Opportunistic cleanup of expired Tombstones lives in sync_sessions,
    // which always runs at the end of a sync pass with the freshest state.

    let root_for_write = root.clone();
    run_sync_blocking(move || {
        update_sync_state(&root_for_write, |state| {
            for (book_id, entry) in revisions {
                state.book_revisions.insert(book_id, entry);
            }
            Ok(())
        })
    })
    .await?;

    Ok(summary)
}

#[tauri::command]
pub async fn sync_download_book_file(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
) -> AppResult<()> {
    // A book that is already local and current needs nothing — callers
    // invoke this on every open, and for cached books it must stay a cheap
    // no-op.
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    let (already_local, stale) = run_sync_blocking({
        let store = store.clone();
        let book_id = book_id.clone();
        let root = root.clone();
        move || {
            let already_local = store
                .read_library_public()?
                .books
                .iter()
                .any(|book| book.id == book_id);
            let stale = read_sync_state(&root)?.stale_files.contains(&book_id);
            Ok((already_local, stale))
        }
    })
    .await?;
    if already_local && !stale {
        return Ok(());
    }

    let download = download_book_file(&root, &book_id).await;
    if already_local {
        // A newer file exists elsewhere, but the local one still opens:
        // failing to fetch the update (offline, say) must not block reading.
        let bytes = match download {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!("[sync] Newer file for {book_id} not downloaded: {}", error.message);
                return Ok(());
            }
        };
        return run_sync_blocking(move || {
            store.replace_synced_book_file(&book_id, &bytes)?;
            update_sync_state(&root, |state| {
                state.stale_files.remove(&book_id);
                Ok(())
            })
        })
        .await;
    }
    let bytes = download?;
    run_sync_blocking(move || store.install_synced_book(&book_id, bytes)).await
}

/// How many bytes opening this book would download, or `None` when it would
/// download nothing (the book is local and current, or Sync is off). The
/// mobile shell asks before spending mobile data on a large EPUB.
#[tauri::command]
pub async fn sync_book_download_size(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
) -> AppResult<Option<u64>> {
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    let lookup = run_sync_blocking({
        let root = root.clone();
        let book_id = book_id.clone();
        move || {
            let already_local = store
                .read_library_public()?
                .books
                .iter()
                .any(|book| book.id == book_id);
            let state = read_sync_state(&root)?;
            if already_local && !state.stale_files.contains(&book_id) {
                return Ok(None);
            }
            let Some(config) = crate::sync_config::read_sync_config(&root)? else {
                return Ok(None);
            };
            let revision = state
                .book_revisions
                .get(&book_id)
                .and_then(|entry| entry.file_revision.clone());
            Ok(revision.map(|revision| (config, revision)))
        }
    })
    .await?;
    let Some((config, revision)) = lookup else {
        return Ok(None);
    };
    let object_store = crate::sync_config::build_sync_store(&config)?;
    let meta = object_store
        .head(&epub_object_key(&book_id, &revision))
        .await
        .map_err(map_object_store_error)?;
    Ok(Some(meta.size))
}

/// Fetch a book's EPUB at the revision the Manifest last named.
async fn download_book_file(root: &Path, book_id: &str) -> AppResult<Vec<u8>> {
    let config = crate::sync_config::read_sync_config(root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let state = read_sync_state(root)?;
    let revision = state
        .book_revisions
        .get(book_id)
        .and_then(|entry| entry.file_revision.clone())
        .ok_or_else(|| {
            AppError::invalid_input("Book file is not available on the sync backend")
        })?;

    let object_store = crate::sync_config::build_sync_store(&config)?;
    let result = object_store
        .get(&epub_object_key(book_id, &revision))
        .await
        .map_err(map_object_store_error)?;
    let bytes = result
        .bytes()
        .await
        .map_err(map_object_store_error)?;
    Ok(bytes.to_vec())
}

/// Download the cover for a book on demand. Returns whether a cover was
/// actually downloaded (false when the cover is already local or the Sync
/// Backend has none).
#[tauri::command]
pub async fn sync_ensure_cover(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
) -> AppResult<bool> {
    let store = store.inner().clone();
    if store.has_local_cover(&book_id) {
        return Ok(false);
    }
    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let state = run_sync_blocking({
        let root = root.clone();
        move || read_sync_state(&root)
    })
    .await?;
    let revision = state
        .book_revisions
        .get(&book_id)
        .and_then(|entry| entry.cover_revision.clone())
        .ok_or_else(|| {
            AppError::invalid_input("Cover is not available on the sync backend")
        })?;

    let object_store = crate::sync_config::build_sync_store(&config)?;
    let result = object_store
        .get(&cover_object_key(&book_id, &revision))
        .await
        .map_err(map_object_store_error)?;
    let bytes = result
        .bytes()
        .await
        .map_err(map_object_store_error)?;

    run_sync_blocking(move || store.install_synced_cover(&book_id, &bytes)).await?;
    Ok(true)
}

#[cfg(test)]
mod file_sync_tests {
    use super::*;

    fn temp_store() -> (tempfile::TempDir, LibraryStore) {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::initialize(directory.path().to_path_buf()).expect("store");
        (directory, store)
    }

    fn imported_book(store: &LibraryStore) -> String {
        let result = store
            .import_bytes(
                std::path::Path::new("/tmp/book.epub"),
                "book.epub".to_string(),
                b"epub-bytes".to_vec(),
            )
            .expect("import");
        result.book_id
    }

    #[test]
    fn object_keys_are_namespaced_by_book_and_revision() {
        assert_eq!(
            epub_object_key("book-1", "abc123").to_string(),
            "litera/files/book-1/abc123/book.epub"
        );
        assert_eq!(
            cover_object_key("book-1", "def456").to_string(),
            "litera/files/book-1/def456/cover.jpg"
        );
    }

    #[test]
    fn estimate_counts_books_without_a_recorded_revision() {
        let (_dir, store) = temp_store();
        let book_id = imported_book(&store);
        let state = SyncState::default();

        let estimate = estimate_pending_upload(&store, &state).expect("estimate");
        assert_eq!(estimate.books, 1);
        assert_eq!(estimate.bytes, b"epub-bytes".len() as u64);
        assert!(!estimate.confirmed);

        // After the revision is recorded (uploaded), the estimate drops to zero.
        let state = SyncState {
            book_revisions: [(
                book_id.clone(),
                BookRevisionState {
                    file_revision: store
                        .read_library_public()
                        .expect("library")
                        .books
                        .iter()
                        .find(|book| book.id == book_id)
                        .and_then(|book| book.content_hash.clone()),
                    cover_revision: None,
                },
            )]
            .into_iter()
            .collect(),
            bulk_upload_confirmed: true,
            ..SyncState::default()
        };
        let estimate = estimate_pending_upload(&store, &state).expect("estimate");
        assert_eq!(estimate.books, 0);
        assert_eq!(estimate.bytes, 0);
        assert!(estimate.confirmed);
    }

    #[test]
    fn export_carries_recorded_file_revisions() {
        let (_dir, store) = temp_store();
        let book_id = imported_book(&store);
        let state = SyncState {
            device_id: "device-a".to_string(),
            book_revisions: [(
                book_id.clone(),
                BookRevisionState {
                    file_revision: Some("rev-1".to_string()),
                    cover_revision: Some("cover-1".to_string()),
                },
            )]
            .into_iter()
            .collect(),
            ..SyncState::default()
        };

        let manifest = export_local_manifest(&store, &state).expect("export");
        let book = manifest.books.get(&book_id).expect("book");
        assert_eq!(book.file_revision.as_deref(), Some("rev-1"));
        assert_eq!(book.cover_revision.as_deref(), Some("cover-1"));
    }

    #[test]
    fn list_books_renders_placeholders_as_uncached_and_promotes_on_install() {
        let (_dir, store) = temp_store();
        store
            .save_placeholder("remotebook1", "Remote Book", "Author", Some(0.25), None, None, None)
            .expect("placeholder");

        let books = store.list_books().expect("list");
        let placeholder = books
            .iter()
            .find(|book| book.id == "remotebook1")
            .expect("placeholder listed");
        assert!(!placeholder.cached);
        assert_eq!(placeholder.cover_path, "");

        store
            .install_synced_book("remotebook1", b"epub-bytes".to_vec())
            .expect("install");

        let books = store.list_books().expect("list");
        let promoted = books
            .iter()
            .find(|book| book.id == "remotebook1")
            .expect("promoted book");
        assert!(promoted.cached);
        assert_eq!(promoted.title, "Remote Book");
        assert_eq!(promoted.author, "Author");
        assert_eq!(promoted.last_fraction, Some(0.25));
        let expected_revision = crate::library::sha256_hex(b"epub-bytes");
        assert_eq!(promoted.content_hash.as_deref(), Some(expected_revision.as_str()));
        assert!(promoted.content_version.is_some());
        // Opening works without any further download.
        assert!(store
            .book_files("remotebook1")
            .expect("files")
            .0
            .is_file());
    }

    #[test]
    fn installing_a_cover_backfills_the_record_cover_path() {
        let (_dir, store) = temp_store();
        let book_id = imported_book(&store);
        assert!(!store.has_local_cover(&book_id));

        store
            .install_synced_cover(&book_id, b"jpeg-bytes")
            .expect("cover");

        assert!(store.has_local_cover(&book_id));
        let books = store.list_books().expect("list");
        let record = books.iter().find(|book| book.id == book_id).expect("book");
        assert!(record.cover_path.ends_with("cover.jpg"));
    }

    #[test]
    fn a_cover_only_edit_stays_pending_and_reuploads_only_the_cover() {
        let (_dir, store) = temp_store();
        let book_id = imported_book(&store);
        // Record the EPUB as uploaded, with a stale cover revision.
        store
            .install_synced_cover(&book_id, b"old-cover")
            .expect("cover");
        let epub_hash = store
            .read_library_public()
            .expect("library")
            .books
            .iter()
            .find(|book| book.id == book_id)
            .and_then(|book| book.content_hash.clone())
            .expect("hash");
        let state = SyncState {
            book_revisions: [(
                book_id.clone(),
                // A stale revision from before the cover was edited.
                BookRevisionState {
                    file_revision: Some(epub_hash),
                    cover_revision: Some(crate::library::sha256_hex(b"previous-cover")),
                },
            )]
            .into_iter()
            .collect(),
            bulk_upload_confirmed: true,
            ..SyncState::default()
        };

        assert!(store.has_local_cover(&book_id));

        // The EPUB is unchanged, but pending_uploads must not skip the book:
        // the recorded cover revision no longer matches the stored cover.
        let pending = pending_uploads(&store, &state).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].book_id, book_id);
    }

    #[test]
    fn a_legacy_png_cover_is_found_and_uploaded() {
        let (_dir, store) = temp_store();
        let book_id = imported_book(&store);
        // Books imported before covers were compressed to JPEG keep cover.png.
        let (epub_path, _) = store.book_files(&book_id).expect("files");
        let png_path = epub_path.with_file_name("cover.png");
        fs::write(&png_path, b"png-cover").expect("write png cover");
        let epub_hash = store
            .read_library_public()
            .expect("library")
            .books
            .iter()
            .find(|book| book.id == book_id)
            .and_then(|book| book.content_hash.clone())
            .expect("hash");
        // The EPUB went out earlier, but the cover never did.
        let state = SyncState {
            book_revisions: [(
                book_id.clone(),
                BookRevisionState { file_revision: Some(epub_hash), cover_revision: None },
            )]
            .into_iter()
            .collect(),
            bulk_upload_confirmed: true,
            ..SyncState::default()
        };

        assert!(store.has_local_cover(&book_id));
        let pending = pending_uploads(&store, &state).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].cover_path.as_deref(), Some(png_path.as_path()));
    }

    #[test]
    fn a_unchanged_book_and_cover_are_not_pending() {
        let (_dir, store) = temp_store();
        let book_id = imported_book(&store);
        store
            .install_synced_cover(&book_id, b"the-cover")
            .expect("cover");
        let epub_hash = store
            .read_library_public()
            .expect("library")
            .books
            .iter()
            .find(|book| book.id == book_id)
            .and_then(|book| book.content_hash.clone())
            .expect("hash");
        let state = SyncState {
            book_revisions: [(
                book_id.clone(),
                BookRevisionState {
                    file_revision: Some(epub_hash),
                    cover_revision: Some(crate::library::sha256_hex(b"the-cover")),
                },
            )]
            .into_iter()
            .collect(),
            bulk_upload_confirmed: true,
            ..SyncState::default()
        };

        let pending = pending_uploads(&store, &state).expect("pending");
        assert!(pending.is_empty());
    }

    #[test]
    fn expired_tombstones_select_their_book_objects_for_purge() {
        let state = SyncState {
            tombstones: vec![
                SyncTombstoneData {
                    kind: "book".to_string(),
                    book_id: "expired-book".to_string(),
                    annotation_id: None,
                    device_id: "device-a".to_string(),
                    deleted_at: "2020-01-01T00:00:00Z".to_string(),
                },
                SyncTombstoneData {
                    kind: "book".to_string(),
                    book_id: "fresh-book".to_string(),
                    annotation_id: None,
                    device_id: "device-a".to_string(),
                    deleted_at: chrono::Utc::now().to_rfc3339(),
                },
            ],
            ..SyncState::default()
        };

        assert_eq!(expired_book_tombstones(&state), vec!["expired-book"]);
    }
}

// ---------------------------------------------------------------------------
// Ticket 06: Session sync — whole-session objects, union merge so diverged
// branches both survive. API keys never leave the device (auth.json is not
// part of session files).
// ---------------------------------------------------------------------------

pub const SESSION_OBJECT_PREFIX: &str = "litera/sessions";

fn session_object_key(book_id: &str, session_id: &str) -> ObjectPath {
    ObjectPath::from(format!("{SESSION_OBJECT_PREFIX}/{book_id}/{session_id}.jsonl"))
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionSyncSummary {
    pub uploaded: u64,
    pub downloaded: u64,
    /// Sessions skipped because they could not be read or merged.
    pub skipped: u64,
    /// Deletions carried across: local deletions removed from the Sync
    /// Backend, plus sessions deleted here because another device did.
    pub deleted: u64,
}

/// Upload locally changed sessions, download remote changes, and merge both
/// sides (entry union by id, both branches kept). Deletions travel as absence:
/// a session this device synced before and no longer has is deleted from the
/// Sync Backend, and one gone from the Sync Backend is deleted here — each
/// only while the other side is unchanged since the last sync, so a
/// conversation continued anywhere outlives its deletion.
#[tauri::command]
pub async fn sync_sessions(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
) -> AppResult<SessionSyncSummary> {
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let object_store = crate::sync_config::build_sync_store(&config)?;
    sync_sessions_with(&root, store, &object_store).await
}

/// Store-generic core of [`sync_sessions`], testable against an in-memory
/// Sync Backend.
async fn sync_sessions_with(
    root: &Path,
    store: LibraryStore,
    object_store: &impl ObjectStore,
) -> AppResult<SessionSyncSummary> {
    use futures::TryStreamExt;

    let root = root.to_path_buf();
    // A snapshot for lookups only. sync-state.json is never written from it:
    // the network work below takes a while, and a deletion or annotation
    // save landing meanwhile must not be overwritten. Results are folded into
    // the freshest state at the end.
    let state_root = root.clone();
    let snapshot = run_sync_blocking(move || read_sync_state(&state_root)).await?;
    let mut revisions: std::collections::BTreeMap<String, SessionRevisionState> =
        std::collections::BTreeMap::new();
    let revision_of = |revisions: &std::collections::BTreeMap<String, SessionRevisionState>,
                       key: &str| {
        revisions
            .get(key)
            .or_else(|| snapshot.session_revisions.get(key))
            .cloned()
            .unwrap_or_default()
    };

    let mut summary = SessionSyncSummary::default();
    // Keys whose session is gone on both sides: forgotten at the end.
    let mut forgotten: Vec<String> = Vec::new();

    // Deletions only apply to books in the Library: a book in the Trash took
    // its Sessions along, and Restore must find them on the Sync Backend.
    let library = store.clone();
    let live_books: std::collections::HashSet<String> = run_sync_blocking(move || {
        let mut live: std::collections::HashSet<String> = library
            .read_library_public()?
            .books
            .into_iter()
            .map(|book| book.id)
            .collect();
        live.extend(library.list_placeholders()?.into_iter().map(|book| book.id));
        Ok(live)
    })
    .await?;
    let listing_root = root.clone();
    let local_before: std::collections::HashSet<String> = run_sync_blocking(move || {
        let store = crate::pi_sessions::PiSessionStore::new(listing_root)?;
        Ok(store
            .list_all_session_files()?
            .into_iter()
            .map(|file| format!("{}/{}", file.book_id, file.session_id))
            .collect())
    })
    .await?;
    let mut remote_keys = std::collections::HashSet::new();

    let remote_objects: Vec<object_store::ObjectMeta> = object_store
        .list(Some(&ObjectPath::from(SESSION_OBJECT_PREFIX)))
        .try_collect()
        .await
        .map_err(map_object_store_error)?;
    for object in remote_objects {
        let location = object.location.to_string();
        let Some(rest) = location.strip_prefix(&format!("{SESSION_OBJECT_PREFIX}/")) else {
            continue;
        };
        let Some((book_id, session_file)) = rest.split_once('/') else {
            continue;
        };
        let Some(session_id) = session_file.strip_suffix(".jsonl") else {
            continue;
        };
        if session_id.is_empty()
            || book_id.is_empty()
            || book_id.contains("..")
            || session_id.contains("..")
        {
            continue;
        }
        let key = format!("{book_id}/{session_id}");
        remote_keys.insert(key.clone());
        let mut entry = revision_of(&revisions, &key);
        if entry.failed_etag.is_some() && entry.failed_etag == object.e_tag {
            continue;
        }
        if entry.content_hash.is_some() && entry.seen_etag == object.e_tag {
            // Synced before, untouched remotely since, gone here: deleted
            // on this device. (A remote change instead revives it below.)
            if !local_before.contains(&key)
                && live_books.contains(book_id)
            {
                object_store
                    .delete(&object.location)
                    .await
                    .map_err(map_object_store_error)?;
                forgotten.push(key);
                summary.deleted += 1;
            }
            continue;
        }
        // Transport failures abort the pass (the backend is unreachable and
        // the next pass retries); a bad object is skipped below instead.
        let result = object_store
            .get(&object.location)
            .await
            .map_err(map_object_store_error)?;
        let bytes = result
            .bytes()
            .await
            .map_err(map_object_store_error)?;
        let remote_hash = crate::library::sha256_hex(&bytes);
        let merged = match String::from_utf8(bytes.to_vec()) {
            Ok(content) => {
                let merge_root = root.clone();
                let merge_book_id = book_id.to_string();
                run_sync_blocking(move || {
                    let store = crate::pi_sessions::PiSessionStore::new(merge_root)?;
                    store.merge_remote_session(&merge_book_id, &content)
                })
                .await
            }
            Err(_) => Err(AppError::storage_corrupt("Synced session is not valid UTF-8")),
        };
        match merged {
            Ok(local_has_extra) => {
                entry.seen_etag = object.e_tag.clone();
                entry.failed_etag = None;
                // Remote already holds everything: the merged local file
                // counts as uploaded. Otherwise record the remote's hash, so
                // the upload below sees a difference and pushes the union
                // back. (Comparing entries, not bytes, keeps two devices
                // whose files differ only in entry order from ping-ponging.)
                entry.content_hash = Some(if local_has_extra {
                    remote_hash
                } else {
                    // Unreadable now: fall back to forcing one re-upload.
                    local_session_hash(&root, book_id, session_id)
                        .await
                        .unwrap_or(remote_hash)
                });
                summary.downloaded += 1;
            }
            Err(error) => {
                // One unreadable or unmergeable session must not fail every
                // pass forever. Remember its etag so it is retried only once
                // it changes; the local copy (if any) still uploads below.
                entry.failed_etag = object.e_tag.clone();
                eprintln!("[sync] Skipping remote session {location}: {}", error.message);
                summary.skipped += 1;
            }
        }
        revisions.insert(key, entry);
    }

    // Gone from the Sync Backend: another device deleted the session.
    for (key, entry) in &snapshot.session_revisions {
        if remote_keys.contains(key) {
            continue;
        }
        let (Some((book_id, session_id)), Some(hash)) = (key.split_once('/'), entry.content_hash.clone())
        else {
            continue;
        };
        if !live_books.contains(book_id) {
            continue;
        }
        if !local_before.contains(key) {
            forgotten.push(key.clone());
            continue;
        }
        let delete_root = root.clone();
        let (book_id, session_id) = (book_id.to_string(), session_id.to_string());
        let deleted = run_sync_blocking(move || {
            let store = crate::pi_sessions::PiSessionStore::new(delete_root)?;
            store.delete_if_unchanged(&book_id, &session_id, &hash)
        })
        .await;
        match deleted {
            Ok(true) => {
                forgotten.push(key.clone());
                summary.deleted += 1;
            }
            // Changed here since: the upload below brings it back.
            Ok(false) => {}
            Err(error) => {
                eprintln!("[sync] Skipping remote deletion of {key}: {}", error.message);
                summary.skipped += 1;
            }
        }
    }

    let upload_root = root.clone();
    let local_files = run_sync_blocking(move || {
        let store = crate::pi_sessions::PiSessionStore::new(upload_root.clone())?;
        store.list_all_session_files()
    })
    .await?;
    for file in &local_files {
        let content = match fs::read_to_string(&file.path) {
            Ok(content) => content,
            Err(error) => {
                eprintln!(
                    "[sync] Skipping local session {}: {error}",
                    file.path.display()
                );
                summary.skipped += 1;
                continue;
            }
        };
        let hash = crate::library::sha256_hex(content.as_bytes());
        let key = format!("{}/{}", file.book_id, file.session_id);
        let mut entry = revision_of(&revisions, &key);
        if entry.content_hash.as_deref() == Some(hash.as_str()) {
            continue;
        }
        let result = object_store
            .put(
                &session_object_key(&file.book_id, &file.session_id),
                PutPayload::from(content.into_bytes()),
            )
            .await
            .map_err(map_object_store_error)?;
        entry.content_hash = Some(hash);
        entry.seen_etag = result.e_tag;
        revisions.insert(key, entry);
        summary.uploaded += 1;
    }

    // Expired book Tombstones release their objects — unless the book is
    // alive on this device after all (revived elsewhere), in which case the
    // Tombstone is simply dropped and the objects stay.
    let mut released = Vec::new();
    for book_id in expired_book_tombstones(&snapshot) {
        if live_books.contains(&book_id) {
            released.push(book_id);
            continue;
        }
        if purge_book_objects(object_store, &book_id).await.is_ok() {
            released.push(book_id);
        }
    }

    let write_root = root.clone();
    run_sync_blocking(move || {
        update_sync_state(&write_root, |state| {
            state.session_revisions.extend(revisions);
            for key in &forgotten {
                state.session_revisions.remove(key);
            }
            state.tombstones.retain(|tombstone| {
                !(tombstone.kind == "book"
                    && released.contains(&tombstone.book_id)
                    && !is_tombstone_active(tombstone))
            });
            Ok(())
        })
    })
    .await?;

    Ok(summary)
}

/// Hash of a session file as stored locally (after a merge wrote it).
async fn local_session_hash(root: &Path, book_id: &str, session_id: &str) -> AppResult<String> {
    let root = root.to_path_buf();
    let book_id = book_id.to_string();
    let session_id = session_id.to_string();
    run_sync_blocking(move || {
        let store = crate::pi_sessions::PiSessionStore::new(root)?;
        let file = store
            .list_all_session_files()?
            .into_iter()
            .find(|file| file.book_id == book_id && file.session_id == session_id)
            .ok_or_else(|| AppError::storage_io("Merged session file is missing"))?;
        let bytes = fs::read(&file.path).map_err(|error| {
            AppError::storage_io(format!("Failed to read merged session: {error}"))
        })?;
        Ok(crate::library::sha256_hex(&bytes))
    })
    .await
}

async fn purge_session_objects(
    object_store: &impl ObjectStore,
    book_id: &str,
) -> AppResult<()> {
    delete_prefix(
        object_store,
        &ObjectPath::from(format!("{SESSION_OBJECT_PREFIX}/{book_id}")),
    )
    .await
}

/// Delete every object under a Sync Backend prefix.
async fn delete_prefix(
    object_store: &impl ObjectStore,
    prefix: &ObjectPath,
) -> AppResult<()> {
    use futures::TryStreamExt;

    let objects: Vec<_> = object_store
        .list(Some(prefix))
        .try_collect()
        .await
        .map_err(map_object_store_error)?;
    for object in objects {
        object_store
            .delete(&object.location)
            .await
            .map_err(map_object_store_error)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Ticket 07: app preferences and LLM provider settings are per-device and
// never sync. The Manifest still carries their envelopes for older clients;
// newer clients pass them through untouched.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod preference_sync_tests {
    use super::*;

    fn envelope(updated_at: &str, data: serde_json::Value) -> SyncEnvelopeData {
        SyncEnvelopeData {
            updated_at: updated_at.to_string(),
            device_id: "device-b".to_string(),
            data,
        }
    }

    fn temp_library() -> (tempfile::TempDir, LibraryStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::initialize(dir.path().to_path_buf()).expect("store");
        (dir, store)
    }

    #[test]
    fn export_passes_an_older_clients_preferences_envelope_through() {
        let (_dir, store) = temp_library();
        let remote = envelope("2026-06-01T00:00:00Z", serde_json::json!({ "theme": "dark" }));
        let state = SyncState {
            device_id: "device-a".to_string(),
            preferences: Some(remote.clone()),
            ..SyncState::default()
        };

        let manifest = export_local_manifest(&store, &state).expect("export");

        // Untouched, so it never outranks what older clients wrote.
        assert_eq!(manifest.preferences, Some(remote));
    }

    #[test]
    fn export_passes_an_older_clients_provider_envelope_through() {
        let (_dir, store) = temp_library();
        let remote = envelope(
            "2026-06-01T00:00:00Z",
            serde_json::json!({ "settings": { "defaultModel": "claude" } }),
        );
        let state = SyncState {
            device_id: "device-a".to_string(),
            provider: Some(remote.clone()),
            ..SyncState::default()
        };

        let manifest = export_local_manifest(&store, &state).expect("export");

        assert_eq!(manifest.provider, Some(remote));
    }

    #[test]
    fn a_state_file_with_retired_timestamps_still_parses() {
        let state: SyncState = serde_json::from_str(
            r#"{"deviceId":"device-a","preferencesUpdatedAt":"2026-01-01T00:00:00Z","providerUpdatedAt":"2026-01-01T00:00:00Z"}"#,
        )
        .expect("parse");

        let json = serde_json::to_string(&state).expect("serialize");
        assert!(!json.contains("preferencesUpdatedAt"));
        assert!(!json.contains("providerUpdatedAt"));
    }
}

// ---------------------------------------------------------------------------
// Review fixes: state lock, revived Tombstones, session round trips, file
// revisions, rebased annotation saves.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod review_fix_tests {
    use super::*;
    use crate::library::{BookmarkRecord, HighlightRecord};
    use object_store::memory::InMemory;
    use serde_json::{json, Value};

    fn temp_store() -> (tempfile::TempDir, LibraryStore) {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::initialize(directory.path().to_path_buf()).expect("store");
        (directory, store)
    }

    fn highlight(id: &str, cfi: &str) -> HighlightRecord {
        HighlightRecord {
            id: id.to_string(),
            cfi: cfi.to_string(),
            excerpt: "text".to_string(),
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
            color: None,
            note: None,
            updated_at: None,
        }
    }

    fn annotations(highlights: Vec<HighlightRecord>) -> AnnotationsFile {
        AnnotationsFile {
            highlights,
            ..AnnotationsFile::empty()
        }
    }

    fn ids(file: &AnnotationsFile) -> Vec<String> {
        let mut ids: Vec<String> = file
            .highlights
            .iter()
            .map(|item| item.id.clone())
            .chain(file.bookmarks.iter().map(|item: &BookmarkRecord| item.id.clone()))
            .collect();
        ids.sort();
        ids
    }

    #[test]
    fn a_rebased_save_keeps_entries_synced_after_the_writer_loaded() {
        // The reader loaded h1 and h2; a Sync then added h3 on disk.
        let base = annotations(vec![highlight("h1", "epubcfi(/1)"), highlight("h2", "epubcfi(/2)")]);
        let current = annotations(vec![
            highlight("h1", "epubcfi(/1)"),
            highlight("h2", "epubcfi(/2)"),
            highlight("h3", "epubcfi(/3)"),
        ]);
        // The reader deletes h2 and adds h4.
        let next = annotations(vec![highlight("h1", "epubcfi(/1)"), highlight("h4", "epubcfi(/4)")]);

        let (stored, removed) = rebase_annotations(&current, &base, next);

        assert_eq!(removed, vec!["h2".to_string()]);
        assert_eq!(ids(&stored), vec!["h1", "h3", "h4"]);
    }

    #[test]
    fn a_rebased_save_lets_the_writer_win_a_contested_cfi() {
        let base = annotations(vec![]);
        let current = annotations(vec![highlight("remote", "epubcfi(/1)")]);
        let next = annotations(vec![highlight("local", "epubcfi(/1)")]);

        let (stored, removed) = rebase_annotations(&current, &base, next);

        assert!(removed.is_empty());
        assert_eq!(ids(&stored), vec!["local"]);
    }

    #[test]
    fn concurrent_state_writers_never_drop_each_others_tombstones() {
        let directory = tempfile::tempdir().expect("temp dir");
        let root = directory.path().to_path_buf();
        let threads: Vec<_> = (0..8)
            .map(|index| {
                let root = root.clone();
                std::thread::spawn(move || {
                    record_book_tombstone(&root, &format!("book{index}")).expect("record");
                })
            })
            .collect();
        for thread in threads {
            thread.join().expect("join");
        }

        let state = read_sync_state(&root).expect("state");
        assert_eq!(state.tombstones.len(), 8);
    }

    fn synced_book(book_updated_at: &str) -> SyncedBookData {
        SyncedBookData {
            metadata: SyncBookMetadata {
                title: "T".to_string(),
                author: String::new(),
                description: None,
                publisher: None,
                language: None,
                series: None,
                reading_status: None,
                status_updated_at: None,
                starred: None,
            },
            position: None,
            annotations: AnnotationsFile::empty(),
            annotations_updated_at: String::new(),
            file_revision: None,
            cover_revision: None,
            book_updated_at: book_updated_at.to_string(),
        }
    }

    fn book_tombstone(book_id: &str, deleted_at: &str) -> SyncTombstoneData {
        SyncTombstoneData {
            kind: "book".to_string(),
            book_id: book_id.to_string(),
            annotation_id: None,
            device_id: "device-b".to_string(),
            deleted_at: deleted_at.to_string(),
        }
    }

    #[test]
    fn a_tombstone_the_merge_revived_leaves_local_state_but_a_mid_sync_one_stays() {
        let mut merged = SyncManifestData::default();
        // Restored elsewhere after the deletion: a revival.
        merged
            .books
            .insert("revived".to_string(), synced_book("2026-06-02T00:00:00+00:00"));
        // Still in the merged books only because the export predates a
        // deletion made while the network round trip was in flight.
        merged
            .books
            .insert("deletedmidsync".to_string(), synced_book("2026-06-01T00:00:00+00:00"));
        let mut tombstones = vec![
            book_tombstone("revived", "2026-06-01T00:00:00+00:00"),
            book_tombstone("deletedmidsync", "2026-06-03T00:00:00+00:00"),
            book_tombstone("gone", "2026-06-01T00:00:00+00:00"),
        ];

        drop_revived_tombstones(&mut tombstones, &merged);

        let left: Vec<&str> = tombstones.iter().map(|t| t.book_id.as_str()).collect();
        assert_eq!(left, vec!["deletedmidsync", "gone"]);
    }

    #[test]
    fn importing_a_book_revokes_its_tombstone_and_stale_marker() {
        let directory = tempfile::tempdir().expect("temp dir");
        record_book_tombstone(directory.path(), "book1").expect("record");
        update_sync_state(directory.path(), |state| {
            state.stale_files.insert("book1".to_string());
            for key in ["book1/s1", "book2/s1"] {
                state
                    .session_revisions
                    .insert(key.to_string(), SessionRevisionState::default());
            }
            Ok(())
        })
        .expect("stale");

        note_book_imported(directory.path(), "book1").expect("imported");

        let state = read_sync_state(directory.path()).expect("state");
        assert!(state.tombstones.is_empty());
        assert!(state.stale_files.is_empty());
        // Its Sessions download again; other books' stay known.
        let keys: Vec<&str> = state.session_revisions.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["book2/s1"]);
    }

    #[test]
    fn changing_the_backend_forgets_what_the_old_one_held() {
        let directory = tempfile::tempdir().expect("temp dir");
        record_book_tombstone(directory.path(), "book1").expect("record");
        update_sync_state(directory.path(), |state| {
            state.bulk_upload_confirmed = true;
            state.last_etag = "etag".to_string();
            state.book_revisions.insert(
                "book1".to_string(),
                BookRevisionState { file_revision: Some("rev".to_string()), cover_revision: None },
            );
            state
                .session_revisions
                .insert("book1/s1".to_string(), SessionRevisionState::default());
            Ok(())
        })
        .expect("seed");

        note_sync_backend_changed(directory.path()).expect("changed");

        let state = read_sync_state(directory.path()).expect("state");
        assert!(state.book_revisions.is_empty());
        assert!(state.session_revisions.is_empty());
        assert!(!state.bulk_upload_confirmed);
        assert!(state.last_etag.is_empty());
        // Local deletions still have to reach the new backend.
        assert_eq!(state.tombstones.len(), 1);
    }

    #[test]
    fn an_empty_first_upload_counts_as_confirmed_so_later_imports_flow() {
        let (_dir, store) = temp_store();
        let mut state = SyncState::default();

        assert!(uploads_to_run(&store, &mut state).expect("run").is_empty());
        assert!(state.bulk_upload_confirmed);

        store
            .import_bytes(Path::new("/tmp/new.epub"), "new.epub".to_string(), b"new".to_vec())
            .expect("import");
        assert_eq!(uploads_to_run(&store, &mut state).expect("run").len(), 1);
    }

    #[test]
    fn an_existing_library_still_waits_for_confirmation() {
        let (_dir, store) = temp_store();
        store
            .import_bytes(Path::new("/tmp/old.epub"), "old.epub".to_string(), b"old".to_vec())
            .expect("import");
        let mut state = SyncState::default();

        assert!(uploads_to_run(&store, &mut state).expect("run").is_empty());
        assert!(!state.bulk_upload_confirmed);
    }

    fn imported(store: &LibraryStore, bytes: &[u8]) -> crate::library::BookRecord {
        let result = store
            .import_bytes(Path::new("/tmp/book.epub"), "book.epub".to_string(), bytes.to_vec())
            .expect("import");
        store
            .read_library_public()
            .expect("library")
            .books
            .into_iter()
            .find(|book| book.id == result.book_id)
            .expect("record")
    }

    #[test]
    fn a_newer_remote_file_marks_the_local_book_stale_and_is_not_reuploaded() {
        let (_dir, store) = temp_store();
        let book = imported(&store, b"version-one");
        let state = SyncState { device_id: "device-a".to_string(), ..SyncState::default() };
        let base = export_local_manifest(&store, &state).expect("export");
        let mut merged = base.clone();
        let synced = merged.books.get_mut(&book.id).expect("book");
        synced.file_revision = Some(crate::library::sha256_hex(b"version-two"));
        synced.book_updated_at = "2999-01-01T00:00:00+00:00".to_string();

        let stale = apply_merged_manifest(&store, &merged, &base).expect("apply");
        assert_eq!(stale, vec![book.id.clone()]);

        let state = SyncState {
            bulk_upload_confirmed: true,
            stale_files: stale.into_iter().collect(),
            ..SyncState::default()
        };
        assert!(pending_uploads(&store, &state).expect("pending").is_empty());

        store
            .replace_synced_book_file(&book.id, b"version-two")
            .expect("replace");
        let replaced = store
            .read_library_public()
            .expect("library")
            .books
            .into_iter()
            .find(|record| record.id == book.id)
            .expect("record");
        assert_eq!(
            replaced.content_hash,
            Some(crate::library::sha256_hex(b"version-two"))
        );
        assert_ne!(replaced.content_version, book.content_version);
    }

    #[test]
    fn an_older_remote_revision_does_not_mark_a_fresh_local_import_stale() {
        let (_dir, store) = temp_store();
        let book = imported(&store, b"version-one");
        let state = SyncState::default();
        let base = export_local_manifest(&store, &state).expect("export");
        let mut merged = base.clone();
        merged.books.get_mut(&book.id).expect("book").file_revision =
            Some(crate::library::sha256_hex(b"version-zero"));

        let stale = apply_merged_manifest(&store, &merged, &base).expect("apply");
        assert!(stale.is_empty());
    }

    #[test]
    fn opening_a_book_does_not_age_its_position_for_sync() {
        let (_dir, store) = temp_store();
        let book = imported(&store, b"position");
        store
            .update_reading_state(&book.id, Some(0.1), None, None, None, Some("epubcfi(/1)".into()))
            .expect("move");
        let state = SyncState::default();
        let before = export_local_manifest(&store, &state).expect("export");
        let moved_at = before.books[&book.id].position.clone().expect("position").updated_at;

        // Opening and re-reporting the same position is not progress.
        store.mark_book_opened(&book.id).expect("open");
        store
            .update_reading_state(&book.id, Some(0.1), None, None, None, Some("epubcfi(/1)".into()))
            .expect("same position");
        let after = export_local_manifest(&store, &state).expect("export");
        assert_eq!(after.books[&book.id].position.clone().expect("position").updated_at, moved_at);

        // A real move is.
        store
            .update_reading_state(&book.id, Some(0.2), None, None, None, Some("epubcfi(/2)".into()))
            .expect("move again");
        let moved = export_local_manifest(&store, &state).expect("export");
        assert!(moved.books[&book.id].position.clone().expect("position").updated_at > moved_at);
    }

    // -- Sessions against an in-memory Sync Backend --------------------------

    struct Device {
        _dir: tempfile::TempDir,
        root: PathBuf,
        store: LibraryStore,
        sessions: crate::pi_sessions::PiSessionStore,
    }

    fn device() -> Device {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path().to_path_buf();
        let store = LibraryStore::initialize(root.clone()).expect("store");
        let sessions = crate::pi_sessions::PiSessionStore::new(root.clone()).expect("sessions");
        Device { _dir: dir, root, store, sessions }
    }

    fn message(id: &str, parent: Option<&str>) -> Value {
        json!({
            "type": "message",
            "id": id,
            "parentId": parent,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "message": {"role": "user", "content": id, "timestamp": 1},
        })
    }

    async fn sync(device: &Device, remote: &InMemory) -> SessionSyncSummary {
        sync_sessions_with(&device.root, device.store.clone(), remote)
            .await
            .expect("sync sessions")
    }

    async fn remote_entry_ids(remote: &InMemory, book: &str, session: &str) -> Vec<String> {
        let bytes = remote
            .get(&session_object_key(book, session))
            .await
            .expect("get")
            .bytes()
            .await
            .expect("bytes");
        let mut ids: Vec<String> = String::from_utf8(bytes.to_vec())
            .expect("utf8")
            .lines()
            .skip(1)
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter_map(|entry| entry["id"].as_str().map(str::to_string))
            .collect();
        ids.sort();
        ids
    }

    fn session_id(device: &Device) -> String {
        device.sessions.list_all_session_files().expect("files")[0]
            .session_id
            .clone()
    }

    #[test]
    fn diverged_sessions_converge_on_the_backend_without_ping_pong() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            let a = device();
            let b = device();
            a.sessions.create("book1").expect("create");
            let id = session_id(&a);
            a.sessions
                .append("book1", &id, None, vec![message("shared01", None)])
                .expect("append");
            sync(&a, &remote).await;
            assert_eq!(sync(&b, &remote).await.downloaded, 1);

            // Both devices continue the conversation independently.
            b.sessions
                .append("book1", &id, Some("shared01"), vec![message("fromb001", Some("shared01"))])
                .expect("append b");
            a.sessions
                .append("book1", &id, Some("shared01"), vec![message("froma001", Some("shared01"))])
                .expect("append a");
            sync(&b, &remote).await;
            // A merges B's entries and must push its own back.
            let summary = sync(&a, &remote).await;
            assert_eq!(summary.uploaded, 1);
            assert_eq!(
                remote_entry_ids(&remote, "book1", &id).await,
                vec!["froma001", "fromb001", "shared01"]
            );

            // Converged: further passes on either side move nothing.
            sync(&b, &remote).await;
            let quiet_a = sync(&a, &remote).await;
            let quiet_b = sync(&b, &remote).await;
            assert_eq!((quiet_a.uploaded, quiet_b.uploaded), (0, 0));
        });
    }

    #[test]
    fn a_corrupt_remote_session_is_skipped_instead_of_failing_every_pass() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            remote
                .put(&session_object_key("book1", "broken"), PutPayload::from(vec![0xff, 0xfe]))
                .await
                .expect("seed");
            let a = device();

            assert_eq!(sync(&a, &remote).await.skipped, 1);
            // Not retried until the object changes.
            assert_eq!(sync(&a, &remote).await.skipped, 0);
        });
    }

    #[test]
    fn an_expired_tombstone_never_purges_a_book_that_is_alive_here() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            let a = device();
            let live = imported(&a.store, b"alive");
            for book_id in [live.id.as_str(), "gonebook"] {
                remote
                    .put(&epub_object_key(book_id, "rev"), PutPayload::from(b"epub".to_vec()))
                    .await
                    .expect("seed");
            }
            update_sync_state(&a.root, |state| {
                state.tombstones = vec![
                    book_tombstone(&live.id, "2020-01-01T00:00:00+00:00"),
                    book_tombstone("gonebook", "2020-01-01T00:00:00+00:00"),
                ];
                Ok(())
            })
            .expect("seed state");

            sync(&a, &remote).await;

            assert!(remote.head(&epub_object_key(&live.id, "rev")).await.is_ok());
            assert!(remote.head(&epub_object_key("gonebook", "rev")).await.is_err());
            assert!(read_sync_state(&a.root).expect("state").tombstones.is_empty());
        });
    }

    /// Two devices sharing one live book and one synced session on it.
    async fn shared_session(remote: &InMemory) -> (Device, Device, String, String) {
        let a = device();
        let b = device();
        let book = imported(&a.store, b"shared").id;
        assert_eq!(imported(&b.store, b"shared").id, book);
        a.sessions.create(&book).expect("create");
        let id = session_id(&a);
        a.sessions
            .append(&book, &id, None, vec![message("first001", None)])
            .expect("append");
        sync(&a, remote).await;
        assert_eq!(sync(&b, remote).await.downloaded, 1);
        (a, b, book, id)
    }

    fn has_session(device: &Device, session: &str) -> bool {
        device
            .sessions
            .list_all_session_files()
            .expect("files")
            .iter()
            .any(|file| file.session_id == session)
    }

    #[test]
    fn a_session_deleted_on_one_device_is_deleted_everywhere() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            let (a, b, book, id) = shared_session(&remote).await;

            a.sessions.delete(&book, &id).expect("delete");
            assert_eq!(sync(&a, &remote).await.deleted, 1);
            assert!(remote.head(&session_object_key(&book, &id)).await.is_err());

            assert_eq!(sync(&b, &remote).await.deleted, 1);
            assert!(!has_session(&b, &id));

            // Settled: nothing comes back on either side.
            let quiet_a = sync(&a, &remote).await;
            let quiet_b = sync(&b, &remote).await;
            assert_eq!((quiet_a.deleted, quiet_b.deleted, quiet_a.uploaded, quiet_b.uploaded), (0, 0, 0, 0));
            assert!(!has_session(&a, &id));
        });
    }

    #[test]
    fn a_session_continued_elsewhere_survives_its_deletion() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            let (a, b, book, id) = shared_session(&remote).await;

            a.sessions.delete(&book, &id).expect("delete");
            sync(&a, &remote).await;
            // B kept talking before it learned of the deletion: its edit wins.
            b.sessions
                .append(&book, &id, Some("first001"), vec![message("later001", Some("first001"))])
                .expect("append b");
            let summary = sync(&b, &remote).await;
            assert_eq!((summary.deleted, summary.uploaded), (0, 1));

            sync(&a, &remote).await;
            assert!(has_session(&a, &id));
        });
    }

    #[test]
    fn a_remote_change_revives_a_session_deleted_here() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            let (a, b, book, id) = shared_session(&remote).await;

            b.sessions
                .append(&book, &id, Some("first001"), vec![message("later001", Some("first001"))])
                .expect("append b");
            sync(&b, &remote).await;
            a.sessions.delete(&book, &id).expect("delete");
            sync(&a, &remote).await;

            assert!(has_session(&a, &id));
            assert!(remote.head(&session_object_key(&book, &id)).await.is_ok());
        });
    }

    #[test]
    fn sessions_of_a_book_missing_here_are_never_deleted_remotely() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            let a = device();
            // "book1" is not in the Library (say, in the Trash with its Sessions).
            a.sessions.create("book1").expect("create");
            let id = session_id(&a);
            sync(&a, &remote).await;
            a.sessions.delete("book1", &id).expect("delete");

            assert_eq!(sync(&a, &remote).await.deleted, 0);
            assert!(remote.head(&session_object_key("book1", &id)).await.is_ok());
        });
    }

    #[test]
    fn a_session_an_older_version_failed_to_merge_is_retried() {
        tauri::async_runtime::block_on(async {
            let remote = InMemory::new();
            let (a, b, book, _) = shared_session(&remote).await;
            a.sessions.create(&book).expect("create second");
            let second = a
                .sessions
                .list_all_session_files()
                .expect("files")
                .into_iter()
                .map(|file| file.session_id)
                .find(|id| has_session(&a, id) && !has_session(&b, id))
                .expect("second session");
            sync(&a, &remote).await;
            // What an older version left behind after failing to merge it:
            // the etag remembered, nothing merged.
            let etag = remote
                .head(&session_object_key(&book, &second))
                .await
                .expect("head")
                .e_tag;
            update_sync_state(&b.root, |state| {
                state.session_revisions.insert(
                    format!("{book}/{second}"),
                    SessionRevisionState { seen_etag: etag.clone(), ..Default::default() },
                );
                Ok(())
            })
            .expect("seed state");

            assert_eq!(sync(&b, &remote).await.downloaded, 1);
            assert!(has_session(&b, &second));
        });
    }
}
