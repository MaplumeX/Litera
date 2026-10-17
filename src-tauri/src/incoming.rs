//! Path-less import: books the Android platform bridge copied out of a
//! content URI (the document picker, "Open with", a share) into the app's
//! cache. The copy is a readable handle, not a source: the Book gets no
//! `source_key`, and the copy is deleted once read.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::library::{ImportBookResult, LibraryStore};

/// Must match `INCOMING_DIR` in the Kotlin `PlatformPlugin`.
const INCOMING_DIR: &str = "incoming-books";
const ZIP_MAGIC: &[u8] = b"PK\x03\x04";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingBookFile {
    pub path: String,
    pub name: String,
}

/// The handle as a real file inside `<cache>/incoming-books/`. Anything else
/// (another directory, `..`, a symlink out) is refused, so the WebView can't
/// use this command to read arbitrary files.
fn resolve_incoming_path(cache_dir: &Path, path: &str) -> AppResult<PathBuf> {
    let refused = || AppError::invalid_input("Not an incoming book handle");
    let root = cache_dir.join(INCOMING_DIR).canonicalize().map_err(|_| refused())?;
    let candidate = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&candidate).map_err(|_| refused())?;
    if !metadata.file_type().is_file() {
        return Err(refused());
    }
    let resolved = candidate.canonicalize().map_err(|_| refused())?;
    if resolved.parent() != Some(root.as_path()) {
        return Err(refused());
    }
    Ok(resolved)
}

/// Read and delete one handle, then import its bytes without a source.
fn import_incoming_file(
    store: &LibraryStore,
    cache_dir: &Path,
    file: IncomingBookFile,
) -> AppResult<ImportBookResult> {
    let path = resolve_incoming_path(cache_dir, &file.path)?;
    let bytes = fs::read(&path);
    let _ = fs::remove_file(&path);
    let bytes =
        bytes.map_err(|error| AppError::storage_io(format!("Failed to read EPUB: {error}")))?;
    // Catch a picked PDF or image before it becomes a Book; a damaged EPUB
    // still fails later, when its metadata is read.
    if !bytes.starts_with(ZIP_MAGIC) {
        return Err(AppError::invalid_input("Only EPUB files can be imported"));
    }
    store.import_bytes_without_source(file.name, bytes)
}

#[tauri::command]
pub async fn import_incoming_books(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    files: Vec<IncomingBookFile>,
) -> AppResult<Vec<ImportBookResult>> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::storage_io(format!("Failed to resolve cache dir: {error}")))?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::with_capacity(files.len());
        for file in files {
            results.push(import_incoming_file(&store, &cache_dir, file)?);
        }
        Ok(results)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Import worker failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppErrorCode;
    use crate::library::ImportStatus;

    struct Fixture {
        _data: tempfile::TempDir,
        cache: tempfile::TempDir,
        store: LibraryStore,
    }

    fn fixture() -> Fixture {
        let data = tempfile::tempdir().expect("data dir");
        let cache = tempfile::tempdir().expect("cache dir");
        fs::create_dir(cache.path().join(INCOMING_DIR)).expect("incoming dir");
        let store = LibraryStore::initialize(data.path().to_path_buf()).expect("store");
        Fixture {
            _data: data,
            cache,
            store,
        }
    }

    fn stage(fixture: &Fixture, file: &str, bytes: &[u8]) -> IncomingBookFile {
        let path = fixture.cache.path().join(INCOMING_DIR).join(file);
        fs::write(&path, bytes).expect("stage");
        IncomingBookFile {
            path: path.to_string_lossy().into_owned(),
            name: "Shared Book.epub".to_string(),
        }
    }

    #[test]
    fn an_incoming_book_imports_under_its_display_name_and_its_copy_is_removed() {
        let fixture = fixture();
        let file = stage(&fixture, "a.epub", b"PK\x03\x04book");
        let path = PathBuf::from(&file.path);

        let result =
            import_incoming_file(&fixture.store, fixture.cache.path(), file).expect("import");

        assert_eq!(result.status, ImportStatus::New);
        assert_eq!(result.name, "Shared Book.epub");
        assert!(!path.exists());
    }

    #[test]
    fn the_same_incoming_bytes_twice_resolve_to_the_same_book() {
        let fixture = fixture();
        let first = import_incoming_file(
            &fixture.store,
            fixture.cache.path(),
            stage(&fixture, "a.epub", b"PK\x03\x04book"),
        )
        .expect("first");

        let second = import_incoming_file(
            &fixture.store,
            fixture.cache.path(),
            stage(&fixture, "b.epub", b"PK\x03\x04book"),
        )
        .expect("second");

        assert_eq!(second.status, ImportStatus::Duplicate);
        assert_eq!(second.book_id, first.book_id);
    }

    #[test]
    fn a_file_that_is_not_a_zip_is_refused_and_still_removed() {
        let fixture = fixture();
        let file = stage(&fixture, "a.epub", b"%PDF-1.7");
        let path = PathBuf::from(&file.path);

        let error = import_incoming_file(&fixture.store, fixture.cache.path(), file)
            .expect_err("not an epub");

        assert_eq!(error.code, AppErrorCode::InvalidInput);
        assert!(!path.exists());
        assert!(fixture.store.list_books().expect("list").is_empty());
    }

    #[test]
    fn paths_outside_the_incoming_directory_are_refused() {
        let fixture = fixture();
        let outside = fixture.cache.path().join("secret.epub");
        fs::write(&outside, b"PK\x03\x04book").expect("outside");
        let sneaky = fixture
            .cache
            .path()
            .join(INCOMING_DIR)
            .join("..")
            .join("secret.epub");

        for path in [outside.clone(), sneaky] {
            let error = import_incoming_file(
                &fixture.store,
                fixture.cache.path(),
                IncomingBookFile {
                    path: path.to_string_lossy().into_owned(),
                    name: "secret.epub".to_string(),
                },
            )
            .expect_err("refused");
            assert_eq!(error.code, AppErrorCode::InvalidInput);
        }
        assert!(outside.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_in_the_incoming_directory_is_refused() {
        let fixture = fixture();
        let outside = fixture.cache.path().join("secret.epub");
        fs::write(&outside, b"PK\x03\x04book").expect("outside");
        let link = fixture.cache.path().join(INCOMING_DIR).join("link.epub");
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");

        let error = import_incoming_file(
            &fixture.store,
            fixture.cache.path(),
            IncomingBookFile {
                path: link.to_string_lossy().into_owned(),
                name: "link.epub".to_string(),
            },
        )
        .expect_err("refused");

        assert_eq!(error.code, AppErrorCode::InvalidInput);
        assert!(outside.exists());
    }
}
