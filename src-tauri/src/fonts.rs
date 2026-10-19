//! Imported fonts: TrueType / OpenType files the reader added from the
//! Android document picker, kept per device under `<app data>/fonts/`. The
//! WebView loads them through the asset protocol as `@font-face` sources, so
//! font bytes never cross IPC. Never synced.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::incoming::resolve_incoming_path;
use crate::library::{atomic_write, is_valid_font_family, GENERIC_FONT_FAMILIES};

/// Must match `INCOMING_FONTS_DIR` in the Kotlin `PlatformPlugin`.
const INCOMING_DIR: &str = "incoming-fonts";
const FONTS_DIR: &str = "fonts";
const INDEX_FILE: &str = "fonts.json";
const INDEX_SCHEMA_VERSION: u32 = 1;
/// Full CJK faces run to ~20 MB; anything far past that is not a font.
const MAX_FONT_BYTES: usize = 64 * 1024 * 1024;
const TRUETYPE_MAGIC: [&[u8]; 2] = [b"\x00\x01\x00\x00", b"true"];
const OPENTYPE_MAGIC: &[u8] = b"OTTO";

/// One imported face. Several faces (regular, bold, italic) can share a
/// `family`; the picker lists the family once.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFont {
    pub id: String,
    pub family: String,
    pub weight: u16,
    pub italic: bool,
    /// The picked file's display name, for the management list.
    pub file_name: String,
    /// Absolute path of the stored file, for `convertFileSrc`.
    pub path: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontIndex {
    schema_version: u32,
    fonts: Vec<StoredFont>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFont {
    id: String,
    family: String,
    weight: u16,
    italic: bool,
    file_name: String,
    extension: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFontFile {
    pub path: String,
    pub name: String,
}

#[derive(Clone)]
pub struct FontStore {
    dir: PathBuf,
    lock: Arc<Mutex<()>>,
}

struct ParsedFace {
    family: String,
    weight: u16,
    italic: bool,
    extension: &'static str,
}

impl FontStore {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            dir: app_data_dir.join(FONTS_DIR),
            lock: Arc::new(Mutex::new(())),
        }
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join(INDEX_FILE)
    }

    fn font_path(&self, font: &StoredFont) -> PathBuf {
        self.dir.join(format!("{}.{}", font.id, font.extension))
    }

    fn read_index(&self) -> AppResult<FontIndex> {
        match fs::read(self.index_path()) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
                AppError::storage_corrupt(format!("Failed to parse font index: {error}"))
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FontIndex {
                schema_version: INDEX_SCHEMA_VERSION,
                fonts: Vec::new(),
            }),
            Err(error) => Err(AppError::storage_io(format!(
                "Failed to read font index: {error}"
            ))),
        }
    }

    fn write_index(&self, index: &FontIndex) -> AppResult<()> {
        let bytes = serde_json::to_vec_pretty(index).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize font index: {error}"))
        })?;
        atomic_write(&self.index_path(), &bytes, "font index")
    }

    fn to_public(&self, font: &StoredFont) -> ImportedFont {
        ImportedFont {
            id: font.id.clone(),
            family: font.family.clone(),
            weight: font.weight,
            italic: font.italic,
            file_name: font.file_name.clone(),
            path: self.font_path(font).to_string_lossy().into_owned(),
        }
    }

    pub fn list(&self) -> AppResult<Vec<ImportedFont>> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let index = self.read_index()?;
        let mut fonts: Vec<ImportedFont> = index
            .fonts
            .iter()
            // A file deleted behind our back would only produce a broken face.
            .filter(|font| self.font_path(font).is_file())
            .map(|font| self.to_public(font))
            .collect();
        fonts.sort_by(|a, b| {
            a.family
                .to_lowercase()
                .cmp(&b.family.to_lowercase())
                .then(a.italic.cmp(&b.italic))
                .then(a.weight.cmp(&b.weight))
        });
        Ok(fonts)
    }

    /// Store one font file. Importing the same bytes again returns the
    /// existing entry.
    pub fn import_bytes(&self, file_name: String, bytes: &[u8]) -> AppResult<ImportedFont> {
        if bytes.len() > MAX_FONT_BYTES {
            return Err(AppError::invalid_input("Font file is too large"));
        }
        let face = parse_face(bytes)?;
        let id = font_id(bytes);
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut index = self.read_index()?;
        if let Some(existing) = index.fonts.iter().find(|font| font.id == id) {
            if self.font_path(existing).is_file() {
                return Ok(self.to_public(existing));
            }
        }
        index.fonts.retain(|font| font.id != id);
        let stored = StoredFont {
            id,
            family: face.family,
            weight: face.weight,
            italic: face.italic,
            file_name,
            extension: face.extension.to_string(),
        };
        atomic_write(&self.font_path(&stored), bytes, "font file")?;
        index.schema_version = INDEX_SCHEMA_VERSION;
        index.fonts.push(stored.clone());
        self.write_index(&index)?;
        Ok(self.to_public(&stored))
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut index = self.read_index()?;
        let Some(position) = index.fonts.iter().position(|font| font.id == id) else {
            return Ok(());
        };
        let removed = index.fonts.remove(position);
        self.write_index(&index)?;
        match fs::remove_file(self.font_path(&removed)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::storage_io(format!(
                "Failed to delete font file: {error}"
            ))),
        }
    }
}

