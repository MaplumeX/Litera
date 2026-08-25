use std::collections::{hash_map::DefaultHasher, HashSet};
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

use crate::error::{AppError, AppResult};
use image::ImageEncoder;

const SCHEMA_VERSION: u32 = 1;
const ANNOTATIONS_SCHEMA_VERSION: u32 = 1;
const MAX_TITLE_BYTES: usize = 4 * 1024;
const MAX_AUTHOR_BYTES: usize = 4 * 1024;
const MAX_DESCRIPTION_BYTES: usize = 32 * 1024;
const MAX_CFI_BYTES: usize = 8 * 1024;
const MAX_EXCERPT_BYTES: usize = 4 * 1024;
const MAX_LABEL_BYTES: usize = 4 * 1024;
const MAX_ANNOTATION_ID_BYTES: usize = 128;
const VALID_HIGHLIGHT_COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "orange"];
const MAX_COVER_BYTES: usize = 20 * 1024 * 1024;
const COVER_MAX_EDGE: u32 = 512;
const COVER_JPEG_QUALITY: u8 = 85;
const FONT_SIZE_RANGE: (f64, f64) = (12.0, 32.0);
const LINE_HEIGHT_RANGE: (f64, f64) = (1.2, 2.4);
const CONTENT_WIDTH_RANGE: (f64, f64) = (28.0, 60.0);
const PAGE_PADDING_RANGE: (f64, f64) = (0.5, 4.0);
const LETTER_SPACING_RANGE: (f64, f64) = (-0.05, 0.2);
const PARAGRAPH_SPACING_RANGE: (f64, f64) = (0.0, 2.0);
const FIRST_LINE_INDENT_RANGE: (f64, f64) = (0.0, 3.0);
const GENERIC_FONT_FAMILIES: [&str; 3] = ["serif", "sans-serif", "monospace"];
const MAX_FONT_FAMILY_CHARS: usize = 128;
const VALID_THEMES: [&str; 3] = ["light", "dark", "sepia"];
const VALID_PAGE_MARGINS: [&str; 3] = ["narrow", "normal", "wide"];
const VALID_TEXT_ALIGNS: [&str; 2] = ["start", "justify"];
static OPERATION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct ReadingSettings {
    #[serde(rename = "fontSize", skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(rename = "fontFamily", skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(
        rename = "lineHeight",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_line_height"
    )]
    pub line_height: Option<f64>,
    #[serde(rename = "pageMargin", skip_serializing_if = "Option::is_none")]
    pub page_margin: Option<String>,
    #[serde(rename = "contentWidth", skip_serializing_if = "Option::is_none")]
    pub content_width: Option<f64>,
    #[serde(rename = "pagePadding", skip_serializing_if = "Option::is_none")]
    pub page_padding: Option<f64>,
    #[serde(rename = "textAlign", skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
    #[serde(rename = "letterSpacing", skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,
    #[serde(rename = "paragraphSpacing", skip_serializing_if = "Option::is_none")]
    pub paragraph_spacing: Option<f64>,
    #[serde(rename = "firstLineIndent", skip_serializing_if = "Option::is_none")]
    pub first_line_indent: Option<f64>,
    #[serde(
        rename = "overrideFont",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub override_font: Option<bool>,
    #[serde(
        rename = "overrideLayout",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub override_layout: Option<bool>,
}

impl ReadingSettings {
    fn is_empty(&self) -> bool {
        self.font_size.is_none()
            && self.font_family.is_none()
            && self.theme.is_none()
            && self.line_height.is_none()
            && self.page_margin.is_none()
            && self.content_width.is_none()
            && self.page_padding.is_none()
            && self.text_align.is_none()
            && self.letter_spacing.is_none()
            && self.paragraph_spacing.is_none()
            && self.first_line_indent.is_none()
            && self.override_font.is_none()
            && self.override_layout.is_none()
    }
}

pub(crate) fn parse_line_height(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(number) => number.as_f64().filter(|item| item.is_finite()),
        serde_json::Value::String(text) => match text.as_str() {
            "compact" => Some(1.4),
            "normal" => Some(1.7),
            "relaxed" => Some(2.0),
            other => other.parse::<f64>().ok().filter(|item| item.is_finite()),
        },
        _ => None,
    }
}

pub(crate) fn deserialize_optional_line_height<'de, D>(
    deserializer: D,
) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(raw) => parse_line_height(&raw)
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom("invalid lineHeight")),
    }
}

pub(crate) fn split_page_margin(value: &str) -> Option<(f64, f64)> {
    match value {
        "narrow" => Some((36.0, 1.25)),
        "normal" => Some((42.0, 1.75)),
        "wide" => Some((52.0, 2.5)),
        _ => None,
    }
}

pub(crate) fn in_typography_range(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && value >= min && value <= max
}

/// Accept the three CSS generics, or a named family that cannot break CSS / JSON.
/// Named fonts are not required to be installed — missing faces fall back in CSS.
pub(crate) fn is_valid_font_family(value: &str) -> bool {
    if GENERIC_FONT_FAMILIES.contains(&value) {
        return true;
    }
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_FONT_FAMILY_CHARS {
        return false;
    }
    !value.chars().any(|ch| {
        let code = ch as u32;
        code < 0x20 || ch == ';' || ch == '{' || ch == '}'
    })
}

fn is_valid_reader_mode(value: &str) -> bool {
    value == "reader" || value == "agent"
}

fn validate_reader_mode(value: &str) -> AppResult<()> {
    if is_valid_reader_mode(value) {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "lastReaderMode must be \"reader\" or \"agent\"",
        ))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReaderLayout {
    pub chat_collapsed: bool,
    pub book_collapsed: bool,
    pub session_rail_open: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BookRecord {
    pub id: String,
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
    #[serde(rename = "coverPath")]
    pub cover_path: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "importedAt")]
    pub imported_at: String,
    #[serde(rename = "lastFraction", skip_serializing_if = "Option::is_none")]
    pub last_fraction: Option<f64>,
    #[serde(rename = "lastCfi", default, skip_serializing_if = "Option::is_none")]
    pub last_cfi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<ReadingSettings>,
    #[serde(
        rename = "lastOpenedAt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub last_opened_at: Option<String>,
    #[serde(
        rename = "contentHash",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub content_hash: Option<String>,
    #[serde(
        rename = "contentVersion",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    content_version: Option<String>,
    #[serde(
        rename = "lastReaderMode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub last_reader_mode: Option<String>,
    #[serde(
        rename = "lastLayout",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub last_layout: Option<ReaderLayout>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImportStatus {
    New,
    Overwrite,
    Duplicate,
}

