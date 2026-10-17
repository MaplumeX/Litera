//! KOReader Sync: exchanges a Book's reading position with a kosync-compatible
//! Progress Server (KOReader's sync server, BookOrbit, ...). Progress only,
//! and independent of the S3 Sync feature.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::library::{atomic_write, LibraryStore};

const KOSYNC_CONFIG_SCHEMA_VERSION: u32 = 1;
const MAX_URL_CHARS: usize = 2048;
const MAX_USERNAME_CHARS: usize = 256;
const MAX_PROGRESS_CHARS: usize = 4096;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const ACCEPT: &str = "application/vnd.koreader.v1+json";
const DEVICE_NAME: &str = "Litera";

/// KOReader's document id: MD5 over 1 KiB samples at offsets 0, 1 KiB,
/// 4 KiB, 16 KiB, ... 1 GiB (`1024 << 2i` for i = -1..=10, where i = -1
/// overflows to 0 in KOReader's LuaJIT), stopping at the first offset past
/// the end of the file. Matches KOReader's default "binary" matching.
pub fn partial_md5(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    let mut hasher = Md5::new();
    let mut buffer = [0u8; 1024];
    for i in -1i32..=10 {
        let offset: u64 = if i < 0 { 0 } else { 1024u64 << (2 * i) };
        if offset >= size {
            break;
        }
        file.seek(SeekFrom::Start(offset))?;
        let mut filled = 0;
        while filled < buffer.len() {
            let read = file.read(&mut buffer[filled..])?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        hasher.update(&buffer[..filled]);
    }
    Ok(hex(&hasher.finalize()))
}

fn md5_hex(text: &str) -> String {
    hex(&Md5::digest(text.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Stored in `kosync.json`, plaintext like the other local credentials and
/// never synced. Only `md5(password)` is kept: it is all the protocol sends.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KosyncConfig {
    pub schema_version: u32,
    pub enabled: bool,
    pub server_url: String,
    pub username: String,
    pub user_key: String,
    /// Stable id this device reports to the Progress Server.
    pub device_id: String,
}

/// What the Settings form sends. A blank password keeps the stored key.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KosyncConfigInput {
    pub enabled: bool,
    pub server_url: String,
    pub username: String,
    #[serde(default)]
    pub password: String,
}

/// The view returned to the frontend: the key never crosses IPC.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KosyncConfigPublic {
    pub enabled: bool,
    pub server_url: String,
    pub username: String,
    pub has_key: bool,
    pub device_id: String,
}

impl From<&KosyncConfig> for KosyncConfigPublic {
    fn from(config: &KosyncConfig) -> Self {
        Self {
            enabled: config.enabled,
            server_url: config.server_url.clone(),
            username: config.username.clone(),
            has_key: !config.user_key.is_empty(),
            device_id: config.device_id.clone(),
        }
    }
}

/// Outcome of the last exchange in this run, shown in Settings.
#[derive(Debug, Serialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KosyncStatus {
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Default)]
pub struct KosyncStatusState(Mutex<KosyncStatus>);

/// A position as the Progress Server reports it.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KosyncProgress {
    pub progress: String,
    pub percentage: f64,
    pub device: String,
    pub device_id: String,
    /// Unix seconds, stamped by the server when it received the position.
    pub timestamp: i64,
}

/// A pulled position together with when this device's position last moved,
/// so the frontend can decide whether the remote one is newer.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KosyncPull {
    pub remote: KosyncProgress,
    pub local_position_updated_at: Option<String>,
}

fn normalize_server_url(raw: &str) -> AppResult<String> {
    let url = raw.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err(AppError::invalid_input("Server URL is required"));
    }
    if url.chars().count() > MAX_URL_CHARS {
        return Err(AppError::invalid_input("Server URL is too long"));
    }
    let parsed = reqwest::Url::parse(&url)
        .map_err(|_| AppError::invalid_input("Server URL is not a valid URL"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(AppError::invalid_input("Server URL must start with http:// or https://"));
    }
    Ok(url)
}

/// Build the stored config from a form submission, keeping the stored key
/// (and device id) when the password is left blank.
fn merge_input(input: KosyncConfigInput, previous: Option<&KosyncConfig>) -> AppResult<KosyncConfig> {
    let server_url = normalize_server_url(&input.server_url)?;
    let username = input.username.trim().to_string();
    if username.is_empty() {
        return Err(AppError::invalid_input("Username is required"));
    }
    if username.chars().count() > MAX_USERNAME_CHARS {
        return Err(AppError::invalid_input("Username is too long"));
    }
    let user_key = if input.password.is_empty() {
        previous.map(|config| config.user_key.clone()).unwrap_or_default()
    } else {
        md5_hex(&input.password)
    };
    if user_key.is_empty() {
        return Err(AppError::invalid_input("Password is required"));
    }
    let device_id = previous
        .map(|config| config.device_id.clone())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
    Ok(KosyncConfig {
        schema_version: KOSYNC_CONFIG_SCHEMA_VERSION,
        enabled: input.enabled,
        server_url,
        username,
        user_key,
        device_id,
    })
}

