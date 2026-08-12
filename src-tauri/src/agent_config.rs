use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::library;

/// Snapshot of the agent configuration reflected back to the frontend.
///
/// The API key is never returned in plaintext; `has_api_key` is the only signal
/// the UI uses to decide whether to show a masked placeholder.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigSnapshot {
    pub configured: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub has_api_key: bool,
}

#[tauri::command]
pub async fn get_agent_config(app: tauri::AppHandle) -> AppResult<AgentConfigSnapshot> {
    let agent_dir = resolve_agent_dir(&app)?;
    let result = tauri::async_runtime::spawn_blocking(move || read_snapshot(&agent_dir))
        .await
        .map_err(|error| {
            AppError::storage_io(format!("Agent config read worker failed: {error}"))
        })??;
    Ok(result)
}

#[tauri::command]
pub async fn save_agent_config(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
    model: String,
) -> AppResult<()> {
    let provider = provider.trim().to_string();
    let model = model.trim().to_string();
    if provider.is_empty() || model.is_empty() || api_key.is_empty() {
        return Err(AppError::invalid_input(
            "provider, api_key, and model are all required",
        ));
    }

    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        save_config(&agent_dir, &provider, &api_key, &model)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Agent config write worker failed: {error}")))?
}

fn resolve_agent_dir(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("agent"))
        .map_err(|error| AppError::storage_io(format!("Failed to resolve app data dir: {error}")))
}

fn read_json_or_empty(path: &Path, label: &str) -> AppResult<serde_json::Value> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
            AppError::storage_corrupt(format!("Failed to parse {label}: {error}"))
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(error) => Err(AppError::storage_io(format!("Failed to read {label}: {error}"))),
    }
}

fn read_snapshot(agent_dir: &Path) -> AppResult<AgentConfigSnapshot> {
    let settings = read_json_or_empty(&agent_dir.join("settings.json"), "settings.json")?;
    let auth = read_json_or_empty(&agent_dir.join("auth.json"), "auth.json")?;

    let provider = settings
        .get("defaultProvider")
        .and_then(|value| value.as_str())
        .map(|string| string.to_string());
    let model = settings
        .get("defaultModel")
        .and_then(|value| value.as_str())
        .map(|string| string.to_string());

    let has_api_key = match &provider {
        Some(provider_id) => auth
            .get(provider_id)
            .and_then(|entry| entry.get("type"))
            .and_then(|value| value.as_str())
            .map(|entry_type| entry_type == "api_key")
            .unwrap_or(false)
            && auth
                .get(provider_id)
                .and_then(|entry| entry.get("key"))
                .and_then(|value| value.as_str())
                .map(|key| !key.is_empty())
                .unwrap_or(false),
        None => false,
    };

    let configured = provider.is_some() && model.is_some() && has_api_key;

    Ok(AgentConfigSnapshot {
        configured,
        provider,
        model,
        has_api_key,
    })
}

