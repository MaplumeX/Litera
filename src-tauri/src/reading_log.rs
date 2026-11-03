//! The Reading log: this device's record of Sittings. Each device writes only
//! its own file, so Reading stats derived from several devices never conflict.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::library::{atomic_write, LibraryStore};
use crate::sync::{ensure_device_id, sync_root};

const SCHEMA_VERSION: u32 = 1;
const READING_LOG_DIR: &str = "reading-log";
const VALID_MODES: [&str; 2] = ["reader", "agent"];

/// Serializes read-modify-write of this device's log file.
static READING_LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sitting {
    pub id: String,
    pub book_id: String,
    /// RFC 3339 with the UTC offset, so the date is the local date as lived.
    pub start: String,
    pub seconds: u64,
    pub from: f64,
    pub to: f64,
    pub mode: String,
}

/// A Book's labels when last read, so a deleted Book's time stays named.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSnapshot {
    pub title: String,
    pub author: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingLog {
    pub schema_version: u32,
    pub device_id: String,
    #[serde(default)]
    pub books: BTreeMap<String, BookSnapshot>,
    #[serde(default)]
    pub sittings: Vec<Sitting>,
}

impl ReadingLog {
    fn empty(device_id: &str) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            device_id: device_id.to_string(),
            books: BTreeMap::new(),
            sittings: Vec::new(),
        }
    }
}

fn log_path(root: &Path, device_id: &str) -> PathBuf {
    root.join(READING_LOG_DIR).join(format!("{device_id}.json"))
}

fn validate(sitting: &Sitting) -> AppResult<()> {
    let invalid = |message: &str| AppError::storage_io(format!("Invalid sitting: {message}"));
    if sitting.id.is_empty() || sitting.book_id.is_empty() {
        return Err(invalid("missing id"));
    }
    if !VALID_MODES.contains(&sitting.mode.as_str()) {
        return Err(invalid("unknown mode"));
    }
    if chrono::DateTime::parse_from_rfc3339(&sitting.start).is_err() {
        return Err(invalid("bad start"));
    }
    if !(0.0..=1.0).contains(&sitting.from) || !(0.0..=1.0).contains(&sitting.to) {
        return Err(invalid("fraction out of range"));
    }
    Ok(())
}

/// This device's log. One that cannot be read is set aside rather than
/// overwritten, and a new one started, so recording never blocks reading.
fn read_or_start(path: &Path, device_id: &str) -> AppResult<ReadingLog> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ReadingLog::empty(device_id))
        }
        Err(error) => {
            return Err(AppError::storage_io(format!(
                "Failed to read the reading log: {error}"
            )))
        }
    };
    match serde_json::from_slice::<ReadingLog>(&bytes) {
        Ok(log) if log.schema_version == SCHEMA_VERSION => Ok(log),
        _ => {
            let aside = path.with_extension(format!(
                "json.unreadable-{}",
                uuid::Uuid::new_v4().simple()
            ));
            fs::rename(path, &aside).map_err(|error| {
                AppError::storage_io(format!("Failed to set aside the reading log: {error}"))
            })?;
            eprintln!("[reading-log] Set aside an unreadable log as {}", aside.display());
            Ok(ReadingLog::empty(device_id))
        }
    }
}

/// Add a Sitting, or replace the one with its id, and refresh the Book's labels.
/// Labels stay as they were when the Library no longer has the Book.
pub fn upsert_sitting(
    root: &Path,
    device_id: &str,
    sitting: Sitting,
    snapshot: Option<BookSnapshot>,
) -> AppResult<()> {
    validate(&sitting)?;
    // A panic elsewhere cannot leave the file half-written (writes are atomic),
    // so a poisoned lock is safe to reuse.
    let _guard = READING_LOG_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = log_path(root, device_id);
    let mut log = read_or_start(&path, device_id)?;
    if let Some(snapshot) = snapshot {
        log.books.insert(sitting.book_id.clone(), snapshot);
    }
    match log.sittings.iter_mut().find(|existing| existing.id == sitting.id) {
        Some(existing) => *existing = sitting,
        None => log.sittings.push(sitting),
    }
    let json = serde_json::to_vec(&log)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize the reading log: {error}")))?;
    atomic_write(&path, &json, "reading log")
}

