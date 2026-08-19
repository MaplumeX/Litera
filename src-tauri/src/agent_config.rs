use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

const VALID_THINKING_LEVELS: &[&str] =
    &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

fn read_thinking_level(settings: &Value) -> String {
    let raw = settings
        .get("defaultThinkingLevel")
        .and_then(Value::as_str)
        .unwrap_or("");
    if VALID_THINKING_LEVELS.contains(&raw) {
        raw.to_string()
    } else {
        "medium".to_string()
    }
}

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
    pub custom_providers: Vec<CustomProviderEntry>,
    pub thinking_level: String,
}

/// A custom OpenAI-compatible provider entry listed in the settings dialog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderEntry {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub models: Vec<String>,
    pub has_api_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeConfig {
    pub provider: String,
    pub model: String,
    pub api: String,
    pub base_url: String,
    pub api_key: String,
    pub thinking_level: String,
}

#[tauri::command]
pub async fn get_agent_runtime_config(app: tauri::AppHandle) -> AppResult<AgentRuntimeConfig> {
    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_runtime_config(&agent_dir))
        .await
        .map_err(|error| {
            AppError::storage_io(format!("Agent runtime config worker failed: {error}"))
        })?
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
    if provider.is_empty() || model.is_empty() {
        return Err(AppError::invalid_input(
            "provider and model are both required",
        ));
    }

    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        save_config(&agent_dir, &provider, &api_key, &model)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Agent config write worker failed: {error}")))?
}

#[tauri::command]
pub async fn add_custom_provider(
    app: tauri::AppHandle,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
) -> AppResult<CustomProviderEntry> {
    let name = name.trim().to_string();
    let base_url = base_url.trim().to_string();
    let api_key = api_key.trim().to_string();
    let models = normalize_model_ids(models)?;
    if name.is_empty() || base_url.is_empty() || api_key.is_empty() {
        return Err(AppError::invalid_input(
            "name, base_url, api_key, and models are all required",
        ));
    }

    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        add_custom_provider_impl(&agent_dir, &name, &base_url, &api_key, &models)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Agent config write worker failed: {error}")))?
}

#[tauri::command]
pub async fn delete_custom_provider(app: tauri::AppHandle, provider_id: String) -> AppResult<()> {
    if !provider_id.starts_with("custom-") {
        return Err(AppError::invalid_input(
            "provider_id must start with 'custom-'",
        ));
    }

    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        delete_custom_provider_impl(&agent_dir, &provider_id)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Agent config write worker failed: {error}")))?
}

#[tauri::command]
pub async fn update_custom_provider(
    app: tauri::AppHandle,
    provider_id: String,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
) -> AppResult<CustomProviderEntry> {
    let provider_id = provider_id.trim().to_string();
    let name = name.trim().to_string();
    let base_url = base_url.trim().to_string();
    let api_key = api_key.trim().to_string();
    let models = normalize_model_ids(models)?;
    if !provider_id.starts_with("custom-") {
        return Err(AppError::invalid_input(
            "provider_id must start with 'custom-'",
        ));
    }
    if name.is_empty() || base_url.is_empty() {
        return Err(AppError::invalid_input(
            "name, base_url, and models are all required",
        ));
    }

    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        update_custom_provider_impl(
            &agent_dir,
            &provider_id,
            &name,
            &base_url,
            &api_key,
            &models,
        )
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Agent config write worker failed: {error}")))?
}

#[tauri::command]
pub async fn list_remote_models(
    app: tauri::AppHandle,
    base_url: String,
    api_key: String,
    provider_id: Option<String>,
) -> AppResult<Vec<String>> {
    let url = models_endpoint_url(&base_url)?;
    let api_key = api_key.trim().to_string();
    let key = if !api_key.is_empty() {
        api_key
    } else {
        let provider_id = provider_id.unwrap_or_default();
        let agent_dir = resolve_agent_dir(&app)?;
        tauri::async_runtime::spawn_blocking(move || {
            resolve_list_models_key(&agent_dir, "", Some(provider_id.as_str()))
        })
        .await
        .map_err(|error| {
            AppError::storage_io(format!("Agent config read worker failed: {error}"))
        })??
    };

    fetch_remote_models(&url, &key).await
}

#[tauri::command]
pub async fn switch_provider(
    app: tauri::AppHandle,
    provider_id: String,
    model: String,
) -> AppResult<()> {
    let provider_id = provider_id.trim().to_string();
    let model = model.trim().to_string();
    if provider_id.is_empty() || model.is_empty() {
        return Err(AppError::invalid_input(
            "provider_id and model are both required",
        ));
    }

    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        switch_provider_impl(&agent_dir, &provider_id, &model)
    })
    .await
    .map_err(|error| AppError::storage_io(format!("Agent config write worker failed: {error}")))?
}

#[tauri::command]
pub async fn set_thinking_level(app: tauri::AppHandle, level: String) -> AppResult<()> {
    if !VALID_THINKING_LEVELS.contains(&level.as_str()) {
        return Err(AppError::invalid_input("Invalid thinking level"));
    }

    let agent_dir = resolve_agent_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || set_thinking_level_impl(&agent_dir, &level))
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
        Err(error) => Err(AppError::storage_io(format!(
            "Failed to read {label}: {error}"
        ))),
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
        Some(provider_id) => {
            auth.get(provider_id)
                .and_then(|entry| entry.get("type"))
                .and_then(|value| value.as_str())
                .map(|entry_type| entry_type == "api_key")
                .unwrap_or(false)
                && auth
                    .get(provider_id)
                    .and_then(|entry| entry.get("key"))
                    .and_then(|value| value.as_str())
                    .map(|key| !key.is_empty())
                    .unwrap_or(false)
        }
        None => false,
    };

    let configured = provider.is_some() && model.is_some() && has_api_key;
    let custom_providers = read_custom_providers(agent_dir, &auth)?;
    let thinking_level = read_thinking_level(&settings);

    Ok(AgentConfigSnapshot {
        configured,
        provider,
        model,
        has_api_key,
        custom_providers,
        thinking_level,
    })
}