fn config_path(root: &Path) -> PathBuf {
    root.join("kosync.json")
}

pub fn read_kosync_config(root: &Path) -> AppResult<Option<KosyncConfig>> {
    let bytes = match fs::read(config_path(root)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(AppError::storage_io(format!(
                "Failed to read kosync.json: {error}"
            )))
        }
    };
    let config: KosyncConfig = serde_json::from_slice(&bytes).map_err(|error| {
        AppError::storage_corrupt(format!("Failed to parse kosync.json: {error}"))
    })?;
    if config.schema_version != KOSYNC_CONFIG_SCHEMA_VERSION {
        return Err(AppError::storage_corrupt(format!(
            "Unsupported kosync.json schema version: {}",
            config.schema_version
        )));
    }
    Ok(Some(config))
}

pub fn write_kosync_config(root: &Path, config: &KosyncConfig) -> AppResult<()> {
    let json = serde_json::to_vec_pretty(config)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize kosync.json: {error}")))?;
    atomic_write(&config_path(root), &json, "kosync.json")
}

/// Parse a `GET /syncs/progress/:document` body. Servers answer `{}` (or a
/// record without a position) for a document they do not know.
fn parse_progress(body: &[u8]) -> AppResult<Option<KosyncProgress>> {
    #[derive(Deserialize)]
    struct Raw {
        progress: Option<serde_json::Value>,
        percentage: Option<f64>,
        device: Option<String>,
        device_id: Option<String>,
        timestamp: Option<f64>,
    }
    let raw: Raw = serde_json::from_slice(body)
        .map_err(|_| AppError::invalid_input("Progress server returned an unreadable response"))?;
    let progress = match raw.progress {
        Some(serde_json::Value::String(text)) if !text.is_empty() => text,
        Some(serde_json::Value::Number(number)) => number.to_string(),
        _ => return Ok(None),
    };
    let (Some(percentage), Some(timestamp)) = (raw.percentage, raw.timestamp) else {
        return Ok(None);
    };
    Ok(Some(KosyncProgress {
        progress,
        percentage: percentage.clamp(0.0, 1.0),
        device: raw.device.unwrap_or_default(),
        device_id: raw.device_id.unwrap_or_default(),
        timestamp: timestamp as i64,
    }))
}

struct Client {
    http: reqwest::Client,
    base: String,
    username: String,
    key: String,
}

impl Client {
    fn new(server_url: &str, username: &str, key: &str) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| AppError::storage_io("Failed to initialize KOReader Sync"))?;
        Ok(Self {
            http,
            base: normalize_server_url(server_url)?,
            username: username.to_string(),
            key: key.to_string(),
        })
    }

    fn from_config(config: &KosyncConfig) -> AppResult<Self> {
        Self::new(&config.server_url, &config.username, &config.user_key)
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base, path))
            .header(reqwest::header::ACCEPT, ACCEPT)
            .header("x-auth-user", &self.username)
            .header("x-auth-key", &self.key)
    }

    /// Send and read a bounded body. reqwest errors may echo the URL, so the
    /// messages stay generic.
    async fn send(&self, builder: reqwest::RequestBuilder) -> AppResult<(u16, Vec<u8>)> {
        let mut response = builder
            .send()
            .await
            .map_err(|_| AppError::storage_io("Could not reach the progress server"))?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::storage_io("Failed to read the progress server response"))?
        {
            if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(AppError::storage_io("Progress server response is too large"));
            }
            body.extend_from_slice(&chunk);
        }
        Ok((status, body))
    }

    async fn authorize(&self) -> AppResult<()> {
        let (status, _) = self
            .send(self.request(reqwest::Method::GET, "/users/auth"))
            .await?;
        check_status(status)
    }

    async fn pull(&self, document: &str) -> AppResult<Option<KosyncProgress>> {
        let (status, body) = self
            .send(self.request(
                reqwest::Method::GET,
                &format!("/syncs/progress/{document}"),
            ))
            .await?;
        if status == 404 {
            return Ok(None);
        }
        check_status(status)?;
        parse_progress(&body)
    }

    async fn push(&self, document: &str, progress: &str, percentage: f64, device_id: &str) -> AppResult<()> {
        let body = serde_json::json!({
            "document": document,
            "progress": progress,
            "percentage": percentage,
            "device": DEVICE_NAME,
            "device_id": device_id,
        });
        let (status, _) = self
            .send(
                self.request(reqwest::Method::PUT, "/syncs/progress")
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body(body.to_string()),
            )
            .await?;
        // A server that does not hold this book (BookOrbit) answers 404.
        if status == 404 {
            return Ok(());
        }
        check_status(status)
    }
}

