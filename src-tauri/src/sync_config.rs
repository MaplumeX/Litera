use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::library::atomic_write;

const SYNC_CONFIG_SCHEMA_VERSION: u32 = 1;
const MAX_ENDPOINT_CHARS: usize = 2048;
const MAX_REGION_CHARS: usize = 128;
const MAX_BUCKET_CHARS: usize = 128;
const MAX_CREDENTIAL_CHARS: usize = 256;

/// User-configured Sync Backend (S3-compatible) credentials and addressing.
/// Stored locally in plaintext JSON, following the conventions of agent auth.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncBackendConfig {
    pub schema_version: u32,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub path_style: bool,
    pub access_key: String,
    pub secret_key: String,
    pub enabled: bool,
}

impl SyncBackendConfig {
    pub fn validate(&self) -> AppResult<()> {
        if self.endpoint.trim().is_empty()
            || self.region.trim().is_empty()
            || self.bucket.trim().is_empty()
            || self.access_key.trim().is_empty()
            || self.secret_key.trim().is_empty()
        {
            return Err(AppError::invalid_input(
                "Endpoint, region, bucket, access key, and secret are all required",
            ));
        }
        if self.endpoint.chars().count() > MAX_ENDPOINT_CHARS
            || self.region.chars().count() > MAX_REGION_CHARS
            || self.bucket.chars().count() > MAX_BUCKET_CHARS
            || self.access_key.chars().count() > MAX_CREDENTIAL_CHARS
            || self.secret_key.chars().count() > MAX_CREDENTIAL_CHARS
        {
            return Err(AppError::invalid_input(
                "Sync configuration field is too long",
            ));
        }
        Ok(())
    }
}

/// The shape returned to the frontend: the secret key is never sent back
/// over IPC, mirroring the agent-config `has_api_key` discipline.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigPublic {
    pub schema_version: u32,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub path_style: bool,
    pub access_key: String,
    pub secret_key: Option<String>,
    pub enabled: bool,
    pub has_secret_key: bool,
}

impl From<&SyncBackendConfig> for SyncConfigPublic {
    fn from(config: &SyncBackendConfig) -> Self {
        Self {
            schema_version: config.schema_version,
            endpoint: config.endpoint.clone(),
            region: config.region.clone(),
            bucket: config.bucket.clone(),
            path_style: config.path_style,
            access_key: config.access_key.clone(),
            secret_key: None,
            enabled: config.enabled,
            has_secret_key: !config.secret_key.is_empty(),
        }
    }
}

fn config_path(root: &Path) -> std::path::PathBuf {
    root.join("sync.json")
}

pub fn read_sync_config(root: &Path) -> AppResult<Option<SyncBackendConfig>> {
    let bytes = match fs::read(config_path(root)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(AppError::storage_io(format!(
                "Failed to read sync.json: {error}"
            )))
        }
    };
    let config: SyncBackendConfig = serde_json::from_slice(&bytes).map_err(|error| {
        AppError::storage_corrupt(format!("Failed to parse sync.json: {error}"))
    })?;
    if config.schema_version != SYNC_CONFIG_SCHEMA_VERSION {
        return Err(AppError::storage_corrupt(format!(
            "Unsupported sync.json schema version: {}",
            config.schema_version
        )));
    }
    Ok(Some(config))
}

