use std::sync::{mpsc, Arc, Mutex};

use tauri::{Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

mod error;
mod library;

use library::LibraryStore;

// ---------------------------------------------------------------------------
// Sidecar process management
// ---------------------------------------------------------------------------

enum SidecarControl {
    Write(Vec<u8>),
    Kill,
    Close,
}

#[derive(Debug, PartialEq)]
enum SidecarTransportStatus {
    Running,
    Stopping,
    Stopped(String),
}

/// The child is owned by a background writer thread; commands only enqueue I/O.
struct SidecarState {
    control: Option<mpsc::Sender<SidecarControl>>,
    status: Arc<Mutex<SidecarTransportStatus>>,
}

impl SidecarState {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            control: None,
            status: Arc::new(Mutex::new(SidecarTransportStatus::Stopped(reason.into()))),
        }
    }
}

/// Safely write a JSON line to the sidecar's stdin.
fn write_to_sidecar(state: &SidecarState, json: &str) -> Result<(), String> {
    let control = state
        .control
        .as_ref()
        .ok_or("Sidecar transport is not available")?;
    let mut status = state
        .status
        .lock()
        .map_err(|_| "Sidecar transport status lock is poisoned".to_string())?;
    match &*status {
        SidecarTransportStatus::Running => {}
        SidecarTransportStatus::Stopping => return Err("Sidecar transport is stopping".to_string()),
        SidecarTransportStatus::Stopped(reason) => {
            return Err(format!("Sidecar transport has stopped: {reason}"))
        }
    }
    let mut line = Vec::with_capacity(json.len() + 1);
    line.extend_from_slice(json.as_bytes());
    line.push(b'\n');
    if control.send(SidecarControl::Write(line)).is_err() {
        *status = SidecarTransportStatus::Stopped("Sidecar writer channel is closed".to_string());
        return Err("Sidecar transport has stopped".to_string());
    }
    Ok(())
}

/// Record a terminal transport state. Returns whether callers should be
/// notified; intentional shutdown transitions are silent.
fn mark_sidecar_stopped(status: &Arc<Mutex<SidecarTransportStatus>>, reason: String) -> bool {
    let Ok(mut status) = status.lock() else {
        eprintln!("[sidecar] transport status lock is poisoned");
        return true;
    };
    match &*status {
        SidecarTransportStatus::Running => {
            *status = SidecarTransportStatus::Stopped(reason);
            true
        }
        SidecarTransportStatus::Stopping => {
            *status = SidecarTransportStatus::Stopped(reason);
            false
        }
        SidecarTransportStatus::Stopped(_) => false,
    }
}

fn emit_sidecar_transport_error(app: &tauri::AppHandle, message: &str) {
    let _ = app.emit("agent_error", serde_json::json!({ "message": message }));
}

fn stop_sidecar(state: &SidecarState) {
    if let Ok(mut status) = state.status.lock() {
        if matches!(*status, SidecarTransportStatus::Running) {
            *status = SidecarTransportStatus::Stopping;
        }
    }
    if let Some(control) = &state.control {
        if control.send(SidecarControl::Kill).is_err() {
            mark_sidecar_stopped(
                &state.status,
                "Sidecar writer stopped before shutdown".to_string(),
            );
        }
    }
}

#[derive(Default)]
struct JsonLineFramer {
    pending: Vec<u8>,
}

impl JsonLineFramer {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(index) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line = self.pending.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            match String::from_utf8(line) {
                Ok(line) if !line.trim().is_empty() => lines.push(line),
                Ok(_) => {}
                Err(error) => eprintln!("[sidecar stdout] invalid UTF-8 line: {error}"),
            }
        }
        lines
    }
}