fn check_status(status: u16) -> AppResult<()> {
    match status {
        200..=299 => Ok(()),
        401 | 403 => Err(AppError::invalid_input("Invalid username or password")),
        _ => Err(AppError::storage_io(format!(
            "Progress server returned HTTP {status}"
        ))),
    }
}

fn config_root(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::storage_io(format!("Failed to resolve app data dir: {error}")))
}

/// The enabled config, or None when KOReader Sync is off or unconfigured.
fn enabled_config(app: &tauri::AppHandle) -> AppResult<Option<KosyncConfig>> {
    let config = read_kosync_config(&config_root(app)?)?;
    Ok(config.filter(|config| config.enabled && !config.user_key.is_empty()))
}

/// The Book's KOReader document id, or None when its EPUB is not on this
/// device (an uncached sync placeholder).
async fn document_id(store: &LibraryStore, book_id: &str) -> AppResult<Option<String>> {
    let (epub, _) = store.book_files(book_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !epub.is_file() {
            return Ok(None);
        }
        partial_md5(&epub)
            .map(Some)
            .map_err(|error| AppError::storage_io(format!("Failed to hash the EPUB: {error}")))
    })
    .await
    .map_err(|error| AppError::storage_io(format!("KOReader Sync worker failed: {error}")))?
}

fn record_outcome<T>(status: &KosyncStatusState, result: &AppResult<T>) {
    let Ok(mut status) = status.0.lock() else {
        return;
    };
    match result {
        Ok(_) => {
            status.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
            status.last_error = None;
        }
        Err(error) => status.last_error = Some(error.message.clone()),
    }
}

#[tauri::command]
pub async fn get_kosync_config(app: tauri::AppHandle) -> AppResult<Option<KosyncConfigPublic>> {
    let config = read_kosync_config(&config_root(&app)?)?;
    Ok(config.as_ref().map(KosyncConfigPublic::from))
}

#[tauri::command]
pub async fn save_kosync_config(
    app: tauri::AppHandle,
    config: KosyncConfigInput,
) -> AppResult<KosyncConfigPublic> {
    let root = config_root(&app)?;
    let previous = read_kosync_config(&root)?;
    let config = merge_input(config, previous.as_ref())?;
    write_kosync_config(&root, &config)?;
    Ok(KosyncConfigPublic::from(&config))
}

#[tauri::command]
pub async fn test_kosync_connection(
    app: tauri::AppHandle,
    config: KosyncConfigInput,
) -> AppResult<()> {
    let previous = read_kosync_config(&config_root(&app)?)?;
    let config = merge_input(config, previous.as_ref())?;
    Client::from_config(&config)?.authorize().await
}

#[tauri::command]
pub async fn get_kosync_status(
    status: tauri::State<'_, KosyncStatusState>,
) -> AppResult<KosyncStatus> {
    Ok(status.0.lock().map(|status| status.clone()).unwrap_or_default())
}

/// The Progress Server's position for a Book, or None when KOReader Sync is
/// off, the EPUB is not cached, the server does not know the book, or the
/// position is this device's own.
#[tauri::command]
pub async fn kosync_pull(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    status: tauri::State<'_, KosyncStatusState>,
    book_id: String,
) -> AppResult<Option<KosyncPull>> {
    let Some(config) = enabled_config(&app)? else {
        return Ok(None);
    };
    let store = store.inner().clone();
    let Some(document) = document_id(&store, &book_id).await? else {
        return Ok(None);
    };
    let result = async { Client::from_config(&config)?.pull(&document).await }.await;
    record_outcome(&status, &result);
    // A pull carrying our own position is nothing to jump to.
    let Some(remote) = result?.filter(|remote| remote.device_id != config.device_id) else {
        return Ok(None);
    };
    // Same fallback as Sync: records from before positionUpdatedAt existed
    // order by when they were last opened.
    let local_position_updated_at = tauri::async_runtime::spawn_blocking(move || store.list_books())
        .await
        .map_err(|error| AppError::storage_io(format!("KOReader Sync worker failed: {error}")))??
        .into_iter()
        .find(|book| book.id == book_id)
        .and_then(|book| book.position_updated_at.or(book.last_opened_at));
    Ok(Some(KosyncPull {
        remote,
        local_position_updated_at,
    }))
}

