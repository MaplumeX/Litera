use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::library;

const SESSION_VERSION: u64 = 3;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_BATCH_BYTES: usize = 2 * 1024 * 1024;
const MAX_BATCH_ENTRIES: usize = 128;

#[derive(Clone)]
pub struct PiSessionStore {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionSummary {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    system_prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPiSession {
    header: Value,
    entries: Vec<Value>,
    leaf_id: Option<String>,
}

impl PiSessionStore {
    pub fn new(root: PathBuf) -> AppResult<Self> {
        let sessions = root.join("sessions");
        require_real_dir(&sessions, "sessions")?;
        static SESSION_GATE: OnceLock<Arc<Mutex<()>>> = OnceLock::new();
        Ok(Self {
            root,
            gate: SESSION_GATE
                .get_or_init(|| Arc::new(Mutex::new(())))
                .clone(),
        })
    }

    fn sessions_root(&self) -> PathBuf {
        self.root.join("sessions")
    }

    fn book_dir(&self, book_id: &str, create: bool) -> AppResult<PathBuf> {
        validate_id("bookId", book_id)?;
        let root = self.sessions_root();
        require_real_dir(&root, "sessions")?;
        let path = root.join(book_id);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(
                AppError::storage_corrupt("Session book path is not a real directory"),
            ),
            Ok(_) => Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                fs::create_dir(&path).map_err(|error| {
                    AppError::storage_io(format!(
                        "Failed to create session book directory: {error}"
                    ))
                })?;
                Ok(path)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path),
            Err(error) => Err(AppError::storage_io(format!(
                "Failed to inspect session book directory: {error}"
            ))),
        }
    }

