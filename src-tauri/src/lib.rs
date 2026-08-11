use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

// ---------------------------------------------------------------------------
// Sidecar process management
// ---------------------------------------------------------------------------

/// Holds the spawned sidecar child process so we can kill it on app exit.
struct SidecarState {
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
}

/// Safely write a JSON line to the sidecar's stdin.
fn write_to_sidecar(state: &mut SidecarState, json: &str) -> Result<(), String> {
    let stdin = state.stdin.as_mut().ok_or("Sidecar stdin not available")?;
    stdin
        .write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write to sidecar: {e}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("Failed to write newline to sidecar: {e}"))?;
    stdin.flush().map_err(|e| format!("Failed to flush sidecar stdin: {e}"))?;
    Ok(())
}

/// Spawn the pi agent sidecar child process.
///
/// In dev mode we run `node sidecar/dist/index.js` directly.
/// The sidecar path is resolved relative to the project root.
fn spawn_sidecar(app: &tauri::AppHandle) -> Result<SidecarState, String> {
    // Resolve sidecar path relative to the executable / project root.
    // In dev mode, the CARGO_MANIFEST_DIR / tauri dev working directory is src-tauri.
    // The sidecar lives at <project_root>/sidecar/dist/index.js
    let sidecar_path = {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let path = std::path::Path::new(manifest_dir)
            .join("..")
            .join("sidecar")
            .join("dist")
            .join("index.js");
        path.canonicalize().unwrap_or(path)
    };

    if !sidecar_path.exists() {
        return Err(format!(
            "Sidecar not built: {} does not exist. Run `cd sidecar && npm run build`.",
            sidecar_path.display()
        ));
    }

    let mut child = Command::new("node")
        .arg(&sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // Take stdout and stderr before moving stdin into state.
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture sidecar stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture sidecar stderr")?;
    let stdin = child
        .stdin
        .take()
        .ok_or("Failed to capture sidecar stdin")?;

    // Spawn a thread to read sidecar stdout line-by-line and forward as Tauri events.
    {
        let app = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        if text.trim().is_empty() {
                            continue;
                        }
                        // Parse the JSON line and forward to WebView as a Tauri event.
                        forward_sidecar_event(&app, &text);
                    }
                    Err(e) => {
                        eprintln!("[sidecar stdout] read error: {e}");
                        break;
                    }
                }
            }
        });
    }

    // Spawn a thread to read sidecar stderr for logging.
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) => eprintln!("[sidecar stderr] {text}"),
                Err(e) => {
                    eprintln!("[sidecar stderr] read error: {e}");
                    break;
                }
            }
        }
    });

    Ok(SidecarState {
        child: Some(child),
        stdin: Some(stdin),
    })
}

/// Parse a sidecar stdout JSON line and emit the corresponding Tauri event.
fn forward_sidecar_event(app: &tauri::AppHandle, line: &str) {
    // Parse as a generic JSON value to inspect the "type" field.
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[sidecar] non-JSON stdout line: {line} ({e})");
            return;
        }
    };

    let msg_type = parsed
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    match msg_type {
        "text_delta" => {
            let delta = parsed
                .get("delta")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string();
            let _ = app.emit("agent_text_delta", serde_json::json!({ "delta": delta }));
        }
        "tool_start" => {
            let tool = parsed
                .get("tool")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let params = parsed.get("params").cloned().unwrap_or(serde_json::Value::Null);
            let _ = app.emit(
                "agent_tool_start",
                serde_json::json!({ "tool": tool, "params": params }),
            );
        }
        "tool_end" => {
            let result = parsed.get("result").cloned().unwrap_or(serde_json::Value::Null);
            let _ = app.emit("agent_tool_end", serde_json::json!({ "result": result }));
        }
        "agent_end" => {
            let _ = app.emit("agent_end", serde_json::json!({}));
        }
        "error" => {
            let message = parsed
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            let _ = app.emit("agent_error", serde_json::json!({ "message": message }));
        }
        "ready" => {
            let _ = app.emit("agent_ready", serde_json::json!({}));
        }
        "book_ready" => {
            let _ = app.emit("agent_book_ready", serde_json::json!({}));
        }
        "session_created" => {
            let session_id = parsed
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let _ = app.emit("session_created", serde_json::json!({ "sessionId": session_id }));
        }
        "session_switched" => {
            let session_id = parsed
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let messages = parsed.get("messages").cloned().unwrap_or(serde_json::Value::Array(vec![]));
            let _ = app.emit(
                "session_switched",
                serde_json::json!({ "sessionId": session_id, "messages": messages }),
            );
        }
        "session_deleted" => {
            let session_id = parsed
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let _ = app.emit("session_deleted", serde_json::json!({ "sessionId": session_id }));
        }
        "sessions_list" => {
            let sessions = parsed.get("sessions").cloned().unwrap_or(serde_json::Value::Array(vec![]));
            let _ = app.emit("sessions_list", serde_json::json!({ "sessions": sessions }));
        }
        other => {
            eprintln!("[sidecar] unhandled message type: {other}");
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// WebView → Rust → sidecar stdin: send a prompt to the agent.
#[tauri::command]
fn agent_prompt(
    prompt: String,
    selection: Option<String>,
    chapter_index: Option<i32>,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let mut json = serde_json::json!({ "type": "prompt", "text": prompt });
    let context = serde_json::json!({});
    let mut context = context;
    if let Some(s) = selection {
        context["selection"] = serde_json::Value::String(s);
    }
    if let Some(idx) = chapter_index {
        context["chapterIndex"] = serde_json::Value::Number(serde_json::Number::from(idx));
    }
    if context.as_object().map_or(false, |m| !m.is_empty()) {
        json["context"] = context;
    }
    write_to_sidecar(&mut state, &json.to_string())
}

/// WebView → Rust → sidecar stdin: abort the current agent operation.
#[tauri::command]
fn agent_abort(state: tauri::State<'_, Mutex<SidecarState>>) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "abort" }).to_string();
    write_to_sidecar(&mut state, &json)
}

// --- Session management commands --------------------------------------------

/// WebView → Rust → sidecar stdin: list sessions for a book.
#[tauri::command]
fn list_sessions(
    book_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "list_sessions", "bookId": book_id }).to_string();
    write_to_sidecar(&mut state, &json)
}

