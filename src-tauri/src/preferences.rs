use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::library::{atomic_write, sync_parent_directory};

const PREFERENCES_SCHEMA_VERSION: u32 = 1;
const VALID_THEMES: [&str; 3] = ["light", "dark", "sepia"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreferencesData {
    schema_version: u32,
    theme: String,
}

impl Default for PreferencesData {
    fn default() -> Self {
        Self {
            schema_version: PREFERENCES_SCHEMA_VERSION,
            theme: "light".to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesResponse {
    pub theme: String,
}

#[derive(Clone)]
pub struct PreferencesStore {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
}

impl PreferencesStore {
    pub fn initialize(root: PathBuf) -> AppResult<Self> {
        let store = Self {
            root,
            gate: Arc::new(Mutex::new(())),
        };
        store.ensure_file()?;
        Ok(store)
    }

    /// Create a store that no-ops all writes and returns default theme.
    pub fn unavailable() -> Self {
        Self {
            root: PathBuf::new(),
            gate: Arc::new(Mutex::new(())),
        }
    }

    fn is_available(&self) -> bool {
        !self.root.as_os_str().is_empty()
    }

    fn preferences_path(&self) -> PathBuf {
        self.root.join("preferences.json")
    }

    fn ensure_file(&self) -> AppResult<()> {
        if !self.is_available() {
            return Ok(());
        }
        let path = self.preferences_path();
        match std::fs::read(&path) {
            Ok(bytes) => {
                let result: Result<PreferencesData, _> = serde_json::from_slice(&bytes);
                match result {
                    Ok(data)
                        if data.schema_version == PREFERENCES_SCHEMA_VERSION
                            && VALID_THEMES.contains(&data.theme.as_str()) =>
                    {
                        // Valid — nothing to do.
                    }
                    _ => {
                        // Corrupt or invalid — overwrite with defaults.
                        self.write_default(&path)?;
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.write_default(&path)?;
            }
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to read preferences.json: {error}"
                )));
            }
        }
        Ok(())
    }

    fn write_default(&self, path: &Path) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(&PreferencesData::default())
            .map_err(|e| AppError::storage_io(format!("Failed to serialize preferences: {e}")))?;
        atomic_write(path, &json, "preferences.json")
    }

    pub fn get_theme(&self) -> AppResult<String> {
        if !self.is_available() {
            return Ok("light".to_string());
        }
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Preferences lock is poisoned"))?;
        let bytes = std::fs::read(&self.preferences_path())
            .map_err(|e| AppError::storage_io(format!("Failed to read preferences.json: {e}")))?;
        let data: PreferencesData = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::storage_corrupt(format!("Failed to parse preferences.json: {e}")))?;
        Ok(data.theme)
    }

    pub fn save_theme(&self, theme: &str) -> AppResult<()> {
        if !self.is_available() {
            return Ok(());
        }
        if !VALID_THEMES.contains(&theme) {
            return Err(AppError::invalid_input("Unsupported theme"));
        }
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Preferences lock is poisoned"))?;
        let data = PreferencesData {
            schema_version: PREFERENCES_SCHEMA_VERSION,
            theme: theme.to_string(),
        };
        let json = serde_json::to_vec_pretty(&data)
            .map_err(|e| AppError::storage_io(format!("Failed to serialize preferences: {e}")))?;
        atomic_write(&self.preferences_path(), &json, "preferences.json")?;
        // sync_parent_directory is already called by atomic_write, but the
        // parent directory here is the app data root — sync it explicitly to
        // match library.rs durability guarantees.
        sync_parent_directory(&self.root, "app data directory")
    }
}

#[tauri::command]
pub async fn get_preferences(
    store: tauri::State<'_, PreferencesStore>,
) -> AppResult<PreferencesResponse> {
    let store = store.inner().clone();
    let theme = tauri::async_runtime::spawn_blocking(move || store.get_theme())
        .await
        .map_err(|e| AppError::storage_io(format!("Preferences read worker failed: {e}")))??;
    Ok(PreferencesResponse { theme })
}

#[tauri::command]
pub async fn save_preferences(
    store: tauri::State<'_, PreferencesStore>,
    theme: String,
) -> AppResult<()> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.save_theme(&theme))
        .await
        .map_err(|e| AppError::storage_io(format!("Preferences write worker failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> (tempfile::TempDir, PreferencesStore) {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("store init");
        (directory, store)
    }

    #[test]
    fn initialize_creates_default_preferences() {
        let (directory, _store) = test_store();
        let path = directory.path().join("preferences.json");
        assert!(path.exists());
        let data: PreferencesData =
            serde_json::from_slice(&std::fs::read(&path).expect("read")).expect("parse");
        assert_eq!(data.schema_version, PREFERENCES_SCHEMA_VERSION);
        assert_eq!(data.theme, "light");
    }

    #[test]
    fn get_theme_returns_persisted_value() {
        let (_directory, store) = test_store();
        store.save_theme("sepia").expect("save");
        assert_eq!(store.get_theme().expect("get"), "sepia");
    }

    #[test]
    fn save_theme_persists_across_reinitialization() {
        let (directory, store) = test_store();
        store.save_theme("dark").expect("save");
        drop(store);

        let recovered =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("reinit");
        assert_eq!(recovered.get_theme().expect("get"), "dark");
    }

    #[test]
    fn save_theme_rejects_invalid_theme() {
        let (_directory, store) = test_store();
        let error = store.save_theme("neon").expect_err("invalid theme");
        assert_eq!(error.code, crate::error::AppErrorCode::InvalidInput);
    }

    #[test]
    fn corrupt_preferences_is_overwritten_with_defaults() {
        let (directory, _store) = test_store();
        let path = directory.path().join("preferences.json");
        std::fs::write(&path, b"not json").expect("corrupt");

        let recovered =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("recover");
        assert_eq!(recovered.get_theme().expect("get"), "light");
    }

    #[test]
    fn invalid_theme_in_preferences_is_overwritten_with_defaults() {
        let (directory, _store) = test_store();
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            serde_json::to_vec_pretty(&PreferencesData {
                schema_version: PREFERENCES_SCHEMA_VERSION,
                theme: "neon".to_string(),
            })
            .expect("serialize"),
        )
        .expect("write invalid theme");

        let recovered =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("recover");
        assert_eq!(recovered.get_theme().expect("get"), "light");
    }

    #[test]
    fn unsupported_schema_version_is_overwritten_with_defaults() {
        let (directory, _store) = test_store();
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            serde_json::to_vec_pretty(&PreferencesData {
                schema_version: 99,
                theme: "light".to_string(),
            })
            .expect("serialize"),
        )
        .expect("write bad version");

        let recovered =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("recover");
        assert_eq!(recovered.get_theme().expect("get"), "light");
    }

    #[test]
    fn unavailable_store_returns_default_and_noops() {
        let store = PreferencesStore::unavailable();
        assert_eq!(store.get_theme().expect("get"), "light");
        store.save_theme("dark").expect("save should noop");
        assert_eq!(store.get_theme().expect("get"), "light");
    }
}