    fn find_file(&self, book_id: &str, session_id: &str) -> AppResult<PathBuf> {
        validate_id("sessionId", session_id)?;
        let dir = self.book_dir(book_id, false)?;
        let mut matches = Vec::new();
        let read = match fs::read_dir(&dir) {
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(AppError::invalid_input("Unknown session"))
            }
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to list sessions: {error}"
                )))
            }
        };
        for item in read {
            let item = item.map_err(|error| {
                AppError::storage_io(format!("Failed to read session directory: {error}"))
            })?;
            let path = item.path();
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                AppError::storage_io(format!("Failed to inspect session file: {error}"))
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                continue;
            }
            if let Ok(header) = read_session_header(&path) {
                if header.get("id").and_then(Value::as_str) == Some(session_id) {
                    matches.push(path);
                }
            }
        }
        if matches.len() != 1 {
            return Err(AppError::invalid_input("Unknown or duplicate session"));
        }
        Ok(matches.remove(0))
    }

    pub fn create(&self, book_id: &str) -> AppResult<LoadedPiSession> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Session lock is poisoned"))?;
        let dir = self.book_dir(book_id, true)?;
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = Utc::now().to_rfc3339();
        let header = json!({"type":"session","version":3,"id":id,"timestamp":timestamp,"cwd":""});
        let path = dir.join(format!("{id}.jsonl"));
        let bytes = format!(
            "{}\n",
            serde_json::to_string(&header).map_err(|error| AppError::storage_io(format!(
                "Failed to serialize session: {error}"
            )))?
        );
        library::atomic_write(&path, bytes.as_bytes(), "Pi session")?;
        Ok(LoadedPiSession {
            header,
            entries: Vec::new(),
            leaf_id: None,
        })
    }

    pub fn load(&self, book_id: &str, session_id: &str) -> AppResult<LoadedPiSession> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Session lock is poisoned"))?;
        let path = self.find_file(book_id, session_id)?;
        let (header, entries) = load_and_migrate(&path)?;
        let leaf_id = stored_leaf_id(&path, &entries)
            .or_else(|| entries.last().and_then(entry_id).map(str::to_string));
        Ok(LoadedPiSession {
            header,
            entries,
            leaf_id,
        })
    }

    pub fn set_leaf(
        &self,
        book_id: &str,
        session_id: &str,
        leaf_id: &str,
    ) -> AppResult<LoadedPiSession> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Session lock is poisoned"))?;
        let path = self.find_file(book_id, session_id)?;
        let (header, entries) = load_and_migrate(&path)?;
        let ids: HashSet<&str> = entries.iter().filter_map(entry_id).collect();
        if !ids.contains(leaf_id) {
            return Err(AppError::invalid_input(
                "Session leaf is unknown; reload before switching",
            ));
        }
        write_leaf_sidecar(&path, leaf_id)?;
        Ok(LoadedPiSession {
            header,
            entries,
            leaf_id: Some(leaf_id.to_string()),
        })
    }

    pub fn list(&self, book_id: &str) -> AppResult<Vec<PiSessionSummary>> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Session lock is poisoned"))?;
        let dir = self.book_dir(book_id, false)?;
        let read = match fs::read_dir(dir) {
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to list sessions: {error}"
                )))
            }
        };
        let mut summaries = Vec::new();
        for item in read.flatten() {
            let path = item.path();
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                continue;
            }
            let Ok((header, entries)) = load_and_migrate(&path) else {
                continue;
            };
            let Some(id) = header.get("id").and_then(Value::as_str) else {
                continue;
            };
            let created = header
                .get("timestamp")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let updated = entries
                .last()
                .and_then(|entry| entry.get("timestamp"))
                .and_then(Value::as_str)
                .unwrap_or(&created)
                .to_string();
            let title = entries
                .iter()
                .rev()
                .find(|entry| entry.get("type").and_then(Value::as_str) == Some("session_info"))
                .and_then(|entry| entry.get("name"))
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty())
                .map(str::to_string)
                .or_else(|| first_user_text(&entries))
                .unwrap_or_else(|| "新会话".to_string());
            let session_config = entries
                .iter()
                .rev()
                .find(|entry| entry.get("type").and_then(Value::as_str) == Some("session_config"));
            let system_prompt = session_config
                .and_then(|entry| entry.get("systemPrompt"))
                .and_then(Value::as_str)
                .map(str::to_string);
            summaries.push(PiSessionSummary {
                id: id.to_string(),
                title,
                created_at: created,
                updated_at: updated,
                system_prompt,
            });
        }
        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(summaries)
    }

    pub fn append(
        &self,
        book_id: &str,
        session_id: &str,
        expected_leaf_id: Option<&str>,
        entries: Vec<Value>,
    ) -> AppResult<Option<String>> {
        if entries.is_empty() || entries.len() > MAX_BATCH_ENTRIES {
            return Err(AppError::invalid_input(
                "Session append batch size is invalid",
            ));
        }
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Session lock is poisoned"))?;
        let path = self.find_file(book_id, session_id)?;
        recover_truncated_tail(&path)?;
        let (_header, existing) = load_and_migrate(&path)?;
        let ids: HashSet<String> = existing
            .iter()
            .filter_map(entry_id)
            .map(str::to_string)
            .collect();
        // Optimistic leaf check, relaxed for branch switching: `None` requires
        // an empty session (fresh-session semantics); `Some(id)` only requires
        // the id to exist in the file, so a stale writer cannot fork history it
        // never saw, while continuing on a non-final (old) branch is allowed.
        match expected_leaf_id {
            Some(expected) if !ids.contains(expected) => {
                return Err(AppError::invalid_input(
                    "Session leaf changed; reload before appending",
                ));
            }
            None if !existing.is_empty() => {
                return Err(AppError::invalid_input(
                    "Session leaf changed; reload before appending",
                ));
            }
            _ => {}
        }
        let mut ids = ids;
        let mut encoded = Vec::new();
        for entry in &entries {
            validate_entry(entry, &ids)?;
            let id = entry_id(entry).expect("validated id").to_string();
            ids.insert(id);
            let line = serde_json::to_vec(entry).map_err(|error| {
                AppError::invalid_input(format!("Invalid session entry: {error}"))
            })?;
            if line.len() > MAX_LINE_BYTES {
                return Err(AppError::invalid_input("Session entry is too large"));
            }
            encoded.extend_from_slice(&line);
            encoded.push(b'\n');
        }
        if encoded.len() > MAX_BATCH_BYTES {
            return Err(AppError::invalid_input("Session append batch is too large"));
        }
        let current_size = fs::metadata(&path)
            .map_err(|error| AppError::storage_io(format!("Failed to inspect session: {error}")))?
            .len();
        if current_size.saturating_add(encoded.len() as u64) > MAX_FILE_BYTES {
            return Err(AppError::invalid_input("Session file is too large"));
        }
        let mut file = OpenOptions::new()
            .append(true)
            .open(&path)
            .map_err(|error| {
                AppError::storage_io(format!("Failed to open session for append: {error}"))
            })?;
        file.write_all(&encoded)
            .and_then(|_| file.flush())
            .and_then(|_| file.sync_all())
            .map_err(|error| AppError::storage_io(format!("Failed to append session: {error}")))?;
        let new_leaf = entries.last().and_then(entry_id).map(str::to_string);
        // Appending always advances the active-branch sidecar to the newest
        // leaf ("latest branch" semantics: continuing a conversation moves
        // the pointer even when the append extended an older branch).
        if let Some(leaf) = new_leaf.as_deref() {
            if write_leaf_sidecar(&path, leaf).is_err() {
                eprintln!("[sessions] Failed to persist active leaf sidecar for {session_id}");
            }
        }
        Ok(new_leaf)
    }

    pub fn delete(&self, book_id: &str, session_id: &str) -> AppResult<()> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Session lock is poisoned"))?;
        let path = self.find_file(book_id, session_id)?;
        fs::remove_file(&path)
            .map_err(|error| AppError::storage_io(format!("Failed to delete session: {error}")))?;
        // The sidecar may already be gone; deleting a session must not fail on
        // its absence.
        if let Err(error) = fs::remove_file(leaf_sidecar_path(&path)) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(AppError::storage_io(format!(
                    "Failed to delete session leaf sidecar: {error}"
                )));
            }
        }
        Ok(())
    }

    /// A local session file located for the Sync Backend.
    pub fn list_all_session_files(&self) -> AppResult<Vec<SyncSessionFile>> {
        let sessions_root = self.sessions_root();
        let books = match fs::read_dir(&sessions_root) {
            Ok(books) => books,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(AppError::storage_io(format!(
                    "Failed to list sessions: {error}"
                )))
            }
        };
        let mut files = Vec::new();
        for book in books {
            let book = book.map_err(|error| {
                AppError::storage_io(format!("Failed to read sessions directory: {error}"))
            })?;
            let path = book.path();
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
                _ => continue,
            }
            let book_id = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string();
            if validate_id("bookId", &book_id).is_err() {
                continue;
            }
            let sessions = match fs::read_dir(&path) {
                Ok(sessions) => sessions,
                Err(error) => {
                    return Err(AppError::storage_io(format!(
                        "Failed to list book sessions: {error}"
                    )))
                }
            };
            for session in sessions {
                let session = session.map_err(|error| {
                    AppError::storage_io(format!(
                        "Failed to read book session directory: {error}"
                    ))
                })?;
                let session_path = session.path();
                if session_path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                    continue;
                }
                let session_id = session_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string();
                if validate_id("sessionId", &session_id).is_err() {
                    continue;
                }
                files.push(SyncSessionFile {
                    book_id: book_id.clone(),
                    session_id,
                    path: session_path,
                });
            }
        }
        Ok(files)
    }

    /// Merge a remote copy of a session into this device. Entries union by
    /// id — local order first, remote-only entries appended in remote order —
    /// so diverged branches on either device survive the merge (both remain
    /// navigable; the active-branch leaf pointer stays per-device). Creates
    /// the session locally when this device has never seen it. Returns the
    /// content now stored locally.
    pub fn merge_remote_session(&self, book_id: &str, remote_content: &str) -> AppResult<String> {
        validate_id("bookId", book_id)?;
        let _guard = self
            .gate
            .lock()
            .map_err(|_| AppError::storage_io("Session lock is poisoned"))?;
        let (mut remote_header, mut remote_entries) = parse_remote_session(remote_content)?;
        let session_id = remote_header
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        validate_id("sessionId", &session_id)?;
        // Bring the remote copy up to the current session format first so
        // entry ids exist to union on.
        let _ = migrate(&mut remote_header, &mut remote_entries)?;

        let local_path = match self.find_file(book_id, &session_id) {
            Ok(path) => Some(path),
            Err(error) if is_unknown_session(&error) => None,
            Err(error) => return Err(error),
        };
        let (header, entries) = match local_path.as_ref() {
            Some(path) => {
                recover_truncated_tail(&path)?;
                let (local_header, mut merged) = load_and_migrate(&path)?;
                let ids: HashSet<String> = merged
                    .iter()
                    .filter_map(entry_id)
                    .map(str::to_string)
                    .collect();
                for entry in remote_entries {
                    let Some(id) = entry_id(&entry) else { continue };
                    if !ids.contains(id) {
                        merged.push(entry);
                    }
                }
                (local_header, merged)
            }
            None => (remote_header, remote_entries),
        };

        validate_entries(&entries)?;
        let mut content = serde_json::to_string(&header)
            .map_err(|error| AppError::storage_io(format!("Failed to serialize session: {error}")))?;
        content.push('\n');
        for entry in &entries {
            let line = serde_json::to_string(entry).map_err(|error| {
                AppError::storage_io(format!("Failed to serialize session entry: {error}"))
            })?;
            content.push_str(&line);
            content.push('\n');
        }
        if content.len() as u64 > MAX_FILE_BYTES {
            return Err(AppError::invalid_input("Merged session is too large"));
        }
        match local_path {
            Some(path) => {
                crate::library::atomic_write(&path, content.as_bytes(), "merged session")?;
            }
            None => {
                let dir = self.book_dir(book_id, true)?;
                let path = dir.join(format!("{session_id}.jsonl"));
                crate::library::atomic_write(&path, content.as_bytes(), "synced session")?;
            }
        }
        Ok(content)
    }
}