fn font_id(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// TrueType or OpenType (CFF) only: collections (`.ttc`) and WOFF can't be
/// named by one `@font-face` source the way the reader uses them.
fn parse_face(bytes: &[u8]) -> AppResult<ParsedFace> {
    let extension = if bytes.starts_with(OPENTYPE_MAGIC) {
        "otf"
    } else if TRUETYPE_MAGIC.iter().any(|magic| bytes.starts_with(magic)) {
        "ttf"
    } else {
        return Err(AppError::invalid_input(
            "Only TrueType (.ttf) and OpenType (.otf) fonts can be imported",
        ));
    };
    let face = ttf_parser::Face::parse(bytes, 0)
        .map_err(|_| AppError::invalid_input("The font file is damaged"))?;
    let family = family_name(&face)
        .ok_or_else(|| AppError::invalid_input("The font has no usable family name"))?;
    Ok(ParsedFace {
        family,
        weight: face.weight().to_number().clamp(1, 1000),
        italic: face.is_italic() || face.is_oblique(),
        extension,
    })
}

/// The typographic family (name ID 16) when present, so a family's weights
/// group together; otherwise the legacy family (ID 1). English names are
/// preferred because the name becomes a CSS family stored with settings.
fn family_name(face: &ttf_parser::Face) -> Option<String> {
    const ENGLISH_US: u16 = 0x0409;
    let names = face.names();
    let candidates = move |name_id: u16| {
        names
            .into_iter()
            .filter(move |name| name.name_id == name_id && name.is_unicode())
            .filter_map(|name| {
                let text = name.to_string()?;
                let text = text.trim().to_string();
                let usable = is_valid_font_family(&text)
                    && !GENERIC_FONT_FAMILIES.contains(&text.to_lowercase().as_str());
                usable.then_some((name.language_id == ENGLISH_US, text))
            })
    };
    for name_id in [
        ttf_parser::name_id::TYPOGRAPHIC_FAMILY,
        ttf_parser::name_id::FAMILY,
    ] {
        let mut found: Vec<(bool, String)> = candidates(name_id).collect();
        // English first, then the table's own order.
        found.sort_by_key(|(english, _)| !english);
        if let Some((_, text)) = found.into_iter().next() {
            return Some(text);
        }
    }
    None
}

fn import_incoming_font_file(
    store: &FontStore,
    cache_dir: &Path,
    file: IncomingFontFile,
) -> AppResult<ImportedFont> {
    let path = resolve_incoming_path(cache_dir, INCOMING_DIR, &file.path)?;
    let bytes = fs::read(&path);
    let _ = fs::remove_file(&path);
    let bytes =
        bytes.map_err(|error| AppError::storage_io(format!("Failed to read font: {error}")))?;
    store.import_bytes(file.name, &bytes)
}

/// One file per call, so a bad file fails alone and every handle is still
/// read (and deleted) by its own call.
#[tauri::command]
pub async fn import_incoming_font(
    app: tauri::AppHandle,
    store: tauri::State<'_, FontStore>,
    file: IncomingFontFile,
) -> AppResult<ImportedFont> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::storage_io(format!("Failed to resolve cache dir: {error}")))?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_incoming_font_file(&store, &cache_dir, file)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Font import worker failed: {error}")))?
}

