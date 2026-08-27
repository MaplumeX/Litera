use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::library::{
    atomic_write, deserialize_optional_line_height, in_typography_range, is_valid_font_family,
    split_page_margin, sync_parent_directory,
};

const PREFERENCES_SCHEMA_VERSION: u32 = 1;
const VALID_THEMES: [&str; 3] = ["light", "dark", "system"];
const VALID_TEXT_ALIGNS: [&str; 2] = ["start", "justify"];
const FONT_SIZE_RANGE: (f64, f64) = (12.0, 32.0);
const LINE_HEIGHT_RANGE: (f64, f64) = (1.2, 2.4);
const CONTENT_WIDTH_RANGE: (f64, f64) = (28.0, 60.0);
const PAGE_PADDING_RANGE: (f64, f64) = (0.5, 4.0);
const LETTER_SPACING_RANGE: (f64, f64) = (-0.05, 0.2);
const PARAGRAPH_SPACING_RANGE: (f64, f64) = (0.0, 2.0);
const FIRST_LINE_INDENT_RANGE: (f64, f64) = (0.0, 3.0);
const COLUMN_COUNT_RANGE: (i64, i64) = (1, 3);

fn default_font_size() -> f64 {
    16.0
}

fn default_font_family() -> String {
    "serif".to_string()
}

fn default_line_height() -> f64 {
    1.7
}

fn default_content_width() -> f64 {
    42.0
}

fn default_page_padding() -> f64 {
    1.75
}

fn default_text_align() -> String {
    "start".to_string()
}

fn default_letter_spacing() -> f64 {
    0.0
}

fn default_paragraph_spacing() -> f64 {
    1.0
}

fn default_first_line_indent() -> f64 {
    0.0
}

fn default_column_count() -> i64 {
    2
}

fn default_override_font() -> bool {
    false
}

fn default_override_layout() -> bool {
    false
}

fn clamp_or_default(value: Option<f64>, min: f64, max: f64, default: f64) -> f64 {
    match value {
        Some(number) if number.is_finite() => number.clamp(min, max),
        _ => default,
    }
}