/// A local session file located for the Sync Backend.
#[derive(Debug, Clone)]
pub struct SyncSessionFile {
    pub book_id: String,
    pub session_id: String,
    pub path: PathBuf,
}

fn is_unknown_session(error: &AppError) -> bool {
    matches!(error.code, crate::error::AppErrorCode::InvalidInput)
        && error.message.contains("Unknown session")
}

fn parse_remote_session(content: &str) -> AppResult<(Value, Vec<Value>)> {
    let mut header: Option<Value> = None;
    let mut entries = Vec::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            return Err(AppError::storage_corrupt("Synced session line is too large"));
        }
        let value: Value = serde_json::from_str(line)
            .map_err(|error| AppError::storage_corrupt(format!("Invalid synced session: {error}")))?;
        if header.is_none() {
            validate_header(&value)?;
            header = Some(value);
        } else {
            entries.push(value);
        }
    }
    let header = header
        .ok_or_else(|| AppError::storage_corrupt("Synced session header is missing"))?;
    Ok((header, entries))
}

fn validate_id(label: &str, value: &str) -> AppResult<()> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric);
    if valid {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!("Invalid {label}")))
    }
}

fn require_real_dir(path: &Path, label: &str) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| AppError::storage_io(format!("Failed to inspect {label}: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        Err(AppError::storage_corrupt(format!(
            "{label} is not a real directory"
        )))
    } else {
        Ok(())
    }
}

fn read_session_file(path: &Path, strict: bool) -> AppResult<(Value, Vec<Value>)> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| AppError::storage_io(format!("Failed to inspect session: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(AppError::storage_corrupt("Invalid session file"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|error| AppError::storage_io(format!("Failed to read session: {error}")))?;
    let terminated = bytes.ends_with(b"\n");
    let mut values = Vec::new();
    let lines: Vec<&[u8]> = bytes.split(|byte| *byte == b'\n').collect();
    for (index, line) in lines.iter().enumerate() {
        if line.is_empty() {
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            return Err(AppError::storage_corrupt("Session line is too large"));
        }
        match serde_json::from_slice::<Value>(line) {
            Ok(value) => values.push(value),
            Err(_) if !terminated && index == lines.len() - 1 => break,
            Err(error) if strict => {
                return Err(AppError::storage_corrupt(format!(
                    "Invalid session JSONL: {error}"
                )))
            }
            Err(_) => return Err(AppError::storage_corrupt("Invalid session JSONL")),
        }
    }
    if values.is_empty() {
        return Err(AppError::storage_corrupt("Session header is missing"));
    }
    let header = values.remove(0);
    validate_header(&header)?;
    if header.get("version").and_then(Value::as_u64).unwrap_or(1) < 2 {
        validate_v1_entries(&values)?;
    } else {
        validate_entries(&values)?;
    }
    Ok((header, values))
}

fn read_session_header(path: &Path) -> AppResult<Value> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| AppError::storage_io(format!("Failed to inspect session: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(AppError::storage_corrupt("Invalid session file"));
    }
    let file = fs::File::open(path)
        .map_err(|error| AppError::storage_io(format!("Failed to read session header: {error}")))?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    reader
        .by_ref()
        .take((MAX_LINE_BYTES + 1) as u64)
        .read_until(b'\n', &mut line)
        .map_err(|error| AppError::storage_io(format!("Failed to read session header: {error}")))?;
    if line.len() > MAX_LINE_BYTES || !line.ends_with(b"\n") {
        return Err(AppError::storage_corrupt("Invalid session header line"));
    }
    line.pop();
    let header: Value = serde_json::from_slice(&line)
        .map_err(|error| AppError::storage_corrupt(format!("Invalid session header: {error}")))?;
    validate_header(&header)?;
    Ok(header)
}

fn validate_header(header: &Value) -> AppResult<()> {
    if header.get("type").and_then(Value::as_str) != Some("session") {
        return Err(AppError::storage_corrupt("Invalid session header"));
    }
    validate_id(
        "session header id",
        header.get("id").and_then(Value::as_str).unwrap_or(""),
    )?;
    let version = header.get("version").and_then(Value::as_u64).unwrap_or(1);
    if version > SESSION_VERSION {
        return Err(AppError::storage_corrupt(format!(
            "Unsupported session version {version}"
        )));
    }
    if header
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_none()
    {
        return Err(AppError::storage_corrupt("Invalid session timestamp"));
    }
    if header.get("cwd").and_then(Value::as_str).is_none() {
        return Err(AppError::storage_corrupt("Invalid session cwd"));
    }
    Ok(())
}

fn entry_id(entry: &Value) -> Option<&str> {
    entry.get("id").and_then(Value::as_str)
}

/// The active-branch pointer lives next to the JSONL file (append-only stays
/// intact): `<session>.jsonl.leaf` holds the target leaf id as one line.
fn leaf_sidecar_path(session_path: &Path) -> PathBuf {
    let mut name = session_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    name.push_str(".leaf");
    session_path.with_file_name(name)
}

/// Read the sidecar leaf id; `None` when absent, unreadable, or pointing at
/// an id the session no longer carries (fall back to `entries.last()`).
fn stored_leaf_id(session_path: &Path, entries: &[Value]) -> Option<String> {
    let bytes = fs::read(leaf_sidecar_path(session_path)).ok()?;
    let id = String::from_utf8(bytes).ok()?.trim().to_string();
    if id.is_empty() {
        return None;
    }
    entries
        .iter()
        .any(|entry| entry_id(entry) == Some(id.as_str()))
        .then_some(id)
}

fn write_leaf_sidecar(session_path: &Path, leaf_id: &str) -> AppResult<()> {
    let bytes = format!("{leaf_id}\n");
    library::atomic_write(&leaf_sidecar_path(session_path), bytes.as_bytes(), "Pi session leaf")
}

fn validate_entries(entries: &[Value]) -> AppResult<()> {
    let mut ids = HashSet::new();
    for entry in entries {
        validate_entry(entry, &ids)?;
        ids.insert(entry_id(entry).unwrap().to_string());
    }
    Ok(())
}

fn validate_v1_entries(entries: &[Value]) -> AppResult<()> {
    for entry in entries {
        let object = entry
            .as_object()
            .ok_or_else(|| AppError::storage_corrupt("Session entry is not an object"))?;
        if object
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            return Err(AppError::storage_corrupt("Session entry type is missing"));
        }
        if object
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .is_none()
        {
            return Err(AppError::storage_corrupt("Invalid session entry timestamp"));
        }
    }
    Ok(())
}