/// Every device's log held here. A file that cannot be read is skipped: one bad
/// log from another device, or from a newer version, must not hide the rest.
pub fn read_all_logs(root: &Path) -> AppResult<Vec<ReadingLog>> {
    let entries = match fs::read_dir(root.join(READING_LOG_DIR)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(AppError::storage_io(format!(
                "Failed to list reading logs: {error}"
            )))
        }
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .collect();
    // Directory order varies; labels shared between logs should not.
    paths.sort();
    let mut logs = Vec::new();
    for path in paths {
        let parsed = fs::read(&path)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                serde_json::from_slice::<ReadingLog>(&bytes).map_err(|error| error.to_string())
            });
        match parsed {
            Ok(log) if log.schema_version == SCHEMA_VERSION => logs.push(log),
            Ok(log) => eprintln!(
                "[reading-log] Skipping {}: schema version {}",
                path.display(),
                log.schema_version
            ),
            Err(error) => eprintln!("[reading-log] Skipping {}: {error}", path.display()),
        }
    }
    Ok(logs)
}

#[tauri::command]
pub async fn record_sitting(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    sitting: Sitting,
) -> AppResult<()> {
    let root = sync_root(&app)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let device_id = ensure_device_id(&root)?;
        let snapshot = store
            .list_books()
            .ok()
            .and_then(|books| books.into_iter().find(|book| book.id == sitting.book_id))
            .map(|book| BookSnapshot {
                title: book.title,
                author: book.author,
            });
        upsert_sitting(&root, &device_id, sitting, snapshot)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Reading log worker failed: {error}")))?
}

#[tauri::command]
pub async fn get_reading_logs(app: tauri::AppHandle) -> AppResult<Vec<ReadingLog>> {
    let root = sync_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_all_logs(&root))
        .await
        .map_err(|error| AppError::storage_io(format!("Reading log worker failed: {error}")))?
}

// ---------------------------------------------------------------------------
// Sync: each device's log is one object that only that device writes, so there
// is nothing to merge. See docs/adr/0003-reading-log-sync.md.
// ---------------------------------------------------------------------------

pub const STATS_OBJECT_PREFIX: &str = "litera/stats";
const SYNC_STATE_FILE: &str = "reading-log-sync.json";

/// What this device knows about the Sync Backend's log objects. Its own file,
/// not `SyncState`: that one rejects unknown fields, so a new field there would
/// break an older build reading it after a downgrade.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct LogSyncState {
    /// Hash of this device's log as last uploaded.
    uploaded_hash: Option<String>,
    /// Etag last seen, by other device's id.
    seen_etags: BTreeMap<String, String>,
}

#[derive(Debug, Default, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogSyncSummary {
    pub uploaded: u64,
    pub downloaded: u64,
    /// Remote objects that were not a valid log of the device they are named for.
    pub skipped: u64,
}

fn sync_state_path(root: &Path) -> PathBuf {
    root.join(SYNC_STATE_FILE)
}

fn read_log_sync_state(root: &Path) -> LogSyncState {
    // Losing this only costs one extra transfer, so a bad file starts over.
    fs::read(sync_state_path(root))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_log_sync_state(root: &Path, state: &LogSyncState) -> AppResult<()> {
    let json = serde_json::to_vec(state).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize reading log sync state: {error}"))
    })?;
    atomic_write(&sync_state_path(root), &json, "reading log sync state")
}

/// The Sync Backend changed: forget its objects, so the new one gets this log.
pub fn forget_sync_state(root: &Path) -> AppResult<()> {
    match fs::remove_file(sync_state_path(root)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::storage_io(format!(
            "Failed to reset reading log sync state: {error}"
        ))),
    }
}

/// The other device's id, for an object directly under the prefix.
fn device_of_object(location: &str) -> Option<&str> {
    let device_id = location
        .strip_prefix(STATS_OBJECT_PREFIX)?
        .strip_prefix('/')?
        .strip_suffix(".json")?;
    crate::sync::validate_sync_id(device_id).ok()?;
    Some(device_id)
}

/// Bytes worth keeping for a device: its log, even of a newer schema this
/// version will skip until it is upgraded.
fn is_log_of(bytes: &[u8], device_id: &str) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .is_ok_and(|value| value.get("deviceId").and_then(|id| id.as_str()) == Some(device_id))
}