#[tauri::command]
pub async fn kosync_push(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    status: tauri::State<'_, KosyncStatusState>,
    book_id: String,
    progress: String,
    percentage: f64,
) -> AppResult<()> {
    if progress.is_empty() || progress.chars().count() > MAX_PROGRESS_CHARS {
        return Err(AppError::invalid_input("Invalid reading position"));
    }
    if !percentage.is_finite() {
        return Err(AppError::invalid_input("Invalid reading percentage"));
    }
    let Some(config) = enabled_config(&app)? else {
        return Ok(());
    };
    let store = store.inner().clone();
    let Some(document) = document_id(&store, &book_id).await? else {
        return Ok(());
    };
    let percentage = (percentage.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0;
    let result = async {
        Client::from_config(&config)?
            .push(&document, &progress, percentage, &config.device_id)
            .await
    }
    .await;
    record_outcome(&status, &result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_bytes(len: usize) -> Vec<u8> {
        (0..len).map(|i| ((i * 31 + 7) % 251) as u8).collect()
    }

    fn hash_of(len: usize) -> String {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("book.epub");
        fs::write(&path, sample_bytes(len)).expect("write sample");
        partial_md5(&path).expect("hash")
    }

    // Expected values computed with an independent implementation of
    // KOReader's util.partialMD5.
    #[test]
    fn partial_md5_matches_koreader_for_a_file_smaller_than_one_block() {
        assert_eq!(hash_of(500), "20d7e49d5efbe12563021059740872ae");
    }

    #[test]
    fn partial_md5_matches_koreader_for_a_file_spanning_a_few_samples() {
        assert_eq!(hash_of(5000), "e9b23960f33568cd50442e8f305853c3");
    }

    #[test]
    fn partial_md5_matches_koreader_for_a_multi_megabyte_file() {
        assert_eq!(hash_of(2_000_000), "951d6ad62a386c5d5e49f4c898e5c6c2");
    }

    fn input(password: &str) -> KosyncConfigInput {
        KosyncConfigInput {
            enabled: true,
            server_url: " https://sync.example.com/api/v1/koreader/ ".to_string(),
            username: " reader ".to_string(),
            password: password.to_string(),
        }
    }

    #[test]
    fn saving_stores_the_md5_of_the_password_and_a_normalized_url() {
        let config = merge_input(input("secret"), None).expect("merge");

        assert_eq!(config.user_key, "5ebe2294ecd0e0f08eab7690d2a6ee69");
        assert_eq!(config.server_url, "https://sync.example.com/api/v1/koreader");
        assert_eq!(config.username, "reader");
        assert_eq!(config.device_id.len(), 32);
    }

    #[test]
    fn a_blank_password_keeps_the_stored_key_and_device_id() {
        let previous = merge_input(input("secret"), None).expect("first save");

        let config = merge_input(input(""), Some(&previous)).expect("resave");

        assert_eq!(config.user_key, previous.user_key);
        assert_eq!(config.device_id, previous.device_id);
    }

    #[test]
    fn a_blank_password_with_nothing_stored_is_rejected() {
        assert!(merge_input(input(""), None).is_err());
    }

    #[test]
    fn a_non_http_url_is_rejected() {
        let mut bad = input("secret");
        bad.server_url = "ftp://example.com".to_string();
        assert!(merge_input(bad, None).is_err());
    }

    #[test]
    fn config_round_trips_and_the_public_view_hides_the_key() {
        let dir = tempfile::tempdir().expect("temp dir");
        let config = merge_input(input("secret"), None).expect("merge");

        write_kosync_config(dir.path(), &config).expect("write");
        let loaded = read_kosync_config(dir.path()).expect("read").expect("present");

        assert_eq!(loaded, config);
        let view = serde_json::to_string(&KosyncConfigPublic::from(&loaded)).expect("view");
        assert!(!view.contains(&config.user_key));
    }

    #[test]
    fn an_empty_progress_record_reads_as_unknown() {
        assert_eq!(parse_progress(b"{}").expect("parse"), None);
    }

    #[test]
    fn a_progress_record_parses() {
        let body = br#"{"document":"abc","progress":"/body/DocFragment[3]/body/p[2]","percentage":0.42,"device":"Kobo","device_id":"D1","timestamp":1700000000}"#;

        let progress = parse_progress(body).expect("parse").expect("present");

        assert_eq!(progress.progress, "/body/DocFragment[3]/body/p[2]");
        assert_eq!(progress.percentage, 0.42);
        assert_eq!(progress.device, "Kobo");
        assert_eq!(progress.device_id, "D1");
        assert_eq!(progress.timestamp, 1_700_000_000);
    }

    #[test]
    fn unauthorized_maps_to_a_credentials_error() {
        let error = check_status(401).expect_err("401");
        assert_eq!(error.message, "Invalid username or password");
    }
}