/// WebView → Rust → sidecar stdin: create a new session for a book.
#[tauri::command]
fn new_session(
    book_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "new_session", "bookId": book_id }).to_string();
    write_to_sidecar(&mut state, &json)
}

/// WebView → Rust → sidecar stdin: switch to an existing session.
#[tauri::command]
fn switch_session(
    session_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "switch_session", "sessionId": session_id }).to_string();
    write_to_sidecar(&mut state, &json)
}

/// WebView → Rust → sidecar stdin: delete a session.
#[tauri::command]
fn delete_session(
    session_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "delete_session", "sessionId": session_id }).to_string();
    write_to_sidecar(&mut state, &json)
}

// ---------------------------------------------------------------------------
// File dialog command (existing)
// ---------------------------------------------------------------------------

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize, Deserialize)]
struct OpenFileResult {
    path: String,
    name: String,
    bytes: Vec<u8>,
    #[serde(rename = "bookId")]
    book_id: String,
}

#[tauri::command]
async fn open_file(app: tauri::AppHandle) -> Result<OpenFileResult, String> {
    let app_clone = app.clone();
    let (path_str, name, bytes) = tauri::async_runtime::spawn_blocking(move || {
        let file_path = app_clone
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

        Ok::<_, String>((path_str, name, bytes))
    })
    .await
    .map_err(|e| e.to_string())??;

    // Compute bookId from file path hash (simplified; Child 5 will use epub metadata identifier).
    let book_id = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        path_str.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    };

    // Notify sidecar that a book was opened (for EPUB parsing + FTS5 indexing).
    // Also pass the sessions directory (Tauri app data dir + "/sessions") for persistence.
    if let Some(state) = app.try_state::<Mutex<SidecarState>>() {
        if let Ok(mut state) = state.lock() {
            let sessions_dir = app.path().app_data_dir()
                .map(|d| d.join("sessions").to_string_lossy().to_string())
                .unwrap_or_default();
            let json = serde_json::json!({
                "type": "book_opened",
                "path": &path_str,
                "bookId": &book_id,
                "sessionsDir": sessions_dir,
            });
            if let Err(e) = write_to_sidecar(&mut state, &json.to_string()) {
                eprintln!("[sidecar] Failed to send book_opened: {e}");
            }
            // Auto-list sessions so the frontend can default to the most recent one.
            let list_json = serde_json::json!({ "type": "list_sessions", "bookId": &book_id }).to_string();
            if let Err(e) = write_to_sidecar(&mut state, &list_json) {
                eprintln!("[sidecar] Failed to send list_sessions: {e}");
            }
        }
    }

    Ok(OpenFileResult {
        path: path_str,
        name,
        bytes,
        book_id,
    })
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Spawn the pi agent sidecar child process.
            match spawn_sidecar(app.handle()) {
                Ok(state) => {
                    app.manage(Mutex::new(state));
                }
                Err(e) => {
                    eprintln!("[sidecar] Failed to start: {e}");
                    // Manage an empty state so commands don't panic on lock.
                    // The WebView will get an agent_error when it tries to prompt.
                    app.manage(Mutex::new(SidecarState {
                        child: None,
                        stdin: None,
                    }));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the sidecar when the main window closes.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<Mutex<SidecarState>>() {
                    if let Ok(mut state) = state.lock() {
                        if let Some(child) = state.child.as_mut() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_file,
            agent_prompt,
            agent_abort,
            list_sessions,
            new_session,
            switch_session,
            delete_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}