fn validate_entry(entry: &Value, prior_ids: &HashSet<String>) -> AppResult<()> {
    let object = entry
        .as_object()
        .ok_or_else(|| AppError::storage_corrupt("Session entry is not an object"))?;
    let id = object.get("id").and_then(Value::as_str).unwrap_or("");
    validate_id("session entry id", id)?;
    if prior_ids.contains(id) {
        return Err(AppError::storage_corrupt("Duplicate session entry id"));
    }
    match object.get("parentId") {
        Some(Value::Null) => {}
        Some(Value::String(parent)) if prior_ids.contains(parent) => {}
        _ => return Err(AppError::storage_corrupt("Invalid session parentId")),
    }
    if object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        return Err(AppError::storage_corrupt("Session entry type is missing"));
    }
    if object
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_none()
    {
        return Err(AppError::storage_corrupt("Invalid session entry timestamp"));
    }
    Ok(())
}

fn migrate(header: &mut Value, entries: &mut [Value]) -> AppResult<bool> {
    let version = header.get("version").and_then(Value::as_u64).unwrap_or(1);
    if version >= SESSION_VERSION {
        return Ok(false);
    }
    if version < 2 {
        let mut prior: Option<String> = None;
        let mut ids = HashSet::new();
        for entry in entries.iter_mut() {
            let id = loop {
                let candidate = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
                if ids.insert(candidate.clone()) {
                    break candidate;
                }
            };
            let object = entry
                .as_object_mut()
                .ok_or_else(|| AppError::storage_corrupt("Session entry is not an object"))?;
            object.insert("id".into(), Value::String(id.clone()));
            object.insert(
                "parentId".into(),
                prior.clone().map(Value::String).unwrap_or(Value::Null),
            );
            prior = Some(id);
        }
        let migrated_ids: Vec<Option<String>> = entries
            .iter()
            .map(|entry| entry_id(entry).map(str::to_string))
            .collect();
        for entry in entries.iter_mut() {
            if entry.get("type").and_then(Value::as_str) != Some("compaction") {
                continue;
            }
            let old_index = entry
                .get("firstKeptEntryIndex")
                .and_then(Value::as_u64)
                .map(|value| value as usize);
            if let Some(index) = old_index
                .and_then(|index| index.checked_sub(1))
                .and_then(|index| migrated_ids.get(index))
                .and_then(Clone::clone)
            {
                let object = entry.as_object_mut().unwrap();
                object.insert("firstKeptEntryId".into(), Value::String(index));
                object.remove("firstKeptEntryIndex");
            }
        }
    }
    if version < 3 {
        for entry in entries.iter_mut() {
            if entry.get("type").and_then(Value::as_str) == Some("message")
                && entry.pointer("/message/role").and_then(Value::as_str) == Some("hookMessage")
            {
                if let Some(message) = entry.get_mut("message").and_then(Value::as_object_mut) {
                    message.insert("role".into(), Value::String("custom".into()));
                }
            }
        }
    }
    header
        .as_object_mut()
        .unwrap()
        .insert("version".into(), Value::Number(SESSION_VERSION.into()));
    Ok(true)
}

fn recover_truncated_tail(path: &Path) -> AppResult<()> {
    let bytes = fs::read(path)
        .map_err(|error| AppError::storage_io(format!("Failed to read session tail: {error}")))?;
    if bytes.is_empty() || bytes.ends_with(b"\n") {
        return Ok(());
    }
    // Validate the header and every complete preceding line before changing
    // the file. read_session_file intentionally tolerates only the incomplete
    // final fragment when the newline terminator is missing.
    read_session_file(path, true)?;
    let last_newline = bytes.iter().rposition(|byte| *byte == b'\n');
    let tail_start = last_newline.map_or(0, |index| index + 1);
    if serde_json::from_slice::<Value>(&bytes[tail_start..]).is_ok() {
        let mut file = OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|error| {
                AppError::storage_io(format!("Failed to recover session tail: {error}"))
            })?;
        return file
            .write_all(b"\n")
            .and_then(|_| file.flush())
            .and_then(|_| file.sync_all())
            .map_err(|error| {
                AppError::storage_io(format!("Failed to recover session tail: {error}"))
            });
    }
    let length = last_newline
        .map(|index| index + 1)
        .ok_or_else(|| AppError::storage_corrupt("Session has no complete header line"))?;
    let file = OpenOptions::new().write(true).open(path).map_err(|error| {
        AppError::storage_io(format!("Failed to recover session tail: {error}"))
    })?;
    file.set_len(length as u64)
        .and_then(|_| file.sync_all())
        .map_err(|error| AppError::storage_io(format!("Failed to recover session tail: {error}")))
}

