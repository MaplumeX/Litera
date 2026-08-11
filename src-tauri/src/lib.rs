use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize, Deserialize)]
struct OpenFileResult {
    path: String,
    name: String,
    bytes: Vec<u8>,
}

#[tauri::command]
fn open_file(app: tauri::AppHandle) -> Result<OpenFileResult, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("EPUB", &["epub"])
        .blocking_pick_file()
        .ok_or("No file selected")?;

    let path = file_path.into_path().map_err(|_| "Invalid path")?;
    let path_str = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("book.epub")
        .to_string();
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(OpenFileResult {
        path: path_str,
        name,
        bytes,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, open_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