async fn sync_logs_with(
    root: &Path,
    device_id: &str,
    object_store: &impl object_store::ObjectStore,
    upload: bool,
    state: &mut LogSyncState,
) -> AppResult<LogSyncSummary> {
    use futures::TryStreamExt;
    use object_store::{path::Path as ObjectPath, ObjectStoreExt, PutPayload};
    let backend_error = crate::sync::map_object_store_error;
    let mut summary = LogSyncSummary::default();

    if upload {
        match fs::read(log_path(root, device_id)) {
            Ok(bytes) => {
                let hash = crate::library::sha256_hex(&bytes);
                if state.uploaded_hash.as_deref() != Some(hash.as_str()) {
                    let key = ObjectPath::from(format!("{STATS_OBJECT_PREFIX}/{device_id}.json"));
                    object_store
                        .put(&key, PutPayload::from(bytes))
                        .await
                        .map_err(backend_error)?;
                    state.uploaded_hash = Some(hash);
                    summary.uploaded += 1;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to read the reading log: {error}"
                )))
            }
        }
    }

    let objects: Vec<object_store::ObjectMeta> = object_store
        .list(Some(&ObjectPath::from(STATS_OBJECT_PREFIX)))
        .try_collect()
        .await
        .map_err(backend_error)?;
    for object in objects {
        let location = object.location.to_string();
        let Some(other) = device_of_object(&location) else {
            continue;
        };
        if other == device_id {
            continue;
        }
        if let (Some(etag), Some(seen)) = (&object.e_tag, state.seen_etags.get(other)) {
            if etag == seen {
                continue;
            }
        }
        let bytes = object_store
            .get(&object.location)
            .await
            .map_err(backend_error)?
            .bytes()
            .await
            .map_err(backend_error)?;
        if is_log_of(&bytes, other) {
            atomic_write(&log_path(root, other), &bytes, "reading log")?;
            summary.downloaded += 1;
        } else {
            eprintln!("[reading-log] Skipping {location}: not this device's log");
            summary.skipped += 1;
        }
        // Remembered either way: a bad object is not fetched again until it changes.
        if let Some(etag) = object.e_tag {
            state.seen_etags.insert(other.to_string(), etag);
        }
    }
    Ok(summary)
}

/// Upload this device's log if it changed (`upload` is false with recording
/// off) and fetch the other devices' logs that changed. Progress is kept even
/// when the backend fails partway.
pub async fn sync_logs(
    root: &Path,
    device_id: &str,
    object_store: &impl object_store::ObjectStore,
    upload: bool,
) -> AppResult<LogSyncSummary> {
    let mut state = read_log_sync_state(root);
    let result = sync_logs_with(root, device_id, object_store, upload, &mut state).await;
    write_log_sync_state(root, &state)?;
    result
}

