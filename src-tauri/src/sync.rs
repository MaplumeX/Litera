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

/// Pre-dates every real edit timestamp; used as the baseline for envelopes
/// recorded when Sync is first enabled on a device.
const EPOCH_BASELINE: &str = "1970-01-01T00:00:00+00:00";

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

fn upsert_tombstones(root: &Path, additions: Vec<SyncTombstoneData>) -> AppResult<()> {
    if additions.is_empty() {
        return Ok(());
    }
    let mut state = read_sync_state(root)?;
    for addition in additions {
        state.tombstones.retain(|existing| {
            tombstone_key(existing) != tombstone_key(&addition)
        });
        state.tombstones.push(addition);
    }
    // Opportunistic purge: expired tombstones never resurrect anything and
    // need not linger in local state.
    state.tombstones.retain(is_tombstone_active);
    write_sync_state(root, &state)
}

/// Record that a book was deleted locally, so other devices learn of the
/// deletion instead of resurrecting the book from their own copies.
pub fn record_book_tombstone(root: &Path, book_id: &str) -> AppResult<()> {
    validate_sync_id(book_id)?;
    let device_id = read_sync_state(root)?.device_id;
    upsert_tombstones(
        root,
        vec![SyncTombstoneData {
            kind: "book".to_string(),
            book_id: book_id.to_string(),
            annotation_id: None,
            device_id,
            deleted_at: chrono::Utc::now().to_rfc3339(),
        }],
    )
}

/// Record an annotations save: bump the book's annotationsUpdatedAt and
/// remember removed ids as Tombstones.
pub fn note_annotations_saved(root: &Path, book_id: &str, removed_ids: &[String]) -> AppResult<()> {
    validate_sync_id(book_id)?;
    let device_id = read_sync_state(root)?.device_id;
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
    upsert_tombstones(root, additions)?;
    let mut state = read_sync_state(root)?;
    state
        .annotations_updated_at
        .insert(book_id.to_string(), now);
    write_sync_state(root, &state)
}

/// A local preferences edit: marks the local envelope as newest for the merge.
pub fn note_preferences_saved(root: &Path) -> AppResult<()> {
    let mut state = read_sync_state(root)?;
    state.preferences_updated_at = Some(chrono::Utc::now().to_rfc3339());
    write_sync_state(root, &state)
}

/// A local provider-settings edit: marks the local envelope as newest.
pub fn note_provider_saved(root: &Path) -> AppResult<()> {
    let mut state = read_sync_state(root)?;
    state.provider_updated_at = Some(chrono::Utc::now().to_rfc3339());
    write_sync_state(root, &state)
}

/// Sync being enabled for the first time: the current local preferences and
/// provider settings become this device's baseline (timestamps, only when
/// the device has never recorded an edit).
pub fn note_sync_enabled(root: &Path) -> AppResult<()> {
    let mut state = read_sync_state(root)?;
    // Epoch baseline, not "now": a device enabling Sync for the first time
    // must lose merges against any envelope another device actually edited,
    // so the new device feels pre-configured rather than clobbering the
    // backend with its untouched defaults.
    let epoch = EPOCH_BASELINE.to_string();
    if state.preferences_updated_at.is_none() {
        state.preferences_updated_at = Some(epoch.clone());
    }
    if state.provider_updated_at.is_none() {
        state.provider_updated_at = Some(epoch);
    }
    write_sync_state(root, &state)
}

fn validate_sync_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(AppError::invalid_input("Invalid sync id"));
    }
    Ok(())
}