fn clamp_column_count(value: Option<i64>) -> i64 {
    value
        .unwrap_or_else(default_column_count)
        .clamp(COLUMN_COUNT_RANGE.0, COLUMN_COUNT_RANGE.1)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreferencesDataRaw {
    schema_version: u32,
    theme: String,
    #[serde(default)]
    font_size: Option<f64>,
    #[serde(default)]
    font_family: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_line_height")]
    line_height: Option<f64>,
    #[serde(default)]
    content_width: Option<f64>,
    #[serde(default)]
    page_padding: Option<f64>,
    #[serde(default)]
    text_align: Option<String>,
    #[serde(default)]
    letter_spacing: Option<f64>,
    #[serde(default)]
    paragraph_spacing: Option<f64>,
    #[serde(default)]
    first_line_indent: Option<f64>,
    #[serde(default)]
    column_count: Option<i64>,
    #[serde(default)]
    override_font: Option<bool>,
    #[serde(default)]
    override_layout: Option<bool>,
    #[serde(default)]
    page_margin: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PreferencesData {
    schema_version: u32,
    theme: String,
    font_size: f64,
    font_family: String,
    line_height: f64,
    content_width: f64,
    page_padding: f64,
    text_align: String,
    letter_spacing: f64,
    paragraph_spacing: f64,
    first_line_indent: f64,
    column_count: i64,
    override_font: bool,
    override_layout: bool,
}

impl From<PreferencesDataRaw> for PreferencesData {
    fn from(raw: PreferencesDataRaw) -> Self {
        let split = raw.page_margin.as_deref().and_then(split_page_margin);
        Self {
            schema_version: raw.schema_version,
            // Migrate legacy "sepia" to "light" on read; the on-disk file
            // keeps "sepia" until the next write (migrate on read, no rewrite).
            theme: if raw.theme == "sepia" {
                "light".to_string()
            } else {
                raw.theme
            },
            font_size: clamp_or_default(
                raw.font_size,
                FONT_SIZE_RANGE.0,
                FONT_SIZE_RANGE.1,
                default_font_size(),
            ),
            font_family: raw.font_family.unwrap_or_else(default_font_family),
            line_height: clamp_or_default(
                raw.line_height,
                LINE_HEIGHT_RANGE.0,
                LINE_HEIGHT_RANGE.1,
                default_line_height(),
            ),
            content_width: clamp_or_default(
                raw.content_width.or(split.map(|(width, _)| width)),
                CONTENT_WIDTH_RANGE.0,
                CONTENT_WIDTH_RANGE.1,
                default_content_width(),
            ),
            page_padding: clamp_or_default(
                raw.page_padding.or(split.map(|(_, padding)| padding)),
                PAGE_PADDING_RANGE.0,
                PAGE_PADDING_RANGE.1,
                default_page_padding(),
            ),
            text_align: raw.text_align.unwrap_or_else(default_text_align),
            letter_spacing: clamp_or_default(
                raw.letter_spacing,
                LETTER_SPACING_RANGE.0,
                LETTER_SPACING_RANGE.1,
                default_letter_spacing(),
            ),
            paragraph_spacing: clamp_or_default(
                raw.paragraph_spacing,
                PARAGRAPH_SPACING_RANGE.0,
                PARAGRAPH_SPACING_RANGE.1,
                default_paragraph_spacing(),
            ),
            first_line_indent: clamp_or_default(
                raw.first_line_indent,
                FIRST_LINE_INDENT_RANGE.0,
                FIRST_LINE_INDENT_RANGE.1,
                default_first_line_indent(),
            ),
            column_count: clamp_column_count(raw.column_count),
            override_font: raw.override_font.unwrap_or_else(default_override_font),
            override_layout: raw.override_layout.unwrap_or_else(default_override_layout),
        }
    }
}

impl<'de> Deserialize<'de> for PreferencesData {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        PreferencesDataRaw::deserialize(deserializer).map(Into::into)
    }
}

impl Default for PreferencesData {
    fn default() -> Self {
        Self {
            schema_version: PREFERENCES_SCHEMA_VERSION,
            theme: "light".to_string(),
            font_size: default_font_size(),
            font_family: default_font_family(),
            line_height: default_line_height(),
            content_width: default_content_width(),
            page_padding: default_page_padding(),
            text_align: default_text_align(),
            letter_spacing: default_letter_spacing(),
            paragraph_spacing: default_paragraph_spacing(),
            first_line_indent: default_first_line_indent(),
            column_count: default_column_count(),
            override_font: default_override_font(),
            override_layout: default_override_layout(),
        }
    }
}

impl PreferencesData {
    fn is_supported(&self) -> bool {
        self.schema_version == PREFERENCES_SCHEMA_VERSION
            && VALID_THEMES.contains(&self.theme.as_str())
            && is_valid_font_family(&self.font_family)
            && VALID_TEXT_ALIGNS.contains(&self.text_align.as_str())
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesResponse {
    pub theme: String,
    pub font_size: f64,
    pub font_family: String,
    pub line_height: f64,
    pub content_width: f64,
    pub page_padding: f64,
    pub text_align: String,
    pub letter_spacing: f64,
    pub paragraph_spacing: f64,
    pub first_line_indent: f64,
    pub column_count: i64,
    pub override_font: bool,
    pub override_layout: bool,
}

impl From<PreferencesData> for PreferencesResponse {
    fn from(data: PreferencesData) -> Self {
        Self {
            theme: data.theme,
            font_size: data.font_size,
            font_family: data.font_family,
            line_height: data.line_height,
            content_width: data.content_width,
            page_padding: data.page_padding,
            text_align: data.text_align,
            letter_spacing: data.letter_spacing,
            paragraph_spacing: data.paragraph_spacing,
            first_line_indent: data.first_line_indent,
            column_count: data.column_count,
            override_font: data.override_font,
            override_layout: data.override_layout,
        }
    }
}

#[derive(Debug, Default)]
struct PreferencesPatch {
    theme: Option<String>,
    font_size: Option<f64>,
    font_family: Option<String>,
    line_height: Option<f64>,
    content_width: Option<f64>,
    page_padding: Option<f64>,
    text_align: Option<String>,
    letter_spacing: Option<f64>,
    paragraph_spacing: Option<f64>,
    first_line_indent: Option<f64>,
    column_count: Option<i64>,
    override_font: Option<bool>,
    override_layout: Option<bool>,
}

impl PreferencesPatch {
    fn is_empty(&self) -> bool {
        self.theme.is_none()
            && self.font_size.is_none()
            && self.font_family.is_none()
            && self.line_height.is_none()
            && self.content_width.is_none()
            && self.page_padding.is_none()
            && self.text_align.is_none()
            && self.letter_spacing.is_none()
            && self.paragraph_spacing.is_none()
            && self.first_line_indent.is_none()
            && self.column_count.is_none()
            && self.override_font.is_none()
            && self.override_layout.is_none()
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
        let bytes = std::fs::read(self.preferences_path())
            .map_err(|e| AppError::storage_io(format!("Failed to read preferences.json: {e}")))?;
        serde_json::from_slice(&bytes).map_err(|e| {
            AppError::storage_corrupt(format!("Failed to parse preferences.json: {e}"))
        })
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
        if let Some(font_size) = patch.font_size {
            data.font_size = font_size;
        }
        if let Some(font_family) = patch.font_family {
            data.font_family = font_family;
        }
        if let Some(line_height) = patch.line_height {
            data.line_height = line_height;
        }
        if let Some(content_width) = patch.content_width {
            data.content_width = content_width;
        }
        if let Some(page_padding) = patch.page_padding {
            data.page_padding = page_padding;
        }
        if let Some(text_align) = patch.text_align {
            data.text_align = text_align;
        }
        if let Some(letter_spacing) = patch.letter_spacing {
            data.letter_spacing = letter_spacing;
        }
        if let Some(paragraph_spacing) = patch.paragraph_spacing {
            data.paragraph_spacing = paragraph_spacing;
        }
        if let Some(first_line_indent) = patch.first_line_indent {
            data.first_line_indent = first_line_indent;
        }
        if let Some(column_count) = patch.column_count {
            data.column_count = column_count;
        }
        if let Some(override_font) = patch.override_font {
            data.override_font = override_font;
        }
        if let Some(override_layout) = patch.override_layout {
            data.override_layout = override_layout;
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
    if let Some(font_size) = patch.font_size {
        if !in_typography_range(font_size, FONT_SIZE_RANGE.0, FONT_SIZE_RANGE.1) {
            return Err(AppError::invalid_input(
                "fontSize must be a finite number between 12 and 32",
            ));
        }
    }
    if let Some(font_family) = &patch.font_family {
        if !is_valid_font_family(font_family) {
            return Err(AppError::invalid_input("Unsupported fontFamily"));
        }
    }
    if let Some(line_height) = patch.line_height {
        if !in_typography_range(line_height, LINE_HEIGHT_RANGE.0, LINE_HEIGHT_RANGE.1) {
            return Err(AppError::invalid_input(
                "lineHeight must be a finite number between 1.2 and 2.4",
            ));
        }
    }
    if let Some(content_width) = patch.content_width {
        if !in_typography_range(content_width, CONTENT_WIDTH_RANGE.0, CONTENT_WIDTH_RANGE.1) {
            return Err(AppError::invalid_input(
                "contentWidth must be a finite number between 28 and 60",
            ));
        }
    }
    if let Some(page_padding) = patch.page_padding {
        if !in_typography_range(page_padding, PAGE_PADDING_RANGE.0, PAGE_PADDING_RANGE.1) {
            return Err(AppError::invalid_input(
                "pagePadding must be a finite number between 0.5 and 4",
            ));
        }
    }
    if let Some(text_align) = &patch.text_align {
        if !VALID_TEXT_ALIGNS.contains(&text_align.as_str()) {
            return Err(AppError::invalid_input("Unsupported textAlign"));
        }
    }
    if let Some(letter_spacing) = patch.letter_spacing {
        if !in_typography_range(
            letter_spacing,
            LETTER_SPACING_RANGE.0,
            LETTER_SPACING_RANGE.1,
        ) {
            return Err(AppError::invalid_input(
                "letterSpacing must be a finite number between -0.05 and 0.2",
            ));
        }
    }
    if let Some(paragraph_spacing) = patch.paragraph_spacing {
        if !in_typography_range(
            paragraph_spacing,
            PARAGRAPH_SPACING_RANGE.0,
            PARAGRAPH_SPACING_RANGE.1,
        ) {
            return Err(AppError::invalid_input(
                "paragraphSpacing must be a finite number between 0 and 2",
            ));
        }
    }
    if let Some(first_line_indent) = patch.first_line_indent {
        if !in_typography_range(
            first_line_indent,
            FIRST_LINE_INDENT_RANGE.0,
            FIRST_LINE_INDENT_RANGE.1,
        ) {
            return Err(AppError::invalid_input(
                "firstLineIndent must be a finite number between 0 and 3",
            ));
        }
    }
    if let Some(column_count) = patch.column_count {
        if !(COLUMN_COUNT_RANGE.0..=COLUMN_COUNT_RANGE.1).contains(&column_count) {
            return Err(AppError::invalid_input(
                "columnCount must be an integer between 1 and 3",
            ));
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
#[allow(clippy::too_many_arguments)]
pub async fn save_preferences(
    store: tauri::State<'_, PreferencesStore>,
    theme: Option<String>,
    font_size: Option<f64>,
    font_family: Option<String>,
    line_height: Option<f64>,
    content_width: Option<f64>,
    page_padding: Option<f64>,
    text_align: Option<String>,
    letter_spacing: Option<f64>,
    paragraph_spacing: Option<f64>,
    first_line_indent: Option<f64>,
    column_count: Option<i64>,
    override_font: Option<bool>,
    override_layout: Option<bool>,
) -> AppResult<()> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.save(PreferencesPatch {
            theme,
            font_size,
            font_family,
            line_height,
            content_width,
            page_padding,
            text_align,
            letter_spacing,
            paragraph_spacing,
            first_line_indent,
            column_count,
            override_font,
            override_layout,
        })
    })
    .await
    .map_err(|e| AppError::storage_io(format!("Preferences write worker failed: {e}")))?
}

fn collect_system_font_families() -> AppResult<Vec<String>> {
    let mut families = font_kit::source::SystemSource::new()
        .all_families()
        .map_err(|error| AppError::storage_io(format!("Failed to list system fonts: {error}")))?;
    families.retain(|name| is_valid_font_family(name));
    families.sort();
    families.dedup();
    Ok(families)
}

#[tauri::command]
pub async fn list_system_fonts() -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(collect_system_font_families)
        .await
        .map_err(|e| AppError::storage_io(format!("Font listing worker failed: {e}")))?
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
        assert_eq!(data.font_size, 16.0);
        assert_eq!(data.font_family, "serif");
        assert_eq!(data.line_height, 1.7);
        assert_eq!(data.content_width, 42.0);
        assert_eq!(data.page_padding, 1.75);
        assert_eq!(data.text_align, "start");
        assert_eq!(data.letter_spacing, 0.0);
        assert_eq!(data.paragraph_spacing, 1.0);
        assert_eq!(data.first_line_indent, 0.0);
        assert_eq!(data.column_count, 2);
        assert!(!data.override_font);
        assert!(!data.override_layout);

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).expect("read")).expect("parse raw");
        assert!(value.get("pageMargin").is_none());
    }

    #[test]
    fn get_theme_returns_persisted_value() {
        let (_directory, store) = test_store();
        store.save_theme("system").expect("save");
        assert_eq!(store.get_theme().expect("get"), "system");
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
        assert_eq!(prefs.theme, "light");
        assert_eq!(prefs.font_size, 16.0);
        assert_eq!(prefs.font_family, "serif");
        assert_eq!(prefs.line_height, 1.7);
        assert_eq!(prefs.content_width, 42.0);
        assert_eq!(prefs.page_padding, 1.75);
        assert_eq!(prefs.text_align, "start");
        assert_eq!(prefs.letter_spacing, 0.0);
        assert_eq!(prefs.paragraph_spacing, 1.0);
        assert_eq!(prefs.first_line_indent, 0.0);
        assert!(!prefs.override_font);
        assert!(!prefs.override_layout);

        let raw = std::fs::read_to_string(&path).expect("read");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["theme"], "sepia");
        assert!(value.get("lineHeight").is_none());
        assert!(value.get("pageMargin").is_none());
        assert!(value.get("contentWidth").is_none());
        assert!(value.get("textAlign").is_none());
        assert!(value.get("overrideFont").is_none());
        assert!(value.get("overrideLayout").is_none());
    }

    #[test]
    fn old_enum_file_migrates_on_read_without_rewrite() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            br#"{"schemaVersion":1,"theme":"sepia","lineHeight":"normal","pageMargin":"wide","textAlign":"justify"}"#,
        )
        .expect("write old enums");

        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("init old file");
        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "light");
        assert_eq!(prefs.line_height, 1.7);
        assert_eq!(prefs.content_width, 52.0);
        assert_eq!(prefs.page_padding, 2.5);
        assert_eq!(prefs.text_align, "justify");

        let raw = std::fs::read_to_string(&path).expect("read");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(value["theme"], "sepia");
        assert_eq!(value["lineHeight"], "normal");
        assert_eq!(value["pageMargin"], "wide");
        assert!(value.get("contentWidth").is_none());
    }

    #[test]
    fn save_theme_does_not_drop_typography_keys() {
        let (_directory, store) = test_store();
        store
            .save(PreferencesPatch {
                font_size: Some(18.0),
                font_family: Some("sans-serif".to_string()),
                line_height: Some(1.4),
                content_width: Some(52.0),
                page_padding: Some(2.5),
                text_align: Some("justify".to_string()),
                letter_spacing: Some(0.05),
                paragraph_spacing: Some(1.2),
                first_line_indent: Some(2.0),
                ..PreferencesPatch::default()
            })
            .expect("save typography");
        store.save_theme("dark").expect("save theme");

        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "dark");
        assert_eq!(prefs.font_size, 18.0);
        assert_eq!(prefs.font_family, "sans-serif");
        assert_eq!(prefs.line_height, 1.4);
        assert_eq!(prefs.content_width, 52.0);
        assert_eq!(prefs.page_padding, 2.5);
        assert_eq!(prefs.text_align, "justify");
        assert_eq!(prefs.letter_spacing, 0.05);
        assert_eq!(prefs.paragraph_spacing, 1.2);
        assert_eq!(prefs.first_line_indent, 2.0);
    }

    #[test]
    fn save_partial_typography_does_not_drop_theme() {
        let (_directory, store) = test_store();
        store.save_theme("system").expect("save theme");
        store
            .save(PreferencesPatch {
                line_height: Some(2.0),
                ..PreferencesPatch::default()
            })
            .expect("save line height");

        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "system");
        assert_eq!(prefs.line_height, 2.0);
        assert_eq!(prefs.content_width, 42.0);
        assert_eq!(prefs.text_align, "start");
    }

    #[test]
    fn save_numbers_persist_and_omit_page_margin() {
        let (directory, store) = test_store();
        store
            .save(PreferencesPatch {
                line_height: Some(1.85),
                content_width: Some(48.0),
                page_padding: Some(2.0),
                letter_spacing: Some(-0.02),
                ..PreferencesPatch::default()
            })
            .expect("save numbers");

        let prefs = store.get().expect("get");
        assert_eq!(prefs.line_height, 1.85);
        assert_eq!(prefs.content_width, 48.0);
        assert_eq!(prefs.page_padding, 2.0);
        assert_eq!(prefs.letter_spacing, -0.02);

        drop(store);
        let recovered =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("reinit");
        let prefs = recovered.get().expect("get recovered");
        assert_eq!(prefs.line_height, 1.85);
        assert_eq!(prefs.content_width, 48.0);

        let value: serde_json::Value = serde_json::from_slice(
            &std::fs::read(directory.path().join("preferences.json")).expect("read"),
        )
        .expect("parse");
        assert!(value.get("pageMargin").is_none());
    }

    #[test]
    fn save_theme_on_old_enum_file_writes_split_fields() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            br#"{"schemaVersion":1,"theme":"sepia","lineHeight":"compact","pageMargin":"wide","textAlign":"start"}"#,
        )
        .expect("write old enums");

        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("init old file");
        store.save_theme("dark").expect("save theme");

        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "dark");
        assert_eq!(prefs.line_height, 1.4);
        assert_eq!(prefs.content_width, 52.0);
        assert_eq!(prefs.page_padding, 2.5);

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).expect("read")).expect("parse");
        assert_eq!(value["lineHeight"], 1.4);
        assert_eq!(value["contentWidth"], 52.0);
        assert_eq!(value["pagePadding"], 2.5);
        assert!(value.get("pageMargin").is_none());
    }

    #[test]
    fn save_rejects_out_of_range_typography() {
        let (_directory, store) = test_store();
        store.save_theme("dark").expect("save theme");
        let error = store
            .save(PreferencesPatch {
                line_height: Some(3.0),
                ..PreferencesPatch::default()
            })
            .expect_err("out of range lineHeight");
        assert_eq!(error.code, crate::error::AppErrorCode::InvalidInput);

        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "dark");
        assert_eq!(prefs.line_height, 1.7);
    }

    #[test]
    fn save_rejects_empty_patch() {
        let (_directory, store) = test_store();
        let error = store
            .save(PreferencesPatch::default())
            .expect_err("empty patch");
        assert_eq!(error.code, crate::error::AppErrorCode::InvalidInput);
    }

    #[test]
    fn save_named_font_family() {
        let (_directory, store) = test_store();
        store
            .save(PreferencesPatch {
                font_family: Some("Source Han Serif".to_string()),
                ..PreferencesPatch::default()
            })
            .expect("save named font");
        assert_eq!(store.get().expect("get").font_family, "Source Han Serif");
    }

    #[test]
    fn save_rejects_invalid_font_family() {
        let (_directory, store) = test_store();
        for value in [
            String::new(),
            "   ".to_string(),
            "bad;font".to_string(),
            "foo{bar}".to_string(),
            "a".repeat(129),
            "\u{0007}Bell".to_string(),
        ] {
            let error = store
                .save(PreferencesPatch {
                    font_family: Some(value),
                    ..PreferencesPatch::default()
                })
                .expect_err("invalid font");
            assert_eq!(error.code, crate::error::AppErrorCode::InvalidInput);
        }
        assert_eq!(store.get().expect("get").font_family, "serif");
    }

    #[test]
    fn named_font_family_is_not_treated_as_corrupt() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            br#"{"schemaVersion":1,"theme":"sepia","fontFamily":"Noto Sans CJK SC"}"#,
        )
        .expect("write named font");

        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("init named font");
        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "light");
        assert_eq!(prefs.font_family, "Noto Sans CJK SC");

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("parse");
        assert_eq!(value["theme"], "sepia");
        assert_eq!(value["fontFamily"], "Noto Sans CJK SC");
        assert!(value.get("lineHeight").is_none());
    }

    #[test]
    fn old_generic_font_families_still_load() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            br#"{"schemaVersion":1,"theme":"dark","fontFamily":"monospace"}"#,
        )
        .expect("write generic font");

        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("init generic");
        let prefs = store.get().expect("get");
        assert_eq!(prefs.theme, "dark");
        assert_eq!(prefs.font_family, "monospace");

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("parse");
        assert_eq!(value["fontFamily"], "monospace");
        assert_eq!(value["theme"], "dark");
        assert!(value.get("fontSize").is_none());
    }

    #[test]
    fn save_override_flags_persist_true() {
        let (directory, store) = test_store();
        store
            .save(PreferencesPatch {
                override_font: Some(true),
                override_layout: Some(true),
                ..PreferencesPatch::default()
            })
            .expect("save override flags");

        let prefs = store.get().expect("get");
        assert!(prefs.override_font);
        assert!(prefs.override_layout);

        drop(store);
        let recovered =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("reinit");
        let prefs = recovered.get().expect("get recovered");
        assert!(prefs.override_font);
        assert!(prefs.override_layout);

        let value: serde_json::Value = serde_json::from_slice(
            &std::fs::read(directory.path().join("preferences.json")).expect("read"),
        )
        .expect("parse");
        assert_eq!(value["overrideFont"], true);
        assert_eq!(value["overrideLayout"], true);
    }

    #[test]
    fn save_override_flags_persist_false() {
        let (_directory, store) = test_store();
        store
            .save(PreferencesPatch {
                override_font: Some(true),
                override_layout: Some(true),
                ..PreferencesPatch::default()
            })
            .expect("save override flags on");
        store
            .save(PreferencesPatch {
                override_font: Some(false),
                override_layout: Some(false),
                ..PreferencesPatch::default()
            })
            .expect("save override flags off");

        let prefs = store.get().expect("get");
        assert!(!prefs.override_font);
        assert!(!prefs.override_layout);
    }

    #[test]
    fn column_count_defaults_and_clamps_on_load() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("preferences.json");
        std::fs::write(&path, br#"{"schemaVersion":1,"theme":"dark"}"#)
            .expect("write without columnCount");

        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("init");
        assert_eq!(store.get().expect("get").column_count, 2);

        std::fs::write(
            &path,
            br#"{"schemaVersion":1,"theme":"dark","columnCount":3}"#,
        )
        .expect("write columnCount 3");
        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("reinit");
        assert_eq!(store.get().expect("get").column_count, 3);

        // Out-of-range stored values clamp into 1–3 on load.
        for (raw, expected) in [(0, 1), (4, 3)] {
            std::fs::write(
                &path,
                format!(r#"{{"schemaVersion":1,"theme":"dark","columnCount":{raw}}}"#),
            )
            .expect("write out of range columnCount");
            let store = PreferencesStore::initialize(directory.path().to_path_buf())
                .expect("reinit out of range");
            assert_eq!(store.get().expect("get").column_count, expected);
        }
    }

    #[test]
    fn save_column_count_persists_and_rejects_out_of_range() {
        let (directory, store) = test_store();
        store
            .save(PreferencesPatch {
                column_count: Some(3),
                ..PreferencesPatch::default()
            })
            .expect("save column count");
        assert_eq!(store.get().expect("get").column_count, 3);

        drop(store);
        let recovered =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("reinit");
        assert_eq!(recovered.get().expect("get recovered").column_count, 3);

        let (_directory, store) = test_store();
        for count in [0, 4] {
            let error = store
                .save(PreferencesPatch {
                    column_count: Some(count),
                    ..PreferencesPatch::default()
                })
                .expect_err("out of range columnCount");
            assert_eq!(error.code, crate::error::AppErrorCode::InvalidInput);
        }
        assert_eq!(store.get().expect("get").column_count, 2);
    }

    #[test]
    fn missing_override_keys_load_as_false() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            br#"{"schemaVersion":1,"theme":"dark","fontSize":18}"#,
        )
        .expect("write without override keys");

        let store =
            PreferencesStore::initialize(directory.path().to_path_buf()).expect("init");
        let prefs = store.get().expect("get");
        assert!(!prefs.override_font);
        assert!(!prefs.override_layout);

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("parse");
        assert!(value.get("overrideFont").is_none());
        assert!(value.get("overrideLayout").is_none());
    }
}