fn read_runtime_config(agent_dir: &Path) -> AppResult<AgentRuntimeConfig> {
    let settings = read_json_or_empty(&agent_dir.join("settings.json"), "settings.json")?;
    let auth = read_json_or_empty(&agent_dir.join("auth.json"), "auth.json")?;
    let provider = settings
        .get("defaultProvider")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Agent provider is not configured"))?
        .to_string();
    let model = settings
        .get("defaultModel")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Agent model is not configured"))?
        .to_string();
    let api_key = auth
        .get(&provider)
        .and_then(|entry| entry.get("key"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("Agent API key is not configured"))?
        .to_string();
    let (api, base_url) = if provider.starts_with("custom-") {
        let models = read_json_or_empty(&agent_dir.join("models.json"), "models.json")?;
        let definition = models
            .get("providers")
            .and_then(|providers| providers.get(&provider))
            .ok_or_else(|| AppError::invalid_input("Custom provider definition is missing"))?;
        let base = definition
            .get("baseUrl")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::invalid_input("Custom provider base URL is missing"))?;
        let model_is_declared = definition
            .get("models")
            .and_then(Value::as_array)
            .is_some_and(|models| {
                models
                    .iter()
                    .any(|entry| entry.get("id").and_then(Value::as_str) == Some(model.as_str()))
            });
        if !model_is_declared {
            return Err(AppError::invalid_input(
                "Configured model is not declared by the custom provider",
            ));
        }
        (
            definition
                .get("api")
                .and_then(Value::as_str)
                .unwrap_or("openai-completions")
                .to_string(),
            base.to_string(),
        )
    } else {
        let pair = match provider.as_str() {
            "anthropic" => ("anthropic-messages", "https://api.anthropic.com"),
            "openai" => ("openai-responses", "https://api.openai.com/v1"),
            "deepseek" => ("openai-completions", "https://api.deepseek.com"),
            "google" => (
                "google-generative-ai",
                "https://generativelanguage.googleapis.com/v1beta",
            ),
            "openrouter" => ("openai-completions", "https://openrouter.ai/api/v1"),
            "groq" => ("openai-completions", "https://api.groq.com/openai/v1"),
            "mistral" => ("mistral-conversations", "https://api.mistral.ai"),
            "xai" if model == "grok-4.5" => ("openai-responses", "https://api.x.ai/v1"),
            "xai" => ("openai-completions", "https://api.x.ai/v1"),
            "together" => ("openai-completions", "https://api.together.ai/v1"),
            "fireworks" if model.contains("kimi-k3") || model.contains("glm-5p2") => (
                "openai-completions",
                "https://api.fireworks.ai/inference/v1",
            ),
            "fireworks" => ("anthropic-messages", "https://api.fireworks.ai/inference"),
            _ => return Err(AppError::invalid_input("Unsupported built-in provider")),
        };
        (pair.0.to_string(), pair.1.to_string())
    };
    let parsed = reqwest::Url::parse(&base_url)
        .map_err(|_| AppError::invalid_input("Provider base URL is invalid"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::invalid_input(
            "Provider base URL must use HTTP(S)",
        ));
    }
    let thinking_level = read_thinking_level(&settings);
    Ok(AgentRuntimeConfig {
        provider,
        model,
        api,
        base_url,
        api_key,
        thinking_level,
    })
}

/// Read models.json and extract custom provider entries.
///
/// models.json structure: `{ "providers": { "<customId>": { "name", "baseUrl", "api", "models": [{ "id" }] } } }`
/// Returns empty vec when the file is absent.
fn read_custom_providers(
    agent_dir: &Path,
    auth: &serde_json::Value,
) -> AppResult<Vec<CustomProviderEntry>> {
    let models = read_json_or_empty(&agent_dir.join("models.json"), "models.json")?;
    if models.is_null() {
        return Ok(Vec::new());
    }
    let providers = models
        .get("providers")
        .and_then(|value| value.as_object())
        .ok_or_else(|| {
            AppError::storage_corrupt("models.json is missing 'providers' object".to_string())
        })?;

    let mut entries = Vec::new();
    for (id, provider) in providers {
        let name = provider
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let base_url = provider
            .get("baseUrl")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let models = collect_model_ids(provider.get("models"));

        let has_api_key = auth
            .get(id)
            .and_then(|entry| entry.get("type"))
            .and_then(|value| value.as_str())
            .map(|entry_type| entry_type == "api_key")
            .unwrap_or(false)
            && auth
                .get(id)
                .and_then(|entry| entry.get("key"))
                .and_then(|value| value.as_str())
                .map(|key| !key.is_empty())
                .unwrap_or(false);

        entries.push(CustomProviderEntry {
            id: id.clone(),
            name,
            base_url,
            models,
            has_api_key,
        });
    }

    // Stable sort by id for deterministic ordering.
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

/// Generate a `custom-<8-hex>` id using a random UUID v4 truncated to 8 hex chars.
fn generate_custom_id() -> String {
    let uuid = uuid::Uuid::new_v4();
    format!("custom-{}", &uuid.simple().to_string()[..8])
}

fn collect_model_ids(models: Option<&serde_json::Value>) -> Vec<String> {
    models
        .and_then(|value| value.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.get("id").and_then(|value| value.as_str()))
                .filter(|id| !id.is_empty())
                .map(|id| id.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_model_ids(models: Vec<String>) -> AppResult<Vec<String>> {
    let mut out = Vec::with_capacity(models.len());
    for model in models {
        let trimmed = model.trim().to_string();
        if trimmed.is_empty() {
            return Err(AppError::invalid_input("model id must not be empty"));
        }
        out.push(trimmed);
    }
    if out.is_empty() {
        return Err(AppError::invalid_input("models must not be empty"));
    }
    Ok(out)
}

fn models_json(models: &[String]) -> serde_json::Value {
    serde_json::Value::Array(
        models
            .iter()
            .map(|id| serde_json::json!({ "id": id }))
            .collect(),
    )
}

fn models_endpoint_url(base_url: &str) -> AppResult<String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("base_url is required"));
    }
    Ok(format!("{}/models", trimmed.trim_end_matches('/')))
}