#[derive(Debug, Serialize)]
pub struct ImportBookResult {
    pub status: ImportStatus,
    #[serde(rename = "bookId")]
    pub book_id: String,
    pub title: String,
    #[serde(rename = "importId", skip_serializing_if = "Option::is_none")]
    pub import_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct BookOpenContext {
    pub name: String,
    pub title: String,
    #[serde(rename = "bookId")]
    pub book_id: String,
    #[serde(rename = "contentVersion")]
    pub content_version: String,
    #[serde(rename = "lastFraction", skip_serializing_if = "Option::is_none")]
    pub last_fraction: Option<f64>,
    #[serde(rename = "lastCfi", skip_serializing_if = "Option::is_none")]
    pub last_cfi: Option<String>,
    pub settings: Option<ReadingSettings>,
    #[serde(rename = "lastReaderMode", skip_serializing_if = "Option::is_none")]
    pub last_reader_mode: Option<String>,
    #[serde(rename = "lastLayout", skip_serializing_if = "Option::is_none")]
    pub last_layout: Option<ReaderLayout>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookmarkRecord {
    pub id: String,
    pub cfi: String,
    pub fraction: f64,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

fn skip_none_or_empty(value: &Option<String>) -> bool {
    match value {
        None => true,
        Some(s) => s.is_empty(),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HighlightRecord {
    pub id: String,
    pub cfi: String,
    pub excerpt: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "skip_none_or_empty")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "skip_none_or_empty")]
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationsFile {
    pub schema_version: u32,
    #[serde(default)]
    pub bookmarks: Vec<BookmarkRecord>,
    #[serde(default)]
    pub highlights: Vec<HighlightRecord>,
}

impl AnnotationsFile {
    fn empty() -> Self {
        Self {
            schema_version: ANNOTATIONS_SCHEMA_VERSION,
            bookmarks: Vec::new(),
            highlights: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct BookContent {
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LibraryData {
    schema_version: u32,
    books: Vec<BookRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportTransactionManifest {
    had_cover: bool,
    /// The file name of the existing cover (e.g. "cover.jpg" or "cover.png")
    /// so that rollback restores it to the correct path.
    cover_name: Option<String>,
}

impl LibraryData {
    fn empty() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            books: Vec::new(),
        }
    }
}

#[derive(Clone)]
pub struct LibraryStore {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
    initialization_error: Option<AppError>,
    #[cfg(test)]
    fail_next_library_write: Arc<std::sync::atomic::AtomicBool>,
}

impl LibraryStore {
    pub fn initialize(root: PathBuf) -> AppResult<Self> {
        initialize_root(&root)?;
        Ok(Self::ready(root))
    }

    pub fn unavailable(root: PathBuf, error: AppError) -> Self {
        Self {
            root,
            gate: Arc::new(Mutex::new(())),
            initialization_error: Some(error),
            #[cfg(test)]
            fail_next_library_write: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    fn ready(root: PathBuf) -> Self {
        Self {
            root,
            gate: Arc::new(Mutex::new(())),
            initialization_error: None,
            #[cfg(test)]
            fail_next_library_write: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    fn transaction(&self) -> AppResult<MutexGuard<'_, ()>> {
        if let Some(error) = &self.initialization_error {
            return Err(error.clone());
        }
        self.gate
            .lock()
            .map_err(|_| AppError::storage_io("Library transaction lock is poisoned"))
    }

    fn library_path(&self) -> PathBuf {
        self.root.join("library.json")
    }

    fn books_root(&self) -> PathBuf {
        self.root.join("books")
    }

    fn trash_root(&self) -> PathBuf {
        self.books_root().join(".trash")
    }

    fn sessions_root(&self) -> PathBuf {
        self.root.join("sessions")
    }

    fn book_dir(&self, book_id: &str) -> AppResult<PathBuf> {
        validate_book_id(book_id)?;
        let books_root = self.books_root();
        let target = books_root.join(book_id);
        if target.parent() != Some(books_root.as_path()) {
            return Err(AppError::invalid_input("Invalid bookId path"));
        }
        Ok(target)
    }

    fn pending_import_path(&self, book_id: &str, import_id: &str) -> AppResult<PathBuf> {
        validate_import_id(import_id)?;
        let imports_root = self.book_dir(book_id)?.join(".imports");
        let target = imports_root.join(format!("{import_id}.epub"));
        if target.parent() != Some(imports_root.as_path()) {
            return Err(AppError::invalid_input("Invalid importId path"));
        }
        Ok(target)
    }

    fn read_library(&self) -> AppResult<LibraryData> {
        require_real_directory(&self.books_root(), "books")?;
        require_real_directory(&self.trash_root(), "library trash")?;
        require_real_directory(&self.sessions_root(), "sessions")?;
        read_library_file(&self.root, &self.library_path())
    }

    fn write_library(&self, data: &LibraryData) -> AppResult<()> {
        #[cfg(test)]
        if self
            .fail_next_library_write
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(AppError::storage_io("Injected library write failure"));
        }

        let json = serde_json::to_vec_pretty(data).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize library: {error}"))
        })?;
        recoverable_atomic_write(&self.library_path(), &json, "library.json")
    }

    pub fn list_books(&self) -> AppResult<Vec<BookRecord>> {
        let _guard = self.transaction()?;
        let mut books = self.read_library()?.books;
        books.sort_by(|left, right| {
            match (&left.last_opened_at, &right.last_opened_at) {
                (Some(left_opened), Some(right_opened)) => right_opened.cmp(left_opened),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
            .then_with(|| right.imported_at.cmp(&left.imported_at))
        });
        Ok(books)
    }

    pub fn import_bytes(
        &self,
        source_path: &Path,
        display_name: String,
        bytes: Vec<u8>,
    ) -> AppResult<ImportBookResult> {
        let book_id = book_id_for_source(source_path);
        validate_book_id(&book_id)?;
        if bytes.is_empty() {
            return Err(AppError::invalid_input("EPUB file is empty"));
        }
        validate_text("filename", &display_name, MAX_TITLE_BYTES, false)?;

        let incoming_hash = sha256_hex(&bytes);
        let _guard = self.transaction()?;
        let mut library = self.read_library()?;
        if self.backfill_missing_content_hashes(&mut library)? {
            self.write_library(&library)?;
        }

        if let Some(existing) = library
            .books
            .iter()
            .find(|book| book.content_hash.as_deref() == Some(incoming_hash.as_str()))
        {
            return Ok(ImportBookResult {
                status: ImportStatus::Duplicate,
                book_id: existing.id.clone(),
                title: existing.title.clone(),
                import_id: None,
                name: display_name,
            });
        }

        let book_dir = self.book_dir(&book_id)?;
        let epub_path = book_dir.join("book.epub");
        let existed = library.books.iter().any(|book| book.id == book_id);
        let existing_title = library
            .books
            .iter()
            .find(|book| book.id == book_id)
            .map(|book| book.title.clone());
        // This token is returned to the WebView and authorizes access to one
        // staged import. Keep it unpredictable rather than reusing the
        // timestamp-based identifiers used only for internal trash paths.
        let import_id = uuid::Uuid::new_v4().simple().to_string();
        let pending_path = self.pending_import_path(&book_id, &import_id)?;

        if existed {
            require_real_directory(&book_dir, "book directory")?;
        } else if fs::symlink_metadata(&book_dir).is_ok() {
            return Err(AppError::storage_corrupt(format!(
                "Unregistered book path already exists: {}",
                book_dir.display()
            )));
        } else {
            fs::create_dir(&book_dir).map_err(|error| {
                AppError::storage_io(format!("Failed to create book directory: {error}"))
            })?;
        }
        ensure_real_directory(&book_dir.join(".imports"), "pending import directory")?;
        if let Err(error) = atomic_write(&pending_path, &bytes, "pending EPUB") {
            if !existed {
                let _ = fs::remove_dir_all(&book_dir);
            }
            return Err(error);
        }

        if !existed {
            if let Err(error) = atomic_write(&epub_path, &bytes, "EPUB") {
                let _ = fs::remove_dir_all(&book_dir);
                return Err(error);
            }
            library.books.push(BookRecord {
                id: book_id.clone(),
                title: display_name.clone(),
                author: String::new(),
                description: None,
                publisher: None,
                language: None,
                series: None,
                cover_path: String::new(),
                file_path: epub_path.to_string_lossy().into_owned(),
                imported_at: Utc::now().to_rfc3339(),
                last_fraction: None,
                last_cfi: None,
                settings: None,
                last_opened_at: None,
                content_hash: Some(incoming_hash),
                content_version: Some(import_id.clone()),
                last_reader_mode: None,
                last_layout: None,
            });
            if let Err(error) = self.write_library(&library) {
                let rollback = fs::remove_dir_all(&book_dir);
                if let Err(rollback_error) = rollback {
                    return Err(AppError::rollback_failed(format!(
                        "Failed to persist imported book ({error}); failed to remove staged book: {rollback_error}"
                    )));
                }
                return Err(error);
            }
        }

        Ok(ImportBookResult {
            status: if existed {
                ImportStatus::Overwrite
            } else {
                ImportStatus::New
            },
            book_id,
            title: existing_title.unwrap_or_else(|| display_name.clone()),
            import_id: Some(import_id),
            name: display_name,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_book_metadata(
        &self,
        book_id: &str,
        title: String,
        author: String,
        description: String,
        publisher: String,
        language: String,
        series: String,
        cover_bytes: Option<Vec<u8>>,
        import_id: &str,
    ) -> AppResult<BookRecord> {
        validate_book_id(book_id)?;
        validate_import_id(import_id)?;
        validate_text("title", &title, MAX_TITLE_BYTES, false)?;
        validate_text("author", &author, MAX_AUTHOR_BYTES, true)?;
        let description = optional_shelf_text("description", description, MAX_DESCRIPTION_BYTES)?;
        let publisher = optional_shelf_text("publisher", publisher, MAX_AUTHOR_BYTES)?;
        let language = optional_shelf_text("language", language, MAX_AUTHOR_BYTES)?;
        let series = optional_shelf_text("series", series, MAX_AUTHOR_BYTES)?;
        if cover_bytes
            .as_ref()
            .is_some_and(|bytes| bytes.len() > MAX_COVER_BYTES)
        {
            return Err(AppError::invalid_input(format!(
                "cover exceeds {MAX_COVER_BYTES} bytes"
            )));
        }

        let _guard = self.transaction()?;
        let mut library = self.read_library()?;
        let record_index = library
            .books
            .iter()
            .position(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;

        let book_dir = self.book_dir(book_id)?;
        let epub_path = book_dir.join("book.epub");
        let cover_path = book_dir.join("cover.jpg");
        let new_cover = cover_bytes
            .filter(|bytes| !bytes.is_empty())
            .map(|bytes| compress_cover(&bytes));
        let old_cover = read_optional_regular_file(&cover_path, "existing cover")?;

        let pending = self.pending_import_path(book_id, import_id)?;
        let pending_bytes = {
            let path = &pending;
            require_regular_file(path, "staged EPUB")?;
            fs::read(path).map_err(|error| match error.kind() {
                std::io::ErrorKind::NotFound => {
                    AppError::invalid_input("Import transaction is missing or expired")
                }
                _ => AppError::storage_io(format!(
                    "Failed to read staged import transaction: {error}"
                )),
            })
        }?;
        if pending_bytes.is_empty() {
            return Err(AppError::storage_corrupt("Staged EPUB is empty"));
        }
        let is_reimport = library.books[record_index].content_version.as_deref() != Some(import_id);
        let transaction_dir = if is_reimport {
            Some(prepare_import_transaction(&book_dir, import_id)?)
        } else {
            None
        };

        if is_reimport {
            if let Err(error) = atomic_write(&epub_path, &pending_bytes, "EPUB") {
                rollback_import_or_error(transaction_dir.as_deref(), &book_dir, &error)?;
                return Err(error);
            }
        }

        if let Some(bytes) = &new_cover {
            if let Err(error) = atomic_write(&cover_path, bytes, "cover") {
                if let Some(transaction_dir) = transaction_dir.as_deref() {
                    rollback_import_or_error(Some(transaction_dir), &book_dir, &error)?;
                } else {
                    restore_file(&cover_path, old_cover.as_deref(), "cover", &error)?;
                }
                return Err(error);
            }
        }

        {
            let record = &mut library.books[record_index];
            record.title = title;
            record.author = author;
            record.description = description;
            record.publisher = publisher;
            record.language = language;
            record.series = series;
            record.cover_path = if new_cover.is_some() {
                cover_path.to_string_lossy().into_owned()
            } else {
                String::new()
            };
            record.content_hash = Some(sha256_hex(&pending_bytes));
            record.content_version = Some(import_id.to_string());
        }
        let updated = library.books[record_index].clone();

        if let Err(error) = self.write_library(&library) {
            if let Some(transaction_dir) = transaction_dir.as_deref() {
                rollback_import_or_error(Some(transaction_dir), &book_dir, &error)?;
            } else if new_cover.is_some() {
                restore_file(&cover_path, old_cover.as_deref(), "cover", &error)?;
            }
            return Err(error);
        }

        if new_cover.is_none() && fs::symlink_metadata(&cover_path).is_ok() {
            if let Err(error) = fs::remove_file(&cover_path) {
                eprintln!(
                    "[library] Metadata committed but unreferenced cover cleanup failed ({}): {error}",
                    cover_path.display()
                );
            }
        }
        if let Some(transaction_dir) = transaction_dir {
            if let Err(error) = fs::remove_dir_all(&transaction_dir) {
                eprintln!(
                    "[library] Re-import committed but transaction cleanup failed ({}): {error}",
                    transaction_dir.display()
                );
            }
        }
        if let Err(error) = fs::remove_file(&pending) {
            eprintln!(
                "[library] Import committed but staged EPUB cleanup failed ({}): {error}",
                pending.display()
            );
        }
        Ok(updated)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_book_metadata(
        &self,
        book_id: &str,
        title: String,
        author: String,
        description: String,
        publisher: String,
        language: String,
        series: String,
        cover_bytes: Option<Vec<u8>>,
    ) -> AppResult<BookRecord> {
        validate_book_id(book_id)?;
        validate_text("title", &title, MAX_TITLE_BYTES, false)?;
        validate_text("author", &author, MAX_AUTHOR_BYTES, true)?;
        let description = optional_shelf_text("description", description, MAX_DESCRIPTION_BYTES)?;
        let publisher = optional_shelf_text("publisher", publisher, MAX_AUTHOR_BYTES)?;
        let language = optional_shelf_text("language", language, MAX_AUTHOR_BYTES)?;
        let series = optional_shelf_text("series", series, MAX_AUTHOR_BYTES)?;
        if let Some(bytes) = &cover_bytes {
            if bytes.is_empty() {
                return Err(AppError::invalid_input("cover is empty"));
            }
            if bytes.len() > MAX_COVER_BYTES {
                return Err(AppError::invalid_input(format!(
                    "cover exceeds {MAX_COVER_BYTES} bytes"
                )));
            }
        }

        let _guard = self.transaction()?;
        let mut library = self.read_library()?;
        let record_index = library
            .books
            .iter()
            .position(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;

        let book_dir = self.book_dir(book_id)?;
        let cover_path = book_dir.join("cover.jpg");
        let new_cover = cover_bytes.as_ref().map(|bytes| compress_cover(bytes));
        let old_cover = if new_cover.is_some() {
            read_optional_regular_file(&cover_path, "existing cover")?
        } else {
            None
        };

        if let Some(bytes) = &new_cover {
            if let Err(error) = atomic_write(&cover_path, bytes, "cover") {
                restore_file(&cover_path, old_cover.as_deref(), "cover", &error)?;
                return Err(error);
            }
        }

        {
            let record = &mut library.books[record_index];
            record.title = title;
            record.author = author;
            record.description = description;
            record.publisher = publisher;
            record.language = language;
            record.series = series;
            if new_cover.is_some() {
                record.cover_path = cover_path.to_string_lossy().into_owned();
            }
        }
        let updated = library.books[record_index].clone();

        if let Err(error) = self.write_library(&library) {
            if new_cover.is_some() {
                restore_file(&cover_path, old_cover.as_deref(), "cover", &error)?;
            }
            return Err(error);
        }

        Ok(updated)
    }

    pub fn read_import_bytes(&self, book_id: &str, import_id: &str) -> AppResult<Vec<u8>> {
        validate_book_id(book_id)?;
        validate_import_id(import_id)?;
        let _guard = self.transaction()?;
        let library = self.read_library()?;
        if !library.books.iter().any(|book| book.id == book_id) {
            return Err(AppError::book_not_found(book_id));
        }
        let path = self.pending_import_path(book_id, import_id)?;
        require_regular_file(&path, "staged EPUB")?;
        let bytes = fs::read(&path).map_err(|error| {
            AppError::storage_io(format!("Failed to read staged EPUB: {error}"))
        })?;
        if bytes.is_empty() {
            return Err(AppError::storage_corrupt("Staged EPUB is empty"));
        }
        Ok(bytes)
    }

    pub fn get_book_open_context(&self, book_id: &str) -> AppResult<BookOpenContext> {
        validate_book_id(book_id)?;
        let _guard = self.transaction()?;
        let mut library = self.read_library()?;
        let record_index = library
            .books
            .iter()
            .position(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;

        if library.books[record_index].content_hash.is_none() {
            let epub_path = self.book_dir(book_id)?.join("book.epub");
            require_regular_file(&epub_path, "EPUB")?;
            let bytes = fs::read(&epub_path)
                .map_err(|error| AppError::storage_io(format!("Failed to read EPUB: {error}")))?;
            if bytes.is_empty() {
                return Err(AppError::storage_corrupt("EPUB file is empty"));
            }
            library.books[record_index].content_hash = Some(sha256_hex(&bytes));
            self.write_library(&library)?;
        }

        let record = &library.books[record_index];
        Ok(BookOpenContext {
            name: "book.epub".to_string(),
            title: record.title.clone(),
            book_id: book_id.to_string(),
            content_version: record.content_version.clone().ok_or_else(|| {
                AppError::storage_corrupt(format!("Book {book_id} has no committed contentVersion"))
            })?,
            last_fraction: record.last_fraction,
            last_cfi: record.last_cfi.clone(),
            settings: record.settings.clone(),
            last_reader_mode: record.last_reader_mode.clone(),
            last_layout: record.last_layout.clone(),
        })
    }

    pub fn mark_book_opened(&self, book_id: &str) -> AppResult<()> {
        validate_book_id(book_id)?;
        let _guard = self.transaction()?;
        let mut library = self.read_library()?;
        let record = library
            .books
            .iter_mut()
            .find(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;
        record.last_opened_at = Some(Utc::now().to_rfc3339());
        self.write_library(&library)
    }

    pub fn discard_import(&self, book_id: &str, import_id: &str) -> AppResult<()> {
        validate_book_id(book_id)?;
        validate_import_id(import_id)?;
        let _guard = self.transaction()?;
        let library = self.read_library()?;
        if !library.books.iter().any(|book| book.id == book_id) {
            return Err(AppError::book_not_found(book_id));
        }
        let pending = self.pending_import_path(book_id, import_id)?;
        match fs::symlink_metadata(&pending) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::storage_io(format!(
                "Failed to inspect staged import: {error}"
            ))),
            Ok(metadata) if metadata.file_type().is_file() => {
                fs::remove_file(&pending).map_err(|error| {
                    AppError::storage_io(format!("Failed to discard staged import: {error}"))
                })?;
                if let Some(parent) = pending.parent() {
                    sync_parent_directory(parent, "pending import directory")?;
                }
                Ok(())
            }
            Ok(_) => Err(AppError::storage_corrupt(format!(
                "Staged import is not a regular file: {}",
                pending.display()
            ))),
        }
    }

    pub(crate) fn read_book_content(
        &self,
        book_id: &str,
        content_version: &str,
    ) -> AppResult<BookContent> {
        validate_book_id(book_id)?;
        validate_import_id(content_version)?;
        let _guard = self.transaction()?;
        let library = self.read_library()?;
        let record = library
            .books
            .iter()
            .find(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;
        let active_version = record.content_version.as_deref().ok_or_else(|| {
            AppError::storage_corrupt(format!("Book {book_id} has no committed contentVersion"))
        })?;
        if active_version != content_version {
            return Err(AppError::invalid_input(
                "Book content changed after its open context was loaded; reload the book",
            ));
        }
        let epub_path = self.book_dir(book_id)?.join("book.epub");
        require_regular_file(&epub_path, "EPUB")?;
        let bytes = fs::read(&epub_path)
            .map_err(|error| AppError::storage_io(format!("Failed to read EPUB: {error}")))?;
        if bytes.is_empty() {
            return Err(AppError::storage_corrupt("EPUB file is empty"));
        }

        Ok(BookContent { bytes })
    }

    pub fn delete_book(&self, book_id: &str) -> AppResult<()> {
        validate_book_id(book_id)?;
        let _guard = self.transaction()?;
        let mut library = self.read_library()?;
        let record_index = library
            .books
            .iter()
            .position(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;
        let book_dir = self.book_dir(book_id)?;

        // Revalidate immediately before the rename. Initialization validation is
        // not enough because a local process could replace `.trash` while Litera
        // is running; following such a symlink would move book data outside the
        // controlled app-data root.
        ensure_real_directory(&self.trash_root(), "library trash")?;
        let trash_path = self
            .trash_root()
            .join(format!("{}-{}", book_id, operation_id()));
        fs::rename(&book_dir, &trash_path).map_err(|error| {
            AppError::storage_io(format!("Failed to stage book deletion: {error}"))
        })?;
        if let Err(error) = sync_parent_directory(&self.books_root(), "books directory")
            .and_then(|_| sync_parent_directory(&self.trash_root(), "library trash"))
        {
            restore_staged_book(&trash_path, &book_dir, &error)?;
            return Err(error);
        }

        library.books.remove(record_index);
        if let Err(error) = self.write_library(&library) {
            restore_staged_book(&trash_path, &book_dir, &error)?;
            return Err(error);
        }

        // Intentionally retain staged directories. A separate retention policy may
        // clean `.trash` later; this operation itself remains recoverable.
        self.remove_book_sessions(book_id)
    }

    fn remove_book_sessions(&self, book_id: &str) -> AppResult<()> {
        let sessions_root = self.sessions_root();
        require_real_directory(&sessions_root, "sessions")?;
        let session_dir = sessions_root.join(book_id);
        if session_dir.parent() != Some(sessions_root.as_path()) {
            return Err(AppError::invalid_input("Invalid bookId path"));
        }
        match fs::symlink_metadata(&session_dir) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::storage_io(format!(
                "Failed to inspect book sessions: {error}"
            ))),
            Ok(metadata) if metadata.file_type().is_dir() => {
                fs::remove_dir_all(&session_dir).map_err(|error| {
                    AppError::storage_io(format!("Failed to delete book sessions: {error}"))
                })?;
                sync_parent_directory(&sessions_root, "sessions")
            }
            Ok(_) => Err(AppError::storage_corrupt(format!(
                "Book session path is not a real directory: {}",
                session_dir.display()
            ))),
        }
    }

    fn backfill_missing_content_hashes(&self, library: &mut LibraryData) -> AppResult<bool> {
        let mut changed = false;
        for book in &mut library.books {
            if book.content_hash.is_some() {
                continue;
            }
            let epub_path = self.book_dir(&book.id)?.join("book.epub");
            require_regular_file(&epub_path, "stored EPUB")?;
            let bytes = fs::read(&epub_path).map_err(|error| {
                AppError::storage_io(format!("Failed to read stored EPUB: {error}"))
            })?;
            if bytes.is_empty() {
                return Err(AppError::storage_corrupt(format!(
                    "Stored EPUB is empty for book {}",
                    book.id
                )));
            }
            book.content_hash = Some(sha256_hex(&bytes));
            changed = true;
        }
        Ok(changed)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_reading_state(
        &self,
        book_id: &str,
        last_fraction: Option<f64>,
        settings: Option<ReadingSettings>,
        last_reader_mode: Option<String>,
        last_layout: Option<ReaderLayout>,
        last_cfi: Option<String>,
    ) -> AppResult<()> {
        validate_book_id(book_id)?;
        if last_fraction.is_none()
            && settings.is_none()
            && last_reader_mode.is_none()
            && last_layout.is_none()
            && last_cfi.is_none()
        {
            return Err(AppError::invalid_input(
                "At least one reading state field is required",
            ));
        }
        if let Some(fraction) = last_fraction {
            if !fraction.is_finite() || !(0.0..=1.0).contains(&fraction) {
                return Err(AppError::invalid_input(
                    "lastFraction must be a finite number between 0 and 1",
                ));
            }
        }
        if let Some(settings) = &settings {
            validate_settings(settings)?;
        }
        if let Some(mode) = &last_reader_mode {
            validate_reader_mode(mode)?;
        }
        if let Some(cfi) = &last_cfi {
            validate_cfi(cfi)?;
        }

        let _guard = self.transaction()?;
        let mut library = self.read_library()?;
        let record = library
            .books
            .iter_mut()
            .find(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;
        if let Some(fraction) = last_fraction {
            record.last_fraction = Some(fraction);
        }
        if let Some(settings) = settings {
            record.settings = if settings.is_empty() {
                None
            } else {
                Some(settings)
            };
        }
        if let Some(mode) = last_reader_mode {
            record.last_reader_mode = Some(mode);
        }
        if let Some(layout) = last_layout {
            record.last_layout = Some(layout);
        }
        if let Some(cfi) = last_cfi {
            record.last_cfi = Some(cfi);
        }
        self.write_library(&library)
    }

    fn annotations_path(&self, book_id: &str) -> AppResult<PathBuf> {
        Ok(self.book_dir(book_id)?.join("annotations.json"))
    }

    fn require_existing_book(&self, book_id: &str) -> AppResult<()> {
        let library = self.read_library()?;
        library
            .books
            .iter()
            .find(|book| book.id == book_id)
            .ok_or_else(|| AppError::book_not_found(book_id))?;
        Ok(())
    }

    pub fn get_annotations(&self, book_id: &str) -> AppResult<AnnotationsFile> {
        validate_book_id(book_id)?;
        let _guard = self.transaction()?;
        self.require_existing_book(book_id)?;
        let path = self.annotations_path(book_id)?;
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(AnnotationsFile::empty());
            }
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to read annotations.json: {error}"
                )));
            }
        };
        let data: AnnotationsFile = serde_json::from_slice(&bytes).map_err(|error| {
            AppError::storage_corrupt(format!("Failed to parse annotations.json: {error}"))
        })?;
        validate_annotations(&data).map_err(|error| {
            AppError::storage_corrupt(format!("Invalid annotations.json: {error}"))
        })?;
        Ok(data)
    }

    pub fn save_annotations(&self, book_id: &str, data: AnnotationsFile) -> AppResult<()> {
        validate_book_id(book_id)?;
        validate_annotations(&data)?;
        let _guard = self.transaction()?;
        self.require_existing_book(book_id)?;
        let path = self.annotations_path(book_id)?;
        let json = serde_json::to_vec_pretty(&data).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize annotations: {error}"))
        })?;
        recoverable_atomic_write(&path, &json, "annotations.json")
    }

    #[cfg(test)]
    fn fail_next_library_write(&self) {
        self.fail_next_library_write
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

fn initialize_root(root: &Path) -> AppResult<()> {
    fs::create_dir_all(root).map_err(|error| {
        AppError::storage_io(format!("Failed to create app data directory: {error}"))
    })?;
    let library_path = root.join("library.json");
    let has_library = library_path.exists();
    let has_legacy_directories = root.join("books").exists() || root.join("sessions").exists();

    if has_library {
        let bytes = fs::read(&library_path).map_err(|error| {
            AppError::storage_io(format!("Failed to read library.json: {error}"))
        })?;
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|error| {
            AppError::storage_corrupt(format!("Failed to parse library.json: {error}"))
        })?;
        match value.get("schemaVersion") {
            Some(version) if version.as_u64() == Some(u64::from(SCHEMA_VERSION)) => {
                let data: LibraryData = serde_json::from_value(value).map_err(|error| {
                    AppError::storage_corrupt(format!("Invalid library.json fields: {error}"))
                })?;
                validate_library_records(root, &data)?;
                ensure_storage_directories(root)?;
                recover_staged_deletions(root, &data)?;
                stage_orphaned_book_directories(root, &data)?;
                recover_import_transactions(root, &data)?;
                validate_library_files(root, &data)?;
                return Ok(());
            }
            Some(version) => {
                return Err(AppError::storage_corrupt(format!(
                    "Unsupported library schemaVersion: {version}"
                )));
            }
            None if value.get("books").is_some_and(serde_json::Value::is_array) => {
                return reset_legacy_storage(root);
            }
            None => {
                return Err(AppError::storage_corrupt(
                    "library.json has no valid schemaVersion or books array",
                ));
            }
        }
    }

    if has_legacy_directories {
        reset_legacy_storage(root)
    } else {
        ensure_storage_directories(root)?;
        write_new_library(root)
    }
}

fn ensure_storage_directories(root: &Path) -> AppResult<()> {
    let books_root = root.join("books");
    ensure_real_directory(&books_root, "books")?;
    ensure_real_directory(&books_root.join(".trash"), "library trash")?;
    ensure_real_directory(&root.join("sessions"), "sessions")
}

fn ensure_real_directory(path: &Path, label: &str) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(AppError::storage_corrupt(format!(
            "{label} is not a real directory: {}",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|error| {
                AppError::storage_io(format!("Failed to create {label}: {error}"))
            })?;
            if let Some(parent) = path.parent() {
                sync_parent_directory(parent, label)?;
            }
            Ok(())
        }
        Err(error) => Err(AppError::storage_io(format!(
            "Failed to inspect {label}: {error}"
        ))),
    }
}

fn require_real_directory(path: &Path, label: &str) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(AppError::storage_corrupt(format!(
            "{label} is not a real directory: {}",
            path.display()
        ))),
        Err(error) => Err(AppError::storage_io(format!(
            "Failed to inspect {label} at {}: {error}",
            path.display()
        ))),
    }
}

fn require_regular_file(path: &Path, label: &str) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(_) => Err(AppError::storage_corrupt(format!(
            "{label} is not a regular file: {}",
            path.display()
        ))),
        Err(error) => Err(AppError::storage_io(format!(
            "Failed to inspect {label} at {}: {error}",
            path.display()
        ))),
    }
}

fn read_optional_regular_file(path: &Path, label: &str) -> AppResult<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => fs::read(path)
            .map(Some)
            .map_err(|error| AppError::storage_io(format!("Failed to read {label}: {error}"))),
        Ok(_) => Err(AppError::storage_corrupt(format!(
            "{label} is not a regular file: {}",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::storage_io(format!(
            "Failed to inspect {label}: {error}"
        ))),
    }
}

fn recover_staged_deletions(root: &Path, data: &LibraryData) -> AppResult<()> {
    let books_root = root.join("books");
    let trash_root = books_root.join(".trash");
    for book in &data.books {
        let book_dir = books_root.join(&book.id);
        match fs::symlink_metadata(&book_dir) {
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to inspect book directory during deletion recovery: {error}"
                )))
            }
        }
        let prefix = format!("{}-", book.id);
        let mut candidates = Vec::new();
        for entry in fs::read_dir(&trash_root).map_err(|error| {
            AppError::storage_io(format!("Failed to inspect library trash: {error}"))
        })? {
            let entry = entry.map_err(|error| {
                AppError::storage_io(format!("Failed to inspect trash entry: {error}"))
            })?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with(&prefix) && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                candidates.push(entry.path());
            }
        }
        if candidates.len() > 1 {
            return Err(AppError::storage_corrupt(format!(
                "Multiple staged deletions could restore book {}",
                book.id
            )));
        }
        if let Some(staged) = candidates.pop() {
            fs::rename(&staged, &book_dir).map_err(|error| {
                AppError::rollback_failed(format!(
                    "Failed to recover interrupted deletion for book {}: {error}",
                    book.id
                ))
            })?;
            sync_parent_directory(&books_root, "recovered book directory")?;
            sync_parent_directory(&trash_root, "library trash")?;
        }
    }
    Ok(())
}

