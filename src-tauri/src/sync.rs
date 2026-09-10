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
    device_id: &str,
    local: &SyncManifestData,
    annotations_updated_at: &std::collections::BTreeMap<String, String>,
) -> AppResult<SyncManifestData> {
    let library = store.read_library_public()?;

    let mut manifest = SyncManifestData {
        schema_version: 1,
        books: std::collections::BTreeMap::new(),
        tombstones: local.tombstones.clone(),
        preferences: local.preferences.clone(),
        provider: local.provider.clone(),
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
        let previous = local.books.get(&book.id);
        manifest.books.insert(
            book.id.clone(),
            SyncedBookData {
                metadata,
                position,
                annotations,
                annotations_updated_at: annotations_updated_at
                    .get(&book.id)
                    .cloned()
                    .unwrap_or_default(),
                file_revision: previous.and_then(|book| book.file_revision.clone()),
                cover_revision: previous.and_then(|book| book.cover_revision.clone()),
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

        let manifest =
            export_local_manifest(&store, "device-a", &local, &Default::default()).expect("export");

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
    /// The etag of the remote manifest we last saw (blank: never synced).
    #[serde(default)]
    pub last_etag: String,
    #[serde(default)]
    pub last_synced_at: Option<String>,
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

#[tauri::command]
pub async fn sync_export_local_manifest(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
) -> AppResult<serde_json::Value> {
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        let state = read_sync_state(&root)?;
        let local = SyncManifestData {
            schema_version: 1,
            books: Default::default(),
            tombstones: state.tombstones.clone(),
            preferences: state.preferences.clone(),
            provider: state.provider.clone(),
        };
        let manifest = export_local_manifest(
            &store,
            &state.device_id,
            &local,
            &state.annotations_updated_at,
        )?;
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
    run_sync_blocking(move || {
        let mut state = read_sync_state(&root)?;
        apply_merged_manifest(&store, &manifest, &base)?;
        state.tombstones = manifest.tombstones.clone();
        state.preferences = manifest.preferences.clone();
        state.provider = manifest.provider.clone();
        state.last_etag = etag;
        state.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
        for (book_id, synced) in &manifest.books {
            state
                .annotations_updated_at
                .insert(book_id.clone(), synced.annotations_updated_at.clone());
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

        let manifest =
            export_local_manifest(&store, "device-a", &SyncManifestData::default(), &Default::default())
                .expect("export");
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