/// Export the local Library (books metadata, positions, annotations) as a
/// Manifest. Local-only view: tombstones and preferences are managed by the
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
        };
        let position = match (&book.last_fraction, &book.last_cfi) {
            (Some(fraction), Some(cfi)) => Some(SyncPositionData {
                // The reading state carries no timestamp of its own; the
                // last-opened time is the closest recorded signal. Books
                // never opened have no position at all.
                updated_at: book.last_opened_at.clone().unwrap_or_default(),
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
            },
        );
    }
    Ok(manifest)
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
pub fn apply_merged_manifest(
    store: &LibraryStore,
    merged: &SyncManifestData,
    base: &SyncManifestData,
) -> AppResult<()> {
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
            // Only take the merged position when the book has not moved on
            // locally since the pass started. last_opened_at is the explicit
            // recorded timestamp the export used as the position's updatedAt;
            // a mismatch means a local page turn raced this sync pass and its
            // next export re-asserts the newer position.
            let base_position = base
                .books
                .get(book_id)
                .and_then(|book| book.position.as_ref());
            let unchanged_since_export = match base_position {
                Some(position) => record.last_opened_at.as_deref() == Some(position.updated_at.as_str()),
                None => record.last_opened_at.is_none(),
            };
            if unchanged_since_export {
                if let Some(position) = &synced.position {
                    record.last_fraction = Some(position.fraction);
                    record.last_cfi = Some(position.cfi.clone());
                    record.last_opened_at = Some(position.updated_at.clone());
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
    Ok(())
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
            )
            .expect("save placeholder");

        let placeholders = store.list_placeholders().expect("list placeholders");
        assert_eq!(placeholders.len(), 1);
        assert_eq!(placeholders[0].id, "remotebook1");
        assert_eq!(placeholders[0].title, "Remote Book");
        assert_eq!(placeholders[0].last_fraction, Some(0.25));
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

    fn synced_book(title: &str, fraction: f64, cfi: &str) -> SyncedBookData {
        SyncedBookData {
            metadata: SyncBookMetadata {
                title: title.to_string(),
                author: "Author".to_string(),
                description: None,
                publisher: None,
                language: None,
                series: None,
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

pub const MANIFEST_MAX_RETRIES: usize = 3;

fn manifest_path() -> ObjectPath {
    ObjectPath::from(MANIFEST_OBJECT_KEY)
}

/// Download the remote Manifest plus its etag, for merging and the
/// subsequent conditional upload.
pub async fn download_manifest(
    config: &crate::sync_config::SyncBackendConfig,
) -> AppResult<DownloadedManifest> {
    let store = crate::sync_config::build_sync_store(config)?;
    let result = store
        .get(&manifest_path())
        .await
        .map_err(map_object_store_error)?;
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
    let bytes = serde_json::to_vec(manifest).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize manifest: {error}"))
    })?;
    let version = UpdateVersion {
        e_tag: Some(etag.to_string()),
        version: None,
    };
    let options = PutOptions::from(PutMode::Update(version));
    store
        .put_opts(&manifest_path(), PutPayload::from(bytes), options)
        .await
        .map_err(map_object_store_error)?;
    Ok(())
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
/// last saw for the session object.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionRevisionState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen_etag: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncState {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// Local manifest overlay: tombstones and preferences the TS merge
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
    /// Explicit recorded timestamps of the last local preferences / provider
    /// edits (never file mtimes): the merge orders envelopes by these.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferences_updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_updated_at: Option<String>,
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

pub fn write_sync_state(root: &Path, state: &SyncState) -> AppResult<()> {
    let json = serde_json::to_vec_pretty(state).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize sync-state.json: {error}"))
    })?;
    crate::library::atomic_write(&sync_state_path(root), &json, "sync-state.json")
}

/// The provider envelope covers agent/settings.json and agent/models.json
/// (provider choice, model, custom providers) — never auth.json, so API
/// keys stay per-device.
fn read_agent_object(root: &Path, file: &str) -> serde_json::Value {
    match fs::read(root.join("agent").join(file)) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

fn build_preferences_envelope(
    preferences_store: &crate::preferences::PreferencesStore,
    state: &mut SyncState,
    locale: Option<&str>,
) -> AppResult<Option<SyncEnvelopeData>> {
    let response = preferences_store.get()?;
    let mut data = serde_json::to_value(&response)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize preferences: {error}")))?;
    if let Some(language) = locale {
        if let Some(last) = &state.preferences {
            let changed = last
                .data
                .get("language")
                .and_then(|value| value.as_str())
                != Some(language);
            if changed {
                state.preferences_updated_at = Some(chrono::Utc::now().to_rfc3339());
            }
        }
        data.as_object_mut()
            .expect("preferences response serializes to an object")
            .insert("language".to_string(), serde_json::Value::String(language.to_string()));
    }
    Ok(state
        .preferences_updated_at
        .as_ref()
        .map(|updated_at| SyncEnvelopeData {
            updated_at: updated_at.clone(),
            device_id: state.device_id.clone(),
            data,
        }))
}

fn build_provider_envelope(root: &Path, state: &SyncState) -> Option<SyncEnvelopeData> {
    state.provider_updated_at.as_ref().map(|updated_at| {
        SyncEnvelopeData {
            updated_at: updated_at.clone(),
            device_id: state.device_id.clone(),
            data: serde_json::json!({
                "settings": read_agent_object(root, "settings.json"),
                "models": read_agent_object(root, "models.json"),
            }),
        }
    })
}

#[tauri::command]
pub async fn sync_export_local_manifest(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    preferences: tauri::State<'_, crate::preferences::PreferencesStore>,
    locale: Option<String>,
) -> AppResult<serde_json::Value> {
    let store = store.inner().clone();
    let preferences = preferences.inner().clone();
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        let mut state = read_sync_state(&root)?;
        let mut manifest = export_local_manifest(&store, &state)?;
        manifest.preferences =
            build_preferences_envelope(&preferences, &mut state, locale.as_deref())?;
        manifest.provider = build_provider_envelope(&root, &state);
        write_sync_state(&root, &state)?;
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
    Ok(serde_json::to_value(downloaded)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize: {error}")))?)
}

fn write_agent_object(root: &Path, file: &str, value: &serde_json::Value) -> AppResult<()> {
    if value.is_null() {
        return Ok(());
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize agent {file}: {error}"))
    })?;
    let agent_dir = root.join("agent");
    fs::create_dir_all(&agent_dir).map_err(|error| {
        AppError::storage_io(format!("Failed to create agent directory: {error}"))
    })?;
    crate::library::atomic_write(&agent_dir.join(file), &bytes, file)
}

/// Apply a merged envelope when it is strictly newer than any local edit:
/// protects a local change made while the network round trip was in flight.
fn envelope_is_newer(envelope: &SyncEnvelopeData, local_dirty: Option<&String>) -> bool {
    match local_dirty {
        Some(dirty) => envelope.updated_at > *dirty,
        None => true,
    }
}

/// Apply the merged preferences and provider envelopes to local storage.
/// Writes happen only when the merged envelope is strictly newer than any
/// local edit (mid-sync local changes win and re-propagate next pass);
/// auth.json is never touched, so API keys stay per-device.
pub fn apply_preference_envelopes(
    root: &Path,
    preferences: &crate::preferences::PreferencesStore,
    state: &mut SyncState,
    manifest: &SyncManifestData,
) -> AppResult<()> {
    if let Some(envelope) = &manifest.preferences {
        let is_newer = envelope_is_newer(envelope, state.preferences_updated_at.as_ref());
        if state.preferences.as_ref() != Some(envelope) && is_newer {
            // Language is frontend-owned (localStorage); the rest is the
            // stored preferences record.
            let mut data = envelope.data.clone();
            if let Some(object) = data.as_object_mut() {
                object.remove("language");
            }
            let patch: crate::preferences::PreferencesPatch =
                serde_json::from_value(data).map_err(|error| {
                    AppError::storage_corrupt(format!("Synced preferences are invalid: {error}"))
                })?;
            preferences.apply_synced(patch)?;
        }
        state.preferences = Some(envelope.clone());
        if is_newer {
            state.preferences_updated_at = Some(envelope.updated_at.clone());
        }
    }

    if let Some(envelope) = &manifest.provider {
        let is_newer = envelope_is_newer(envelope, state.provider_updated_at.as_ref());
        if state.provider.as_ref() != Some(envelope) && is_newer {
            if let Some(settings) = envelope.data.get("settings") {
                write_agent_object(root, "settings.json", settings)?;
            }
            if let Some(models) = envelope.data.get("models") {
                write_agent_object(root, "models.json", models)?;
            }
        }
        state.provider = Some(envelope.clone());
        if is_newer {
            state.provider_updated_at = Some(envelope.updated_at.clone());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_apply_merged_manifest(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    preferences: tauri::State<'_, crate::preferences::PreferencesStore>,
    manifest: SyncManifestData,
    base: SyncManifestData,
    etag: String,
) -> AppResult<()> {
    let store = store.inner().clone();
    let preferences = preferences.inner().clone();
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        let mut state = read_sync_state(&root)?;
        apply_merged_manifest(&store, &manifest, &base)?;

        apply_preference_envelopes(&root, &preferences, &mut state, &manifest)?;
        // Deletions recorded while the network round trip was in flight must
        // survive: union by tombstone key with the newest deletedAt winning.
        // Expired book Tombstones are retained until their objects are purged.
        state.tombstones = merge_local_tombstones(state.tombstones.clone(), manifest.tombstones.clone());
        state.preferences = manifest.preferences.clone();
        state.provider = manifest.provider.clone();
        state.last_etag = etag;
        state.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
        for (book_id, synced) in &manifest.books {
            state
                .annotations_updated_at
                .insert(book_id.clone(), synced.annotations_updated_at.clone());
            let entry = state.book_revisions.entry(book_id.clone()).or_default();
            if let Some(revision) = &synced.file_revision {
                entry.file_revision = Some(revision.clone());
            }
            if let Some(revision) = &synced.cover_revision {
                entry.cover_revision = Some(revision.clone());
            }
        }
        write_sync_state(&root, &state)
    })
    .await
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
        let mut state = read_sync_state(&root)?;
        if success {
            state.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
            state.last_error = None;
        } else {
            state.last_error = error;
        }
        write_sync_state(&root, &state)
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
        }
    }

    fn bookmark(id: &str, created_at: &str) -> BookmarkRecord {
        BookmarkRecord {
            id: id.to_string(),
            cfi: "epubcfi(/4)".to_string(),
            fraction: 0.5,
            created_at: created_at.to_string(),
            label: None,
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
            .save_placeholder("remotebook1", "Remote Book", "Author", None, None)
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
                    },
                    position: None,
                    annotations: base_annotations,
                    annotations_updated_at: String::new(),
                    file_revision: None,
                    cover_revision: None,
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
    object_store: &object_store::aws::AmazonS3,
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
        let mut state = read_sync_state(&root)?;
        state.bulk_upload_confirmed = true;
        write_sync_state(&root, &state)
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
        let state = read_sync_state(&state_root)?;
        let pending = pending_uploads(&store, &state)?;
        // The first bulk upload of an existing library happens only after the
        // user confirmed the estimate; afterwards new imports flow automatically.
        // The first bulk upload happens only after the user confirmed the
        // estimate; until then automatic syncs silently skip file uploads
        // (the Manifest still converges).
        if !state.bulk_upload_confirmed && !pending.is_empty() {
            return Ok((Vec::new(), state.book_revisions.clone()));
        }
        Ok((pending, state.book_revisions.clone()))
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
        let mut state = read_sync_state(&root_for_write)?;
        for (book_id, entry) in revisions {
            state.book_revisions.insert(book_id, entry);
        }
        write_sync_state(&root_for_write, &state)
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
    // A book that is already local needs nothing — callers invoke this on
    // every open, and for cached books it must stay a cheap no-op.
    let store = store.inner().clone();
    let already_local = run_sync_blocking({
        let store = store.clone();
        let book_id = book_id.clone();
        move || {
            Ok(store
                .read_library_public()?
                .books
                .iter()
                .any(|book| book.id == book_id))
        }
    })
    .await?;
    if already_local {
        return Ok(());
    }

    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let state = read_sync_state(&root)?;
    let revision = state
        .book_revisions
        .get(&book_id)
        .and_then(|entry| entry.file_revision.clone())
        .ok_or_else(|| {
            AppError::invalid_input("Book file is not available on the sync backend")
        })?;

    let object_store = crate::sync_config::build_sync_store(&config)?;
    let result = object_store
        .get(&epub_object_key(&book_id, &revision))
        .await
        .map_err(map_object_store_error)?;
    let bytes = result
        .bytes()
        .await
        .map_err(map_object_store_error)?;

    run_sync_blocking(move || store.install_synced_book(&book_id, bytes.to_vec())).await
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
            .save_placeholder("remotebook1", "Remote Book", "Author", Some(0.25), None)
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
}

/// Upload locally changed sessions, download remote changes, and merge both
/// sides (entry union by id, both branches kept).
#[tauri::command]
pub async fn sync_sessions(app: tauri::AppHandle) -> AppResult<SessionSyncSummary> {
    use futures::TryStreamExt;

    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let object_store = crate::sync_config::build_sync_store(&config)?;

    let state_root = root.clone();
    let (local_files, mut state) = run_sync_blocking(move || {
        let store = crate::pi_sessions::PiSessionStore::new(state_root.clone())?;
        let files = store.list_all_session_files()?;
        let state = read_sync_state(&state_root)?;
        Ok((files, state))
    })
    .await?;

    let mut summary = SessionSyncSummary::default();

    // 1. Download remote sessions we have not yet seen (etag moved or new)
    // and merge them locally BEFORE any upload: a PUT must never overwrite a
    // remote copy without first unioning with it, or another device's
    // diverged branch would exist only on that device until it syncs again.
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
        let entry = state.session_revisions.entry(key).or_default();
        if entry.seen_etag.is_some() && entry.seen_etag == object.e_tag {
            continue;
        }
        let result = object_store
            .get(&object.location)
            .await
            .map_err(map_object_store_error)?;
        let bytes = result
            .bytes()
            .await
            .map_err(map_object_store_error)?;
        let content = String::from_utf8(bytes.to_vec()).map_err(|_| {
            AppError::storage_corrupt("Synced session is not valid UTF-8")
        })?;
        let merge_root = root.clone();
        let merge_book_id = book_id.to_string();
        let merged = run_sync_blocking(move || {
            let store = crate::pi_sessions::PiSessionStore::new(merge_root)?;
            store.merge_remote_session(&merge_book_id, &content)
        })
        .await?;
        entry.seen_etag = object.e_tag.clone();
        entry.content_hash = Some(crate::library::sha256_hex(merged.as_bytes()));
        summary.downloaded += 1;
    }

    // 2. Upload sessions whose content changed since the last upload (the
    // downloads above may have merged remote branches in, growing content).
    let upload_root = root.clone();
    let local_files = run_sync_blocking(move || {
        let store = crate::pi_sessions::PiSessionStore::new(upload_root.clone())?;
        store.list_all_session_files()
    })
    .await?;
    for file in &local_files {
        let content = fs::read_to_string(&file.path).map_err(|error| {
            AppError::storage_io(format!("Failed to read session for upload: {error}"))
        })?;
        let hash = crate::library::sha256_hex(content.as_bytes());
        let key = format!("{}/{}", file.book_id, file.session_id);
        let entry = state.session_revisions.entry(key).or_default();
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
        summary.uploaded += 1;
    }

    // 3. Opportunistic cleanup: expired Tombstones release their book file
    // and session objects on the Sync Backend; once purged, the Tombstone
    // itself is dropped from local state.
    for book_id in expired_book_tombstones(&state) {
        if purge_book_objects(&object_store, &book_id).await.is_ok() {
            state
                .tombstones
                .retain(|tombstone| tombstone_key(tombstone) != format!("book:{book_id}"));
        }
    }

    let write_root = root.clone();
    run_sync_blocking(move || write_sync_state(&write_root, &state)).await?;

    Ok(summary)
}

/// Delete every object stored under a book's session prefix: the 30-day
/// Tombstone retention has elapsed.
async fn purge_session_objects(
    object_store: &object_store::aws::AmazonS3,
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
    object_store: &object_store::aws::AmazonS3,
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
// Ticket 07: preferences and provider settings sync via the Manifest.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod preference_sync_tests {
    use super::*;

    fn temp() -> (tempfile::TempDir, crate::preferences::PreferencesStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = crate::preferences::PreferencesStore::initialize(dir.path().to_path_buf())
            .expect("preferences store");
        (dir, store)
    }

    fn envelope(updated_at: &str, data: serde_json::Value) -> SyncEnvelopeData {
        SyncEnvelopeData {
            updated_at: updated_at.to_string(),
            device_id: "device-b".to_string(),
            data,
        }
    }

    #[test]
    fn local_edits_bump_the_dirty_timestamp() {
        let dir = tempfile::tempdir().expect("temp dir");

        note_preferences_saved(dir.path()).expect("note");
        note_provider_saved(dir.path()).expect("note");

        let state = read_sync_state(dir.path()).expect("state");
        assert!(state.preferences_updated_at.is_some());
        assert!(state.provider_updated_at.is_some());
    }

    #[test]
    fn the_enable_baseline_loses_to_any_real_envelope() {
        let dir = tempfile::tempdir().expect("temp dir");

        note_sync_enabled(dir.path()).expect("enable");
        let state = read_sync_state(dir.path()).expect("state");

        // The baseline predates every real edit, so an envelope another
        // device actually saved wins the merge and applies locally.
        let remote = envelope("2026-01-01T00:00:00Z", serde_json::json!({ "theme": "dark" }));
        let baseline = state.preferences_updated_at.expect("baseline");
        assert!(envelope_is_newer(&remote, Some(&baseline)));
    }

    #[test]
    fn enabling_sync_baselines_only_missing_timestamps() {
        let dir = tempfile::tempdir().expect("temp dir");
        note_preferences_saved(dir.path()).expect("existing edit");
        let before = read_sync_state(dir.path()).expect("state").preferences_updated_at;

        note_sync_enabled(dir.path()).expect("enable");

        let state = read_sync_state(dir.path()).expect("state");
        assert_eq!(state.preferences_updated_at, before);
        assert!(state.provider_updated_at.is_some());
    }

    #[test]
    fn a_newer_synced_envelope_rewrites_local_preferences() {
        let (dir, preferences) = temp();

        let manifest = SyncManifestData {
            schema_version: 1,
            books: Default::default(),
            tombstones: Vec::new(),
            preferences: Some(envelope(
                "2026-06-01T00:00:00Z",
                serde_json::json!({ "theme": "dark", "fontSize": 18.0, "language": "zh-CN" }),
            )),
            provider: None,
        };
        let mut state = SyncState {
            preferences_updated_at: Some("2026-01-01T00:00:00Z".to_string()),
            ..SyncState::default()
        };

        apply_preference_envelopes(dir.path(), &preferences, &mut state, &manifest)
            .expect("apply");

        let response = preferences.get().expect("preferences");
        assert_eq!(response.theme, "dark");
        assert_eq!(response.font_size, 18.0);
        assert_eq!(
            state.preferences_updated_at.as_deref(),
            Some("2026-06-01T00:00:00Z")
        );
    }

    #[test]
    fn a_local_edit_newer_than_the_envelope_wins() {
        let (dir, preferences) = temp();

        let manifest = SyncManifestData {
            schema_version: 1,
            books: Default::default(),
            tombstones: Vec::new(),
            preferences: Some(envelope(
                "2026-01-01T00:00:00Z",
                serde_json::json!({ "theme": "dark" }),
            )),
            provider: None,
        };
        let mut state = SyncState {
            preferences_updated_at: Some("2026-06-01T00:00:00Z".to_string()),
            ..SyncState::default()
        };

        apply_preference_envelopes(dir.path(), &preferences, &mut state, &manifest)
            .expect("apply");

        let response = preferences.get().expect("preferences");
        assert_eq!(response.theme, "light");
        assert_eq!(
            state.preferences_updated_at.as_deref(),
            Some("2026-06-01T00:00:00Z")
        );
    }

    #[test]
    fn a_newer_synced_provider_envelope_rewrites_settings_but_not_auth() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join("agent")).expect("agent dir");
        std::fs::write(
            dir.path().join("agent").join("auth.json"),
            serde_json::to_vec(&serde_json::json!({
                "anthropic": { "type": "api_key", "key": "local-secret" }
            }))
            .expect("auth bytes"),
        )
        .expect("auth write");

        let manifest = SyncManifestData {
            schema_version: 1,
            books: Default::default(),
            tombstones: Vec::new(),
            preferences: None,
            provider: Some(envelope(
                "2026-06-01T00:00:00Z",
                serde_json::json!({
                    "settings": {
                        "defaultProvider": "custom-abcd1234",
                        "defaultModel": "some-model",
                        "defaultThinkingLevel": "high"
                    },
                    "models": {
                        "providers": {
                            "custom-abcd1234": {
                                "name": "My provider",
                                "baseUrl": "https://example.com/v1",
                                "models": [{ "id": "some-model" }]
                            }
                        }
                    }
                }),
            )),
        };
        let mut state = SyncState::default();

        apply_preference_envelopes(dir.path(), &temp().1, &mut state, &manifest).expect("apply");

        let settings: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.path().join("agent").join("settings.json")).expect("settings"),
        )
        .expect("json");
        assert_eq!(settings["defaultProvider"], "custom-abcd1234");
        assert_eq!(settings["defaultThinkingLevel"], "high");
        let auth: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.path().join("agent").join("auth.json")).expect("auth"),
        )
        .expect("json");
        // API keys never leave the device — and the synced envelope never
        // overwrites them: the local key is intact and the new provider has
        // none yet (the UI will ask for it).
        assert_eq!(auth["anthropic"]["key"], "local-secret");
        assert!(auth.get("custom-abcd1234").is_none());
    }

    #[test]
    fn export_envelopes_carry_language_and_agent_settings() {
        let (dir, preferences) = temp();
        let mut state = SyncState {
            device_id: "device-a".to_string(),
            preferences_updated_at: Some("2026-06-01T00:00:00Z".to_string()),
            provider_updated_at: Some("2026-06-01T00:00:00Z".to_string()),
            ..SyncState::default()
        };
        std::fs::create_dir_all(dir.path().join("agent")).expect("agent dir");
        std::fs::write(
            dir.path().join("agent").join("settings.json"),
            br#"{"defaultProvider":"anthropic","defaultModel":"claude"}"#,
        )
        .expect("settings");

        let preferences_envelope =
            build_preferences_envelope(&preferences, &mut state, Some("zh-CN")).expect("prefs");
        let provider_envelope = build_provider_envelope(dir.path(), &state).expect("provider");

        assert_eq!(preferences_envelope.unwrap().data["language"], "zh-CN");
        assert_eq!(
            provider_envelope.data["settings"]["defaultModel"],
            "claude"
        );
    }

    #[test]
    fn a_locale_change_counts_as_a_preferences_edit() {
        let (dir, preferences) = temp();
        let mut state = SyncState {
            device_id: "device-a".to_string(),
            preferences_updated_at: Some("2026-01-01T00:00:00Z".to_string()),
            preferences: Some(SyncEnvelopeData {
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                device_id: "device-a".to_string(),
                data: serde_json::json!({ "language": "en" }),
            }),
            ..SyncState::default()
        };

        build_preferences_envelope(&preferences, &mut state, Some("zh-CN")).expect("build");

        // The recorded language changed → the local envelope is newer than the
        // old timestamp.
        assert_ne!(
            state.preferences_updated_at.as_deref(),
            Some("2026-01-01T00:00:00Z")
        );
    }
}