fn stage_orphaned_book_directories(root: &Path, data: &LibraryData) -> AppResult<()> {
    let books_root = root.join("books");
    let trash_root = books_root.join(".trash");
    let known_ids: HashSet<&str> = data.books.iter().map(|book| book.id.as_str()).collect();
    for entry in fs::read_dir(&books_root).map_err(|error| {
        AppError::storage_io(format!("Failed to inspect books directory: {error}"))
    })? {
        let entry = entry.map_err(|error| {
            AppError::storage_io(format!("Failed to inspect book entry: {error}"))
        })?;
        let name = entry.file_name();
        if name == ".trash" || name.to_str().is_some_and(|name| known_ids.contains(name)) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| {
            AppError::storage_io(format!(
                "Failed to inspect unregistered book entry: {error}"
            ))
        })?;
        if !file_type.is_dir() {
            return Err(AppError::storage_corrupt(format!(
                "Unregistered entry in books directory is not a real directory: {}",
                entry.path().display()
            )));
        }
        let safe_name = name
            .to_str()
            .filter(|name| !name.is_empty())
            .unwrap_or("nonutf8");
        let staged = trash_root.join(format!("orphan-{safe_name}-{}", operation_id()));
        fs::rename(entry.path(), &staged).map_err(|error| {
            AppError::storage_io(format!("Failed to stage orphaned book directory: {error}"))
        })?;
        sync_parent_directory(&books_root, "books directory")?;
        sync_parent_directory(&trash_root, "library trash")?;
    }
    Ok(())
}

fn recover_import_transactions(root: &Path, data: &LibraryData) -> AppResult<()> {
    for book in &data.books {
        let book_dir = root.join("books").join(&book.id);
        let transactions_root = book_dir.join(".transactions");
        match fs::symlink_metadata(&transactions_root) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => {
                return Err(AppError::storage_corrupt(
                    "Import transaction root is not a real directory",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to inspect import transaction root: {error}"
                )))
            }
        }
        let entries = fs::read_dir(&transactions_root).map_err(|error| {
            AppError::storage_io(format!("Failed to inspect import transactions: {error}"))
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                AppError::storage_io(format!("Failed to inspect import transaction: {error}"))
            })?;
            let import_id = entry.file_name().into_string().map_err(|_| {
                AppError::storage_corrupt("Import transaction has a non-UTF-8 identifier")
            })?;
            validate_import_id(&import_id).map_err(|error| {
                AppError::storage_corrupt(format!("Invalid import transaction id: {error}"))
            })?;
            if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                return Err(AppError::storage_corrupt(
                    "Import transaction entry is not a real directory",
                ));
            }
            let transaction_dir = entry.path();
            let manifest_path = transaction_dir.join("manifest.json");
            if !manifest_path.exists() {
                fs::remove_dir_all(&transaction_dir).map_err(|error| {
                    AppError::storage_io(format!(
                        "Failed to remove incomplete import transaction: {error}"
                    ))
                })?;
                continue;
            }
            if book.content_version.as_deref() != Some(import_id.as_str()) {
                restore_import_transaction(&transaction_dir, &book_dir)?;
            }
            fs::remove_dir_all(&transaction_dir).map_err(|error| {
                AppError::storage_io(format!(
                    "Failed to clean recovered import transaction: {error}"
                ))
            })?;
        }
    }
    Ok(())
}

fn reset_legacy_storage(root: &Path) -> AppResult<()> {
    let backup_root = root.join("backup");
    if fs::symlink_metadata(&backup_root).is_ok_and(|metadata| !metadata.file_type().is_dir()) {
        return Err(AppError::storage_io(format!(
            "Legacy backup root is not a usable directory: {}",
            backup_root.display()
        )));
    }
    ensure_real_directory(&backup_root, "legacy backup root")?;
    let backup_dir = backup_root.join(format!("legacy-{}", operation_id()));
    ensure_real_directory(&backup_dir, "legacy backup directory")?;

    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for name in ["library.json", "books", "sessions"] {
        let source = root.join(name);
        if !source.exists() {
            continue;
        }
        let destination = backup_dir.join(name);
        if let Err(error) = fs::rename(&source, &destination) {
            rollback_moves(&moved).map_err(|rollback_error| {
                AppError::rollback_failed(format!(
                    "Failed to back up {name} ({error}); {rollback_error}"
                ))
            })?;
            return Err(AppError::storage_io(format!(
                "Failed to back up legacy {name}: {error}"
            )));
        }
        moved.push((source, destination));
        if let Err(error) = sync_parent_directory(root, "legacy storage root")
            .and_then(|_| sync_parent_directory(&backup_dir, "legacy backup directory"))
        {
            rollback_moves(&moved).map_err(|rollback_error| {
                AppError::rollback_failed(format!(
                    "Failed to sync legacy backup ({error}); {rollback_error}"
                ))
            })?;
            return Err(error);
        }
    }

    if let Err(error) = ensure_storage_directories(root).and_then(|_| write_new_library(root)) {
        let new_books = root.join("books");
        if new_books.exists() {
            let _ = fs::remove_dir_all(&new_books);
        }
        let new_library = root.join("library.json");
        if new_library.exists() {
            let _ = fs::remove_file(&new_library);
        }
        let new_sessions = root.join("sessions");
        if new_sessions.exists() {
            let _ = fs::remove_dir_all(&new_sessions);
        }
        rollback_moves(&moved).map_err(|rollback_error| {
            AppError::rollback_failed(format!(
                "Failed to initialize v1 library ({error}); {rollback_error}"
            ))
        })?;
        return Err(error);
    }
    Ok(())
}

fn rollback_moves(moved: &[(PathBuf, PathBuf)]) -> AppResult<()> {
    for (source, destination) in moved.iter().rev() {
        fs::rename(destination, source).map_err(|error| {
            AppError::rollback_failed(format!("Failed to restore {}: {error}", source.display()))
        })?;
        if let Some(parent) = source.parent() {
            sync_parent_directory(parent, "restored legacy storage")?;
        }
        if let Some(parent) = destination.parent() {
            sync_parent_directory(parent, "restored legacy backup")?;
        }
    }
    Ok(())
}

fn restore_staged_book(staged: &Path, book_dir: &Path, original_error: &AppError) -> AppResult<()> {
    fs::rename(staged, book_dir).map_err(|rollback_error| {
        AppError::rollback_failed(format!(
            "Operation failed ({original_error}); failed to restore book directory: {rollback_error}"
        ))
    })?;
    let books_root = book_dir.parent().ok_or_else(|| {
        AppError::rollback_failed("Restored book directory has no trusted parent")
    })?;
    sync_parent_directory(books_root, "restored books directory")
        .and_then(|_| {
            staged
                .parent()
                .ok_or_else(|| AppError::rollback_failed("Staged book has no trash parent"))
                .and_then(|trash| sync_parent_directory(trash, "restored library trash"))
        })
        .map_err(|rollback_error| {
            AppError::rollback_failed(format!(
                "Operation failed ({original_error}); failed to sync restored book directory: {rollback_error}"
            ))
        })
}

fn write_new_library(root: &Path) -> AppResult<()> {
    let json = serde_json::to_vec_pretty(&LibraryData::empty())
        .map_err(|error| AppError::storage_io(format!("Failed to serialize library: {error}")))?;
    recoverable_atomic_write(&root.join("library.json"), &json, "library.json")
}

fn read_library_file(root: &Path, path: &Path) -> AppResult<LibraryData> {
    let bytes = fs::read(path)
        .map_err(|error| AppError::storage_io(format!("Failed to read library.json: {error}")))?;
    let data: LibraryData = serde_json::from_slice(&bytes).map_err(|error| {
        AppError::storage_corrupt(format!("Failed to parse library.json: {error}"))
    })?;
    if data.schema_version != SCHEMA_VERSION {
        return Err(AppError::storage_corrupt(format!(
            "Unsupported library schemaVersion: {}",
            data.schema_version
        )));
    }
    validate_library_records(root, &data)?;
    validate_library_files(root, &data)?;
    Ok(data)
}

fn validate_library_records(root: &Path, data: &LibraryData) -> AppResult<()> {
    let mut ids = HashSet::new();
    for book in &data.books {
        validate_book_id(&book.id).map_err(|error| {
            AppError::storage_corrupt(format!("Invalid stored book record: {error}"))
        })?;
        if !ids.insert(book.id.as_str()) {
            return Err(AppError::storage_corrupt(format!(
                "Duplicate stored book id: {}",
                book.id
            )));
        }
        validate_text("title", &book.title, MAX_TITLE_BYTES, false).map_err(|error| {
            AppError::storage_corrupt(format!("Invalid title for book {}: {error}", book.id))
        })?;
        validate_text("author", &book.author, MAX_AUTHOR_BYTES, true).map_err(|error| {
            AppError::storage_corrupt(format!("Invalid author for book {}: {error}", book.id))
        })?;
        validate_stored_optional_text(
            "description",
            &book.description,
            MAX_DESCRIPTION_BYTES,
            &book.id,
        )?;
        validate_stored_optional_text("publisher", &book.publisher, MAX_AUTHOR_BYTES, &book.id)?;
        validate_stored_optional_text("language", &book.language, MAX_AUTHOR_BYTES, &book.id)?;
        validate_stored_optional_text("series", &book.series, MAX_AUTHOR_BYTES, &book.id)?;
        chrono::DateTime::parse_from_rfc3339(&book.imported_at).map_err(|error| {
            AppError::storage_corrupt(format!("Invalid importedAt for book {}: {error}", book.id))
        })?;
        if let Some(opened_at) = &book.last_opened_at {
            chrono::DateTime::parse_from_rfc3339(opened_at).map_err(|error| {
                AppError::storage_corrupt(format!(
                    "Invalid lastOpenedAt for book {}: {error}",
                    book.id
                ))
            })?;
        }
        if let Some(hash) = &book.content_hash {
            validate_content_hash(hash).map_err(|error| {
                AppError::storage_corrupt(format!(
                    "Invalid contentHash for book {}: {error}",
                    book.id
                ))
            })?;
        }
        if let Some(version) = &book.content_version {
            validate_import_id(version).map_err(|error| {
                AppError::storage_corrupt(format!(
                    "Invalid contentVersion for book {}: {error}",
                    book.id
                ))
            })?;
        }

        let book_dir = root.join("books").join(&book.id);
        let expected_epub = book_dir.join("book.epub");
        if Path::new(&book.file_path) != expected_epub {
            return Err(AppError::storage_corrupt(format!(
                "filePath for book {} is outside its controlled storage path",
                book.id
            )));
        }
        let expected_covers = [book_dir.join("cover.jpg"), book_dir.join("cover.png")];
        if !book.cover_path.is_empty()
            && !expected_covers
                .iter()
                .any(|c| Path::new(&book.cover_path) == c)
        {
            return Err(AppError::storage_corrupt(format!(
                "coverPath for book {} is outside its controlled storage path",
                book.id
            )));
        }
        if let Some(fraction) = book.last_fraction {
            if !fraction.is_finite() || !(0.0..=1.0).contains(&fraction) {
                return Err(AppError::storage_corrupt(format!(
                    "Invalid lastFraction for book {}",
                    book.id
                )));
            }
        }
        if let Some(settings) = &book.settings {
            validate_settings(settings).map_err(|error| {
                AppError::storage_corrupt(format!("Invalid settings for book {}: {error}", book.id))
            })?;
        }
        if let Some(mode) = &book.last_reader_mode {
            if !is_valid_reader_mode(mode) {
                return Err(AppError::storage_corrupt(format!(
                    "Invalid lastReaderMode for book {}",
                    book.id
                )));
            }
        }
        if let Some(cfi) = &book.last_cfi {
            validate_cfi(cfi).map_err(|_| {
                AppError::storage_corrupt(format!("Invalid lastCfi for book {}", book.id))
            })?;
        }
    }
    Ok(())
}

fn validate_library_files(root: &Path, data: &LibraryData) -> AppResult<()> {
    for book in &data.books {
        let book_dir = root.join("books").join(&book.id);
        require_real_directory(&book_dir, "stored book directory")?;
        require_regular_file(&book_dir.join("book.epub"), "stored EPUB")?;
        if !book.cover_path.is_empty() {
            let cover_jpg = book_dir.join("cover.jpg");
            let cover_png = book_dir.join("cover.png");
            if fs::symlink_metadata(&cover_jpg).is_ok() {
                require_regular_file(&cover_jpg, "stored cover")?;
            } else {
                require_regular_file(&cover_png, "stored cover")?;
            }
        }
        for (name, label) in [
            (".imports", "pending import directory"),
            (".transactions", "import transaction root"),
        ] {
            let path = book_dir.join(name);
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_dir() => {}
                Ok(_) => {
                    return Err(AppError::storage_corrupt(format!(
                        "{label} is not a real directory: {}",
                        path.display()
                    )))
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(AppError::storage_io(format!(
                        "Failed to inspect {label}: {error}"
                    )))
                }
            }
        }
    }
    Ok(())
}

fn validate_book_id(book_id: &str) -> AppResult<()> {
    if book_id.is_empty()
        || book_id == "."
        || book_id == ".."
        || book_id.len() > 64
        || !book_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    {
        return Err(AppError::invalid_input(
            "bookId must contain 1-64 lowercase ASCII letters or digits",
        ));
    }
    Ok(())
}

fn validate_import_id(import_id: &str) -> AppResult<()> {
    if import_id.is_empty()
        || import_id.len() > 64
        || !import_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    {
        return Err(AppError::invalid_input(
            "importId must contain 1-64 lowercase ASCII letters or digits",
        ));
    }
    Ok(())
}

fn validate_text(name: &str, value: &str, max_bytes: usize, allow_empty: bool) -> AppResult<()> {
    if (!allow_empty && value.trim().is_empty()) || value.len() > max_bytes {
        return Err(AppError::invalid_input(format!(
            "{name} must be {} and at most {max_bytes} bytes",
            if allow_empty { "valid" } else { "non-empty" }
        )));
    }
    Ok(())
}

fn optional_shelf_text(name: &str, value: String, max_bytes: usize) -> AppResult<Option<String>> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    validate_text(name, &value, max_bytes, true)?;
    Ok(Some(value))
}