fn load_and_migrate(path: &Path) -> AppResult<(Value, Vec<Value>)> {
    let (mut header, mut entries) = read_session_file(path, true)?;
    if migrate(&mut header, &mut entries)? {
        validate_entries(&entries)?;
        let backup = path.with_extension("jsonl.pre-v3.bak");
        if !backup.exists() {
            fs::copy(path, &backup).map_err(|error| {
                AppError::storage_io(format!("Failed to back up legacy session: {error}"))
            })?;
        }
        let mut bytes = serde_json::to_vec(&header).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize session header: {error}"))
        })?;
        bytes.push(b'\n');
        for entry in &entries {
            bytes.extend(serde_json::to_vec(entry).map_err(|error| {
                AppError::storage_io(format!("Failed to serialize session entry: {error}"))
            })?);
            bytes.push(b'\n');
        }
        library::atomic_write(path, &bytes, "migrated Pi session")?;
    }
    Ok((header, entries))
}

fn first_user_text(entries: &[Value]) -> Option<String> {
    entries
        .iter()
        .find(|entry| {
            entry.get("type").and_then(Value::as_str) == Some("message")
                && entry.pointer("/message/role").and_then(Value::as_str) == Some("user")
        })
        .and_then(|entry| entry.pointer("/message/content"))
        .and_then(|content| match content {
            Value::String(text) => Some(text.clone()),
            Value::Array(parts) => parts
                .iter()
                .find_map(|part| part.get("text").and_then(Value::as_str).map(str::to_string)),
            _ => None,
        })
        .map(|title| title.chars().take(80).collect())
}

fn resolve_store(app: &tauri::AppHandle) -> AppResult<PiSessionStore> {
    let root = app.path().app_data_dir().map_err(|error| {
        AppError::storage_io(format!("Failed to resolve app data dir: {error}"))
    })?;
    PiSessionStore::new(root)
}