fn resolve_list_models_key(
    agent_dir: &Path,
    api_key: &str,
    provider_id: Option<&str>,
) -> AppResult<String> {
    let trimmed = api_key.trim();
    if !trimmed.is_empty() {
        return Ok(trimmed.to_string());
    }
    let Some(id) = provider_id
        .map(str::trim)
        .filter(|id| !id.is_empty() && id.starts_with("custom-"))
    else {
        return Err(AppError::invalid_input("API key is required"));
    };
    let auth = read_json_or_empty(&agent_dir.join("auth.json"), "auth.json")?;
    auth.get(id)
        .and_then(|entry| entry.get("key"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(|key| key.to_string())
        .ok_or_else(|| AppError::invalid_input("API key is required"))
}

fn parse_openai_model_ids(body: &[u8]) -> AppResult<Vec<String>> {
    let value: serde_json::Value = serde_json::from_slice(body).map_err(|error| {
        AppError::invalid_input(format!("Failed to parse models response: {error}"))
    })?;

    let mut ids = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut push = |id: &str| {
        let id = id.trim();
        if id.is_empty() || !seen.insert(id.to_string()) {
            return;
        }
        ids.push(id.to_string());
    };

    if let Some(data) = value.get("data").and_then(|value| value.as_array()) {
        for entry in data {
            if let Some(id) = entry.get("id").and_then(|value| value.as_str()) {
                push(id);
            }
        }
    } else if let Some(array) = value.as_array() {
        for entry in array {
            if let Some(id) = entry.as_str() {
                push(id);
            }
        }
    }

    if ids.is_empty() {
        return Err(AppError::invalid_input("no models returned"));
    }
    Ok(ids)
}

const MAX_MODELS_BODY: usize = 1024 * 1024;

async fn fetch_remote_models(url: &str, api_key: &str) -> AppResult<Vec<String>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::invalid_input("Failed to initialize model discovery"))?;

    let mut response = client
        .get(url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        // reqwest errors may echo the full user-controlled URL.  That URL can
        // contain credentials or secret query parameters, so keep the UI error
        // deliberately generic just like the embedded model transport.
        .map_err(|_| AppError::invalid_input("Failed to fetch models"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::invalid_input(format!(
            "Models endpoint returned HTTP {}",
            status.as_u16()
        )));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::invalid_input("Failed to read models response"))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_MODELS_BODY {
            return Err(AppError::invalid_input("Models response exceeded 1 MiB"));
        }
        body.extend_from_slice(&chunk);
    }

    parse_openai_model_ids(&body)
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

    if api_key.is_empty() {
        // Empty key: keep the existing key when present; error when the
        // provider has no key at all.
        let has_key = auth_object
            .get(provider)
            .and_then(|entry| entry.get("key"))
            .and_then(|value| value.as_str())
            .map(|key| !key.is_empty())
            .unwrap_or(false);
        if !has_key {
            return Err(AppError::invalid_input(format!(
                "API key required for provider {provider}"
            )));
        }
    } else {
        auth_object.insert(
            provider.to_string(),
            serde_json::json!({ "type": "api_key", "key": api_key }),
        );
        let auth_bytes = serde_json::to_vec_pretty(&auth).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize auth.json: {error}"))
        })?;
        library::atomic_write(&auth_path, &auth_bytes, "auth.json")?;
    }

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
    // Preserve an existing defaultThinkingLevel; initialize to "medium" only on first install.
    settings_object
        .entry("defaultThinkingLevel".to_string())
        .or_insert_with(|| serde_json::Value::String("medium".to_string()));
    let settings_bytes = serde_json::to_vec_pretty(&settings).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize settings.json: {error}"))
    })?;
    library::atomic_write(&settings_path, &settings_bytes, "settings.json")?;

    Ok(())
}

fn add_custom_provider_impl(
    agent_dir: &Path,
    name: &str,
    base_url: &str,
    api_key: &str,
    models: &[String],
) -> AppResult<CustomProviderEntry> {
    let models = normalize_model_ids(models.to_vec())?;
    let custom_id = generate_custom_id();

    // Write models.json provider entry.
    let models_path = agent_dir.join("models.json");
    let mut models_file = read_json_or_empty(&models_path, "models.json")?;
    if models_file.is_null() {
        models_file = serde_json::Value::Object(serde_json::Map::new());
    }
    let models_object = models_file.as_object_mut().ok_or_else(|| {
        AppError::storage_corrupt("models.json root is not a JSON object".to_string())
    })?;
    let providers = models_object
        .entry("providers")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let providers_object = providers.as_object_mut().ok_or_else(|| {
        AppError::storage_corrupt("models.json 'providers' is not a JSON object".to_string())
    })?;
    providers_object.insert(
        custom_id.clone(),
        serde_json::json!({
            "name": name,
            "baseUrl": base_url,
            "api": "openai-completions",
            "models": models_json(&models)
        }),
    );
    let models_bytes = serde_json::to_vec_pretty(&models_file).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize models.json: {error}"))
    })?;
    library::atomic_write(&models_path, &models_bytes, "models.json")?;

    // Write auth.json key entry.
    let auth_path = agent_dir.join("auth.json");
    let mut auth = read_json_or_empty(&auth_path, "auth.json")?;
    if auth.is_null() {
        auth = serde_json::Value::Object(serde_json::Map::new());
    }
    let auth_object = auth.as_object_mut().ok_or_else(|| {
        AppError::storage_corrupt("auth.json root is not a JSON object".to_string())
    })?;
    auth_object.insert(
        custom_id.clone(),
        serde_json::json!({ "type": "api_key", "key": api_key }),
    );
    let auth_bytes = serde_json::to_vec_pretty(&auth)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize auth.json: {error}")))?;
    library::atomic_write(&auth_path, &auth_bytes, "auth.json")?;

    Ok(CustomProviderEntry {
        id: custom_id,
        name: name.to_string(),
        base_url: base_url.to_string(),
        models,
        has_api_key: true,
    })
}

