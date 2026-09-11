use std::fs;
use std::path::PathBuf;

use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};

/// Maximum accepted export payload (16 MiB) to keep a runaway render from
/// ballooning memory before the save dialog opens.
const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;

/// A default file name must stay a single path component.
fn sanitize_default_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("Export file name must not be empty"));
    }
    if trimmed
        .chars()
        .any(|character| character == '/' || character == '\\' || character == '\0')
    {
        return Err(AppError::invalid_input(
            "Export file name must not contain path separators",
        ));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::invalid_input("Export file name is not a valid file name"));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn save_text_file(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> AppResult<String> {
    let name = sanitize_default_name(&default_name)?;
    if contents.len() > MAX_EXPORT_BYTES {
        return Err(AppError::invalid_input(
            "Export contents exceed the 16 MiB limit",
        ));
    }
    let extension = PathBuf::from(&name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_string())
        .unwrap_or_else(|| "txt".to_string());
    let filter_name = extension.to_uppercase();
    let dialog_app = app.clone();
    let dialog_name = name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file_path) = dialog_app
            .dialog()
            .file()
            .add_filter(&filter_name, &[extension.as_str()])
            .set_file_name(&dialog_name)
            .blocking_save_file()
        else {
            return Err(AppError::cancelled("No file selected"));
        };
        let path = file_path
            .into_path()
            .map_err(|_| AppError::invalid_input("Selected file has an invalid path"))?;
        fs::write(&path, contents)
            .map_err(|error| AppError::storage_io(format!("Failed to write export: {error}")))?;
        Ok(path.display().to_string())
    })
    .await
    .map_err(|error| {
        AppError::storage_io(format!("Blocking export worker failed: {error}"))
    })?
}