#[tauri::command]
pub async fn list_imported_fonts(
    store: tauri::State<'_, FontStore>,
) -> AppResult<Vec<ImportedFont>> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.list())
        .await
        .map_err(|error| AppError::storage_io(format!("Font listing worker failed: {error}")))?
}

#[tauri::command]
pub async fn delete_imported_font(store: tauri::State<'_, FontStore>, id: String) -> AppResult<()> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.delete(&id))
        .await
        .map_err(|error| AppError::storage_io(format!("Font delete worker failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppErrorCode;

    /// The smallest face `ttf-parser` accepts: `head`, `hhea`, `maxp`, `OS/2`
    /// and a `name` table with the given (name ID, language, family) records.
    fn build_font(names: &[(u16, u16, &str)], weight: u16, italic: bool) -> Vec<u8> {
        let mut head = vec![0u8; 54];
        head[0..4].copy_from_slice(&[0, 1, 0, 0]);
        head[12..16].copy_from_slice(&0x5F0F3CF5u32.to_be_bytes());
        head[18..20].copy_from_slice(&1000u16.to_be_bytes());
        let mut hhea = vec![0u8; 36];
        hhea[0..4].copy_from_slice(&[0, 1, 0, 0]);
        hhea[34..36].copy_from_slice(&1u16.to_be_bytes());
        let mut maxp = vec![0u8; 6];
        maxp[0..4].copy_from_slice(&0x00005000u32.to_be_bytes());
        maxp[4..6].copy_from_slice(&1u16.to_be_bytes());
        let mut os2 = vec![0u8; 78];
        os2[4..6].copy_from_slice(&weight.to_be_bytes());
        os2[6..8].copy_from_slice(&5u16.to_be_bytes());
        let selection: u16 = if italic { 0x0001 } else { 0x0040 };
        os2[62..64].copy_from_slice(&selection.to_be_bytes());

        let mut strings = Vec::new();
        let mut records = Vec::new();
        for (name_id, language, text) in names {
            let encoded: Vec<u8> = text.encode_utf16().flat_map(u16::to_be_bytes).collect();
            for value in [
                3u16,
                1,
                *language,
                *name_id,
                encoded.len() as u16,
                strings.len() as u16,
            ] {
                records.extend_from_slice(&value.to_be_bytes());
            }
            strings.extend_from_slice(&encoded);
        }
        let mut name = Vec::new();
        name.extend_from_slice(&0u16.to_be_bytes());
        name.extend_from_slice(&(names.len() as u16).to_be_bytes());
        name.extend_from_slice(&(6 + records.len() as u16).to_be_bytes());
        name.extend_from_slice(&records);
        name.extend_from_slice(&strings);

        let tables: [(&[u8; 4], Vec<u8>); 5] = [
            (b"OS/2", os2),
            (b"head", head),
            (b"hhea", hhea),
            (b"maxp", maxp),
            (b"name", name),
        ];
        let mut font = Vec::new();
        font.extend_from_slice(&[0, 1, 0, 0]);
        font.extend_from_slice(&(tables.len() as u16).to_be_bytes());
        font.extend_from_slice(&[0; 6]);
        let mut offset = 12 + 16 * tables.len();
        let mut body = Vec::new();
        for (tag, data) in &tables {
            font.extend_from_slice(*tag);
            font.extend_from_slice(&[0; 4]);
            font.extend_from_slice(&(offset as u32).to_be_bytes());
            font.extend_from_slice(&(data.len() as u32).to_be_bytes());
            let mut padded = data.clone();
            padded.resize(data.len().div_ceil(4) * 4, 0);
            offset += padded.len();
            body.extend_from_slice(&padded);
        }
        font.extend_from_slice(&body);
        font
    }

    fn store() -> (tempfile::TempDir, FontStore) {
        let dir = tempfile::tempdir().expect("data dir");
        let store = FontStore::new(dir.path());
        (dir, store)
    }

    #[test]
    fn an_imported_font_is_listed_under_its_family_with_its_style() {
        let (_dir, store) = store();
        let bytes = build_font(&[(1, 0x0409, "Literata")], 700, true);

        let font = store
            .import_bytes("Literata-BoldItalic.ttf".into(), &bytes)
            .expect("import");

        assert_eq!(font.family, "Literata");
        assert_eq!(font.weight, 700);
        assert!(font.italic);
        assert!(font.path.ends_with(".ttf"));
        assert!(Path::new(&font.path).is_file());
        assert_eq!(store.list().expect("list"), vec![font]);
    }

    #[test]
    fn the_typographic_family_and_the_english_name_win() {
        let (_dir, store) = store();
        let bytes = build_font(
            &[
                (1, 0x0409, "Source Han Serif SC Bold"),
                (16, 0x0804, "思源宋体"),
                (16, 0x0409, "Source Han Serif SC"),
            ],
            700,
            false,
        );

        let font = store.import_bytes("a.otf".into(), &bytes).expect("import");

        assert_eq!(font.family, "Source Han Serif SC");
    }

    #[test]
    fn a_family_with_only_a_localized_name_keeps_it() {
        let (_dir, store) = store();
        let bytes = build_font(&[(1, 0x0804, "霞鹜文楷")], 400, false);

        let font = store.import_bytes("a.ttf".into(), &bytes).expect("import");

        assert_eq!(font.family, "霞鹜文楷");
    }

    #[test]
    fn importing_the_same_bytes_twice_keeps_one_entry() {
        let (_dir, store) = store();
        let bytes = build_font(&[(1, 0x0409, "Literata")], 400, false);

        let first = store.import_bytes("a.ttf".into(), &bytes).expect("first");
        let second = store
            .import_bytes("copy.ttf".into(), &bytes)
            .expect("second");

        assert_eq!(first, second);
        assert_eq!(store.list().expect("list").len(), 1);
    }

    #[test]
    fn non_fonts_and_collections_are_refused() {
        let (_dir, store) = store();
        for bytes in [b"PK\x03\x04epub".to_vec(), b"ttcf\x00\x01\x00\x00".to_vec()] {
            let error = store.import_bytes("x".into(), &bytes).expect_err("refused");
            assert_eq!(error.code, AppErrorCode::InvalidInput);
        }
        assert!(store.list().expect("list").is_empty());
    }

    #[test]
    fn a_generic_family_name_is_refused() {
        let (_dir, store) = store();
        let bytes = build_font(&[(1, 0x0409, "Serif")], 400, false);

        let error = store
            .import_bytes("a.ttf".into(), &bytes)
            .expect_err("refused");

        assert_eq!(error.code, AppErrorCode::InvalidInput);
    }

    #[test]
    fn a_deleted_font_leaves_the_list_and_the_disk() {
        let (_dir, store) = store();
        let bytes = build_font(&[(1, 0x0409, "Literata")], 400, false);
        let font = store.import_bytes("a.ttf".into(), &bytes).expect("import");

        store.delete(&font.id).expect("delete");

        assert!(store.list().expect("list").is_empty());
        assert!(!Path::new(&font.path).exists());
        store.delete(&font.id).expect("deleting again is a no-op");
    }

    #[test]
    fn an_incoming_font_handle_is_read_and_removed() {
        let (_data, store) = store();
        let cache = tempfile::tempdir().expect("cache dir");
        fs::create_dir(cache.path().join(INCOMING_DIR)).expect("incoming dir");
        let path = cache.path().join(INCOMING_DIR).join("a.font");
        fs::write(&path, build_font(&[(1, 0x0409, "Literata")], 400, false)).expect("stage");

        let font = import_incoming_font_file(
            &store,
            cache.path(),
            IncomingFontFile {
                path: path.to_string_lossy().into_owned(),
                name: "Literata.ttf".into(),
            },
        )
        .expect("import");

        assert_eq!(font.file_name, "Literata.ttf");
        assert!(!path.exists());
    }

    #[test]
    fn a_path_outside_the_incoming_fonts_directory_is_refused() {
        let (_data, store) = store();
        let cache = tempfile::tempdir().expect("cache dir");
        fs::create_dir(cache.path().join(INCOMING_DIR)).expect("incoming dir");
        let outside = cache.path().join("outside.ttf");
        fs::write(&outside, build_font(&[(1, 0x0409, "Literata")], 400, false)).expect("stage");

        let error = import_incoming_font_file(
            &store,
            cache.path(),
            IncomingFontFile {
                path: outside.to_string_lossy().into_owned(),
                name: "x.ttf".into(),
            },
        )
        .expect_err("refused");

        assert_eq!(error.code, AppErrorCode::InvalidInput);
        assert!(outside.exists());
    }
}