fn validate_stored_optional_text(
    name: &str,
    value: &Option<String>,
    max_bytes: usize,
    book_id: &str,
) -> AppResult<()> {
    if let Some(text) = value {
        validate_text(name, text, max_bytes, true).map_err(|error| {
            AppError::storage_corrupt(format!("Invalid {name} for book {book_id}: {error}"))
        })?;
    }
    Ok(())
}

fn validate_annotation_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || id.len() > MAX_ANNOTATION_ID_BYTES
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(AppError::invalid_input(
            "annotation id must contain 1-128 ASCII letters, digits, '-' or '_'",
        ));
    }
    Ok(())
}

fn validate_cfi(cfi: &str) -> AppResult<()> {
    if cfi.is_empty() || cfi.len() > MAX_CFI_BYTES {
        return Err(AppError::invalid_input(format!(
            "cfi must be non-empty and at most {MAX_CFI_BYTES} bytes"
        )));
    }
    if !cfi.starts_with("epubcfi(") || cfi.starts_with("foliate-search:") {
        return Err(AppError::invalid_input(
            "cfi must be an epubcfi(...) locator",
        ));
    }
    Ok(())
}

fn validate_created_at(value: &str) -> AppResult<()> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| AppError::invalid_input("createdAt must be RFC3339"))
}

fn validate_annotations(data: &AnnotationsFile) -> AppResult<()> {
    if data.schema_version != ANNOTATIONS_SCHEMA_VERSION {
        return Err(AppError::invalid_input(
            "Unsupported annotations schemaVersion",
        ));
    }

    let mut ids = HashSet::new();
    let mut bookmark_cfis = HashSet::new();
    for bookmark in &data.bookmarks {
        validate_annotation_id(&bookmark.id)?;
        if !ids.insert(bookmark.id.as_str()) {
            return Err(AppError::invalid_input(format!(
                "Duplicate annotation id: {}",
                bookmark.id
            )));
        }
        validate_cfi(&bookmark.cfi)?;
        if !bookmark_cfis.insert(bookmark.cfi.as_str()) {
            return Err(AppError::invalid_input("Duplicate bookmark cfi"));
        }
        if !bookmark.fraction.is_finite() || !(0.0..=1.0).contains(&bookmark.fraction) {
            return Err(AppError::invalid_input(
                "bookmark fraction must be a finite number between 0 and 1",
            ));
        }
        validate_created_at(&bookmark.created_at)?;
        if let Some(label) = &bookmark.label {
            validate_text("label", label, MAX_LABEL_BYTES, true)?;
        }
    }

    let mut highlight_cfis = HashSet::new();
    for highlight in &data.highlights {
        validate_annotation_id(&highlight.id)?;
        if !ids.insert(highlight.id.as_str()) {
            return Err(AppError::invalid_input(format!(
                "Duplicate annotation id: {}",
                highlight.id
            )));
        }
        validate_cfi(&highlight.cfi)?;
        if !highlight_cfis.insert(highlight.cfi.as_str()) {
            return Err(AppError::invalid_input("Duplicate highlight cfi"));
        }
        validate_text("excerpt", &highlight.excerpt, MAX_EXCERPT_BYTES, false)?;
        validate_created_at(&highlight.created_at)?;
        if let Some(color) = &highlight.color {
            if !VALID_HIGHLIGHT_COLORS.contains(&color.as_str()) {
                return Err(AppError::invalid_input("Unsupported highlight color"));
            }
        }
        if let Some(note) = &highlight.note {
            if !note.is_empty() {
                validate_text("note", note, MAX_LABEL_BYTES, true)?;
            }
        }
    }
    Ok(())
}

fn validate_settings(settings: &ReadingSettings) -> AppResult<()> {
    if let Some(font_size) = settings.font_size {
        if !in_typography_range(font_size, FONT_SIZE_RANGE.0, FONT_SIZE_RANGE.1) {
            return Err(AppError::invalid_input(
                "fontSize must be a finite number between 12 and 32",
            ));
        }
    }
    if let Some(font_family) = &settings.font_family {
        if !is_valid_font_family(font_family) {
            return Err(AppError::invalid_input("Unsupported fontFamily"));
        }
    }
    if let Some(theme) = &settings.theme {
        if !VALID_THEMES.contains(&theme.as_str()) {
            return Err(AppError::invalid_input("Unsupported theme"));
        }
    }
    if let Some(line_height) = settings.line_height {
        if !in_typography_range(line_height, LINE_HEIGHT_RANGE.0, LINE_HEIGHT_RANGE.1) {
            return Err(AppError::invalid_input(
                "lineHeight must be a finite number between 1.2 and 2.4",
            ));
        }
    }
    if let Some(page_margin) = &settings.page_margin {
        if !VALID_PAGE_MARGINS.contains(&page_margin.as_str()) {
            return Err(AppError::invalid_input("Unsupported pageMargin"));
        }
    }
    if let Some(content_width) = settings.content_width {
        if !in_typography_range(content_width, CONTENT_WIDTH_RANGE.0, CONTENT_WIDTH_RANGE.1) {
            return Err(AppError::invalid_input(
                "contentWidth must be a finite number between 28 and 60",
            ));
        }
    }
    if let Some(page_padding) = settings.page_padding {
        if !in_typography_range(page_padding, PAGE_PADDING_RANGE.0, PAGE_PADDING_RANGE.1) {
            return Err(AppError::invalid_input(
                "pagePadding must be a finite number between 0.5 and 4",
            ));
        }
    }
    if let Some(text_align) = &settings.text_align {
        if !VALID_TEXT_ALIGNS.contains(&text_align.as_str()) {
            return Err(AppError::invalid_input("Unsupported textAlign"));
        }
    }
    if let Some(letter_spacing) = settings.letter_spacing {
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
    if let Some(paragraph_spacing) = settings.paragraph_spacing {
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
    if let Some(first_line_indent) = settings.first_line_indent {
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
    Ok(())
}

fn book_id_for_source(source_path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    source_path.to_string_lossy().hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn compress_cover(raw: &[u8]) -> Vec<u8> {
    match image::load_from_memory(raw) {
        Ok(img) => {
            // Only downscale — never upscale a small cover.
            let need_resize = img.width() > COVER_MAX_EDGE || img.height() > COVER_MAX_EDGE;
            let processed = if need_resize {
                img.thumbnail(COVER_MAX_EDGE, COVER_MAX_EDGE)
            } else {
                img
            };
            let rgb = processed.to_rgb8();
            let mut buf = Vec::new();
            let encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, COVER_JPEG_QUALITY);
            match encoder.write_image(
                &rgb,
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            ) {
                Ok(()) => buf,
                Err(error) => {
                    eprintln!("[library] Cover re-encode failed, using original: {error}");
                    raw.to_vec()
                }
            }
        }
        Err(error) => {
            eprintln!("[library] Cover decode failed, using original: {error}");
            raw.to_vec()
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_content_hash(hash: &str) -> AppResult<()> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(AppError::invalid_input(
            "contentHash must be 64 lowercase hex characters",
        ));
    }
    Ok(())
}

fn is_epub_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("epub"))
}

fn validate_import_source(path: &Path) -> AppResult<()> {
    if !is_epub_path(path) {
        return Err(AppError::invalid_input("Only EPUB files can be imported"));
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(metadata) if metadata.file_type().is_symlink() => Err(AppError::invalid_input(
            "Refusing to import a symbolic link",
        )),
        Ok(_) => Err(AppError::invalid_input("Import path is not a regular file")),
        Err(error) => Err(AppError::storage_io(format!(
            "Failed to inspect import path: {error}"
        ))),
    }
}

fn display_name_for_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("book.epub")
        .to_string()
}

fn operation_id() -> String {
    let counter = OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}{:x}", Utc::now().format("%Y%m%d%H%M%S%f"), counter)
}

fn recoverable_atomic_write(path: &Path, bytes: &[u8], label: &str) -> AppResult<()> {
    let previous = match fs::read(path) {
        Ok(previous) => Some(previous),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(AppError::storage_io(format!(
                "Failed to snapshot existing {label}: {error}"
            )))
        }
    };
    let error = match atomic_write(path, bytes, label) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };

    let needs_rollback = match fs::read(path) {
        Ok(current) => current == bytes,
        Err(read_error) if read_error.kind() == std::io::ErrorKind::NotFound => previous.is_some(),
        Err(read_error) => {
            return Err(AppError::rollback_failed(format!(
                "Atomic {label} write failed ({error}); cannot inspect the target for rollback: {read_error}"
            )))
        }
    };
    if needs_rollback {
        let rollback = if let Some(previous) = previous {
            atomic_write(path, &previous, &format!("restored {label}"))
        } else {
            fs::remove_file(path)
                .map_err(|rollback_error| {
                    AppError::storage_io(format!(
                        "Failed to remove uncommitted {label}: {rollback_error}"
                    ))
                })
                .and_then(|_| {
                    path.parent()
                        .ok_or_else(|| AppError::storage_io(format!("{label} has no parent")))
                        .and_then(|parent| {
                            sync_parent_directory(parent, &format!("restored {label}"))
                        })
                })
        };
        if let Err(rollback_error) = rollback {
            return Err(AppError::rollback_failed(format!(
                "Atomic {label} write failed ({error}); failed to restore previous contents: {rollback_error}"
            )));
        }
    }
    Err(error)
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8], label: &str) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::storage_io(format!("{label} target has no parent directory")))?;
    fs::create_dir_all(parent).map_err(|error| {
        AppError::storage_io(format!("Failed to create {label} directory: {error}"))
    })?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
        AppError::storage_io(format!("Failed to create temporary {label}: {error}"))
    })?;
    temporary.write_all(bytes).map_err(|error| {
        AppError::storage_io(format!("Failed to write temporary {label}: {error}"))
    })?;
    temporary.flush().map_err(|error| {
        AppError::storage_io(format!("Failed to flush temporary {label}: {error}"))
    })?;
    temporary.as_file().sync_all().map_err(|error| {
        AppError::storage_io(format!("Failed to sync temporary {label}: {error}"))
    })?;
    temporary.persist(path).map_err(|error| {
        AppError::storage_io(format!(
            "Failed to atomically replace {label}: {}",
            error.error
        ))
    })?;
    sync_parent_directory(parent, label)
}

#[cfg(unix)]
pub(crate) fn sync_parent_directory(parent: &Path, label: &str) -> AppResult<()> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| AppError::storage_io(format!("Failed to sync {label} directory: {error}")))
}

#[cfg(not(unix))]
pub(crate) fn sync_parent_directory(_parent: &Path, _label: &str) -> AppResult<()> {
    // Windows does not support opening directories through std::fs::File.
    Ok(())
}

fn prepare_import_transaction(book_dir: &Path, import_id: &str) -> AppResult<PathBuf> {
    validate_import_id(import_id)?;
    let transactions_root = book_dir.join(".transactions");
    ensure_real_directory(&transactions_root, "import transaction root")?;
    let transaction_dir = transactions_root.join(import_id);
    if fs::symlink_metadata(&transaction_dir).is_ok() {
        return Err(AppError::invalid_input(
            "Import transaction has already been prepared",
        ));
    }
    fs::create_dir(&transaction_dir).map_err(|error| {
        AppError::storage_io(format!("Failed to create import transaction: {error}"))
    })?;
    if let Err(error) = sync_parent_directory(&transactions_root, "import transaction root") {
        let _ = fs::remove_dir(&transaction_dir);
        return Err(error);
    }

    let result = (|| {
        let epub_path = book_dir.join("book.epub");
        let old_epub = fs::read(&epub_path).map_err(|error| {
            AppError::storage_io(format!("Failed to back up current EPUB: {error}"))
        })?;
        atomic_write(
            &transaction_dir.join("old.epub"),
            &old_epub,
            "EPUB rollback",
        )?;

        let cover_jpg = book_dir.join("cover.jpg");
        let cover_png = book_dir.join("cover.png");
        let (old_cover, cover_name) = match read_optional_regular_file(&cover_jpg, "current cover")
        {
            Ok(Some(data)) => (Some(data), Some("cover.jpg".to_string())),
            Ok(None) => (None, None),
            Err(_) => {
                // cover.jpg is corrupt/non-regular — try cover.png (legacy books).
                let png_data = read_optional_regular_file(&cover_png, "current cover")?;
                let name = if png_data.is_some() {
                    Some("cover.png".to_string())
                } else {
                    None
                };
                (png_data, name)
            }
        };
        let had_cover = old_cover.is_some();
        if let Some(old_cover) = old_cover {
            atomic_write(
                &transaction_dir.join("old.cover"),
                &old_cover,
                "cover rollback",
            )?;
        }
        let manifest = serde_json::to_vec(&ImportTransactionManifest {
            had_cover,
            cover_name,
        })
        .map_err(|error| {
            AppError::storage_io(format!("Failed to serialize import journal: {error}"))
        })?;
        atomic_write(
            &transaction_dir.join("manifest.json"),
            &manifest,
            "import journal",
        )
    })();

    if let Err(error) = result {
        let _ = fs::remove_dir_all(&transaction_dir);
        return Err(error);
    }
    Ok(transaction_dir)
}

fn restore_import_transaction(transaction_dir: &Path, book_dir: &Path) -> AppResult<()> {
    let manifest_path = transaction_dir.join("manifest.json");
    require_regular_file(&manifest_path, "import transaction manifest")?;
    let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
        AppError::storage_io(format!(
            "Failed to read import transaction manifest: {error}"
        ))
    })?;
    let manifest: ImportTransactionManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|error| {
            AppError::storage_corrupt(format!("Invalid import transaction manifest: {error}"))
        })?;
    let old_epub_path = transaction_dir.join("old.epub");
    require_regular_file(&old_epub_path, "EPUB rollback")?;
    let old_epub = fs::read(&old_epub_path)
        .map_err(|error| AppError::storage_io(format!("Failed to read EPUB rollback: {error}")))?;
    atomic_write(&book_dir.join("book.epub"), &old_epub, "restored EPUB")?;

    let cover_jpg = book_dir.join("cover.jpg");
    let cover_png = book_dir.join("cover.png");
    if manifest.had_cover {
        let old_cover_path = transaction_dir.join("old.cover");
        require_regular_file(&old_cover_path, "cover rollback")?;
        let old_cover = fs::read(&old_cover_path).map_err(|error| {
            AppError::storage_io(format!("Failed to read cover rollback: {error}"))
        })?;
        // Remove any cover left by the failed import, then restore the backup to its
        // original path (recorded in the manifest).
        let _ = fs::remove_file(&cover_jpg);
        let _ = fs::remove_file(&cover_png);
        let restore_name = manifest.cover_name.as_deref().unwrap_or("cover.png");
        atomic_write(&book_dir.join(restore_name), &old_cover, "restored cover")?;
    } else {
        let _ = fs::remove_file(&cover_jpg);
        if fs::symlink_metadata(&cover_png).is_ok() {
            fs::remove_file(&cover_png).map_err(|error| {
                AppError::storage_io(format!("Failed to remove uncommitted cover: {error}"))
            })?;
        }
        sync_parent_directory(book_dir, "restored cover directory")?;
    }
    Ok(())
}

fn rollback_import_or_error(
    transaction_dir: Option<&Path>,
    book_dir: &Path,
    original_error: &AppError,
) -> AppResult<()> {
    let Some(transaction_dir) = transaction_dir else {
        return Ok(());
    };
    restore_import_transaction(transaction_dir, book_dir).map_err(|rollback_error| {
        AppError::rollback_failed(format!(
            "Operation failed ({original_error}); import rollback failed: {rollback_error}"
        ))
    })?;
    fs::remove_dir_all(transaction_dir).map_err(|rollback_error| {
        AppError::rollback_failed(format!(
            "Operation failed ({original_error}); failed to clean import rollback: {rollback_error}"
        ))
    })
}

fn restore_file(
    path: &Path,
    previous_bytes: Option<&[u8]>,
    label: &str,
    original_error: &AppError,
) -> AppResult<()> {
    if let Some(bytes) = previous_bytes {
        atomic_write(path, bytes, &format!("restored {label}"))
    } else if path.exists() {
        fs::remove_file(path).map_err(|error| {
            AppError::rollback_failed(format!(
                "Operation failed ({original_error}); failed to remove new {label}: {error}"
            ))
        })?;
        sync_parent_directory(
            path.parent().ok_or_else(|| {
                AppError::rollback_failed(format!("Restored {label} path has no parent"))
            })?,
            &format!("restored {label}"),
        )
    } else {
        Ok(())
    }
    .map_err(|rollback_error| {
        AppError::rollback_failed(format!(
            "Operation failed ({original_error}); failed to restore {label}: {rollback_error}"
        ))
    })
}

async fn run_blocking<T, F>(operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::storage_io(format!("Blocking library worker failed: {error}")))?
}

#[tauri::command]
pub async fn import_book(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
) -> AppResult<Vec<ImportBookResult>> {
    let dialog_app = app.clone();
    let picked = run_blocking(move || {
        let file_paths = dialog_app
            .dialog()
            .file()
            .add_filter("EPUB", &["epub"])
            .blocking_pick_files()
            .ok_or_else(|| AppError::cancelled("No file selected"))?;
        let mut sources = Vec::new();
        for file_path in file_paths {
            let path = file_path
                .into_path()
                .map_err(|_| AppError::invalid_input("Selected file has an invalid path"))?;
            validate_import_source(&path)?;
            let bytes = fs::read(&path)
                .map_err(|error| AppError::storage_io(format!("Failed to read EPUB: {error}")))?;
            let name = display_name_for_path(&path);
            sources.push((path, name, bytes));
        }
        Ok(sources)
    })
    .await?;

    let store = store.inner().clone();
    run_blocking(move || {
        let mut results = Vec::with_capacity(picked.len());
        for (path, name, bytes) in picked {
            results.push(store.import_bytes(&path, name, bytes)?);
        }
        Ok(results)
    })
    .await
}

