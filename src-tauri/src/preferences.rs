use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::library::{atomic_write, sync_parent_directory};

const PREFERENCES_SCHEMA_VERSION: u32 = 1;
const VALID_THEMES: [&str; 3] = ["light", "dark", "sepia"];
const VALID_LINE_HEIGHTS: [&str; 3] = ["compact", "normal", "relaxed"];
const VALID_PAGE_MARGINS: [&str; 3] = ["narrow", "normal", "wide"];
const VALID_TEXT_ALIGNS: [&str; 2] = ["start", "justify"];

fn default_line_height() -> String {
    "normal".to_string()
}

fn default_page_margin() -> String {
    "normal".to_string()
}

fn default_text_align() -> String {
    "start".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreferencesData {
    schema_version: u32,
    theme: String,
    #[serde(default = "default_line_height")]
    line_height: String,
    #[serde(default = "default_page_margin")]
    page_margin: String,
    #[serde(default = "default_text_align")]
    text_align: String,
}

impl Default for PreferencesData {
    fn default() -> Self {
        Self {
            schema_version: PREFERENCES_SCHEMA_VERSION,
            theme: "light".to_string(),
            line_height: default_line_height(),
            page_margin: default_page_margin(),
            text_align: default_text_align(),
        }
    }
}

impl PreferencesData {
    fn is_supported(&self) -> bool {
        self.schema_version == PREFERENCES_SCHEMA_VERSION
            && VALID_THEMES.contains(&self.theme.as_str())
            && VALID_LINE_HEIGHTS.contains(&self.line_height.as_str())
            && VALID_PAGE_MARGINS.contains(&self.page_margin.as_str())
            && VALID_TEXT_ALIGNS.contains(&self.text_align.as_str())
    }
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesResponse {
    pub theme: String,
    pub line_height: String,
    pub page_margin: String,
    pub text_align: String,
}

impl From<PreferencesData> for PreferencesResponse {
    fn from(data: PreferencesData) -> Self {
        Self {
            theme: data.theme,
            line_height: data.line_height,
            page_margin: data.page_margin,
            text_align: data.text_align,
        }
    }
}

#[derive(Debug, Default)]
struct PreferencesPatch {
    theme: Option<String>,
    line_height: Option<String>,
    page_margin: Option<String>,
    text_align: Option<String>,
}

impl PreferencesPatch {
    fn is_empty(&self) -> bool {
        self.theme.is_none()
            && self.line_height.is_none()
            && self.page_margin.is_none()
            && self.text_align.is_none()
    }
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
                    Ok(data) if data.is_supported() => {
                        // Valid v1 (including theme-only files with defaulted keys).
                        // Do not rewrite: adding new keys would break older builds.
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

    fn read_unlocked(&self) -> AppResult<PreferencesData> {
        let bytes = std::fs::read(&self.preferences_path())
            .map_err(|e| AppError::storage_io(format!("Failed to read preferences.json: {e}")))?;
        serde_json::from_slice(&bytes)
            .map_err(|e| AppError::storage_corrupt(format!("Failed to parse preferences.json: {e}")))
    }

    fn write_unlocked(&self, data: &PreferencesData) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(data)
            .map_err(|e| AppError::storage_io(format!("Failed to serialize preferences: {e}")))?;
        atomic_write(&self.preferences_path(), &json, "preferences.json")?;
        // sync_parent_directory is already called by atomic_write, but the
        // parent directory here is the app data root — sync it explicitly to
        // match library.rs durability guarantees.
        sync_parent_directory(&self.root, "app data directory")
    }

    pub fn get(&self) -> AppResult<PreferencesResponse> {
        if !self.is_available() {
            return Ok(PreferencesResponse::from(PreferencesData::default()));
        }
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Preferences lock is poisoned"))?;
        Ok(PreferencesResponse::from(self.read_unlocked()?))
    }

    #[cfg(test)]
    pub fn get_theme(&self) -> AppResult<String> {
        Ok(self.get()?.theme)
    }

    #[cfg(test)]
    pub fn save_theme(&self, theme: &str) -> AppResult<()> {
        self.save(PreferencesPatch {
            theme: Some(theme.to_string()),
            ..PreferencesPatch::default()
        })
    }

    fn save(&self, patch: PreferencesPatch) -> AppResult<()> {
        if self.is_available() {
            validate_patch(&patch)?;
        } else {
            return Ok(());
        }
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Preferences lock is poisoned"))?;
        let mut data = self.read_unlocked()?;
        if let Some(theme) = patch.theme {
            data.theme = theme;
        }
        if let Some(line_height) = patch.line_height {
            data.line_height = line_height;
        }
        if let Some(page_margin) = patch.page_margin {
            data.page_margin = page_margin;
        }
        if let Some(text_align) = patch.text_align {
            data.text_align = text_align;
        }
        self.write_unlocked(&data)
    }
}

fn validate_patch(patch: &PreferencesPatch) -> AppResult<()> {
    if patch.is_empty() {
        return Err(AppError::invalid_input(
            "At least one preference field is required",
        ));
    }
    if let Some(theme) = &patch.theme {
        if !VALID_THEMES.contains(&theme.as_str()) {
            return Err(AppError::invalid_input("Unsupported theme"));
        }
    }
    if let Some(line_height) = &patch.line_height {
        if !VALID_LINE_HEIGHTS.contains(&line_height.as_str()) {
            return Err(AppError::invalid_input("Unsupported lineHeight"));
        }
    }
    if let Some(page_margin) = &patch.page_margin {
        if !VALID_PAGE_MARGINS.contains(&page_margin.as_str()) {
            return Err(AppError::invalid_input("Unsupported pageMargin"));
        }
    }
    if let Some(text_align) = &patch.text_align {
        if !VALID_TEXT_ALIGNS.contains(&text_align.as_str()) {
            return Err(AppError::invalid_input("Unsupported textAlign"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_preferences(
    store: tauri::State<'_, PreferencesStore>,
) -> AppResult<PreferencesResponse> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.get())
        .await
        .map_err(|e| AppError::storage_io(format!("Preferences read worker failed: {e}")))?
}

#[tauri::command]
pub async fn save_preferences(
    store: tauri::State<'_, PreferencesStore>,
    theme: Option<String>,
    line_height: Option<String>,
    page_margin: Option<String>,
    text_align: Option<String>,
) -> AppResult<()> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.save(PreferencesPatch {
            theme,
            line_height,
            page_margin,
            text_align,
        })
    })
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
        assert_eq!(data.line_height, "normal");
        assert_eq!(data.page_margin, "normal");
        assert_eq!(data.text_align, "start");
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
                ..PreferencesData::default()
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
                ..PreferencesData::default()
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

    #[test]
    fn theme_only_file_loads_without_wiping_theme() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("preferences.json");
        std::fs::write(&path, br#"{"schemaVersion":1,"theme":"sepia"}"#).expect("write theme-only");

        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("init old file");
        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "sepia");
        assert_eq!(prefs.line_height, "normal");
        assert_eq!(prefs.page_margin, "normal");
        assert_eq!(prefs.text_align, "start");

        let raw = std::fs::read_to_string(&path).expect("read");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["theme"], "sepia");
        assert!(value.get("lineHeight").is_none());
        assert!(value.get("pageMargin").is_none());
        assert!(value.get("textAlign").is_none());
    }

    #[test]
    fn save_theme_does_not_drop_typography_keys() {
        let (_directory, store) = test_store();
        store
            .save(PreferencesPatch {
                line_height: Some("compact".to_string()),
                page_margin: Some("wide".to_string()),
                text_align: Some("justify".to_string()),
                ..PreferencesPatch::default()
            })
            .expect("save typography");
        store.save_theme("dark").expect("save theme");

        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "dark");
        assert_eq!(prefs.line_height, "compact");
        assert_eq!(prefs.page_margin, "wide");
        assert_eq!(prefs.text_align, "justify");
    }

    #[test]
    fn save_partial_typography_does_not_drop_theme() {
        let (_directory, store) = test_store();
        store.save_theme("sepia").expect("save theme");
        store
            .save(PreferencesPatch {
                line_height: Some("relaxed".to_string()),
                ..PreferencesPatch::default()
            })
            .expect("save line height");

        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "sepia");
        assert_eq!(prefs.line_height, "relaxed");
        assert_eq!(prefs.page_margin, "normal");
        assert_eq!(prefs.text_align, "start");
    }

    #[test]
    fn save_rejects_invalid_typography_enum() {
        let (_directory, store) = test_store();
        store.save_theme("dark").expect("save theme");
        let error = store
            .save(PreferencesPatch {
                line_height: Some("huge".to_string()),
                ..PreferencesPatch::default()
            })
            .expect_err("invalid lineHeight");
        assert_eq!(error.code, crate::error::AppErrorCode::InvalidInput);

        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "dark");
        assert_eq!(prefs.line_height, "normal");
    }

    #[test]
    fn save_rejects_empty_patch() {
        let (_directory, store) = test_store();
        let error = store
            .save(PreferencesPatch::default())
            .expect_err("empty patch");
        assert_eq!(error.code, crate::error::AppErrorCode::InvalidInput);
    }
}