#[tauri::command]
pub async fn create_agent_session(
    app: tauri::AppHandle,
    book_id: String,
) -> AppResult<LoadedPiSession> {
    tauri::async_runtime::spawn_blocking(move || resolve_store(&app)?.create(&book_id))
        .await
        .map_err(|error| AppError::storage_io(format!("Session worker failed: {error}")))?
}
#[tauri::command]
pub async fn list_agent_sessions(
    app: tauri::AppHandle,
    book_id: String,
) -> AppResult<Vec<PiSessionSummary>> {
    tauri::async_runtime::spawn_blocking(move || resolve_store(&app)?.list(&book_id))
        .await
        .map_err(|error| AppError::storage_io(format!("Session worker failed: {error}")))?
}
#[tauri::command]
pub async fn load_agent_session(
    app: tauri::AppHandle,
    book_id: String,
    session_id: String,
) -> AppResult<LoadedPiSession> {
    tauri::async_runtime::spawn_blocking(move || resolve_store(&app)?.load(&book_id, &session_id))
        .await
        .map_err(|error| AppError::storage_io(format!("Session worker failed: {error}")))?
}
#[tauri::command]
pub async fn append_agent_session_entries(
    app: tauri::AppHandle,
    book_id: String,
    session_id: String,
    expected_leaf_id: Option<String>,
    entries: Vec<Value>,
) -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        resolve_store(&app)?.append(&book_id, &session_id, expected_leaf_id.as_deref(), entries)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Session worker failed: {error}")))?
}
#[tauri::command]
pub async fn set_agent_session_leaf(
    app: tauri::AppHandle,
    book_id: String,
    session_id: String,
    leaf_id: String,
) -> AppResult<LoadedPiSession> {
    tauri::async_runtime::spawn_blocking(move || {
        resolve_store(&app)?.set_leaf(&book_id, &session_id, &leaf_id)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Session worker failed: {error}")))?
}
#[tauri::command]
pub async fn delete_agent_session(
    app: tauri::AppHandle,
    book_id: String,
    session_id: String,
) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || resolve_store(&app)?.delete(&book_id, &session_id))
        .await
        .map_err(|error| AppError::storage_io(format!("Session worker failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (tempfile::TempDir, PiSessionStore) {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("sessions")).unwrap();
        let store = PiSessionStore::new(temp.path().to_path_buf()).unwrap();
        (temp, store)
    }
    #[test]
    fn create_append_reopen_and_stale_leaf() {
        let (_temp, store) = store();
        let created = store.create("book-1").unwrap();
        let id = created.header["id"].as_str().unwrap();
        let entry = json!({"type":"message","id":"entry1","parentId":null,"timestamp":Utc::now().to_rfc3339(),"message":{"role":"user","content":"hello","timestamp":1}});
        assert_eq!(
            store.append("book-1", id, None, vec![entry]).unwrap(),
            Some("entry1".into())
        );
        // Contract change (branch switching): `None` still requires an empty
        // session, but a *missing* expected id is the only `Some` rejection —
        // an id anywhere in the file now passes (old-branch continuation).
        assert!(store.append("book-1", id, None, vec![json!({})]).is_err());
        assert!(store
            .append("book-1", id, Some("ghost-id"), vec![json!({})])
            .is_err());
        assert_eq!(
            store.load("book-1", id).unwrap().leaf_id.as_deref(),
            Some("entry1")
        );
    }

    #[test]
    fn appends_on_an_old_branch_after_the_leaf_contract_relaxation() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap();
        let now = Utc::now().to_rfc3339();
        let first = json!({"type":"message","id":"entry001","parentId":null,"timestamp":now,"message":{"role":"user","content":"one","timestamp":1}});
        let second = json!({"type":"message","id":"entry002","parentId":"entry001","timestamp":now,"message":{"role":"assistant","content":[],"timestamp":2}});
        let third = json!({"type":"message","id":"entry003","parentId":"entry002","timestamp":now,"message":{"role":"user","content":"two","timestamp":3}});
        assert_eq!(store.append("book", id, None, vec![first]).unwrap(), Some("entry001".into()));
        assert_eq!(store.append("book", id, Some("entry001"), vec![second]).unwrap(), Some("entry002".into()));
        assert_eq!(store.append("book", id, Some("entry002"), vec![third]).unwrap(), Some("entry003".into()));
        // Continuing on the old branch: the expected leaf is a mid-file entry,
        // which used to be rejected and must now be accepted (branch switching).
        let fork = json!({"type":"message","id":"fork0001","parentId":"entry001","timestamp":now,"message":{"role":"user","content":"edited","timestamp":4}});
        assert_eq!(
            store.append("book", id, Some("entry001"), vec![fork]).unwrap(),
            Some("fork0001".into())
        );
        // A ghost leaf id is still a stale-writer rejection.
        let ghost = json!({"type":"message","id":"ghost0001","parentId":"entry001","timestamp":now,"message":{"role":"user","content":"x","timestamp":5}});
        assert!(store.append("book", id, Some("ghost-id"), vec![ghost]).is_err());
        // The append advanced the sidecar to the newest leaf.
        assert_eq!(
            store.load("book", id).unwrap().leaf_id.as_deref(),
            Some("fork0001")
        );
    }

    #[test]
    fn set_leaf_persists_and_load_returns_it() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap();
        let now = Utc::now().to_rfc3339();
        let one = json!({"type":"message","id":"entry001","parentId":null,"timestamp":now,"message":{"role":"user","content":"one","timestamp":1}});
        let two = json!({"type":"message","id":"entry002","parentId":"entry001","timestamp":now,"message":{"role":"assistant","content":[],"timestamp":2}});
        let three = json!({"type":"message","id":"entry003","parentId":"entry002","timestamp":now,"message":{"role":"user","content":"two","timestamp":3}});
        store.append("book", id, None, vec![one]).unwrap();
        store.append("book", id, Some("entry001"), vec![two]).unwrap();
        store.append("book", id, Some("entry002"), vec![three]).unwrap();
        // Switch back to the middle entry and reload.
        let loaded = store.set_leaf("book", id, "entry001").unwrap();
        assert_eq!(loaded.leaf_id.as_deref(), Some("entry001"));
        assert_eq!(
            store.load("book", id).unwrap().leaf_id.as_deref(),
            Some("entry001")
        );
        // An id the file does not carry is rejected.
        assert!(store.set_leaf("book", id, "ghost-id").is_err());
    }

    #[test]
    fn load_falls_back_to_last_entry_when_the_sidecar_is_missing_or_stale() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap();
        let now = Utc::now().to_rfc3339();
        let one = json!({"type":"message","id":"entry001","parentId":null,"timestamp":now,"message":{"role":"user","content":"one","timestamp":1}});
        let two = json!({"type":"message","id":"entry002","parentId":"entry001","timestamp":now,"message":{"role":"assistant","content":[],"timestamp":2}});
        store.append("book", id, None, vec![one]).unwrap();
        store.append("book", id, Some("entry001"), vec![two]).unwrap();
        let path = store.find_file("book", id).unwrap();
        let sidecar = leaf_sidecar_path(&path);
        // Sidecar written by the appends: load returns it, removing it falls
        // back to `entries.last()` (legacy-session compatibility).
        assert!(sidecar.exists());
        fs::remove_file(&sidecar).unwrap();
        assert_eq!(
            store.load("book", id).unwrap().leaf_id.as_deref(),
            Some("entry002")
        );
        // A sidecar pointing at an id the file no longer carries is ignored.
        fs::write(&sidecar, "ghost-id\n").unwrap();
        assert_eq!(
            store.load("book", id).unwrap().leaf_id.as_deref(),
            Some("entry002")
        );
    }

    #[test]
    fn delete_removes_the_leaf_sidecar() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap();
        let now = Utc::now().to_rfc3339();
        let one = json!({"type":"message","id":"entry001","parentId":null,"timestamp":now,"message":{"role":"user","content":"one","timestamp":1}});
        store.append("book", id, None, vec![one]).unwrap();
        let path = store.find_file("book", id).unwrap();
        let sidecar = leaf_sidecar_path(&path);
        assert!(sidecar.exists());
        store.delete("book", id).unwrap();
        assert!(!path.exists());
        assert!(!sidecar.exists());
        // Deleting again still fails on the missing session file (unknown
        // session), never on the already-absent sidecar.
        assert!(store.delete("book", id).is_err());
    }
    #[test]
    fn migrates_v2_hook_message_with_backup() {
        let (temp, store) = store();
        let dir = temp.path().join("sessions/book");
        fs::create_dir(&dir).unwrap();
        let path = dir.join("old.jsonl");
        let now = Utc::now().to_rfc3339();
        fs::write(&path,format!("{{\"type\":\"session\",\"version\":2,\"id\":\"old\",\"timestamp\":\"{now}\",\"cwd\":\"\"}}\n{{\"type\":\"message\",\"id\":\"one\",\"parentId\":null,\"timestamp\":\"{now}\",\"message\":{{\"role\":\"hookMessage\",\"content\":[]}}}}\n")).unwrap();
        let loaded = store.load("book", "old").unwrap();
        assert_eq!(loaded.header["version"], 3);
        assert_eq!(loaded.entries[0]["message"]["role"], "custom");
        assert!(path.with_extension("jsonl.pre-v3.bak").exists());
    }

    #[test]
    fn migrates_v1_linear_entries_and_compaction_reference() {
        let (temp, store) = store();
        let dir = temp.path().join("sessions/book");
        fs::create_dir(&dir).unwrap();
        let path = dir.join("legacy.jsonl");
        let now = Utc::now().to_rfc3339();
        fs::write(
            &path,
            format!(
                "{{\"type\":\"session\",\"id\":\"legacy\",\"timestamp\":\"{now}\",\"cwd\":\"\"}}\n{{\"type\":\"message\",\"timestamp\":\"{now}\",\"message\":{{\"role\":\"user\",\"content\":\"one\",\"timestamp\":1}}}}\n{{\"type\":\"compaction\",\"timestamp\":\"{now}\",\"summary\":\"summary\",\"firstKeptEntryIndex\":1}}\n",
            ),
        )
        .unwrap();
        let loaded = store.load("book", "legacy").unwrap();
        assert_eq!(loaded.header["version"], 3);
        let first_id = loaded.entries[0]["id"].as_str().unwrap();
        assert_eq!(loaded.entries[0]["parentId"], Value::Null);
        assert_eq!(loaded.entries[1]["parentId"], first_id);
        assert_eq!(loaded.entries[1]["firstKeptEntryId"], first_id);
        assert!(loaded.entries[1].get("firstKeptEntryIndex").is_none());
    }

    #[test]
    fn rejects_corruption_before_a_truncated_tail() {
        let (temp, store) = store();
        let dir = temp.path().join("sessions/book");
        fs::create_dir(&dir).unwrap();
        let path = dir.join("bad.jsonl");
        let now = Utc::now().to_rfc3339();
        fs::write(
            &path,
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"bad\",\"timestamp\":\"{now}\",\"cwd\":\"\"}}\nnot-json\n{{\"type\":",
            ),
        )
        .unwrap();
        assert!(store.load("book", "bad").is_err());
        let before = fs::read(&path).unwrap();
        let entry = json!({"type":"message","id":"valid001","parentId":null,"timestamp":Utc::now().to_rfc3339(),"message":{"role":"user","content":"ok","timestamp":1}});
        assert!(store.append("book", "bad", None, vec![entry]).is_err());
        assert_eq!(fs::read(path).unwrap(), before);
    }

    #[test]
    fn loading_a_known_corrupt_session_reports_corruption_not_unknown() {
        let (temp, store) = store();
        let dir = temp.path().join("sessions/book");
        fs::create_dir(&dir).unwrap();
        let path = dir.join("bad.jsonl");
        let now = Utc::now().to_rfc3339();
        fs::write(
            path,
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"bad\",\"timestamp\":\"{now}\",\"cwd\":\"\"}}\nnot-json\n",
            ),
        )
        .unwrap();
        let error = store.load("book", "bad").expect_err("corrupt session");
        assert_eq!(error.code, crate::error::AppErrorCode::StorageCorrupt);
    }

    #[test]
    fn rejects_oversized_append_batches() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap();
        assert!(store
            .append("book", id, None, vec![json!({}); MAX_BATCH_ENTRIES + 1])
            .is_err());
        let oversized = "x".repeat(MAX_LINE_BYTES + 1);
        let entry = json!({"type":"custom","id":"large001","parentId":null,"timestamp":Utc::now().to_rfc3339(),"value":oversized});
        assert!(store.append("book", id, None, vec![entry]).is_err());
    }

    #[test]
    fn append_recovers_a_truncated_final_line() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap();
        let path = store.find_file("book", id).unwrap();
        OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"type\":")
            .unwrap();
        let entry = json!({"type":"message","id":"valid001","parentId":null,"timestamp":Utc::now().to_rfc3339(),"message":{"role":"user","content":"ok","timestamp":1}});
        store.append("book", id, None, vec![entry]).unwrap();
        assert_eq!(
            store.load("book", id).unwrap().leaf_id.as_deref(),
            Some("valid001")
        );
    }

    #[test]
    fn append_preserves_a_valid_final_line_without_newline() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap();
        let path = store.find_file("book", id).unwrap();
        let first = json!({"type":"message","id":"first001","parentId":null,"timestamp":Utc::now().to_rfc3339(),"message":{"role":"user","content":"one","timestamp":1}});
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(serde_json::to_string(&first).unwrap().as_bytes())
            .unwrap();
        drop(file);
        let second = json!({"type":"message","id":"second01","parentId":"first001","timestamp":Utc::now().to_rfc3339(),"message":{"role":"assistant","content":[],"timestamp":2}});
        store
            .append("book", id, Some("first001"), vec![second])
            .unwrap();
        let loaded = store.load("book", id).unwrap();
        assert_eq!(loaded.entries.len(), 2);
        assert_eq!(loaded.entries[0]["id"], "first001");
        assert_eq!(loaded.entries[1]["id"], "second01");
    }

    #[test]
    fn compare_and_append_allows_only_one_concurrent_writer() {
        let (_temp, store) = store();
        let created = store.create("book").unwrap();
        let id = created.header["id"].as_str().unwrap().to_string();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let handles: Vec<_> = ["entry001", "entry002"].into_iter().map(|entry_id| {
            let store = store.clone(); let id = id.clone(); let barrier = barrier.clone();
            std::thread::spawn(move || { barrier.wait(); store.append("book", &id, None, vec![json!({"type":"message","id":entry_id,"parentId":null,"timestamp":Utc::now().to_rfc3339(),"message":{"role":"user","content":"race","timestamp":1}})]) })
        }).collect();
        barrier.wait();
        let successes = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .filter(Result::is_ok)
            .count();
        assert_eq!(successes, 1);
    }

    #[test]
    fn rejects_future_headers_and_ignores_corrupt_files_when_listing() {
        let (temp, store) = store();
        let valid = store.create("book").unwrap();
        let dir = temp.path().join("sessions/book");
        let now = Utc::now().to_rfc3339();
        fs::write(dir.join("future.jsonl"), format!("{{\"type\":\"session\",\"version\":4,\"id\":\"future\",\"timestamp\":\"{now}\",\"cwd\":\"\"}}\n")).unwrap();
        assert_eq!(store.list("book").unwrap().len(), 1);
        assert_eq!(store.list("book").unwrap()[0].id, valid.header["id"]);
    }

    #[test]
    fn list_exposes_the_latest_session_config() {
        let (temp, store) = store();
        let dir = temp.path().join("sessions/book");
        fs::create_dir(&dir).unwrap();
        let now = Utc::now().to_rfc3339();
        fs::write(
            dir.join("one.jsonl"),
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"one\",\"timestamp\":\"{now}\",\"cwd\":\"\"}}\n\
                 {{\"type\":\"session_config\",\"id\":\"cfg1\",\"parentId\":null,\"timestamp\":\"{now}\",\"systemPrompt\":\"旧提示词\",\"thinkingLevel\":\"max\"}}\n\
                 {{\"type\":\"session_config\",\"id\":\"cfg2\",\"parentId\":\"cfg1\",\"timestamp\":\"{now}\",\"systemPrompt\":\"翻译为古文\"}}\n"
            ),
        )
        .unwrap();
        let summary = &store.list("book").unwrap()[0];
        assert_eq!(summary.id, "one");
        assert_eq!(summary.system_prompt.as_deref(), Some("翻译为古文"));
    }

    #[test]
    fn list_leaves_session_config_fields_none_when_absent() {
        let (temp, store) = store();
        let dir = temp.path().join("sessions/book");
        fs::create_dir(&dir).unwrap();
        let now = Utc::now().to_rfc3339();
        fs::write(
            dir.join("plain.jsonl"),
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":\"plain\",\"timestamp\":\"{now}\",\"cwd\":\"\"}}\n{{\"type\":\"message\",\"id\":\"m1\",\"parentId\":null,\"timestamp\":\"{now}\",\"message\":{{\"role\":\"user\",\"content\":\"hello\",\"timestamp\":1}}}}\n"
            ),
        )
        .unwrap();
        let summary = &store.list("book").unwrap()[0];
        assert_eq!(summary.system_prompt, None);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_book_session_directory() {
        use std::os::unix::fs::symlink;
        let (temp, store) = store();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), temp.path().join("sessions/linked")).unwrap();
        assert!(store.create("linked").is_err());
    }
}