#[tauri::command]
pub async fn import_paths(
    store: tauri::State<'_, LibraryStore>,
    paths: Vec<String>,
) -> AppResult<Vec<ImportBookResult>> {
    let store = store.inner().clone();
    run_blocking(move || {
        let mut results = Vec::with_capacity(paths.len());
        for path in paths {
            let path = PathBuf::from(path);
            validate_import_source(&path)?;
            let bytes = fs::read(&path)
                .map_err(|error| AppError::storage_io(format!("Failed to read EPUB: {error}")))?;
            let name = display_name_for_path(&path);
            results.push(store.import_bytes(&path, name, bytes)?);
        }
        Ok(results)
    })
    .await
}

#[tauri::command]
pub async fn discard_import(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    import_id: String,
) -> AppResult<()> {
    let store = store.inner().clone();
    run_blocking(move || store.discard_import(&book_id, &import_id)).await
}

fn raw_response(bytes: Vec<u8>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(bytes)
}

#[tauri::command]
pub async fn read_import_bytes(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    import_id: String,
) -> AppResult<tauri::ipc::Response> {
    let store = store.inner().clone();
    let bytes = run_blocking(move || store.read_import_bytes(&book_id, &import_id)).await?;
    Ok(raw_response(bytes))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_book_metadata(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    title: String,
    author: String,
    description: String,
    publisher: String,
    language: String,
    series: String,
    cover_bytes: Option<Vec<u8>>,
    import_id: String,
) -> AppResult<BookRecord> {
    let store = store.inner().clone();
    run_blocking(move || {
        store.save_book_metadata(
            &book_id,
            title,
            author,
            description,
            publisher,
            language,
            series,
            cover_bytes,
            &import_id,
        )
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_book_metadata(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    title: String,
    author: String,
    description: String,
    publisher: String,
    language: String,
    series: String,
    cover_bytes: Option<Vec<u8>>,
) -> AppResult<BookRecord> {
    let store = store.inner().clone();
    run_blocking(move || {
        store.update_book_metadata(
            &book_id,
            title,
            author,
            description,
            publisher,
            language,
            series,
            cover_bytes,
        )
    })
    .await
}

#[tauri::command]
pub async fn list_books(store: tauri::State<'_, LibraryStore>) -> AppResult<Vec<BookRecord>> {
    let store = store.inner().clone();
    run_blocking(move || store.list_books()).await
}

#[tauri::command]
pub async fn get_book_open_context(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
) -> AppResult<BookOpenContext> {
    let store = store.inner().clone();
    run_blocking(move || store.get_book_open_context(&book_id)).await
}

#[tauri::command]
pub async fn read_book_bytes(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    content_version: String,
) -> AppResult<tauri::ipc::Response> {
    let store = store.inner().clone();
    let content = run_blocking(move || store.read_book_content(&book_id, &content_version)).await?;
    Ok(raw_response(content.bytes))
}

#[tauri::command]
pub async fn open_book_bytes(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    content_version: String,
) -> AppResult<tauri::ipc::Response> {
    let opened_book_id = book_id.clone();
    let store = store.inner().clone();
    let opened_store = store.clone();
    let content = run_blocking(move || store.read_book_content(&book_id, &content_version)).await?;
    // Opening the reader must not fail only because the shelf timestamp could
    // not be updated; the EPUB bytes are already validated and available.
    if let Err(error) = run_blocking(move || opened_store.mark_book_opened(&opened_book_id)).await {
        eprintln!("[library] Book opened but lastOpenedAt was not saved: {error}");
    }
    Ok(raw_response(content.bytes))
}

#[tauri::command]
pub async fn delete_book(store: tauri::State<'_, LibraryStore>, book_id: String) -> AppResult<()> {
    let store = store.inner().clone();
    run_blocking(move || store.delete_book(&book_id)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_reading_state(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    last_fraction: Option<f64>,
    settings: Option<ReadingSettings>,
    last_reader_mode: Option<String>,
    last_layout: Option<ReaderLayout>,
    last_cfi: Option<String>,
) -> AppResult<()> {
    let store = store.inner().clone();
    run_blocking(move || {
        store.update_reading_state(
            &book_id,
            last_fraction,
            settings,
            last_reader_mode,
            last_layout,
            last_cfi,
        )
    })
    .await
}

#[tauri::command]
pub async fn get_annotations(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
) -> AppResult<AnnotationsFile> {
    let store = store.inner().clone();
    run_blocking(move || store.get_annotations(&book_id)).await
}

#[tauri::command]
pub async fn save_annotations(
    store: tauri::State<'_, LibraryStore>,
    book_id: String,
    data: AnnotationsFile,
) -> AppResult<()> {
    let store = store.inner().clone();
    run_blocking(move || store.save_annotations(&book_id, data)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppErrorCode;
    use std::sync::{Arc, Barrier};

    fn test_store() -> (tempfile::TempDir, LibraryStore) {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store = LibraryStore::initialize(directory.path().to_path_buf()).expect("store init");
        (directory, store)
    }

    fn staged_import_id(result: &ImportBookResult) -> &str {
        result
            .import_id
            .as_deref()
            .expect("import should have been staged")
    }

    fn import_test_book(store: &LibraryStore, source: &Path) -> String {
        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-one".to_vec())
            .expect("import");
        store
            .save_book_metadata(
                &result.book_id,
                "Version One".to_string(),
                "Author One".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![1, 2, 3]),
                staged_import_id(&result),
            )
            .expect("metadata");
        result.book_id
    }

    #[test]
    fn legacy_storage_is_backed_up_before_v1_is_created() {
        let directory = tempfile::tempdir().expect("temporary directory");
        fs::write(directory.path().join("library.json"), br#"{"books":[]}"#).expect("legacy lib");
        fs::create_dir(directory.path().join("books")).expect("legacy books");
        fs::create_dir(directory.path().join("sessions")).expect("legacy sessions");

        LibraryStore::initialize(directory.path().to_path_buf()).expect("initialize");

        let data = read_library_file(directory.path(), &directory.path().join("library.json"))
            .expect("new library");
        assert_eq!(data.schema_version, SCHEMA_VERSION);
        let backups: Vec<_> = fs::read_dir(directory.path().join("backup"))
            .expect("backup root")
            .collect::<Result<_, _>>()
            .expect("backup entries");
        assert_eq!(backups.len(), 1);
        assert!(backups[0].path().join("library.json").exists());
        assert!(backups[0].path().join("books").exists());
        assert!(backups[0].path().join("sessions").exists());
        assert!(directory.path().join("sessions").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn v1_sessions_symlink_is_rejected_before_agent_use() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory");
        let outside = tempfile::tempdir().expect("outside directory");
        fs::write(
            directory.path().join("library.json"),
            br#"{"schemaVersion":1,"books":[]}"#,
        )
        .expect("v1 library");
        fs::create_dir(directory.path().join("books")).expect("books");
        fs::create_dir(directory.path().join("books").join(".trash")).expect("trash");
        symlink(outside.path(), directory.path().join("sessions")).expect("sessions symlink");

        let error = match LibraryStore::initialize(directory.path().to_path_buf()) {
            Ok(_) => panic!("sessions symlink unexpectedly initialized"),
            Err(error) => error,
        };

        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
        assert!(outside
            .path()
            .read_dir()
            .expect("outside remains readable")
            .next()
            .is_none());
    }

    #[test]
    fn corrupt_or_mismatched_library_is_never_replaced() {
        for bytes in [
            br#"{"schemaVersion":1,"books":["# as &[u8],
            br#"{"schemaVersion":2,"books":[]}"#,
            br#"{"schemaVersion":1,"books":[{}]}"#,
        ] {
            let directory = tempfile::tempdir().expect("temporary directory");
            let path = directory.path().join("library.json");
            fs::write(&path, bytes).expect("write corrupt data");
            let before = fs::read(&path).expect("before");
            let error = match LibraryStore::initialize(directory.path().to_path_buf()) {
                Ok(_) => panic!("corrupt store unexpectedly initialized"),
                Err(error) => error,
            };
            assert_eq!(error.code, AppErrorCode::StorageCorrupt);
            assert_eq!(fs::read(path).expect("after"), before);
        }
    }

    #[test]
    fn failed_legacy_backup_does_not_create_a_new_library() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let library_path = directory.path().join("library.json");
        let legacy = br#"{"books":[]}"#;
        fs::write(&library_path, legacy).expect("legacy library");
        fs::write(directory.path().join("backup"), b"not a directory").expect("backup blocker");

        let error = match LibraryStore::initialize(directory.path().to_path_buf()) {
            Ok(_) => panic!("store unexpectedly initialized"),
            Err(error) => error,
        };

        assert_eq!(error.code, AppErrorCode::StorageIo);
        assert_eq!(fs::read(library_path).expect("legacy remains"), legacy);
    }

    #[test]
    fn rejects_path_like_and_unknown_ids_before_filesystem_changes() {
        let (directory, store) = test_store();
        for invalid in ["", ".", "..", "../x", "a/b", r"a\b", "/tmp/x", "UPPER"] {
            let error = store.delete_book(invalid).expect_err("invalid id");
            assert_eq!(error.code, AppErrorCode::InvalidInput);
        }
        let unknown = "deadbeef";
        let candidate = directory.path().join("books").join(unknown);
        let error = store.delete_book(unknown).expect_err("unknown id");
        assert_eq!(error.code, AppErrorCode::BookNotFound);
        assert!(!candidate.exists());
    }

    #[test]
    fn concurrent_partial_updates_preserve_both_fields() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/concurrent.epub"));
        let barrier = Arc::new(Barrier::new(3));
        let fraction_store = store.clone();
        let fraction_id = id.clone();
        let fraction_barrier = barrier.clone();
        let fraction = std::thread::spawn(move || {
            fraction_barrier.wait();
            fraction_store.update_reading_state(&fraction_id, Some(0.75), None, None, None, None)
        });
        let settings_store = store.clone();
        let settings_id = id.clone();
        let settings_barrier = barrier.clone();
        let settings = std::thread::spawn(move || {
            settings_barrier.wait();
            settings_store.update_reading_state(
                &settings_id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    font_family: Some("serif".to_string()),
                    theme: Some("sepia".to_string()),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
        });
        barrier.wait();
        fraction.join().expect("fraction thread").expect("fraction");
        settings.join().expect("settings thread").expect("settings");

        let book = store.list_books().expect("list").remove(0);
        assert_eq!(book.last_fraction, Some(0.75));
        assert_eq!(
            book.settings.expect("settings").theme.as_deref(),
            Some("sepia")
        );
    }

    #[test]
    fn delete_write_failure_restores_the_book_directory() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/rollback.epub"));
        let book_dir = directory.path().join("books").join(&id);
        store.fail_next_library_write();

        let error = store.delete_book(&id).expect_err("injected failure");

        assert_eq!(error.code, AppErrorCode::StorageIo);
        assert!(book_dir.join("book.epub").exists());
        assert_eq!(store.list_books().expect("list").len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn runtime_trash_symlink_cannot_move_a_book_outside_the_library() {
        use std::os::unix::fs::symlink;

        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/runtime-trash-symlink.epub"));
        let book_dir = directory.path().join("books").join(&id);
        let trash = directory.path().join("books").join(".trash");
        let outside = tempfile::tempdir().expect("outside directory");
        fs::remove_dir(&trash).expect("remove empty trash");
        symlink(outside.path(), &trash).expect("trash symlink");

        let error = store.delete_book(&id).expect_err("symlink trash must fail");

        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
        assert!(book_dir.join("book.epub").is_file());
        assert!(outside
            .path()
            .read_dir()
            .expect("outside remains readable")
            .next()
            .is_none());
    }

    #[test]
    fn interrupted_delete_is_restored_during_initialization() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/delete-crash.epub"));
        let book_dir = directory.path().join("books").join(&id);
        let staged = directory.path().join("books").join(".trash").join(format!(
            "{}-{}",
            id,
            operation_id()
        ));
        fs::rename(&book_dir, &staged).expect("simulate crash after deletion staging");
        drop(store);

        let recovered =
            LibraryStore::initialize(directory.path().to_path_buf()).expect("recover store");

        assert!(book_dir.join("book.epub").is_file());
        assert!(!staged.exists());
        assert_eq!(recovered.list_books().expect("list").len(), 1);
    }

    #[test]
    fn interrupted_first_import_is_staged_as_a_recoverable_orphan() {
        let (directory, store) = test_store();
        let orphan_id = "deadbeef";
        let orphan_dir = directory.path().join("books").join(orphan_id);
        fs::create_dir(&orphan_dir).expect("orphan directory");
        fs::write(orphan_dir.join("book.epub"), b"uncommitted").expect("orphan epub");
        drop(store);

        let recovered =
            LibraryStore::initialize(directory.path().to_path_buf()).expect("recover store");

        assert!(!orphan_dir.exists());
        let trash_entries: Vec<_> = fs::read_dir(directory.path().join("books").join(".trash"))
            .expect("trash")
            .collect::<Result<_, _>>()
            .expect("trash entries");
        assert!(trash_entries.iter().any(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("orphan-deadbeef-"))
        }));
        assert!(recovered.list_books().expect("list").is_empty());
    }

    #[test]
    fn failed_library_write_preserves_the_last_complete_json() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/atomic.epub"));
        let library_path = directory.path().join("library.json");
        let before = fs::read(&library_path).expect("complete library");
        store.fail_next_library_write();

        store
            .update_reading_state(&id, Some(0.9), None, None, None, None)
            .expect_err("injected failure");

        assert_eq!(
            fs::read(&library_path).expect("library after failure"),
            before
        );
        read_library_file(directory.path(), &library_path).expect("still valid json");
    }

    #[test]
    fn controlled_paths_in_v1_records_are_strictly_validated() {
        for field in ["filePath", "coverPath"] {
            let (directory, store) = test_store();
            import_test_book(&store, Path::new("/source/path-validation.epub"));
            let library_path = directory.path().join("library.json");
            let mut value: serde_json::Value =
                serde_json::from_slice(&fs::read(&library_path).expect("library bytes"))
                    .expect("library json");
            value["books"][0][field] = serde_json::Value::String("/tmp/outside".to_string());
            fs::write(
                &library_path,
                serde_json::to_vec_pretty(&value).expect("corrupt json"),
            )
            .expect("write corrupt record");

            let error = store.list_books().expect_err("unsafe path must fail");
            assert_eq!(error.code, AppErrorCode::StorageCorrupt);
        }
    }

    #[cfg(unix)]
    #[test]
    fn unregistered_symlink_book_directory_cannot_escape_books_root() {
        use std::os::unix::fs::symlink;

        let (directory, store) = test_store();
        let source = Path::new("/source/symlink.epub");
        let id = book_id_for_source(source);
        let outside = tempfile::tempdir().expect("outside directory");
        symlink(outside.path(), directory.path().join("books").join(&id)).expect("book symlink");

        let error = store
            .import_bytes(source, "book.epub".to_string(), b"unsafe".to_vec())
            .expect_err("symlink import must fail");

        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
        assert!(!outside.path().join("book.epub").exists());
        assert!(!outside.path().join(".imports").exists());
    }

    #[test]
    fn update_book_metadata_title_only_keeps_cover_and_progress() {
        let (directory, store) = test_store();
        let source = Path::new("/source/edit-title.epub");
        let id = import_test_book(&store, source);
        store
            .update_reading_state(&id, Some(0.42), None, None, None, None)
            .expect("progress");
        let before = store.list_books().expect("list").remove(0);
        let cover_path = PathBuf::from(&before.cover_path);
        let cover_before = fs::read(&cover_path).expect("cover");
        let epub_before =
            fs::read(directory.path().join("books").join(&id).join("book.epub")).expect("epub");

        let updated = store
            .update_book_metadata(
                &id,
                "Renamed".to_string(),
                "Author One".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                None,
            )
            .expect("title-only update");

        assert_eq!(updated.title, "Renamed");
        assert_eq!(updated.author, "Author One");
        assert_eq!(updated.cover_path, before.cover_path);
        assert_eq!(updated.last_fraction, Some(0.42));
        assert_eq!(updated.last_opened_at, before.last_opened_at);
        assert_eq!(updated.imported_at, before.imported_at);
        assert_eq!(updated.file_path, before.file_path);
        assert_eq!(updated.content_hash, before.content_hash);
        assert_eq!(updated.id, id);
        assert_eq!(fs::read(&cover_path).expect("cover after"), cover_before);
        assert_eq!(
            fs::read(directory.path().join("books").join(&id).join("book.epub"))
                .expect("epub after"),
            epub_before
        );
    }

    #[test]
    fn update_book_metadata_cover_write_failure_rolls_back() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/edit-cover-rollback.epub"));
        let book_dir = directory.path().join("books").join(&id);
        let cover_path = book_dir.join("cover.jpg");
        let cover_before = fs::read(&cover_path).expect("cover");
        store.fail_next_library_write();

        let error = store
            .update_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![4, 5, 6]),
            )
            .expect_err("library write must fail");

        assert_eq!(error.code, AppErrorCode::StorageIo);
        assert_eq!(fs::read(&cover_path).expect("restored cover"), cover_before);
        let record = store.list_books().expect("old library").remove(0);
        assert_eq!(record.title, "Version One");
        assert_eq!(record.author, "Author One");
    }

    #[test]
    fn update_book_metadata_rejects_empty_title() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/edit-empty-title.epub"));

        let error = store
            .update_book_metadata(
                &id,
                "   ".to_string(),
                "Author".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                None,
            )
            .expect_err("empty title");

        assert_eq!(error.code, AppErrorCode::InvalidInput);
        let record = store.list_books().expect("unchanged").remove(0);
        assert_eq!(record.title, "Version One");
    }

    #[test]
    fn update_book_metadata_rejects_empty_cover_bytes() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/edit-empty-cover.epub"));

        let error = store
            .update_book_metadata(
                &id,
                "Version One".to_string(),
                "Author One".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![]),
            )
            .expect_err("empty cover");

        assert_eq!(error.code, AppErrorCode::InvalidInput);
        let record = store.list_books().expect("unchanged").remove(0);
        assert_eq!(record.title, "Version One");
        assert_eq!(fs::read(&record.cover_path).expect("cover"), [1, 2, 3]);
    }

    #[test]
    fn update_book_metadata_replaces_cover_and_keeps_other_fields() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/edit-cover.epub"));
        store
            .update_reading_state(&id, Some(0.3), None, None, None, None)
            .expect("progress");
        let before = store.list_books().expect("list").remove(0);
        let cover_path = PathBuf::from(&before.cover_path);
        let epub_before =
            fs::read(directory.path().join("books").join(&id).join("book.epub")).expect("epub");

        let updated = store
            .update_book_metadata(
                &id,
                "Version One".to_string(),
                "Author One".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![4, 5, 6]),
            )
            .expect("cover replace");

        assert_eq!(updated.cover_path, before.cover_path);
        assert_eq!(updated.last_fraction, Some(0.3));
        assert_eq!(updated.file_path, before.file_path);
        assert_eq!(updated.content_hash, before.content_hash);
        assert_eq!(updated.id, id);
        assert_eq!(fs::read(&cover_path).expect("new cover"), [4, 5, 6]);
        assert_eq!(
            fs::read(directory.path().join("books").join(&id).join("book.epub"))
                .expect("epub after"),
            epub_before
        );
    }

    #[test]
    fn extra_shelf_fields_persist_round_trip_and_empty_omits_keys() {
        let (directory, store) = test_store();
        let source = Path::new("/source/shelf-fields.epub");
        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-one".to_vec())
            .expect("import");
        let saved = store
            .save_book_metadata(
                &result.book_id,
                "Version One".to_string(),
                "Author One".to_string(),
                "A blurb".to_string(),
                "Pub Co".to_string(),
                "zh-CN".to_string(),
                "The Series · 2".to_string(),
                Some(vec![1, 2, 3]),
                staged_import_id(&result),
            )
            .expect("commit extra fields");

        assert_eq!(saved.description.as_deref(), Some("A blurb"));
        assert_eq!(saved.publisher.as_deref(), Some("Pub Co"));
        assert_eq!(saved.language.as_deref(), Some("zh-CN"));
        assert_eq!(saved.series.as_deref(), Some("The Series · 2"));

        let listed = store.list_books().expect("reload").remove(0);
        assert_eq!(listed.description, saved.description);
        assert_eq!(listed.publisher, saved.publisher);
        assert_eq!(listed.language, saved.language);
        assert_eq!(listed.series, saved.series);

        let library_path = directory.path().join("library.json");
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&library_path).expect("library bytes"))
                .expect("library json");
        assert_eq!(value["books"][0]["description"], "A blurb");
        assert_eq!(value["books"][0]["publisher"], "Pub Co");
        assert_eq!(value["books"][0]["language"], "zh-CN");
        assert_eq!(value["books"][0]["series"], "The Series · 2");

        store
            .update_book_metadata(
                &result.book_id,
                "Version One".to_string(),
                "Author One".to_string(),
                "  ".to_string(),
                String::new(),
                String::new(),
                String::new(),
                None,
            )
            .expect("clear extra fields");

        let cleared = store.list_books().expect("cleared").remove(0);
        assert!(cleared.description.is_none());
        assert!(cleared.publisher.is_none());
        assert!(cleared.language.is_none());
        assert!(cleared.series.is_none());
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&library_path).expect("library bytes"))
                .expect("library json");
        let book = value["books"][0].as_object().expect("book object");
        assert!(!book.contains_key("description"));
        assert!(!book.contains_key("publisher"));
        assert!(!book.contains_key("language"));
        assert!(!book.contains_key("series"));
    }

    #[test]
    fn old_library_json_without_extra_shelf_fields_still_reads() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/legacy-shelf.epub"));
        store
            .update_book_metadata(
                &id,
                "Version One".to_string(),
                "Author One".to_string(),
                "keep".to_string(),
                "press".to_string(),
                "en".to_string(),
                "saga".to_string(),
                None,
            )
            .expect("seed extra fields");
        let library_path = directory.path().join("library.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&library_path).expect("library bytes"))
                .expect("library json");
        let book = value["books"][0].as_object_mut().expect("book object");
        book.remove("description");
        book.remove("publisher");
        book.remove("language");
        book.remove("series");
        fs::write(
            &library_path,
            serde_json::to_vec_pretty(&value).expect("legacy json"),
        )
        .expect("write legacy record");

        let books = store.list_books().expect("old records still read");
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].id, id);
        assert!(books[0].description.is_none());
        assert!(books[0].publisher.is_none());
        assert!(books[0].language.is_none());
        assert!(books[0].series.is_none());
        assert_eq!(books[0].title, "Version One");
    }

    #[test]
    fn extra_shelf_fields_over_cap_are_rejected() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/shelf-over-cap.epub"));
        let too_long_description = "x".repeat(MAX_DESCRIPTION_BYTES + 1);
        let error = store
            .update_book_metadata(
                &id,
                "Version One".to_string(),
                "Author One".to_string(),
                too_long_description,
                String::new(),
                String::new(),
                String::new(),
                None,
            )
            .expect_err("description over cap");
        assert_eq!(error.code, AppErrorCode::InvalidInput);

        let too_long_publisher = "x".repeat(MAX_AUTHOR_BYTES + 1);
        let error = store
            .update_book_metadata(
                &id,
                "Version One".to_string(),
                "Author One".to_string(),
                String::new(),
                too_long_publisher,
                String::new(),
                String::new(),
                None,
            )
            .expect_err("publisher over cap");
        assert_eq!(error.code, AppErrorCode::InvalidInput);

        let record = store.list_books().expect("unchanged").remove(0);
        assert!(record.description.is_none());
        assert!(record.publisher.is_none());

        let library_path = directory.path().join("library.json");
        let original = fs::read(&library_path).expect("original library");
        let mut value: serde_json::Value = serde_json::from_slice(&original).expect("library json");
        value["books"][0]["description"] =
            serde_json::Value::String("x".repeat(MAX_DESCRIPTION_BYTES + 1));
        fs::write(
            &library_path,
            serde_json::to_vec_pretty(&value).expect("over-cap json"),
        )
        .expect("write over-cap");
        let error = store.list_books().expect_err("stored over-cap");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn overwrite_replaces_extra_shelf_fields() {
        let (_directory, store) = test_store();
        let source = Path::new("/source/overwrite-shelf.epub");
        let id = import_test_book(&store, source);
        store
            .update_book_metadata(
                &id,
                "Version One".to_string(),
                "Author One".to_string(),
                "Old desc".to_string(),
                "Old pub".to_string(),
                "en".to_string(),
                "Old series".to_string(),
                None,
            )
            .expect("seed extra fields");
        store
            .update_reading_state(&id, Some(0.42), None, None, None, None)
            .expect("progress");

        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("reimport");
        store
            .save_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                "New desc".to_string(),
                "New pub".to_string(),
                "zh".to_string(),
                "New series".to_string(),
                Some(vec![9, 9, 9]),
                staged_import_id(&result),
            )
            .expect("commit overwrite");

        let after = store.list_books().expect("after").remove(0);
        assert_eq!(after.title, "Version Two");
        assert_eq!(after.description.as_deref(), Some("New desc"));
        assert_eq!(after.publisher.as_deref(), Some("New pub"));
        assert_eq!(after.language.as_deref(), Some("zh"));
        assert_eq!(after.series.as_deref(), Some("New series"));
        assert_eq!(after.last_fraction, Some(0.42));
    }

    #[test]
    fn unknown_metadata_id_does_not_create_a_cover_path() {
        let (directory, store) = test_store();
        let unknown = "deadbeef";

        let error = store
            .save_book_metadata(
                unknown,
                "Unknown".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![1, 2, 3]),
                "pending1",
            )
            .expect_err("unknown id");

        assert_eq!(error.code, AppErrorCode::BookNotFound);
        assert!(!directory.path().join("books").join(unknown).exists());
    }

    #[test]
    fn late_update_does_not_recreate_a_deleted_record() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/delete.epub"));
        store.delete_book(&id).expect("delete");

        let error = store
            .update_reading_state(&id, Some(0.5), None, None, None, None)
            .expect_err("late update");

        assert_eq!(error.code, AppErrorCode::BookNotFound);
        assert!(store.list_books().expect("list").is_empty());
    }

    #[test]
    fn failed_reimport_metadata_keeps_the_previous_complete_version() {
        let (directory, store) = test_store();
        let source = Path::new("/source/reimport.epub");
        let id = import_test_book(&store, source);
        store
            .update_reading_state(&id, Some(0.4), None, None, None, None)
            .expect("progress");
        let version_two = b"version-two-and-different".to_vec();

        let result = store
            .import_bytes(source, "book.epub".to_string(), version_two.clone())
            .expect("reimport");

        assert_eq!(
            store
                .read_import_bytes(&result.book_id, staged_import_id(&result))
                .expect("staged bytes"),
            version_two
        );
        assert_eq!(
            fs::read(directory.path().join("books").join(&id).join("book.epub"))
                .expect("stored epub"),
            b"version-one"
        );
        let before_commit = store.list_books().expect("list").remove(0);
        assert_eq!(before_commit.title, "Version One");
        assert_eq!(
            fs::read(before_commit.cover_path).expect("old cover"),
            [1, 2, 3]
        );

        store
            .save_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![4, 5, 6]),
                staged_import_id(&result),
            )
            .expect("commit reimport metadata");

        assert_eq!(
            fs::read(directory.path().join("books").join(&id).join("book.epub"))
                .expect("stored epub"),
            version_two
        );
        let committed = store.list_books().expect("list").remove(0);
        assert_eq!(committed.title, "Version Two");
        assert_eq!(
            fs::read(committed.cover_path).expect("new cover"),
            [4, 5, 6]
        );
        assert_eq!(committed.last_fraction, Some(0.4));
    }

    #[test]
    fn reimport_library_write_failure_rolls_back_epub_cover_and_metadata() {
        let (directory, store) = test_store();
        let source = Path::new("/source/reimport-write-failure.epub");
        let id = import_test_book(&store, source);
        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("stage reimport");
        store.fail_next_library_write();

        let error = store
            .save_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![4, 5, 6]),
                staged_import_id(&result),
            )
            .expect_err("metadata commit must fail");

        assert_eq!(error.code, AppErrorCode::StorageIo);
        let book_dir = directory.path().join("books").join(&id);
        assert_eq!(
            fs::read(book_dir.join("book.epub")).expect("old epub"),
            b"version-one"
        );
        assert_eq!(
            fs::read(book_dir.join("cover.jpg")).expect("old cover"),
            [1, 2, 3]
        );
        let record = store.list_books().expect("old library").remove(0);
        assert_eq!(record.title, "Version One");
        assert_eq!(record.author, "Author One");
    }

    #[test]
    fn interrupted_reimport_is_rolled_back_during_initialization() {
        let (directory, store) = test_store();
        let source = Path::new("/source/reimport-crash.epub");
        let id = import_test_book(&store, source);
        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("stage reimport");
        let book_dir = directory.path().join("books").join(&id);
        prepare_import_transaction(&book_dir, staged_import_id(&result)).expect("prepare journal");
        atomic_write(&book_dir.join("book.epub"), b"version-two", "EPUB")
            .expect("replace epub before simulated crash");
        atomic_write(&book_dir.join("cover.jpg"), &[4, 5, 6], "cover")
            .expect("replace cover before simulated crash");
        drop(store);

        let recovered =
            LibraryStore::initialize(directory.path().to_path_buf()).expect("recover store");

        assert_eq!(
            fs::read(book_dir.join("book.epub")).expect("old epub"),
            b"version-one"
        );
        assert_eq!(
            fs::read(book_dir.join("cover.jpg")).expect("old cover"),
            [1, 2, 3]
        );
        let record = recovered.list_books().expect("old library").remove(0);
        assert_eq!(record.title, "Version One");
        assert_eq!(record.author, "Author One");
    }

    #[test]
    fn validation_rejects_out_of_range_reading_state() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/validation.epub"));
        for fraction in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
            let error = store
                .update_reading_state(&id, Some(fraction), None, None, None, None)
                .expect_err("fraction validation");
            assert_eq!(error.code, AppErrorCode::InvalidInput);
        }
        let error = store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(11.0),
                    font_family: Some("Comic Sans".to_string()),
                    theme: Some("neon".to_string()),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect_err("settings validation");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
    }

    #[test]
    fn reading_settings_persists_typography_override() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/typography-override.epub"));
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    font_family: Some("serif".to_string()),
                    line_height: Some(2.0),
                    content_width: Some(52.0),
                    page_padding: Some(2.5),
                    text_align: Some("justify".to_string()),
                    letter_spacing: Some(0.02),
                    paragraph_spacing: Some(1.1),
                    first_line_indent: Some(2.0),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("persist override");

        let settings = store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .expect("settings");
        assert_eq!(settings.font_size, Some(18.0));
        assert_eq!(settings.font_family.as_deref(), Some("serif"));
        assert_eq!(settings.line_height, Some(2.0));
        assert_eq!(settings.content_width, Some(52.0));
        assert_eq!(settings.page_padding, Some(2.5));
        assert!(settings.page_margin.is_none());
        assert_eq!(settings.text_align.as_deref(), Some("justify"));
        assert_eq!(settings.letter_spacing, Some(0.02));
        assert_eq!(settings.paragraph_spacing, Some(1.1));
        assert_eq!(settings.first_line_indent, Some(2.0));
    }

    #[test]
    fn reading_settings_restore_omits_typography_key() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/typography-restore.epub"));
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    font_family: Some("sans-serif".to_string()),
                    line_height: Some(1.4),
                    content_width: Some(36.0),
                    page_padding: Some(1.25),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("persist override");
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    font_family: Some("sans-serif".to_string()),
                    content_width: Some(36.0),
                    page_padding: Some(1.25),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("restore lineHeight");

        let settings = store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .expect("settings");
        assert_eq!(settings.font_size, Some(18.0));
        assert_eq!(settings.font_family.as_deref(), Some("sans-serif"));
        assert!(settings.line_height.is_none());
        assert_eq!(settings.content_width, Some(36.0));
        assert_eq!(settings.page_padding, Some(1.25));
    }

    #[test]
    fn reading_settings_accepts_named_font_family() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/named-font.epub"));
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_family: Some("Noto Serif CJK SC".to_string()),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("persist named font");
        let settings = store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .expect("settings");
        assert_eq!(settings.font_family.as_deref(), Some("Noto Serif CJK SC"));
    }

    #[test]
    fn reading_settings_rejects_invalid_font_family() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/bad-font.epub"));
        for value in [
            String::new(),
            "   ".to_string(),
            "bad;font".to_string(),
            "a".repeat(129),
        ] {
            let error = store
                .update_reading_state(
                    &id,
                    None,
                    Some(ReadingSettings {
                        font_family: Some(value),
                        ..ReadingSettings::default()
                    }),
                    None,
                    None,
                    None,
                )
                .expect_err("invalid font");
            assert_eq!(error.code, AppErrorCode::InvalidInput);
        }
    }

    #[test]
    fn reading_settings_old_enum_book_loads() {
        let settings: ReadingSettings =
            serde_json::from_str(r#"{"lineHeight":"compact","pageMargin":"wide"}"#)
                .expect("old enum settings");
        validate_settings(&settings).expect("old enums valid");
        assert_eq!(settings.line_height, Some(1.4));
        assert_eq!(settings.page_margin.as_deref(), Some("wide"));

        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/old-enum-settings.epub"));
        store
            .update_reading_state(&id, None, Some(settings.clone()), None, None, None)
            .expect("persist old enums");
        let stored = store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .expect("settings");
        assert_eq!(stored.line_height, Some(1.4));
        assert_eq!(stored.page_margin.as_deref(), Some("wide"));
    }

    #[test]
    fn reading_settings_rejects_out_of_range() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/typography-invalid.epub"));
        let error = store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(16.0),
                    line_height: Some(3.0),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect_err("out of range lineHeight");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
    }

    #[test]
    fn reading_settings_empty_snapshot_clears_overrides() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/typography-clear.epub"));
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("persist override");
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings::default()),
                None,
                None,
                None,
            )
            .expect("clear overrides");
        assert!(store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .is_none());
    }

    #[test]
    fn reading_settings_old_font_only_snapshot_still_valid() {
        let settings: ReadingSettings =
            serde_json::from_str(r#"{"fontSize":18.0,"fontFamily":"serif"}"#)
                .expect("old settings json");
        validate_settings(&settings).expect("old font snapshot is valid");

        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/old-font-settings.epub"));
        store
            .update_reading_state(&id, None, Some(settings.clone()), None, None, None)
            .expect("persist old snapshot");
        let stored = store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .expect("settings");
        assert_eq!(stored, settings);
        assert!(stored.line_height.is_none());
        assert!(stored.page_margin.is_none());
        assert!(stored.text_align.is_none());
        assert!(stored.override_font.is_none());
        assert!(stored.override_layout.is_none());
    }

    #[test]
    fn reading_settings_persists_override_flags() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/override-flags.epub"));
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    override_font: Some(true),
                    override_layout: Some(true),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("persist override flags");
        let settings = store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .expect("settings");
        assert_eq!(settings.override_font, Some(true));
        assert_eq!(settings.override_layout, Some(true));
    }

    #[test]
    fn reading_settings_keeps_explicit_override_false() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/override-false.epub"));
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    override_font: Some(false),
                    override_layout: Some(false),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("persist explicit false");
        let settings = store
            .list_books()
            .expect("list")
            .remove(0)
            .settings
            .expect("settings");
        assert_eq!(settings.override_font, Some(false));
        assert_eq!(settings.override_layout, Some(false));

        let json = serde_json::to_value(&settings).expect("serialize");
        assert_eq!(json["overrideFont"], false);
        assert_eq!(json["overrideLayout"], false);
    }

    #[test]
    fn reading_settings_missing_override_keys_are_none() {
        let settings: ReadingSettings =
            serde_json::from_str(r#"{"fontSize":18.0}"#).expect("old settings json");
        validate_settings(&settings).expect("old snapshot valid");
        assert!(settings.override_font.is_none());
        assert!(settings.override_layout.is_none());
    }

    #[test]
    fn open_context_version_rejects_stale_or_uncommitted_content() {
        let (_directory, store) = test_store();
        let source = Path::new("/source/version-bound-open.epub");
        let id = import_test_book(&store, source);
        let first_context = store.get_book_open_context(&id).expect("first context");
        assert_eq!(
            store
                .read_book_content(&id, &first_context.content_version)
                .expect("first content")
                .bytes,
            b"version-one"
        );

        let pending = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("stage second version");
        assert_ne!(staged_import_id(&pending), first_context.content_version);
        let error = store
            .read_book_content(&id, staged_import_id(&pending))
            .expect_err("uncommitted content must not open as the active book");
        assert_eq!(error.code, AppErrorCode::InvalidInput);

        store
            .save_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                None,
                staged_import_id(&pending),
            )
            .expect("commit second version");
        let stale_error = store
            .read_book_content(&id, &first_context.content_version)
            .expect_err("old context must not open new bytes");
        assert_eq!(stale_error.code, AppErrorCode::InvalidInput);

        let second_context = store.get_book_open_context(&id).expect("second context");
        assert_eq!(second_context.content_version, staged_import_id(&pending));
        assert_eq!(
            store
                .read_book_content(&id, &second_context.content_version)
                .expect("second content")
                .bytes,
            b"version-two"
        );
    }

    #[test]
    fn raw_response_keeps_large_epub_payload_out_of_json() {
        use tauri::ipc::{InvokeResponseBody, IpcResponse};

        let payload = vec![0xA5; 2 * 1024 * 1024];
        let body = raw_response(payload.clone()).body().expect("raw body");
        match body {
            InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, payload),
            InvokeResponseBody::Json(_) => panic!("EPUB bytes must not be JSON serialized"),
        }
    }

    #[test]
    fn old_library_json_without_new_fields_still_reads() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/legacy-fields.epub"));
        let library_path = directory.path().join("library.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&library_path).expect("library bytes"))
                .expect("library json");
        value["books"][0]
            .as_object_mut()
            .expect("book object")
            .remove("contentHash");
        value["books"][0]
            .as_object_mut()
            .expect("book object")
            .remove("lastOpenedAt");
        fs::write(
            &library_path,
            serde_json::to_vec_pretty(&value).expect("legacy json"),
        )
        .expect("write legacy record");

        let books = store.list_books().expect("old records still read");
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].id, id);
        assert!(books[0].content_hash.is_none());
        assert!(books[0].last_opened_at.is_none());
    }

    #[test]
    fn open_context_returns_stored_title_and_backfills_hash() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/open-title.epub"));
        let library_path = directory.path().join("library.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&library_path).expect("library bytes"))
                .expect("library json");
        value["books"][0]
            .as_object_mut()
            .expect("book object")
            .remove("contentHash");
        fs::write(
            &library_path,
            serde_json::to_vec_pretty(&value).expect("stripped json"),
        )
        .expect("write stripped hash");

        let context = store.get_book_open_context(&id).expect("open context");
        assert_eq!(context.title, "Version One");
        assert_eq!(context.name, "book.epub");
        assert_ne!(context.title, "book.epub");
        assert!(!context.title.is_empty());

        let book = store.list_books().expect("list").remove(0);
        let hash = book.content_hash.expect("backfilled hash");
        assert_eq!(hash.len(), 64);
        assert!(hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
    }

    fn import_named_book(store: &LibraryStore, source: &Path, bytes: &[u8], title: &str) -> String {
        let result = store
            .import_bytes(source, "book.epub".to_string(), bytes.to_vec())
            .expect("import");
        store
            .save_book_metadata(
                &result.book_id,
                title.to_string(),
                "Author One".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![1, 2, 3]),
                staged_import_id(&result),
            )
            .expect("metadata");
        result.book_id
    }

    #[test]
    fn list_books_orders_recently_opened_first() {
        let (_directory, store) = test_store();
        let first = import_named_book(
            &store,
            Path::new("/source/older.epub"),
            b"older-book-bytes",
            "Older",
        );
        let second = import_named_book(
            &store,
            Path::new("/source/newer.epub"),
            b"newer-book-bytes",
            "Newer",
        );

        let before = store.list_books().expect("list before open");
        assert_eq!(before[0].id, second);
        assert_eq!(before[1].id, first);

        store.mark_book_opened(&first).expect("mark opened");

        let after = store.list_books().expect("list after open");
        assert_eq!(after[0].id, first);
        assert_eq!(after[1].id, second);
        assert!(after[0].last_opened_at.is_some());
        assert!(after[1].last_opened_at.is_none());
    }

    #[test]
    fn same_path_reimport_is_overwrite_and_keeps_progress() {
        let (_directory, store) = test_store();
        let source = Path::new("/source/overwrite.epub");
        let id = import_test_book(&store, source);
        store
            .update_reading_state(
                &id,
                Some(0.42),
                None,
                None,
                None,
                Some("epubcfi(/6/8!/4/2/1:0)".to_string()),
            )
            .expect("progress");
        store
            .update_reading_state(&id, None, None, Some("agent".to_string()), None, None)
            .expect("mode");
        store
            .update_reading_state(
                &id,
                None,
                None,
                None,
                Some(ReaderLayout {
                    chat_collapsed: false,
                    book_collapsed: true,
                    session_rail_open: false,
                }),
                None,
            )
            .expect("layout");
        store.mark_book_opened(&id).expect("opened");
        let before = store.list_books().expect("before").remove(0);

        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("reimport");

        assert_eq!(result.status, ImportStatus::Overwrite);
        assert_eq!(result.book_id, id);
        assert_eq!(result.title, "Version One");
        assert!(result.import_id.is_some());

        store
            .save_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![9, 9, 9]),
                staged_import_id(&result),
            )
            .expect("commit overwrite");

        let after = store.list_books().expect("after").remove(0);
        assert_eq!(after.title, "Version Two");
        assert_eq!(after.last_fraction, Some(0.42));
        assert_eq!(after.last_cfi.as_deref(), Some("epubcfi(/6/8!/4/2/1:0)"));
        assert_eq!(after.last_opened_at, before.last_opened_at);
        assert_eq!(after.settings, before.settings);
        assert_eq!(after.last_reader_mode.as_deref(), Some("agent"));
        assert_eq!(
            after.last_layout,
            Some(ReaderLayout {
                chat_collapsed: false,
                book_collapsed: true,
                session_rail_open: false,
            })
        );
        assert_eq!(
            after.content_hash.as_deref(),
            Some(sha256_hex(b"version-two").as_str())
        );
    }

    #[test]
    fn same_path_unchanged_reimport_is_duplicate_and_does_not_stage() {
        let (directory, store) = test_store();
        let source = Path::new("/source/unchanged.epub");
        let id = import_test_book(&store, source);
        store
            .update_reading_state(&id, Some(0.42), None, None, None, None)
            .expect("progress");
        store.mark_book_opened(&id).expect("opened");
        let before = store.list_books().expect("before").remove(0);
        let book_dir = directory.path().join("books").join(&id);
        let committed_epub = book_dir.join("book.epub");
        let committed_bytes = fs::read(&committed_epub).expect("committed epub");

        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-one".to_vec())
            .expect("reimport unchanged");

        assert_eq!(result.status, ImportStatus::Duplicate);
        assert_eq!(result.book_id, id);
        assert_eq!(result.title, "Version One");
        assert!(result.import_id.is_none());
        let imports_dir = book_dir.join(".imports");
        let staged = fs::read_dir(&imports_dir)
            .map(|entries| entries.collect::<Result<Vec<_>, _>>().expect("imports"))
            .unwrap_or_default();
        assert!(staged.is_empty(), "unchanged reimport must not stage");

        let after = store.list_books().expect("after").remove(0);
        assert_eq!(after.title, before.title);
        assert_eq!(after.last_fraction, Some(0.42));
        assert_eq!(after.last_opened_at, before.last_opened_at);
        assert_eq!(after.content_hash, before.content_hash);
        assert_eq!(
            fs::read(&committed_epub).expect("epub unchanged"),
            committed_bytes
        );
        assert_eq!(committed_bytes, b"version-one");
    }

    #[test]
    fn same_batch_new_then_same_content_is_duplicate() {
        let (_directory, store) = test_store();
        let first = store
            .import_bytes(
                Path::new("/source/first.epub"),
                "first.epub".to_string(),
                b"shared-bytes".to_vec(),
            )
            .expect("first import");
        assert_eq!(first.status, ImportStatus::New);

        let second = store
            .import_bytes(
                Path::new("/other/second.epub"),
                "second.epub".to_string(),
                b"shared-bytes".to_vec(),
            )
            .expect("second import");

        assert_eq!(second.status, ImportStatus::Duplicate);
        assert_eq!(second.book_id, first.book_id);
        assert_eq!(second.title, "first.epub");
        assert!(second.import_id.is_none());
        assert_eq!(store.list_books().expect("list").len(), 1);
    }

    #[test]
    fn overwrite_commit_then_other_path_same_content_is_duplicate() {
        let (_directory, store) = test_store();
        let source = Path::new("/source/then-copy.epub");
        let id = import_test_book(&store, source);
        let overwrite = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("overwrite");
        store
            .save_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![9, 9, 9]),
                staged_import_id(&overwrite),
            )
            .expect("commit overwrite");

        let duplicate = store
            .import_bytes(
                Path::new("/other/copy-two.epub"),
                "copy-two.epub".to_string(),
                b"version-two".to_vec(),
            )
            .expect("duplicate after overwrite commit");

        assert_eq!(duplicate.status, ImportStatus::Duplicate);
        assert_eq!(duplicate.book_id, id);
        assert_eq!(store.list_books().expect("list").len(), 1);
    }

    #[test]
    fn same_content_different_path_is_duplicate_and_does_not_stage() {
        let (directory, store) = test_store();
        let existing = import_test_book(&store, Path::new("/source/original.epub"));
        let copy = Path::new("/other/copy.epub");

        let result = store
            .import_bytes(copy, "copy.epub".to_string(), b"version-one".to_vec())
            .expect("duplicate import");

        assert_eq!(result.status, ImportStatus::Duplicate);
        assert_eq!(result.book_id, existing);
        assert_eq!(result.title, "Version One");
        assert!(result.import_id.is_none());
        assert_eq!(store.list_books().expect("list").len(), 1);
        assert!(!directory
            .path()
            .join("books")
            .join(book_id_for_source(copy))
            .exists());
    }

    #[test]
    fn discard_overwrite_removes_pending_and_keeps_old_book() {
        let (directory, store) = test_store();
        let source = Path::new("/source/discard-overwrite.epub");
        let id = import_test_book(&store, source);
        store
            .update_reading_state(&id, Some(0.3), None, None, None, None)
            .expect("progress");

        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("stage overwrite");
        let import_id = staged_import_id(&result).to_string();
        assert!(store.read_import_bytes(&id, &import_id).is_ok());

        store.discard_import(&id, &import_id).expect("discard");

        let error = store
            .read_import_bytes(&id, &import_id)
            .expect_err("pending should be gone");
        assert!(error.code == AppErrorCode::InvalidInput || error.code == AppErrorCode::StorageIo);
        assert!(!directory
            .path()
            .join("books")
            .join(&id)
            .join(".imports")
            .join(format!("{import_id}.epub"))
            .exists());
        let book = store.list_books().expect("old book remains").remove(0);
        assert_eq!(book.title, "Version One");
        assert_eq!(book.last_fraction, Some(0.3));
        assert_eq!(
            fs::read(directory.path().join("books").join(&id).join("book.epub")).expect("old epub"),
            b"version-one"
        );
    }

    #[test]
    fn delete_book_removes_session_directory() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/delete-sessions.epub"));
        let session_dir = directory.path().join("sessions").join(&id);
        fs::create_dir(&session_dir).expect("session dir");
        fs::write(session_dir.join("chat.jsonl"), b"{}").expect("session file");

        store.delete_book(&id).expect("delete");

        assert!(!session_dir.exists());
        assert!(store.list_books().expect("list").is_empty());
    }

    #[test]
    fn delete_book_succeeds_when_session_directory_is_missing() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/delete-no-session.epub"));
        let session_dir = directory.path().join("sessions").join(&id);
        assert!(!session_dir.exists());

        store.delete_book(&id).expect("delete without sessions");
        assert!(store.list_books().expect("list").is_empty());
    }

    #[test]
    fn validation_rejects_invalid_last_opened_at_and_content_hash() {
        let (directory, store) = test_store();
        import_test_book(&store, Path::new("/source/field-validation.epub"));
        let library_path = directory.path().join("library.json");
        let original = fs::read(&library_path).expect("original library");
        let mut value: serde_json::Value = serde_json::from_slice(&original).expect("library json");
        value["books"][0]["lastOpenedAt"] = serde_json::Value::String("not-a-date".to_string());
        fs::write(
            &library_path,
            serde_json::to_vec_pretty(&value).expect("bad opened"),
        )
        .expect("write bad opened");
        let error = store.list_books().expect_err("bad lastOpenedAt");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);

        fs::write(&library_path, &original).expect("restore");
        let mut value: serde_json::Value = serde_json::from_slice(&original).expect("library json");
        value["books"][0]["contentHash"] = serde_json::Value::String("abc".to_string());
        fs::write(
            &library_path,
            serde_json::to_vec_pretty(&value).expect("bad hash"),
        )
        .expect("write bad hash");
        let error = store.list_books().expect_err("bad contentHash");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn last_reader_mode_missing_is_valid_and_round_trips() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/reader-mode.epub"));
        let book = store.list_books().expect("list").remove(0);
        assert!(book.last_reader_mode.is_none());
        let library_path = directory.path().join("library.json");
        let raw = fs::read_to_string(&library_path).expect("library text");
        assert!(!raw.contains("lastReaderMode"));

        store
            .update_reading_state(&id, None, None, Some("agent".to_string()), None, None)
            .expect("write mode");
        let stored = store.list_books().expect("after write").remove(0);
        assert_eq!(stored.last_reader_mode.as_deref(), Some("agent"));
        assert_eq!(stored.last_fraction, None);
        assert!(stored.settings.is_none());

        let context = store.get_book_open_context(&id).expect("open context");
        assert_eq!(context.last_reader_mode.as_deref(), Some("agent"));
    }

    #[test]
    fn last_reader_mode_does_not_clobber_fraction_or_settings() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/reader-mode-independent.epub"));
        store
            .update_reading_state(&id, Some(0.3), None, None, None, None)
            .expect("fraction");
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("settings");
        store
            .update_reading_state(&id, None, None, Some("reader".to_string()), None, None)
            .expect("mode");

        let book = store.list_books().expect("list").remove(0);
        assert_eq!(book.last_fraction, Some(0.3));
        assert_eq!(book.settings.expect("settings").font_size, Some(18.0));
        assert_eq!(book.last_reader_mode.as_deref(), Some("reader"));

        store
            .update_reading_state(&id, Some(0.8), None, None, None, None)
            .expect("fraction only");
        let book = store.list_books().expect("list").remove(0);
        assert_eq!(book.last_fraction, Some(0.8));
        assert_eq!(book.settings.expect("settings").font_size, Some(18.0));
        assert_eq!(book.last_reader_mode.as_deref(), Some("reader"));
    }

    #[test]
    fn last_reader_mode_rejects_invalid_update_and_stored_value() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/reader-mode-invalid.epub"));
        let error = store
            .update_reading_state(&id, None, None, Some("dark".to_string()), None, None)
            .expect_err("invalid update");
        assert_eq!(error.code, AppErrorCode::InvalidInput);

        let error = store
            .update_reading_state(&id, None, None, None, None, None)
            .expect_err("empty update");
        assert_eq!(error.code, AppErrorCode::InvalidInput);

        let library_path = directory.path().join("library.json");
        let original = fs::read(&library_path).expect("original library");
        let mut value: serde_json::Value = serde_json::from_slice(&original).expect("library json");
        value["books"][0]["lastReaderMode"] = serde_json::Value::String("dark".to_string());
        fs::write(
            &library_path,
            serde_json::to_vec_pretty(&value).expect("bad mode"),
        )
        .expect("write bad mode");
        let error = store.list_books().expect_err("bad lastReaderMode");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn last_layout_missing_is_valid_and_round_trips() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/reader-layout.epub"));
        let book = store.list_books().expect("list").remove(0);
        assert!(book.last_layout.is_none());
        let library_path = directory.path().join("library.json");
        let raw = fs::read_to_string(&library_path).expect("library text");
        assert!(!raw.contains("lastLayout"));

        let layout = ReaderLayout {
            chat_collapsed: false,
            book_collapsed: true,
            session_rail_open: false,
        };
        store
            .update_reading_state(&id, None, None, None, Some(layout.clone()), None)
            .expect("write layout");
        let stored = store.list_books().expect("after write").remove(0);
        assert_eq!(stored.last_layout, Some(layout.clone()));
        assert_eq!(stored.last_fraction, None);
        assert!(stored.settings.is_none());
        assert!(stored.last_reader_mode.is_none());

        let context = store.get_book_open_context(&id).expect("open context");
        assert_eq!(context.last_layout, Some(layout));
        let raw = fs::read_to_string(&library_path).expect("library text after");
        assert!(raw.contains("\"lastLayout\""));
        assert!(raw.contains("\"chatCollapsed\": false"));
        assert!(raw.contains("\"bookCollapsed\": true"));
        assert!(raw.contains("\"sessionRailOpen\": false"));
    }

    #[test]
    fn last_layout_does_not_clobber_fraction_settings_or_mode() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/reader-layout-independent.epub"));
        store
            .update_reading_state(&id, Some(0.3), None, None, None, None)
            .expect("fraction");
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("settings");
        store
            .update_reading_state(&id, None, None, Some("reader".to_string()), None, None)
            .expect("mode");
        store
            .update_reading_state(
                &id,
                None,
                None,
                None,
                Some(ReaderLayout {
                    chat_collapsed: false,
                    book_collapsed: true,
                    session_rail_open: false,
                }),
                None,
            )
            .expect("layout");

        let book = store.list_books().expect("list").remove(0);
        assert_eq!(book.last_fraction, Some(0.3));
        assert_eq!(book.settings.expect("settings").font_size, Some(18.0));
        assert_eq!(book.last_reader_mode.as_deref(), Some("reader"));
        assert_eq!(
            book.last_layout,
            Some(ReaderLayout {
                chat_collapsed: false,
                book_collapsed: true,
                session_rail_open: false,
            })
        );

        store
            .update_reading_state(&id, Some(0.8), None, None, None, None)
            .expect("fraction only");
        let book = store.list_books().expect("list").remove(0);
        assert_eq!(book.last_fraction, Some(0.8));
        assert_eq!(book.settings.expect("settings").font_size, Some(18.0));
        assert_eq!(book.last_reader_mode.as_deref(), Some("reader"));
        assert_eq!(
            book.last_layout
                .as_ref()
                .map(|layout| layout.book_collapsed),
            Some(true)
        );
    }

    #[test]
    fn last_layout_rejects_invalid_stored_value() {
        let (directory, store) = test_store();
        import_test_book(&store, Path::new("/source/reader-layout-invalid.epub"));
        let library_path = directory.path().join("library.json");
        let original = fs::read(&library_path).expect("original library");

        for bad in [
            serde_json::json!(true),
            serde_json::json!({"chatCollapsed": true, "bookCollapsed": false}),
            serde_json::json!({
                "chatCollapsed": true,
                "bookCollapsed": false,
                "sessionRailOpen": true,
                "extra": 1
            }),
            serde_json::json!({
                "chatCollapsed": "yes",
                "bookCollapsed": false,
                "sessionRailOpen": true
            }),
        ] {
            let mut value: serde_json::Value =
                serde_json::from_slice(&original).expect("library json");
            value["books"][0]["lastLayout"] = bad;
            fs::write(
                &library_path,
                serde_json::to_vec_pretty(&value).expect("bad layout"),
            )
            .expect("write bad layout");
            let error = store.list_books().expect_err("bad lastLayout");
            assert_eq!(error.code, AppErrorCode::StorageCorrupt);
            fs::write(&library_path, &original).expect("restore");
        }
    }

    #[test]
    fn last_cfi_missing_is_valid_and_round_trips() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/last-cfi.epub"));
        let book = store.list_books().expect("list").remove(0);
        assert!(book.last_cfi.is_none());
        let library_path = directory.path().join("library.json");
        let raw = fs::read_to_string(&library_path).expect("library text");
        assert!(!raw.contains("lastCfi"));

        store
            .update_reading_state(
                &id,
                None,
                None,
                None,
                None,
                Some("epubcfi(/6/8!/4/2/1:0)".to_string()),
            )
            .expect("write cfi");
        let stored = store.list_books().expect("after write").remove(0);
        assert_eq!(stored.last_cfi.as_deref(), Some("epubcfi(/6/8!/4/2/1:0)"));
        assert_eq!(stored.last_fraction, None);
        assert!(stored.settings.is_none());
        assert!(stored.last_reader_mode.is_none());
        assert!(stored.last_layout.is_none());

        let context = store.get_book_open_context(&id).expect("open context");
        assert_eq!(context.last_cfi.as_deref(), Some("epubcfi(/6/8!/4/2/1:0)"));
        let raw = fs::read_to_string(&library_path).expect("library text after");
        assert!(raw.contains("\"lastCfi\""));
    }

    #[test]
    fn last_cfi_does_not_clobber_fraction_settings_mode_or_layout() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/last-cfi-independent.epub"));
        store
            .update_reading_state(&id, Some(0.3), None, None, None, None)
            .expect("fraction");
        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(18.0),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("settings");
        store
            .update_reading_state(&id, None, None, Some("reader".to_string()), None, None)
            .expect("mode");
        store
            .update_reading_state(
                &id,
                None,
                None,
                None,
                Some(ReaderLayout {
                    chat_collapsed: false,
                    book_collapsed: true,
                    session_rail_open: false,
                }),
                None,
            )
            .expect("layout");
        store
            .update_reading_state(
                &id,
                None,
                None,
                None,
                None,
                Some("epubcfi(/6/8!/4/2/1:0)".to_string()),
            )
            .expect("cfi");

        let book = store.list_books().expect("list").remove(0);
        assert_eq!(book.last_fraction, Some(0.3));
        assert_eq!(book.settings.expect("settings").font_size, Some(18.0));
        assert_eq!(book.last_reader_mode.as_deref(), Some("reader"));
        assert_eq!(
            book.last_layout
                .as_ref()
                .map(|layout| layout.book_collapsed),
            Some(true)
        );
        assert_eq!(book.last_cfi.as_deref(), Some("epubcfi(/6/8!/4/2/1:0)"));

        store
            .update_reading_state(
                &id,
                None,
                Some(ReadingSettings {
                    font_size: Some(20.0),
                    ..ReadingSettings::default()
                }),
                None,
                None,
                None,
            )
            .expect("settings only");
        let book = store.list_books().expect("list").remove(0);
        assert_eq!(book.settings.expect("settings").font_size, Some(20.0));
        assert_eq!(book.last_cfi.as_deref(), Some("epubcfi(/6/8!/4/2/1:0)"));
        assert_eq!(book.last_fraction, Some(0.3));
        assert_eq!(book.last_reader_mode.as_deref(), Some("reader"));
    }

    #[test]
    fn last_cfi_rejects_invalid_update_and_stored_value() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/last-cfi-invalid.epub"));
        for bad in [
            String::new(),
            "not-a-cfi".to_string(),
            "foliate-search:epubcfi(/6/8)".to_string(),
            format!("epubcfi({})", "a".repeat(MAX_CFI_BYTES)),
        ] {
            let error = store
                .update_reading_state(&id, None, None, None, None, Some(bad))
                .expect_err("invalid cfi update");
            assert_eq!(error.code, AppErrorCode::InvalidInput);
        }

        let library_path = directory.path().join("library.json");
        let original = fs::read(&library_path).expect("original library");
        for bad in ["", "href", "foliate-search:epubcfi(/6/8)"] {
            let mut value: serde_json::Value =
                serde_json::from_slice(&original).expect("library json");
            value["books"][0]["lastCfi"] = serde_json::Value::String(bad.to_string());
            fs::write(
                &library_path,
                serde_json::to_vec_pretty(&value).expect("bad cfi"),
            )
            .expect("write bad cfi");
            let error = store.list_books().expect_err("bad lastCfi");
            assert_eq!(error.code, AppErrorCode::StorageCorrupt);
            fs::write(&library_path, &original).expect("restore");
        }
    }

    #[test]
    fn import_paths_reject_non_epub_and_symlinks() {
        let (directory, store) = test_store();
        let txt = directory.path().join("notes.txt");
        fs::write(&txt, b"not an epub").expect("txt");
        let error = validate_import_source(&txt).expect_err("txt is not epub");
        assert_eq!(error.code, AppErrorCode::InvalidInput);

        let missing = directory.path().join("ghost.epub");
        let error = validate_import_source(&missing).expect_err("missing epub");
        assert_eq!(error.code, AppErrorCode::StorageIo);

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = directory.path().join("real.epub");
            fs::write(&target, b"version-one").expect("real epub");
            let link = directory.path().join("alias.epub");
            symlink(&target, &link).expect("symlink");
            let error = validate_import_source(&link).expect_err("symlink epub");
            assert_eq!(error.code, AppErrorCode::InvalidInput);
            assert!(store.list_books().expect("list").is_empty());
        }
    }

    fn sample_annotations() -> AnnotationsFile {
        AnnotationsFile {
            schema_version: ANNOTATIONS_SCHEMA_VERSION,
            bookmarks: vec![BookmarkRecord {
                id: "b_01hxyz".into(),
                cfi: "epubcfi(/6/8!/4/2,/1:0,/1:80)".into(),
                fraction: 0.42,
                created_at: "2026-08-14T12:00:00+00:00".into(),
                label: Some("Chapter 3".into()),
            }],
            highlights: vec![HighlightRecord {
                id: "h_01hxyz".into(),
                cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)".into(),
                excerpt: "selected sentence".into(),
                created_at: "2026-08-14T12:01:00+00:00".into(),
                color: None,
                note: None,
            }],
        }
    }

    #[test]
    fn missing_annotations_file_returns_empty_lists() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-missing.epub"));
        let data = store.get_annotations(&id).expect("missing is empty");
        assert_eq!(data.schema_version, ANNOTATIONS_SCHEMA_VERSION);
        assert!(data.bookmarks.is_empty());
        assert!(data.highlights.is_empty());
    }

    #[test]
    fn annotations_round_trip() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-roundtrip.epub"));
        let data = sample_annotations();
        store.save_annotations(&id, data.clone()).expect("save");
        let loaded = store.get_annotations(&id).expect("load");
        assert_eq!(loaded, data);
        assert!(directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json")
            .is_file());
        let books = store.list_books().expect("list");
        let record = serde_json::to_value(&books[0]).expect("book json");
        assert!(record.get("bookmarks").is_none());
        assert!(record.get("highlights").is_none());
        assert!(record.get("annotations").is_none());
    }

    #[test]
    fn corrupt_annotations_file_is_storage_corrupt() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-corrupt.epub"));
        let path = directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json");
        fs::write(&path, br#"{"schemaVersion":1,"bookmarks":["#).expect("corrupt");
        let error = store.get_annotations(&id).expect_err("corrupt");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
        assert_eq!(
            fs::read(&path).expect("file kept"),
            br#"{"schemaVersion":1,"bookmarks":["#
        );
    }

    #[test]
    fn unknown_annotations_field_is_storage_corrupt() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-unknown.epub"));
        let path = directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json");
        fs::write(
            &path,
            br#"{"schemaVersion":1,"bookmarks":[],"highlights":[],"notes":[]}"#,
        )
        .expect("unknown field");
        let error = store.get_annotations(&id).expect_err("unknown field");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn unsupported_annotations_schema_is_storage_corrupt() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-schema.epub"));
        let path = directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json");
        fs::write(
            &path,
            br#"{"schemaVersion":2,"bookmarks":[],"highlights":[]}"#,
        )
        .expect("v2");
        let error = store.get_annotations(&id).expect_err("unsupported schema");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn save_annotations_rejects_fraction_out_of_bounds() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-fraction.epub"));
        let mut data = sample_annotations();
        data.bookmarks[0].fraction = 1.5;
        let error = store.save_annotations(&id, data).expect_err("fraction");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
        let loaded = store.get_annotations(&id).expect("still empty");
        assert!(loaded.bookmarks.is_empty());
    }

    #[test]
    fn overwrite_keeps_annotations_file() {
        let (directory, store) = test_store();
        let source = Path::new("/source/annotations-overwrite.epub");
        let id = import_test_book(&store, source);
        store
            .save_annotations(&id, sample_annotations())
            .expect("save");

        let result = store
            .import_bytes(source, "book.epub".to_string(), b"version-two".to_vec())
            .expect("reimport");
        store
            .save_book_metadata(
                &id,
                "Version Two".to_string(),
                "Author Two".to_string(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                Some(vec![9, 9, 9]),
                staged_import_id(&result),
            )
            .expect("commit overwrite");

        let loaded = store.get_annotations(&id).expect("kept");
        assert_eq!(loaded, sample_annotations());
        assert!(directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json")
            .is_file());
    }

    #[test]
    fn delete_book_removes_annotations_directory() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-delete.epub"));
        store
            .save_annotations(&id, sample_annotations())
            .expect("save");
        let annotations_path = directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json");
        assert!(annotations_path.is_file());

        store.delete_book(&id).expect("delete");

        assert!(!annotations_path.exists());
        assert!(store.list_books().expect("list").is_empty());
        let error = store.get_annotations(&id).expect_err("book gone");
        assert_eq!(error.code, AppErrorCode::BookNotFound);
    }

    #[test]
    fn old_highlights_without_color_or_note_still_load() {
        let (directory, store) = test_store();
        let id = import_test_book(
            &store,
            Path::new("/source/annotations-legacy-highlight.epub"),
        );
        let path = directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json");
        fs::write(
            &path,
            br#"{"schemaVersion":1,"bookmarks":[],"highlights":[{"id":"h_01hxyz","cfi":"epubcfi(/6/8!/4/2,/1:12,/1:48)","excerpt":"selected sentence","createdAt":"2026-08-14T12:01:00+00:00"}]}"#,
        )
        .expect("legacy highlight");
        let loaded = store.get_annotations(&id).expect("legacy loads");
        assert_eq!(loaded.highlights[0].color, None);
        assert_eq!(loaded.highlights[0].note, None);
        assert_eq!(loaded.highlights[0].excerpt, "selected sentence");
    }

    #[test]
    fn annotations_round_trip_with_color_and_note() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-color-note.epub"));
        let mut data = sample_annotations();
        data.highlights[0].color = Some("green".into());
        data.highlights[0].note = Some("why I marked this".into());
        store.save_annotations(&id, data.clone()).expect("save");
        let loaded = store.get_annotations(&id).expect("load");
        assert_eq!(loaded, data);
        let bytes = fs::read(
            directory
                .path()
                .join("books")
                .join(&id)
                .join("annotations.json"),
        )
        .expect("read file");
        let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["highlights"][0]["color"], "green");
        assert_eq!(value["highlights"][0]["note"], "why I marked this");
    }

    #[test]
    fn save_annotations_rejects_unknown_highlight_color() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-bad-color.epub"));
        let mut data = sample_annotations();
        data.highlights[0].color = Some("#ff00ff".into());
        let error = store
            .save_annotations(&id, data)
            .expect_err("unknown color");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
        let loaded = store.get_annotations(&id).expect("still empty");
        assert!(loaded.highlights.is_empty());
    }

    #[test]
    fn unknown_stored_highlight_color_is_storage_corrupt() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-corrupt-color.epub"));
        let path = directory
            .path()
            .join("books")
            .join(&id)
            .join("annotations.json");
        fs::write(
            &path,
            br#"{"schemaVersion":1,"bookmarks":[],"highlights":[{"id":"h_01hxyz","cfi":"epubcfi(/6/8!/4/2,/1:12,/1:48)","excerpt":"selected sentence","createdAt":"2026-08-14T12:01:00+00:00","color":"purple"}]}"#,
        )
        .expect("unknown color");
        let error = store.get_annotations(&id).expect_err("corrupt color");
        assert_eq!(error.code, AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn save_annotations_rejects_oversized_note() {
        let (_directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-note-cap.epub"));
        let mut data = sample_annotations();
        data.highlights[0].note = Some("x".repeat(MAX_LABEL_BYTES + 1));
        let error = store.save_annotations(&id, data).expect_err("note cap");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
    }

    #[test]
    fn empty_highlight_note_is_omitted_from_disk() {
        let (directory, store) = test_store();
        let id = import_test_book(&store, Path::new("/source/annotations-empty-note.epub"));
        let mut data = sample_annotations();
        data.highlights[0].color = Some("yellow".into());
        data.highlights[0].note = Some(String::new());
        store.save_annotations(&id, data).expect("save");
        let bytes = fs::read(
            directory
                .path()
                .join("books")
                .join(&id)
                .join("annotations.json"),
        )
        .expect("read file");
        let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
        assert!(value["highlights"][0].get("note").is_none());
        assert_eq!(value["highlights"][0]["color"], "yellow");
        let loaded = store.get_annotations(&id).expect("load");
        assert_eq!(loaded.highlights[0].note, None);
    }

    fn make_png_bytes(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(width, height, image::Rgba(rgba));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .expect("encode test png");
        buf
    }

    #[test]
    fn compress_cover_does_not_upscale_small_images() {
        let raw = make_png_bytes(100, 80, [255, 0, 0, 255]);
        let compressed = compress_cover(&raw);
        let decoded = image::load_from_memory(&compressed).expect("decode compressed");
        assert!(decoded.width() <= 100);
        assert!(decoded.height() <= 80);
    }

    #[test]
    fn compress_cover_scales_down_large_images() {
        let raw = make_png_bytes(2000, 3000, [0, 0, 255, 255]);
        let compressed = compress_cover(&raw);
        let decoded = image::load_from_memory(&compressed).expect("decode compressed");
        assert!(decoded.width() <= COVER_MAX_EDGE);
        assert!(decoded.height() <= COVER_MAX_EDGE);
        assert_eq!(decoded.color().has_alpha(), false);
    }

    #[test]
    fn compress_cover_returns_original_on_invalid_bytes() {
        let raw = vec![0u8; 64];
        let compressed = compress_cover(&raw);
        assert_eq!(compressed, raw);
    }
}