/// Spawn the bundled executable through Tauri's external-binary resolver.
fn spawn_sidecar(app: &tauri::AppHandle) -> Result<SidecarState, String> {
    let (mut events, mut child) = app
        .shell()
        .sidecar("litera-sidecar")
        .map_err(|error| format!("Failed to resolve bundled sidecar: {error}"))?
        .set_raw_out(true)
        .spawn()
        .map_err(|error| format!("Failed to spawn bundled sidecar: {error}"))?;

    let (control, controls) = mpsc::channel();
    let status = Arc::new(Mutex::new(SidecarTransportStatus::Running));
    let writer_status = status.clone();
    let writer_app = app.clone();
    std::thread::spawn(move || {
        while let Ok(message) = controls.recv() {
            match message {
                SidecarControl::Write(bytes) => {
                    if let Err(error) = child.write(&bytes) {
                        let message = format!("Sidecar stdin write failed: {error}");
                        eprintln!("[sidecar] {message}");
                        if mark_sidecar_stopped(&writer_status, message.clone()) {
                            emit_sidecar_transport_error(&writer_app, &message);
                        }
                        break;
                    }
                }
                SidecarControl::Kill => {
                    if let Err(error) = child.kill() {
                        eprintln!("[sidecar] kill failed: {error}");
                    }
                    break;
                }
                SidecarControl::Close => break,
            }
        }
    });

    let event_app = app.clone();
    let event_status = status.clone();
    let event_control = control.clone();
    tauri::async_runtime::spawn(async move {
        let mut stdout = JsonLineFramer::default();
        let mut stderr = JsonLineFramer::default();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(chunk) => {
                    for line in stdout.push(&chunk) {
                        forward_sidecar_event(&event_app, &line);
                    }
                }
                CommandEvent::Stderr(chunk) => {
                    for line in stderr.push(&chunk) {
                        eprintln!("[sidecar stderr] {line}");
                    }
                }
                CommandEvent::Error(error) => {
                    let message = format!("Sidecar transport error: {error}");
                    eprintln!("[sidecar] {message}");
                    if mark_sidecar_stopped(&event_status, message.clone()) {
                        emit_sidecar_transport_error(&event_app, &message);
                    }
                    let _ = event_control.send(SidecarControl::Kill);
                }
                CommandEvent::Terminated(payload) => {
                    let message = format!(
                        "Sidecar terminated (code: {:?}, signal: {:?})",
                        payload.code, payload.signal
                    );
                    eprintln!("[sidecar] {message}");
                    if mark_sidecar_stopped(&event_status, message.clone()) {
                        emit_sidecar_transport_error(&event_app, &message);
                    }
                    let _ = event_control.send(SidecarControl::Close);
                    break;
                }
                _ => {}
            }
        }
        let message = "Sidecar event stream closed".to_string();
        if mark_sidecar_stopped(&event_status, message.clone()) {
            emit_sidecar_transport_error(&event_app, &message);
        }
        let _ = event_control.send(SidecarControl::Close);
    });

    let state = SidecarState {
        control: Some(control),
        status,
    };
    // Bootstrap stdin immediately. The packaged Node runtime can otherwise
    // observe an idle pipe before the WebView sends its first command.
    write_to_sidecar(&state, r#"{"type":"ping"}"#)?;
    Ok(state)
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
            let params = parsed
                .get("params")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let _ = app.emit(
                "agent_tool_start",
                serde_json::json!({ "tool": tool, "params": params }),
            );
        }
        "tool_end" => {
            let result = parsed
                .get("result")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
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
        "pong" => {
            let fts5 = parsed
                .get("fts5")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let _ = app.emit("agent_pong", serde_json::json!({ "fts5": fts5 }));
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
            let _ = app.emit(
                "session_created",
                serde_json::json!({ "sessionId": session_id }),
            );
        }
        "session_switched" => {
            let session_id = parsed
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let messages = parsed
                .get("messages")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![]));
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
            let _ = app.emit(
                "session_deleted",
                serde_json::json!({ "sessionId": session_id }),
            );
        }
        "sessions_list" => {
            let sessions = parsed
                .get("sessions")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![]));
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
    let state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let mut json = serde_json::json!({ "type": "prompt", "text": prompt });
    let context = serde_json::json!({});
    let mut context = context;
    if let Some(s) = selection {
        context["selection"] = serde_json::Value::String(s);
    }
    if let Some(idx) = chapter_index {
        context["chapterIndex"] = serde_json::Value::Number(serde_json::Number::from(idx));
    }
    if context.as_object().is_some_and(|map| !map.is_empty()) {
        json["context"] = context;
    }
    write_to_sidecar(&state, &json.to_string())
}

/// WebView → Rust → sidecar stdin: abort the current agent operation.
#[tauri::command]
fn agent_abort(state: tauri::State<'_, Mutex<SidecarState>>) -> Result<(), String> {
    let state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "abort" }).to_string();
    write_to_sidecar(&state, &json)
}

// --- Session management commands --------------------------------------------

/// WebView → Rust → sidecar stdin: list sessions for a book.
#[tauri::command]
fn list_sessions(
    book_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "list_sessions", "bookId": book_id }).to_string();
    write_to_sidecar(&state, &json)
}

/// WebView → Rust → sidecar stdin: create a new session for a book.
#[tauri::command]
fn new_session(
    book_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "new_session", "bookId": book_id }).to_string();
    write_to_sidecar(&state, &json)
}

/// WebView → Rust → sidecar stdin: switch to an existing session.
#[tauri::command]
fn switch_session(
    session_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "switch_session", "sessionId": session_id }).to_string();
    write_to_sidecar(&state, &json)
}

/// WebView → Rust → sidecar stdin: delete a session.
#[tauri::command]
fn delete_session(
    session_id: String,
    state: tauri::State<'_, Mutex<SidecarState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    let json = serde_json::json!({ "type": "delete_session", "sessionId": session_id }).to_string();
    write_to_sidecar(&state, &json)
}