pub fn write_sync_config(root: &Path, config: &SyncBackendConfig) -> AppResult<()> {
    if config.schema_version != SYNC_CONFIG_SCHEMA_VERSION {
        return Err(AppError::invalid_input(format!(
            "Unsupported sync.json schema version: {}",
            config.schema_version
        )));
    }
    config.validate()?;
    let json = serde_json::to_vec_pretty(config)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize sync.json: {error}")))?;
    atomic_write(&config_path(root), &json, "sync.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppErrorCode;
    use std::fs;

    fn temp_sync_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("create temp dir")
    }

    fn sample_config() -> SyncBackendConfig {
        SyncBackendConfig {
            schema_version: 1,
            endpoint: "https://s3.example.com".to_string(),
            region: "us-east-1".to_string(),
            bucket: "litera-books".to_string(),
            path_style: true,
            access_key: "AKIAEXAMPLE".to_string(),
            secret_key: "secret-example".to_string(),
            enabled: true,
        }
    }

    #[test]
    fn missing_config_file_reads_as_unconfigured() {
        let dir = temp_sync_dir();

        let config = read_sync_config(dir.path()).expect("read config");

        assert!(config.is_none());
    }

    #[test]
    fn saved_config_round_trips() {
        let dir = temp_sync_dir();
        let config = sample_config();

        write_sync_config(dir.path(), &config).expect("write config");
        let loaded = read_sync_config(dir.path())
            .expect("read config")
            .expect("config present");

        assert_eq!(loaded, config);
    }

    #[test]
    fn corrupt_config_file_reports_storage_corrupt() {
        let dir = temp_sync_dir();
        fs::write(dir.path().join("sync.json"), b"{not json").expect("seed corrupt file");

        let error = read_sync_config(dir.path()).expect_err("expected error");

        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn empty_fields_are_rejected_on_save() {
        let dir = temp_sync_dir();
        let mut config = sample_config();
        config.endpoint.clear();

        let error = write_sync_config(dir.path(), &config).expect_err("expected error");

        assert_eq!(error.code, AppErrorCode::InvalidInput);
    }

    #[test]
    fn secret_key_is_never_in_the_public_view() {
        let config = sample_config();

        let view = SyncConfigPublic::from(&config);

        assert_eq!(view.access_key, config.access_key);
        assert!(view.secret_key.is_none());
        assert!(serde_json::to_string(&view)
            .expect("serialize view")
            .find("secret-example")
            .is_none());
    }

    #[test]
    fn disabling_keeps_credentials() {
        let dir = temp_sync_dir();
        let mut config = sample_config();
        config.enabled = false;

        write_sync_config(dir.path(), &config).expect("write config");
        let loaded = read_sync_config(dir.path())
            .expect("read config")
            .expect("config present");

        assert!(!loaded.enabled);
        assert_eq!(loaded.secret_key, "secret-example");
    }
}

/// Build an object store client from a stored Sync Backend configuration.
pub fn build_sync_store(config: &SyncBackendConfig) -> AppResult<object_store::aws::AmazonS3> {
    config.validate()?;
    let mut builder = object_store::aws::AmazonS3Builder::new()
        .with_endpoint(config.endpoint.trim())
        .with_region(config.region.trim())
        .with_bucket_name(config.bucket.trim())
        .with_access_key_id(config.access_key.trim())
        .with_secret_access_key(config.secret_key.trim())
        .with_virtual_hosted_style_request(!config.path_style);
    if config.endpoint.trim().starts_with("http://") {
        builder = builder.with_allow_http(true);
    }
    builder
        .build()
        .map_err(|error| AppError::invalid_input(format!("Invalid sync configuration: {error}")))
}

/// Probe the Sync Backend: perform a lightweight listing to verify the
/// credentials and addressing actually work before the user relies on Sync.
pub async fn probe_sync_connection(config: &SyncBackendConfig) -> AppResult<()> {
    use futures::TryStreamExt;

    use object_store::path::Path;
    use object_store::ObjectStore;

    let store = build_sync_store(config)?;
    let prefix = Path::from("litera/");
    let stream = store.list(Some(&prefix));
    futures::stream::StreamExt::take(stream, 1)
        .try_collect::<Vec<_>>()
        .await
        .map_err(|error| {
            AppError::storage_io(format!("Sync backend connection failed: {error}"))
        })?;
    Ok(())
}

#[tauri::command]
pub async fn get_sync_config(app: tauri::AppHandle) -> AppResult<Option<SyncConfigPublic>> {
    let root = sync_config_root(&app)?;
    let config = run_blocking(move || read_sync_config(&root)).await?;
    Ok(config.as_ref().map(SyncConfigPublic::from))
}

/// The secret is never sent back to the UI, so a blank one on save means
/// "keep the stored secret" (the form's placeholder says exactly that).
/// Everything else must still be provided. A blank secret with nothing
/// stored stays blank and fails validation, as it should.
fn merge_blank_secret(
    mut config: SyncBackendConfig,
    previous: Option<&SyncBackendConfig>,
) -> SyncBackendConfig {
    if config.secret_key.trim().is_empty() {
        if let Some(previous) = previous {
            if !previous.secret_key.trim().is_empty() {
                config.secret_key = previous.secret_key.clone();
            }
        }
    }
    config
}

#[tauri::command]
pub async fn save_sync_config(
    app: tauri::AppHandle,
    config: SyncBackendConfig,
) -> AppResult<SyncConfigPublic> {
    let root = sync_config_root(&app)?;
    let previous = read_sync_config(&root)?;
    let was_enabled = previous.as_ref().is_some_and(|previous| previous.enabled);
    let newly_enabled = config.enabled && !was_enabled;
    let config = merge_blank_secret(config, previous.as_ref());
    let config = run_blocking(move || {
        write_sync_config(&root, &config)?;
        // First enable: the current local preferences and provider settings
        // become this device's sync baseline.
        if newly_enabled {
            crate::sync::note_sync_enabled(&root)?;
        }
        Ok(config)
    })
    .await?;
    Ok(SyncConfigPublic::from(&config))
}

#[tauri::command]
pub async fn test_sync_connection(config: SyncBackendConfig) -> AppResult<()> {
    probe_sync_connection(&config).await
}

fn sync_config_root(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::storage_io(format!("Failed to resolve app data dir: {error}")))
}

async fn run_blocking<T, F>(operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::storage_io(format!("Blocking sync worker failed: {error}")))?
}

#[cfg(test)]
mod blank_secret_tests {
    use super::*;

    fn stored_config(secret: &str) -> SyncBackendConfig {
        SyncBackendConfig {
            schema_version: 1,
            endpoint: "https://example.r2.cloudflarestorage.com".to_string(),
            region: "us-east-1".to_string(),
            bucket: "bucket".to_string(),
            path_style: true,
            access_key: "access".to_string(),
            secret_key: secret.to_string(),
            enabled: false,
        }
    }

    #[test]
    fn a_blank_secret_merges_back_the_stored_secret() {
        // The UI never receives the secret back, so a re-save arrives with
        // a blank secret and must keep the stored one while applying other
        // field edits.
        let previous = stored_config("stored-secret");
        let mut resave = previous.clone();
        resave.endpoint = "https://changed.example.com".to_string();
        resave.secret_key = String::new();

        let merged = merge_blank_secret(resave, Some(&previous));

        assert_eq!(merged.endpoint, "https://changed.example.com");
        assert_eq!(merged.secret_key, "stored-secret");
    }

    #[test]
    fn a_blank_secret_with_nothing_stored_stays_blank() {
        // First-time configuration must still require a secret.
        let resave = stored_config("");
        let merged = merge_blank_secret(resave, None);
        assert_eq!(merged.secret_key, "");
    }

    #[test]
    fn a_supplied_secret_overwrites_the_stored_one() {
        let previous = stored_config("stored-secret");
        let mut resave = previous.clone();
        resave.secret_key = "new-secret".to_string();

        let merged = merge_blank_secret(resave, Some(&previous));

        assert_eq!(merged.secret_key, "new-secret");
    }
}