#[tauri::command]
pub async fn sync_reading_logs(app: tauri::AppHandle, upload: bool) -> AppResult<LogSyncSummary> {
    let root = sync_root(&app)?;
    let config = crate::sync_config::read_sync_config(&root)?
        .ok_or_else(|| AppError::invalid_input("Sync is not configured"))?;
    let object_store = crate::sync_config::build_sync_store(&config)?;
    let device_id = ensure_device_id(&root)?;
    sync_logs(&root, &device_id, &object_store, upload).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sitting(id: &str, seconds: u64) -> Sitting {
        Sitting {
            id: id.to_string(),
            book_id: "book-1".to_string(),
            start: "2026-11-03T22:10:00+08:00".to_string(),
            seconds,
            from: 0.31,
            to: 0.34,
            mode: "reader".to_string(),
        }
    }

    fn snapshot(title: &str) -> Option<BookSnapshot> {
        Some(BookSnapshot {
            title: title.to_string(),
            author: "Author".to_string(),
        })
    }

    fn read(root: &Path) -> ReadingLog {
        serde_json::from_slice(&fs::read(log_path(root, "device-a")).unwrap()).unwrap()
    }

    #[test]
    fn upserts_by_id() {
        let dir = tempdir().unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("one", 120), None).unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("two", 30), None).unwrap();
        let log = read(dir.path());
        assert_eq!(log.device_id, "device-a");
        assert_eq!(log.schema_version, SCHEMA_VERSION);
        assert_eq!(
            log.sittings.iter().map(|s| (s.id.as_str(), s.seconds)).collect::<Vec<_>>(),
            vec![("one", 120), ("two", 30)]
        );
    }

    #[test]
    fn refreshes_labels_and_keeps_them_once_the_book_is_gone() {
        let dir = tempdir().unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("one", 60), snapshot("Old")).unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("one", 90), snapshot("New")).unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("one", 120), None).unwrap();
        assert_eq!(read(dir.path()).books["book-1"].title, "New");
    }

    #[test]
    fn writes_the_documented_shape() {
        let dir = tempdir().unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("one", 60), snapshot("Title")).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(log_path(dir.path(), "device-a")).unwrap()).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["deviceId"], "device-a");
        assert_eq!(value["books"]["book-1"]["title"], "Title");
        assert_eq!(value["sittings"][0]["bookId"], "book-1");
        assert_eq!(value["sittings"][0]["start"], "2026-11-03T22:10:00+08:00");
    }

    #[test]
    fn sets_an_unreadable_log_aside_and_starts_again() {
        for bad in ["not json", r#"{"schemaVersion":99,"deviceId":"device-a"}"#] {
            let dir = tempdir().unwrap();
            let path = log_path(dir.path(), "device-a");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bad).unwrap();

            upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();

            assert_eq!(read(dir.path()).sittings.len(), 1);
            let kept: Vec<_> = fs::read_dir(path.parent().unwrap())
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .filter(|entry| entry != &path)
                .collect();
            assert_eq!(kept.len(), 1);
            assert_eq!(fs::read_to_string(&kept[0]).unwrap(), bad);
        }
    }

    #[test]
    fn rejects_invalid_sittings() {
        let dir = tempdir().unwrap();
        let cases = [
            Sitting { id: String::new(), ..sitting("x", 60) },
            Sitting { mode: "other".to_string(), ..sitting("x", 60) },
            Sitting { start: "yesterday".to_string(), ..sitting("x", 60) },
            Sitting { to: 1.5, ..sitting("x", 60) },
            Sitting { from: f64::NAN, ..sitting("x", 60) },
        ];
        for case in cases {
            assert!(upsert_sitting(dir.path(), "device-a", case, None).is_err());
        }
        assert!(!log_path(dir.path(), "device-a").exists());
    }

    #[test]
    fn reads_every_device_and_skips_what_it_cannot_read() {
        let dir = tempdir().unwrap();
        upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();
        upsert_sitting(dir.path(), "device-b", sitting("two", 30), None).unwrap();
        let logs = dir.path().join(READING_LOG_DIR);
        fs::write(logs.join("corrupt.json"), "not json").unwrap();
        fs::write(
            logs.join("newer.json"),
            r#"{"schemaVersion":99,"deviceId":"newer"}"#,
        )
        .unwrap();
        // Set aside earlier: not a log any more.
        fs::write(logs.join("device-c.json.unreadable-abc"), "{}").unwrap();

        let read = read_all_logs(dir.path()).unwrap();

        assert_eq!(
            read.iter().map(|log| log.device_id.as_str()).collect::<Vec<_>>(),
            vec!["device-a", "device-b"]
        );
    }

    #[test]
    fn reads_nothing_before_anything_is_recorded() {
        let dir = tempdir().unwrap();
        assert!(read_all_logs(dir.path()).unwrap().is_empty());
    }

    mod sync {
        use super::*;
        use object_store::{memory::InMemory, path::Path as ObjectPath, ObjectStoreExt, PutPayload};

        const OWN_KEY: &str = "litera/stats/device-a.json";
        const OTHER_KEY: &str = "litera/stats/device-b.json";

        async fn put_log(store: &InMemory, key: &str, device_id: &str, seconds: u64) {
            let mut log = ReadingLog::empty(device_id);
            log.sittings.push(sitting("remote", seconds));
            let bytes = serde_json::to_vec(&log).unwrap();
            store
                .put(&ObjectPath::from(key), PutPayload::from(bytes))
                .await
                .unwrap();
        }

        async fn has(store: &InMemory, key: &str) -> bool {
            store.get(&ObjectPath::from(key)).await.is_ok()
        }

        #[tokio::test]
        async fn uploads_only_when_the_log_changed() {
            let dir = tempdir().unwrap();
            let store = InMemory::new();
            upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();

            let first = sync_logs(dir.path(), "device-a", &store, true).await.unwrap();
            assert_eq!(first.uploaded, 1);
            assert!(has(&store, OWN_KEY).await);
            let again = sync_logs(dir.path(), "device-a", &store, true).await.unwrap();
            assert_eq!(again.uploaded, 0);

            upsert_sitting(dir.path(), "device-a", sitting("one", 120), None).unwrap();
            let changed = sync_logs(dir.path(), "device-a", &store, true).await.unwrap();
            assert_eq!(changed.uploaded, 1);
        }

        #[tokio::test]
        async fn uploads_nothing_with_recording_off_but_still_downloads() {
            let dir = tempdir().unwrap();
            let store = InMemory::new();
            upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();
            put_log(&store, OTHER_KEY, "device-b", 30).await;

            let summary = sync_logs(dir.path(), "device-a", &store, false).await.unwrap();

            assert_eq!((summary.uploaded, summary.downloaded), (0, 1));
            assert!(!has(&store, OWN_KEY).await);
        }

        #[tokio::test]
        async fn uploads_nothing_before_anything_is_recorded() {
            let dir = tempdir().unwrap();
            let store = InMemory::new();
            let summary = sync_logs(dir.path(), "device-a", &store, true).await.unwrap();
            assert_eq!(summary, LogSyncSummary::default());
        }

        #[tokio::test]
        async fn downloads_other_devices_when_they_change_and_reads_them_together() {
            let dir = tempdir().unwrap();
            let store = InMemory::new();
            upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();
            put_log(&store, OTHER_KEY, "device-b", 30).await;

            assert_eq!(sync_logs(dir.path(), "device-a", &store, true).await.unwrap().downloaded, 1);
            assert_eq!(sync_logs(dir.path(), "device-a", &store, true).await.unwrap().downloaded, 0);
            put_log(&store, OTHER_KEY, "device-b", 90).await;
            assert_eq!(sync_logs(dir.path(), "device-a", &store, true).await.unwrap().downloaded, 1);

            let logs = read_all_logs(dir.path()).unwrap();
            assert_eq!(logs.len(), 2);
            assert_eq!(logs[1].device_id, "device-b");
            assert_eq!(logs[1].sittings[0].seconds, 90);
        }

        #[tokio::test]
        async fn never_overwrites_its_own_log_from_the_backend() {
            let dir = tempdir().unwrap();
            let store = InMemory::new();
            upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();
            put_log(&store, OWN_KEY, "device-a", 9999).await;

            sync_logs(dir.path(), "device-a", &store, false).await.unwrap();

            assert_eq!(read(dir.path()).sittings[0].seconds, 60);
        }

        #[tokio::test]
        async fn skips_objects_that_are_not_a_devices_log() {
            let dir = tempdir().unwrap();
            let store = InMemory::new();
            for (key, bytes) in [
                ("litera/stats/garbled.json", b"not json".to_vec()),
                (OTHER_KEY, br#"{"deviceId":"someone-else"}"#.to_vec()),
                ("litera/stats/nested/device-c.json", b"{}".to_vec()),
                ("litera/stats/device-d.txt", b"{}".to_vec()),
            ] {
                store
                    .put(&ObjectPath::from(key), PutPayload::from(bytes))
                    .await
                    .unwrap();
            }

            let summary = sync_logs(dir.path(), "device-a", &store, true).await.unwrap();

            assert_eq!((summary.downloaded, summary.skipped), (0, 2));
            assert!(read_all_logs(dir.path()).unwrap().is_empty());
            // Not fetched again until it changes.
            assert_eq!(sync_logs(dir.path(), "device-a", &store, true).await.unwrap().skipped, 0);
        }

        #[tokio::test]
        async fn keeps_a_newer_schema_for_after_an_upgrade() {
            let dir = tempdir().unwrap();
            let store = InMemory::new();
            store
                .put(
                    &ObjectPath::from(OTHER_KEY),
                    PutPayload::from(br#"{"schemaVersion":99,"deviceId":"device-b"}"#.to_vec()),
                )
                .await
                .unwrap();

            assert_eq!(sync_logs(dir.path(), "device-a", &store, true).await.unwrap().downloaded, 1);

            assert!(log_path(dir.path(), "device-b").exists());
            assert!(read_all_logs(dir.path()).unwrap().is_empty());
        }

        #[tokio::test]
        async fn a_new_backend_gets_the_log_again() {
            let dir = tempdir().unwrap();
            upsert_sitting(dir.path(), "device-a", sitting("one", 60), None).unwrap();
            sync_logs(dir.path(), "device-a", &InMemory::new(), true).await.unwrap();

            crate::sync::note_sync_backend_changed(dir.path()).unwrap();

            let store = InMemory::new();
            assert_eq!(sync_logs(dir.path(), "device-a", &store, true).await.unwrap().uploaded, 1);
            assert!(has(&store, OWN_KEY).await);
        }
    }

    #[test]
    fn device_id_stays_the_same_without_a_sync_state_file() {
        let dir = tempdir().unwrap();
        let first = ensure_device_id(dir.path()).unwrap();
        let second = ensure_device_id(dir.path()).unwrap();
        assert!(!first.is_empty());
        assert_eq!(first, second);
    }
}