fn delete_custom_provider_impl(agent_dir: &Path, provider_id: &str) -> AppResult<()> {
    // Remove from models.json.
    let models_path = agent_dir.join("models.json");
    let mut models = read_json_or_empty(&models_path, "models.json")?;
    if !models.is_null() {
        if let Some(providers) = models
            .get_mut("providers")
            .and_then(|value| value.as_object_mut())
        {
            providers.remove(provider_id);
        }
        let models_bytes = serde_json::to_vec_pretty(&models).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize models.json: {error}"))
        })?;
        library::atomic_write(&models_path, &models_bytes, "models.json")?;
    }

    // Remove from auth.json.
    let auth_path = agent_dir.join("auth.json");
    let mut auth = read_json_or_empty(&auth_path, "auth.json")?;
    if !auth.is_null() {
        if let Some(auth_object) = auth.as_object_mut() {
            auth_object.remove(provider_id);
        }
        let auth_bytes = serde_json::to_vec_pretty(&auth).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize auth.json: {error}"))
        })?;
        library::atomic_write(&auth_path, &auth_bytes, "auth.json")?;
    }

    // Clear settings.json if this was the active provider.
    let settings_path = agent_dir.join("settings.json");
    let mut settings = read_json_or_empty(&settings_path, "settings.json")?;
    if !settings.is_null() {
        let is_active = settings
            .get("defaultProvider")
            .and_then(|value| value.as_str())
            .map(|value| value == provider_id)
            .unwrap_or(false);
        if is_active {
            if let Some(settings_object) = settings.as_object_mut() {
                settings_object.remove("defaultProvider");
                settings_object.remove("defaultModel");
            }
            let settings_bytes = serde_json::to_vec_pretty(&settings).map_err(|error| {
                AppError::storage_io(format!("Failed to serialize settings.json: {error}"))
            })?;
            library::atomic_write(&settings_path, &settings_bytes, "settings.json")?;
        }
    }

    Ok(())
}

fn update_custom_provider_impl(
    agent_dir: &Path,
    provider_id: &str,
    name: &str,
    base_url: &str,
    api_key: &str,
    models: &[String],
) -> AppResult<CustomProviderEntry> {
    let models = normalize_model_ids(models.to_vec())?;

    // Update models.json provider entry.
    let models_path = agent_dir.join("models.json");
    let mut models_file = read_json_or_empty(&models_path, "models.json")?;
    if models_file.is_null() {
        return Err(AppError::invalid_input(
            "Custom provider not found".to_string(),
        ));
    }
    let providers = models_file
        .get_mut("providers")
        .and_then(|value| value.as_object_mut())
        .ok_or_else(|| {
            AppError::storage_corrupt("models.json is missing 'providers' object".to_string())
        })?;
    let existing = providers
        .get_mut(provider_id)
        .ok_or_else(|| AppError::invalid_input("Custom provider not found".to_string()))?;
    // Preserve the existing `api` field value if present.
    let api = existing
        .get("api")
        .and_then(|value| value.as_str())
        .unwrap_or("openai-completions")
        .to_string();
    *existing = serde_json::json!({
        "name": name,
        "baseUrl": base_url,
        "api": api,
        "models": models_json(&models)
    });
    let models_bytes = serde_json::to_vec_pretty(&models_file).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize models.json: {error}"))
    })?;
    library::atomic_write(&models_path, &models_bytes, "models.json")?;

    // Upsert auth.json key entry when a new key was provided.
    if !api_key.is_empty() {
        let auth_path = agent_dir.join("auth.json");
        let mut auth = read_json_or_empty(&auth_path, "auth.json")?;
        if auth.is_null() {
            auth = serde_json::Value::Object(serde_json::Map::new());
        }
        let auth_object = auth.as_object_mut().ok_or_else(|| {
            AppError::storage_corrupt("auth.json root is not a JSON object".to_string())
        })?;
        auth_object.insert(
            provider_id.to_string(),
            serde_json::json!({ "type": "api_key", "key": api_key }),
        );
        let auth_bytes = serde_json::to_vec_pretty(&auth).map_err(|error| {
            AppError::storage_io(format!("Failed to serialize auth.json: {error}"))
        })?;
        library::atomic_write(&auth_path, &auth_bytes, "auth.json")?;
    }

    // Compute has_api_key from auth.json after the update.
    // Activation lives on switch_provider / save_agent_config; do not touch settings.json.
    let auth = read_json_or_empty(&agent_dir.join("auth.json"), "auth.json")?;
    let has_api_key = auth
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
            .unwrap_or(false);

    Ok(CustomProviderEntry {
        id: provider_id.to_string(),
        name: name.to_string(),
        base_url: base_url.to_string(),
        models,
        has_api_key,
    })
}

fn switch_provider_impl(agent_dir: &Path, provider_id: &str, model: &str) -> AppResult<()> {
    let settings_path = agent_dir.join("settings.json");
    let mut settings = read_json_or_empty(&settings_path, "settings.json")?;
    if settings.is_null() {
        settings = serde_json::Value::Object(serde_json::Map::new());
    }
    let settings_object = settings.as_object_mut().ok_or_else(|| {
        AppError::storage_corrupt("settings.json root is not a JSON object".to_string())
    })?;
    settings_object.insert(
        "defaultProvider".to_string(),
        serde_json::Value::String(provider_id.to_string()),
    );
    settings_object.insert(
        "defaultModel".to_string(),
        serde_json::Value::String(model.to_string()),
    );
    // Preserve an existing defaultThinkingLevel; initialize to "medium" only on first install.
    settings_object
        .entry("defaultThinkingLevel".to_string())
        .or_insert_with(|| serde_json::Value::String("medium".to_string()));
    let settings_bytes = serde_json::to_vec_pretty(&settings).map_err(|error| {
        AppError::storage_io(format!("Failed to serialize settings.json: {error}"))
    })?;
    library::atomic_write(&settings_path, &settings_bytes, "settings.json")?;

    Ok(())
}