/// Notify sidecar that a book was opened, and auto-list its sessions.
fn notify_sidecar_book_opened(app: &tauri::AppHandle, path: &str, book_id: &str) {
    if let Some(state) = app.try_state::<Mutex<SidecarState>>() {
        if let Ok(state) = state.lock() {
            let sessions_dir = app
                .path()
                .app_data_dir()
                .map(|d| d.join("sessions").to_string_lossy().to_string())
                .unwrap_or_default();
            let json = serde_json::json!({
                "type": "book_opened",
                "path": path,
                "bookId": book_id,
                "sessionsDir": sessions_dir,
            });
            if let Err(e) = write_to_sidecar(&state, &json.to_string()) {
                eprintln!("[sidecar] Failed to send book_opened: {e}");
            }
            // Auto-list sessions so the frontend can default to the most recent one.
            let list_json =
                serde_json::json!({ "type": "list_sessions", "bookId": book_id }).to_string();
            if let Err(e) = write_to_sidecar(&state, &list_json) {
                eprintln!("[sidecar] Failed to send list_sessions: {e}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let root_result = app.path().app_data_dir().map_err(|error| {
                error::AppError::storage_io(format!("Failed to resolve app data dir: {error}"))
            });
            let (library_store, library_ready) = match root_result {
                Ok(root) => {
                    match tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking({
                        let root = root.clone();
                        move || LibraryStore::initialize(root)
                    }))
                    .map_err(|error| {
                        error::AppError::storage_io(format!(
                            "Library initialization worker failed: {error}"
                        ))
                    })
                    .and_then(|result| result)
                    {
                        Ok(store) => (store, true),
                        Err(error) => {
                            eprintln!("[library] Initialization failed: {error}");
                            (LibraryStore::unavailable(root, error), false)
                        }
                    }
                }
                Err(error) => {
                    eprintln!("[library] Initialization failed: {error}");
                    (
                        LibraryStore::unavailable(std::path::PathBuf::new(), error),
                        false,
                    )
                }
            };
            app.manage(library_store);

            // The sidecar must not observe a half-initialized storage layout.
            let sidecar_state = if library_ready {
                match spawn_sidecar(app.handle()) {
                    Ok(state) => state,
                    Err(error) => {
                        eprintln!("[sidecar] Failed to start: {error}");
                        SidecarState::unavailable(error)
                    }
                }
            } else {
                eprintln!("[sidecar] Not started because library initialization failed");
                SidecarState::unavailable("Library initialization failed")
            };
            app.manage(Mutex::new(sidecar_state));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the sidecar when the main window closes.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<Mutex<SidecarState>>() {
                    if let Ok(state) = state.lock() {
                        stop_sidecar(&state);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            library::import_book,
            library::read_import_bytes,
            library::save_book_metadata,
            library::list_books,
            library::get_book_open_context,
            library::read_book_bytes,
            library::open_book_bytes,
            library::delete_book,
            library::update_reading_state,
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

#[cfg(test)]
mod tests {
    use std::sync::{mpsc, Arc, Mutex};

    use super::{
        write_to_sidecar, JsonLineFramer, SidecarControl, SidecarState, SidecarTransportStatus,
    };

    #[test]
    fn json_line_framer_reassembles_fragmented_chunks() {
        let mut framer = JsonLineFramer::default();
        assert!(framer.push(br#"{"type":"rea"#).is_empty());
        assert_eq!(
            framer.push(b"dy\"}\r\n{\"type\":\"pong\"}\npartial"),
            vec![
                r#"{"type":"ready"}"#.to_string(),
                r#"{"type":"pong"}"#.to_string(),
            ]
        );
        assert_eq!(framer.push(b"-line\n"), vec!["partial-line".to_string()]);
    }

    #[test]
    fn stopped_transport_rejects_writes_before_enqueueing() {
        let (control, receiver) = mpsc::channel();
        let status = Arc::new(Mutex::new(SidecarTransportStatus::Running));
        let state = SidecarState {
            control: Some(control),
            status: status.clone(),
        };

        write_to_sidecar(&state, r#"{"type":"ping"}"#).expect("running transport");
        match receiver.recv().expect("queued command") {
            SidecarControl::Write(bytes) => assert_eq!(bytes, b"{\"type\":\"ping\"}\n"),
            _ => panic!("expected a queued write"),
        }

        *status.lock().expect("status") =
            SidecarTransportStatus::Stopped("process exited".to_string());
        let error = write_to_sidecar(&state, r#"{"type":"prompt"}"#)
            .expect_err("stopped transport must reject writes");
        assert!(error.contains("process exited"));
        assert!(receiver.try_recv().is_err());
    }
}