#[cfg(test)]
mod sync_merge_tests {
    use super::*;

    fn store() -> (tempfile::TempDir, PiSessionStore) {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("sessions")).unwrap();
        let store = PiSessionStore::new(temp.path().to_path_buf()).unwrap();
        (temp, store)
    }

    fn message(id: &str, parent: Option<&str>, content: &str) -> Value {
        json!({
            "type": "message",
            "id": id,
            "parentId": parent,
            "timestamp": Utc::now().to_rfc3339(),
            "message": {"role": "user", "content": content, "timestamp": 1},
        })
    }

    fn session_content(store: &PiSessionStore, book: &str, session: &str) -> String {
        let path = store.find_file(book, session).unwrap();
        fs::read_to_string(&path).unwrap()
    }

    #[test]
    fn merging_a_remote_session_keeps_both_diverged_branches() {
        let (_temp, store) = store();
        let created = store.create("book-1").unwrap();
        let id = created.header["id"].as_str().unwrap().to_string();

        // Shared prefix, then a local-only branch.
        store
            .append("book-1", &id, None, vec![message("entry001", None, "shared")])
            .unwrap();
        store
            .append(
                "book-1",
                &id,
                Some("entry001"),
                vec![message("local0001", Some("entry001"), "local branch")],
            )
            .unwrap();

        // Another device diverged from the same shared prefix.
        let remote = format!(
            "{}\n{}\n{}\n",
            serde_json::to_string(&json!({
                "type": "session", "version": 3, "id": id,
                "timestamp": "2026-01-01T00:00:00Z", "cwd": "",
            }))
            .unwrap(),
            serde_json::to_string(&message("entry001", None, "shared")).unwrap(),
            serde_json::to_string(&message("remote001", Some("entry001"), "remote branch")).unwrap(),
        );

        store.merge_remote_session("book-1", &remote).unwrap();

        let loaded = store.load("book-1", &id).unwrap();
        let ids: Vec<&str> = loaded.entries.iter().filter_map(entry_id).collect();
        // Union by id: the shared entry once, and both branches survive.
        assert_eq!(ids, vec!["entry001", "local0001", "remote001"]);
        // Both branches remain navigable (the existing branch UI works off
        // the leaf pointer).
        store.set_leaf("book-1", &id, "local0001").unwrap();
        store.set_leaf("book-1", &id, "remote001").unwrap();
    }

    #[test]
    fn merging_an_unseen_session_creates_it_locally() {
        let (_temp, store) = store();
        let remote = format!(
            "{}\n{}\n",
            serde_json::to_string(&json!({
                "type": "session", "version": 3, "id": "session42",
                "timestamp": "2026-01-01T00:00:00Z", "cwd": "",
            }))
            .unwrap(),
            serde_json::to_string(&message("entry001", None, "from another device")).unwrap(),
        );

        store.merge_remote_session("book-1", &remote).unwrap();

        let loaded = store.load("book-1", "session42").unwrap();
        assert_eq!(loaded.entries.len(), 1);
        let summaries = store.list("book-1").unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "session42");
    }

    #[test]
    fn merging_a_session_with_a_summary_and_system_prompt_keeps_them() {
        let (_temp, store) = store();
        let created = store.create("book-1").unwrap();
        let id = created.header["id"].as_str().unwrap().to_string();
        let remote = format!(
            "{}\n{}\n{}\n{}\n",
            serde_json::to_string(&json!({
                "type": "session", "version": 3, "id": id,
                "timestamp": "2026-01-01T00:00:00Z", "cwd": "",
            }))
            .unwrap(),
            serde_json::to_string(&message("entry001", None, "question")).unwrap(),
            serde_json::to_string(&json!({
                "type": "session_info", "id": "info0001", "parentId": "entry001",
                "timestamp": "2026-01-02T00:00:00Z", "name": "Summary title",
            }))
            .unwrap(),
            serde_json::to_string(&json!({
                "type": "session_config", "id": "conf0001", "parentId": "info0001",
                "timestamp": "2026-01-02T00:00:00Z", "systemPrompt": "Discuss this book",
            }))
            .unwrap(),
        );

        store.merge_remote_session("book-1", &remote).unwrap();

        let summaries = store.list("book-1").unwrap();
        assert_eq!(summaries[0].title, "Summary title");
        assert_eq!(summaries[0].system_prompt.as_deref(), Some("Discuss this book"));
        // The returned content matches what is on disk.
        assert!(session_content(&store, "book-1", &id).contains("Summary title"));
    }

    #[test]
    fn list_all_session_files_walks_books_and_sessions() {
        let (_temp, store) = store();
        let created = store.create("book-1").unwrap();
        let id = created.header["id"].as_str().unwrap().to_string();
        store
            .append("book-1", &id, None, vec![message("entry001", None, "hi")])
            .unwrap();
        store.create("book-2").unwrap();

        let files = store.list_all_session_files().unwrap();
        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .any(|file| file.book_id == "book-1" && file.session_id == id));
        assert!(files.iter().all(|file| file.path.extension().and_then(|v| v.to_str()) == Some("jsonl")));
    }
}