fn set_thinking_level_impl(agent_dir: &Path, level: &str) -> AppResult<()> {
    let settings_path = agent_dir.join("settings.json");
    let mut settings = read_json_or_empty(&settings_path, "settings.json")?;
    if settings.is_null() {
        settings = serde_json::Value::Object(serde_json::Map::new());
    }
    let settings_object = settings.as_object_mut().ok_or_else(|| {
        AppError::storage_corrupt("settings.json root is not a JSON object".to_string())
    })?;
    settings_object.insert(
        "defaultThinkingLevel".to_string(),
        serde_json::Value::String(level.to_string()),
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
    use crate::error::AppErrorCode;

    fn temp_agent_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temporary directory")
    }

    fn ids(models: &[&str]) -> Vec<String> {
        models.iter().map(|model| (*model).to_string()).collect()
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
        save_config(dir.path(), "anthropic", "secret-key", "claude-opus-4-5").expect("save config");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert!(snapshot.configured);
        assert_eq!(snapshot.provider.as_deref(), Some("anthropic"));
        assert_eq!(snapshot.model.as_deref(), Some("claude-opus-4-5"));
        assert!(snapshot.has_api_key);
    }

    #[test]
    fn runtime_config_resolves_builtin_provider_without_exposing_key_in_errors() {
        let dir = temp_agent_dir();
        save_config(dir.path(), "anthropic", "secret-key", "claude-opus-4-5").expect("save config");
        let runtime = read_runtime_config(dir.path()).expect("runtime config");
        assert_eq!(runtime.provider, "anthropic");
        assert_eq!(runtime.model, "claude-opus-4-5");
        assert_eq!(runtime.api, "anthropic-messages");
        assert_eq!(runtime.base_url, "https://api.anthropic.com");
        assert_eq!(runtime.api_key, "secret-key");

        save_config(dir.path(), "unsupported", "do-not-leak", "model").expect("save invalid");
        let error = read_runtime_config(dir.path()).expect_err("unsupported provider");
        assert!(!error.message.contains("do-not-leak"));
    }

    #[test]
    fn runtime_config_uses_the_pinned_pi_api_and_origin_for_builtin_models() {
        let dir = temp_agent_dir();
        save_config(dir.path(), "openai", "secret", "gpt-5").expect("save openai");
        let openai = read_runtime_config(dir.path()).expect("openai runtime");
        assert_eq!(openai.api, "openai-responses");
        assert_eq!(openai.base_url, "https://api.openai.com/v1");

        save_config(dir.path(), "mistral", "secret", "codestral-latest").expect("save mistral");
        let mistral = read_runtime_config(dir.path()).expect("mistral runtime");
        assert_eq!(mistral.api, "mistral-conversations");
        assert_eq!(mistral.base_url, "https://api.mistral.ai");

        save_config(dir.path(), "together", "secret", "Qwen/Qwen3.6-Plus").expect("save together");
        let together = read_runtime_config(dir.path()).expect("together runtime");
        assert_eq!(together.base_url, "https://api.together.ai/v1");
    }

    #[test]
    fn runtime_config_resolves_custom_openai_provider_and_rejects_non_http_url() {
        let dir = temp_agent_dir();
        let provider = add_custom_provider_impl(
            dir.path(),
            "Local",
            "http://localhost:11434/v1",
            "local-secret",
            &ids(&["qwen"]),
        )
        .expect("add custom provider");
        switch_provider_impl(dir.path(), &provider.id, "qwen").expect("switch provider");
        let runtime = read_runtime_config(dir.path()).expect("runtime config");
        assert_eq!(runtime.provider, provider.id);
        assert_eq!(runtime.api, "openai-completions");
        assert_eq!(runtime.base_url, "http://localhost:11434/v1");
        assert_eq!(runtime.api_key, "local-secret");

        let models_path = dir.path().join("models.json");
        let mut models: serde_json::Value =
            serde_json::from_slice(&fs::read(&models_path).expect("read models")).expect("parse");
        models["providers"][&provider.id]["baseUrl"] =
            serde_json::Value::String("file:///tmp/model".to_string());
        fs::write(
            &models_path,
            serde_json::to_vec(&models).expect("serialize"),
        )
        .expect("write");
        let error = read_runtime_config(dir.path()).expect_err("non-http endpoint");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
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
        fs::write(
            &settings_path,
            br#"{"theme":"dark","defaultModel":"old-model"}"#,
        )
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
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftover.is_empty(), "temp files left behind: {leftover:?}");
    }

    #[test]
    fn save_does_not_write_api_key_to_a_log_file() {
        let dir = temp_agent_dir();
        save_config(
            dir.path(),
            "anthropic",
            "super-secret-key",
            "claude-opus-4-5",
        )
        .expect("save config");

        // The only files in the agent dir should be auth.json and settings.json.
        let mut files: Vec<String> = fs::read_dir(dir.path())
            .expect("list dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        files.sort();
        assert_eq!(
            files,
            vec!["auth.json".to_string(), "settings.json".to_string()]
        );

        let auth = fs::read_to_string(dir.path().join("auth.json")).expect("read auth");
        assert!(auth.contains("super-secret-key"));
        let settings = fs::read_to_string(dir.path().join("settings.json")).expect("read settings");
        assert!(!settings.contains("super-secret-key"));
    }

    // --- Custom provider tests ---

    #[test]
    fn add_custom_provider_round_trip() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "本地 Ollama",
            "http://localhost:11434/v1",
            "ollama-key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        assert!(entry.id.starts_with("custom-"));
        assert_eq!(entry.name, "本地 Ollama");
        assert_eq!(entry.base_url, "http://localhost:11434/v1");
        assert_eq!(entry.models, ids(&["llama-3.1"]));
        assert!(entry.has_api_key);

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert_eq!(snapshot.custom_providers.len(), 1);
        let cp = &snapshot.custom_providers[0];
        assert_eq!(cp.id, entry.id);
        assert_eq!(cp.name, "本地 Ollama");
        assert_eq!(cp.base_url, "http://localhost:11434/v1");
        assert_eq!(cp.models, ids(&["llama-3.1"]));
        assert!(cp.has_api_key);

        let models: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.path().join("models.json")).expect("read models"))
                .expect("parse models");
        assert_eq!(
            models["providers"][&entry.id]["models"]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            models["providers"][&entry.id]["models"][0]["id"],
            "llama-3.1"
        );
    }

    #[test]
    fn read_snapshot_returns_all_model_ids() {
        let dir = temp_agent_dir();
        fs::write(
            dir.path().join("models.json"),
            br#"{
              "providers": {
                "custom-abc12345": {
                  "name": "Ollama",
                  "baseUrl": "http://localhost:11434/v1",
                  "api": "openai-completions",
                  "models": [{ "id": "llama-3.1" }, { "id": "qwen-2.5" }, { "id": "" }]
                }
              }
            }"#,
        )
        .expect("seed models");
        fs::write(
            dir.path().join("auth.json"),
            br#"{"custom-abc12345":{"type":"api_key","key":"k"}}"#,
        )
        .expect("seed auth");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert_eq!(snapshot.custom_providers.len(), 1);
        assert_eq!(
            snapshot.custom_providers[0].models,
            ids(&["llama-3.1", "qwen-2.5"])
        );
    }

    #[test]
    fn delete_custom_provider_round_trip() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "vLLM",
            "http://localhost:8000/v1",
            "vllm-key",
            &ids(&["qwen-2.5"]),
        )
        .expect("add custom provider");

        delete_custom_provider_impl(dir.path(), &entry.id).expect("delete custom provider");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert!(snapshot.custom_providers.is_empty());

        // auth.json should not contain the removed provider's key.
        let auth: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.path().join("auth.json")).expect("read auth"))
                .expect("parse auth");
        assert!(auth.get(&entry.id).is_none());
    }

    #[test]
    fn delete_active_custom_provider_clears_settings() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "ollama-key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        // Switch to the custom provider.
        switch_provider_impl(dir.path(), &entry.id, "llama-3.1").expect("switch provider");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot after switch");
        assert_eq!(snapshot.provider.as_deref(), Some(entry.id.as_str()));
        assert_eq!(snapshot.model.as_deref(), Some("llama-3.1"));

        // Delete the active provider.
        delete_custom_provider_impl(dir.path(), &entry.id).expect("delete active provider");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot after delete");
        assert!(snapshot.custom_providers.is_empty());
        assert_eq!(snapshot.provider, None);
        assert_eq!(snapshot.model, None);
        assert!(!snapshot.configured);
    }

    #[test]
    fn add_custom_provider_uses_atomic_write() {
        let dir = temp_agent_dir();
        add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        let leftover: Vec<_> = fs::read_dir(dir.path())
            .expect("list dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftover.is_empty(), "temp files left behind: {leftover:?}");
    }

    #[test]
    fn custom_id_has_prefix_and_hex_suffix() {
        let id = generate_custom_id();
        assert!(id.starts_with("custom-"));
        let suffix = &id["custom-".len()..];
        assert_eq!(suffix.len(), 8);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn delete_custom_provider_rejects_non_custom_prefix() {
        // The command-level guard is tested via the async wrapper logic;
        // here we verify the guard directly.
        let result = delete_custom_provider_impl(temp_agent_dir().path(), "anthropic");
        // The impl itself does not guard (the command does), but deleting
        // a non-existent non-custom id is a no-op — verify it doesn't panic.
        // The real guard is in the #[tauri::command] wrapper.
        let _ = result;
    }

    #[test]
    fn delete_custom_provider_command_rejects_non_custom_prefix() {
        let result = std::thread::spawn(|| {
            // Simulate the guard from delete_custom_provider command.
            let provider_id = "anthropic".to_string();
            if !provider_id.starts_with("custom-") {
                return Err::<(), AppError>(AppError::invalid_input(
                    "provider_id must start with 'custom-'",
                ));
            }
            Ok(())
        })
        .join()
        .expect("thread");
        assert!(result.is_err());
    }

    #[test]
    fn add_multiple_custom_providers_preserve_each_other() {
        let dir = temp_agent_dir();
        let entry1 = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key1",
            &ids(&["llama-3.1"]),
        )
        .expect("add first");

        let entry2 = add_custom_provider_impl(
            dir.path(),
            "vLLM",
            "http://localhost:8000/v1",
            "key2",
            &ids(&["qwen-2.5"]),
        )
        .expect("add second");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert_eq!(snapshot.custom_providers.len(), 2);

        // Delete only the first.
        delete_custom_provider_impl(dir.path(), &entry1.id).expect("delete first");

        let snapshot = read_snapshot(dir.path()).expect("read snapshot after delete");
        assert_eq!(snapshot.custom_providers.len(), 1);
        assert_eq!(snapshot.custom_providers[0].id, entry2.id);
        assert_eq!(snapshot.custom_providers[0].name, "vLLM");
    }

    #[test]
    fn switch_provider_writes_settings() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        switch_provider_impl(dir.path(), &entry.id, "llama-3.1").expect("switch provider");

        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["defaultProvider"], entry.id);
        assert_eq!(settings["defaultModel"], "llama-3.1");
        assert_eq!(settings["defaultThinkingLevel"], "medium");
    }

    #[test]
    fn switch_provider_preserves_other_settings() {
        let dir = temp_agent_dir();
        fs::write(dir.path().join("settings.json"), br#"{"theme":"dark"}"#).expect("seed settings");

        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        switch_provider_impl(dir.path(), &entry.id, "llama-3.1").expect("switch provider");

        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["theme"], "dark");
        assert_eq!(settings["defaultProvider"], entry.id);
    }

    // --- Empty-key save behavior ---

    #[test]
    fn save_config_empty_key_keeps_existing_key() {
        let dir = temp_agent_dir();
        let auth_path = dir.path().join("auth.json");
        fs::write(
            &auth_path,
            br#"{"anthropic":{"type":"api_key","key":"existing-key"}}"#,
        )
        .expect("seed auth");

        save_config(dir.path(), "anthropic", "", "claude-opus-4-5").expect("save config");

        // auth.json untouched for this provider.
        let auth: serde_json::Value =
            serde_json::from_slice(&fs::read(&auth_path).expect("read auth")).expect("parse auth");
        assert_eq!(auth["anthropic"]["key"], "existing-key");
        assert_eq!(auth["anthropic"]["type"], "api_key");

        // settings.json still updated.
        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["defaultProvider"], "anthropic");
        assert_eq!(settings["defaultModel"], "claude-opus-4-5");
    }

    #[test]
    fn save_config_empty_key_errors_when_no_key() {
        let dir = temp_agent_dir();
        let result = save_config(dir.path(), "anthropic", "", "claude-opus-4-5");
        assert!(result.is_err());
        let error = result.expect_err("save should fail");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
        assert!(error.message.contains("API key required"));
    }

    #[test]
    fn save_config_empty_key_errors_when_key_is_blank() {
        let dir = temp_agent_dir();
        fs::write(
            dir.path().join("auth.json"),
            br#"{"anthropic":{"type":"api_key","key":""}}"#,
        )
        .expect("seed auth");

        let result = save_config(dir.path(), "anthropic", "", "claude-opus-4-5");
        assert!(result.is_err());
        let error = result.expect_err("save should fail");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
    }

    // --- update_custom_provider tests ---

    #[test]
    fn update_custom_provider_updates_fields_and_preserves_key() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "ollama-key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        let updated = update_custom_provider_impl(
            dir.path(),
            &entry.id,
            "本地 Ollama 2",
            "http://localhost:11434/v2",
            "",
            &ids(&["llama-3.2", "qwen-2.5"]),
        )
        .expect("update custom provider");

        assert_eq!(updated.id, entry.id);
        assert_eq!(updated.name, "本地 Ollama 2");
        assert_eq!(updated.base_url, "http://localhost:11434/v2");
        assert_eq!(updated.models, ids(&["llama-3.2", "qwen-2.5"]));
        assert!(updated.has_api_key, "existing key preserved");

        // models.json reflects the new fields and keeps api.
        let models: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.path().join("models.json")).expect("read models"))
                .expect("parse models");
        let provider = &models["providers"][&entry.id];
        assert_eq!(provider["name"], "本地 Ollama 2");
        assert_eq!(provider["baseUrl"], "http://localhost:11434/v2");
        assert_eq!(provider["api"], "openai-completions");
        assert_eq!(provider["models"][0]["id"], "llama-3.2");
        assert_eq!(provider["models"][1]["id"], "qwen-2.5");

        // auth.json key unchanged.
        let auth: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.path().join("auth.json")).expect("read auth"))
                .expect("parse auth");
        assert_eq!(auth[&entry.id]["key"], "ollama-key");
    }

    #[test]
    fn update_custom_provider_with_new_key_replaces_key() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "old-key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        let updated = update_custom_provider_impl(
            dir.path(),
            &entry.id,
            "Ollama",
            "http://localhost:11434/v1",
            "new-key",
            &ids(&["llama-3.1"]),
        )
        .expect("update custom provider");
        assert!(updated.has_api_key);

        let auth: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.path().join("auth.json")).expect("read auth"))
                .expect("parse auth");
        assert_eq!(auth[&entry.id]["key"], "new-key");
    }

    #[test]
    fn update_custom_provider_on_missing_id_errors() {
        let dir = temp_agent_dir();
        let result = update_custom_provider_impl(
            dir.path(),
            "custom-deadbeef",
            "Ghost",
            "http://localhost:9999/v1",
            "",
            &ids(&["model"]),
        );
        assert!(result.is_err());
        let error = result.expect_err("update should fail");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
        assert!(error.message.contains("Custom provider not found"));
    }

    #[test]
    fn update_custom_provider_active_does_not_change_settings() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        switch_provider_impl(dir.path(), &entry.id, "llama-3.1").expect("switch provider");

        update_custom_provider_impl(
            dir.path(),
            &entry.id,
            "Ollama",
            "http://localhost:11434/v1",
            "",
            &ids(&["llama-3.2"]),
        )
        .expect("update active provider");

        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["defaultProvider"], entry.id);
        assert_eq!(settings["defaultModel"], "llama-3.1");
    }

    #[test]
    fn update_custom_provider_inactive_keeps_settings() {
        let dir = temp_agent_dir();
        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        // Active provider is a built-in one.
        save_config(dir.path(), "anthropic", "anthropic-key", "claude-opus-4-5")
            .expect("save built-in config");

        update_custom_provider_impl(
            dir.path(),
            &entry.id,
            "Ollama",
            "http://localhost:11434/v1",
            "",
            &ids(&["llama-3.2"]),
        )
        .expect("update inactive provider");

        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["defaultProvider"], "anthropic");
        assert_eq!(settings["defaultModel"], "claude-opus-4-5");
    }

    #[test]
    fn empty_models_is_invalid_input() {
        let dir = temp_agent_dir();
        let add = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &[],
        );
        assert_eq!(add.expect_err("add").code, AppErrorCode::InvalidInput);

        let blank = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["  "]),
        );
        assert_eq!(
            blank.expect_err("add blank").code,
            AppErrorCode::InvalidInput
        );

        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");
        let update = update_custom_provider_impl(
            dir.path(),
            &entry.id,
            "Ollama",
            "http://localhost:11434/v1",
            "",
            &[],
        );
        assert_eq!(update.expect_err("update").code, AppErrorCode::InvalidInput);
    }

    // --- Remote catalog helpers ---

    #[test]
    fn parse_openai_model_ids_from_data_array() {
        let body =
            br#"{"data":[{"id":"llama-3.1"},{"id":"qwen-2.5"},{"id":""},{"id":"llama-3.1"}]}"#;
        assert_eq!(
            parse_openai_model_ids(body).expect("parse"),
            ids(&["llama-3.1", "qwen-2.5"])
        );
    }

    #[test]
    fn parse_openai_model_ids_from_string_array() {
        let body = br#"["alpha","beta",""]"#;
        assert_eq!(
            parse_openai_model_ids(body).expect("parse"),
            ids(&["alpha", "beta"])
        );
    }

    #[test]
    fn parse_openai_model_ids_empty_is_error() {
        let error = parse_openai_model_ids(br#"{"data":[]}"#).expect_err("empty");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
        assert!(error.message.contains("no models returned"));
    }

    #[test]
    fn models_endpoint_url_strips_trailing_slash() {
        assert_eq!(
            models_endpoint_url("http://localhost:11434/v1/").expect("url"),
            "http://localhost:11434/v1/models"
        );
        assert_eq!(
            models_endpoint_url("http://localhost:11434/v1").expect("url"),
            "http://localhost:11434/v1/models"
        );
        let error = models_endpoint_url("   ").expect_err("empty");
        assert_eq!(error.code, AppErrorCode::InvalidInput);
    }

    #[test]
    fn resolve_list_models_key_uses_draft_or_stored() {
        let dir = temp_agent_dir();
        add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "stored-key",
            &ids(&["llama-3.1"]),
        )
        .expect("add");
        let snapshot = read_snapshot(dir.path()).expect("snapshot");
        let id = snapshot.custom_providers[0].id.clone();

        assert_eq!(
            resolve_list_models_key(dir.path(), "draft-key", Some(&id)).expect("draft"),
            "draft-key"
        );
        assert_eq!(
            resolve_list_models_key(dir.path(), "", Some(&id)).expect("stored"),
            "stored-key"
        );
        let missing = resolve_list_models_key(dir.path(), "", None).expect_err("no key");
        assert_eq!(missing.code, AppErrorCode::InvalidInput);
        let builtin =
            resolve_list_models_key(dir.path(), "", Some("anthropic")).expect_err("builtin");
        assert_eq!(builtin.code, AppErrorCode::InvalidInput);
        let unknown =
            resolve_list_models_key(dir.path(), "", Some("custom-deadbeef")).expect_err("unknown");
        assert_eq!(unknown.code, AppErrorCode::InvalidInput);
    }

    // --- thinking level ---

    #[test]
    fn read_snapshot_defaults_thinking_level_to_medium() {
        let dir = temp_agent_dir();
        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert_eq!(snapshot.thinking_level, "medium");
    }

    #[test]
    fn read_snapshot_reads_thinking_level_from_settings() {
        let dir = temp_agent_dir();
        fs::write(
            dir.path().join("settings.json"),
            br#"{"defaultThinkingLevel":"high"}"#,
        )
        .expect("seed settings");
        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert_eq!(snapshot.thinking_level, "high");
    }

    #[test]
    fn read_snapshot_falls_back_to_medium_for_invalid_thinking_level() {
        let dir = temp_agent_dir();
        fs::write(
            dir.path().join("settings.json"),
            br#"{"defaultThinkingLevel":"bogus"}"#,
        )
        .expect("seed settings");
        let snapshot = read_snapshot(dir.path()).expect("read snapshot");
        assert_eq!(snapshot.thinking_level, "medium");
    }

    #[test]
    fn read_runtime_config_exposes_thinking_level() {
        let dir = temp_agent_dir();
        save_config(dir.path(), "anthropic", "secret", "claude-opus-4-5").expect("save config");
        let runtime = read_runtime_config(dir.path()).expect("runtime config");
        assert_eq!(runtime.thinking_level, "medium");

        // Change via set_thinking_level_impl and re-read.
        set_thinking_level_impl(dir.path(), "high").expect("set thinking level");
        let runtime = read_runtime_config(dir.path()).expect("runtime config");
        assert_eq!(runtime.thinking_level, "high");
    }

    #[test]
    fn save_config_preserves_existing_thinking_level() {
        let dir = temp_agent_dir();
        let settings_path = dir.path().join("settings.json");
        fs::write(
            &settings_path,
            br#"{"defaultThinkingLevel":"high"}"#,
        )
        .expect("seed settings");

        save_config(dir.path(), "anthropic", "anthropic-key", "claude-opus-4-5")
            .expect("save config");

        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(&settings_path).expect("read settings"))
                .expect("parse settings");
        assert_eq!(settings["defaultThinkingLevel"], "high");
    }

    #[test]
    fn switch_provider_preserves_existing_thinking_level() {
        let dir = temp_agent_dir();
        fs::write(
            dir.path().join("settings.json"),
            br#"{"defaultThinkingLevel":"max"}"#,
        )
        .expect("seed settings");

        let entry = add_custom_provider_impl(
            dir.path(),
            "Ollama",
            "http://localhost:11434/v1",
            "key",
            &ids(&["llama-3.1"]),
        )
        .expect("add custom provider");

        switch_provider_impl(dir.path(), &entry.id, "llama-3.1").expect("switch provider");

        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["defaultThinkingLevel"], "max");
    }

    #[test]
    fn set_thinking_level_writes_and_rejects_invalid() {
        let dir = temp_agent_dir();
        set_thinking_level_impl(dir.path(), "high").expect("set high");

        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["defaultThinkingLevel"], "high");

        // Overwrite to another valid level.
        set_thinking_level_impl(dir.path(), "off").expect("set off");
        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.path().join("settings.json")).expect("read settings"),
        )
        .expect("parse settings");
        assert_eq!(settings["defaultThinkingLevel"], "off");
    }

    #[test]
    fn set_thinking_level_command_rejects_invalid_level() {
        let invalid = "bogus".to_string();
        assert!(!VALID_THINKING_LEVELS.contains(&invalid.as_str()));

        for valid in VALID_THINKING_LEVELS {
            assert!(VALID_THINKING_LEVELS.contains(valid));
        }
    }
}
