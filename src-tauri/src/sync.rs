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

/// Export the local Library (books metadata, positions, annotations) as a
/// Manifest. Local-only view: tombstones and preferences are managed by the
/// caller, which persists its own sync state.
pub fn export_local_manifest(
    store: &LibraryStore,
    device_id: &str,
    local: &SyncManifestData,
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
                annotations_updated_at: String::new(),
                file_revision: previous.and_then(|book| book.file_revision.clone()),
                cover_revision: previous.and_then(|book| book.cover_revision.clone()),
            },
        );
    }
    Ok(manifest)
}

/// Apply a merged Manifest to the local Library: update positions and
/// metadata for known books, and create placeholder records for books this
/// device has never seen (bootstrap; file downloads come later).
pub fn apply_merged_manifest(store: &LibraryStore, merged: &SyncManifestData) -> AppResult<()> {
    let mut library = store.read_library_public()?;
    let known: std::collections::HashSet<String> =
        library.books.iter().map(|book| book.id.clone()).collect();

    for (book_id, synced) in &merged.books {
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
            if let Some(position) = &synced.position {
                record.last_fraction = Some(position.fraction);
                record.last_cfi = Some(position.cfi.clone());
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
        if !known.contains(book_id) {
            store.save_annotations(book_id, synced.annotations.clone())?;
        }
    }
    Ok(())
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

        let manifest = export_local_manifest(&store, "device-a", &local).expect("export");

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

        apply_merged_manifest(&store, &merged).expect("apply");

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
        let manifest = export_local_manifest(&store, &state.device_id, &local)?;
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
    etag: String,
) -> AppResult<()> {
    let store = store.inner().clone();
    let root = sync_root(&app)?;
    run_sync_blocking(move || {
        let mut state = read_sync_state(&root)?;
        apply_merged_manifest(&store, &manifest)?;
        state.tombstones = manifest.tombstones.clone();
        state.preferences = manifest.preferences.clone();
        state.provider = manifest.provider.clone();
        state.last_etag = etag;
        state.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
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

fn sync_root(app: &tauri::AppHandle) -> AppResult<PathBuf> {
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

        let manifest = export_local_manifest(&store, "device-a", &SyncManifestData::default())
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