fn save_config(agent_dir: &Path, provider: &str, api_key: &str, model: &str) -> AppResult<()> {
    let auth_path = agent_dir.join("auth.json");
    let settings_path = agent_dir.join("settings.json");

    let mut auth = read_json_or_empty(&auth_path, "auth.json")?;
    if auth.is_null() {
        auth = serde_json::Value::Object(serde_json::Map::new());
    }
    let auth_object = auth.as_object_mut().ok_or_else(|| {
        AppError::storage_corrupt("auth.json root is not a JSON object".to_string())
    })?;
    auth_object.insert(
        provider.to_string(),
        serde_json::json!({ "type": "api_key", "key": api_key }),
    );
    let auth_bytes = serde_json::to_vec_pretty(&auth)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize auth.json: {error}")))?;
    library::atomic_write(&auth_path, &auth_bytes, "auth.json")?;

    let mut settings = read_json_or_empty(&settings_path, "settings.json")?;
    if settings.is_null() {
        settings = serde_json::Value::Object(serde_json::Map::new());
    }
    let settings_object = settings.as_object_mut().ok_or_else(|| {
        AppError::storage_corrupt("settings.json root is not a JSON object".to_string())
    })?;
    settings_object.insert(
        "defaultProvider".to_string(),
        serde_json::Value::String(provider.to_string()),
    );
    settings_object.insert(
        "defaultModel".to_string(),
        serde_json::Value::String(model.to_string()),
    );
    settings_object.insert(
        "defaultThinkingLevel".to_string(),
        serde_json::Value::String("medium".to_string()),
    );
    let settings_bytes = serde_json::to_vec_pretty(&settings).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize settings.json: {error}"))
    })?;
    library::atomic_write(&settings_path, &settings_bytes, "settings.json")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_agent_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temporary directory")
    }

    #[test]
    fn empty_dir_reports_unconfigured() {
        let dir = temp_agent_dir();
        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert!(!snapshot.configured);
        assert_eq!(snapshot.provider, None);
        assert_eq!(snapshot.model, None);
        assert!(!snapshot.has_api_key);
    }

    #[test]
    fn save_then_read_round_trip() {
        let dir = temp_agent_dir();
        save_config(dir.path(), "anthropic", "secret-key", "claude-opus-4-5")
            .expect("save config");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert!(snapshot.configured);
        assert_eq!(snapshot.provider.as_deref(), Some("anthropic"));
        assert_eq!(snapshot.model.as_deref(), Some("claude-opus-4-5"));
        assert!(snapshot.has_api_key);
    }

    #[test]
    fn save_preserves_other_provider_keys() {
        let dir = temp_agent_dir();
        let auth_path = dir.path().join("auth.json");
        fs::write(
            &auth_path,
            br#"{"openai":{"type":"api_key","key":"other-key"}}"#,
        )
        .expect("seed auth");

        save_config(dir.path(), "anthropic", "anthropic-key", "claude-opus-4-5")
            .expect("save config");

        let auth: serde_json::Value =
            serde_json::from_slice(&fs::read(&auth_path).expect("read auth")).expect("parse auth");
        assert_eq!(auth["openai"]["key"], "other-key");
        assert_eq!(auth["anthropic"]["type"], "api_key");
        assert_eq!(auth["anthropic"]["key"], "anthropic-key");
    }

    #[test]
    fn save_preserves_other_settings_fields() {
        let dir = temp_agent_dir();
        let settings_path = dir.path().join("settings.json");
        fs::write(&settings_path, br#"{"theme":"dark","defaultModel":"old-model"}"#)
            .expect("seed settings");

        save_config(dir.path(), "anthropic", "anthropic-key", "claude-opus-4-5")
            .expect("save config");

        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(&settings_path).expect("read settings"))
                .expect("parse settings");
        assert_eq!(settings["theme"], "dark");
        assert_eq!(settings["defaultProvider"], "anthropic");
        assert_eq!(settings["defaultModel"], "claude-opus-4-5");
        assert_eq!(settings["defaultThinkingLevel"], "medium");
    }

    #[test]
    fn configured_requires_matching_api_key_entry() {
        let dir = temp_agent_dir();
        let settings_path = dir.path().join("settings.json");
        fs::write(
            &settings_path,
            br#"{"defaultProvider":"anthropic","defaultModel":"claude-opus-4-5"}"#,
        )
        .expect("seed settings");
        // auth.json references a different provider
        fs::write(
            dir.path().join("auth.json"),
            br#"{"openai":{"type":"api_key","key":"key"}}"#,
        )
        .expect("seed auth");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert!(!snapshot.configured);
        assert_eq!(snapshot.provider.as_deref(), Some("anthropic"));
        assert!(!snapshot.has_api_key);
    }

    #[test]
    fn empty_api_key_is_not_configured() {
        let dir = temp_agent_dir();
        let settings_path = dir.path().join("settings.json");
        fs::write(
            &settings_path,
            br#"{"defaultProvider":"anthropic","defaultModel":"claude-opus-4-5"}"#,
        )
        .expect("seed settings");
        fs::write(
            dir.path().join("auth.json"),
            br#"{"anthropic":{"type":"api_key","key":""}}"#,
        )
        .expect("seed auth");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert!(!snapshot.configured);
        assert!(!snapshot.has_api_key);
    }

    #[test]
    fn save_uses_atomic_temp_file() {
        let dir = temp_agent_dir();
        save_config(dir.path(), "anthropic", "secret", "claude-opus-4-5").expect("save config");

        // No leftover temp files after a successful atomic write.
        let leftover: Vec<_> = fs::read_dir(dir.path())
            .expect("list dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .collect();
        assert!(leftover.is_empty(), "temp files left behind: {leftover:?}");
    }

    #[test]
    fn save_does_not_write_api_key_to_a_log_file() {
        let dir = temp_agent_dir();
        save_config(dir.path(), "anthropic", "super-secret-key", "claude-opus-4-5")
            .expect("save config");

        // The only files in the agent dir should be auth.json and settings.json.
        let mut files: Vec<String> = fs::read_dir(dir.path())
            .expect("list dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        files.sort();
        assert_eq!(files, vec!["auth.json".to_string(), "settings.json".to_string()]);

        let auth = fs::read_to_string(dir.path().join("auth.json")).expect("read auth");
        assert!(auth.contains("super-secret-key"));
        let settings = fs::read_to_string(dir.path().join("settings.json")).expect("read settings");
        assert!(!settings.contains("super-secret-key"));
    }
}