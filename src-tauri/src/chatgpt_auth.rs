//! Sign in with ChatGPT: lets the assistant run on the user's ChatGPT plan.
//!
//! OAuth authorization-code flow with PKCE against auth.openai.com, a loopback
//! callback on 127.0.0.1, and a public client (no secret). The first sign-in
//! registers a client through `dynamic_agent_client`; OpenAI returns the issued
//! client id in the callback and every later sign-in or refresh reuses it.
//!
//! Credentials live in agent/auth.json under the `chatgpt` key, which never
//! leaves the device (Sync only mirrors settings.json and models.json). The host
//! id identifying this installation lives in its own file so signing out keeps
//! it stable. The access token is handed to pi-ai as the `openai` provider's
//! API key; pi-ai recognises a non-`sk-` key against api.openai.com as a
//! ChatGPT sign-in and drops the request fields that flow rejects.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::library;

pub const PROVIDER_ID: &str = "chatgpt";
pub const API_BASE_URL: &str = "https://api.openai.com/v1";

const ISSUER: &str = "https://auth.openai.com";
const AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const OPENID_CONFIGURATION_URL: &str = "https://auth.openai.com/.well-known/openid-configuration";
const MODELS_URL: &str = "https://api.openai.com/v1/models";
const DYNAMIC_CLIENT_ID: &str = "dynamic_agent_client";
const AGENT_NAME_HINT: &str = "Litera";
const DIRECT_SCOPE: &str = "chatgpt.tokens.use.direct";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const CALLBACK_PORT: u16 = 1455;
const CALLBACK_PATH: &str = "/auth/callback";
const HOST_ID_FILE: &str = "chatgpt-host-id";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
/// Refresh this long before expiry so a request never starts with a token about to lapse.
const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;
/// Refresh-grant error codes after which the saved tokens can never work again.
const UNUSABLE_REFRESH_ERRORS: &[&str] = &["invalid_grant", "token_expired", "refresh_token_reused"];

/// Cancels the pending sign-in when fired or dropped; one sign-in at a time.
/// Tagged with an attempt number so a finished attempt only clears its own slot.
static PENDING_LOGIN: Mutex<Option<(u64, oneshot::Sender<()>)>> = Mutex::new(None);
static LOGIN_ATTEMPTS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Refresh tokens rotate on use, so concurrent refreshes would burn each other.
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Signed-in account shown in the settings dialog. Tokens never cross IPC here.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptAccount {
    pub email: Option<String>,
    /// Model slugs the plan offers, as listed at sign-in; empty when unknown.
    pub models: Vec<String>,
}

#[tauri::command]
pub async fn chatgpt_login(app: tauri::AppHandle) -> AppResult<ChatgptAccount> {
    let agent_dir = crate::agent_config::resolve_agent_dir(&app)?;
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let attempt = LOGIN_ATTEMPTS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let previous = PENDING_LOGIN.lock().unwrap().replace((attempt, cancel_tx));
    if let Some((_, previous)) = previous {
        let _ = previous.send(());
    }
    let result = login(&app, &agent_dir, cancel_rx).await;
    let mut pending = PENDING_LOGIN.lock().unwrap();
    if pending.as_ref().is_some_and(|(id, _)| *id == attempt) {
        pending.take();
    }
    result
}

#[tauri::command]
pub fn chatgpt_cancel_login() {
    let pending = PENDING_LOGIN.lock().unwrap().take();
    if let Some((_, pending)) = pending {
        let _ = pending.send(());
    }
}

#[tauri::command]
pub async fn chatgpt_logout(app: tauri::AppHandle) -> AppResult<()> {
    let agent_dir = crate::agent_config::resolve_agent_dir(&app)?;
    let _guard = REFRESH_LOCK.lock().await;
    let auth = read_auth(&agent_dir)?;
    let entry = auth.get(PROVIDER_ID);
    let refresh = entry.and_then(|entry| string_field(entry, "refresh"));
    let client_id = entry.and_then(|entry| string_field(entry, "clientId"));
    if let (Some(refresh), Some(client_id)) = (refresh, client_id) {
        // Best effort: signing out must still clear the device when offline.
        let _ = revoke(&refresh, &client_id).await;
    }
    update_entry(&agent_dir, |entry| {
        *entry = None;
        Ok(())
    })
}

/// Refreshes the saved access token when it is close to expiry.
pub async fn ensure_fresh_token(agent_dir: &Path) -> AppResult<()> {
    let _guard = REFRESH_LOCK.lock().await;
    let auth = read_auth(agent_dir)?;
    let Some(entry) = auth.get(PROVIDER_ID) else {
        return Err(not_signed_in());
    };
    let (Some(refresh), Some(client_id)) = (string_field(entry, "refresh"), string_field(entry, "clientId")) else {
        return Err(not_signed_in());
    };
    let expires = entry.get("expires").and_then(Value::as_i64).unwrap_or(0);
    if !needs_refresh(expires, now_ms()) {
        return Ok(());
    }
    let response = post_token(&[
        ("grant_type", "refresh_token"),
        ("client_id", &client_id),
        ("refresh_token", &refresh),
        ("resource", API_BASE_URL),
    ])
    .await;
    let token = match response {
        Ok(token) => token,
        Err(TokenError::Rejected(code)) if UNUSABLE_REFRESH_ERRORS.contains(&code.as_str()) => {
            // Keep the client id and ID token so signing in again is the returning flow.
            update_entry(agent_dir, |entry| {
                if let Some(Value::Object(object)) = entry {
                    object.remove("access");
                    object.remove("refresh");
                    object.remove("expires");
                }
                Ok(())
            })?;
            return Err(AppError::invalid_input(
                "ChatGPT sign-in has expired. Sign in with ChatGPT again.",
            ));
        }
        Err(error) => return Err(error.into_app_error()),
    };
    let previous_scopes = entry.get("scopes").cloned().unwrap_or(Value::Array(Vec::new()));
    let credential = refreshed_credential(&token, previous_scopes, now_ms())?;
    update_entry(agent_dir, |entry| {
        let Some(Value::Object(object)) = entry else {
            return Err(not_signed_in());
        };
        for (key, value) in credential {
            object.insert(key, value);
        }
        Ok(())
    })
}

/// The saved access token, or an error when the user is not signed in.
pub fn access_token(auth: &Value) -> AppResult<String> {
    auth.get(PROVIDER_ID)
        .and_then(|entry| string_field(entry, "access"))
        .ok_or_else(not_signed_in)
}

/// The signed-in account, or `None` when there are no usable tokens.
pub fn account(auth: &Value) -> Option<ChatgptAccount> {
    let entry = auth.get(PROVIDER_ID)?;
    string_field(entry, "refresh")?;
    Some(ChatgptAccount {
        email: string_field(entry, "email"),
        models: entry
            .get("models")
            .and_then(Value::as_array)
            .map(|models| models.iter().filter_map(|id| id.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
    })
}

async fn login(
    app: &tauri::AppHandle,
    agent_dir: &Path,
    cancel: oneshot::Receiver<()>,
) -> AppResult<ChatgptAccount> {
    let host_id = load_or_create_host_id(agent_dir)?;
    let auth = read_auth(agent_dir)?;
    let previous = auth.get(PROVIDER_ID);
    let returning_client = previous.and_then(|entry| string_field(entry, "clientId"));
    let id_token_hint = previous.and_then(|entry| string_field(entry, "idToken"));

    let listener = bind_callback_listener().await?;
    let port = listener
        .local_addr()
        .map_err(|error| AppError::storage_io(format!("Failed to read callback port: {error}")))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let attempt = AuthAttempt::new()?;
    let url = authorize_url(&AuthorizeParams {
        client_id: returning_client.as_deref(),
        redirect_uri: &redirect_uri,
        host_id: &host_id,
        id_token_hint: id_token_hint.as_deref(),
        attempt: &attempt,
    })?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| AppError::invalid_input("Failed to open the browser for ChatGPT sign-in"))?;

    let callback = tokio::select! {
        result = tokio::time::timeout(LOGIN_TIMEOUT, accept_callback(&listener, &attempt.state)) => {
            result.map_err(|_| AppError::cancelled("ChatGPT sign-in timed out"))??
        }
        _ = cancel => return Err(AppError::cancelled("ChatGPT sign-in was cancelled")),
    };
    drop(listener);

    let client_id = callback
        .client_id
        .or(returning_client)
        .ok_or_else(|| AppError::invalid_input("ChatGPT sign-in did not return a client id"))?;
    let token = post_token(&[
        ("grant_type", "authorization_code"),
        ("client_id", &client_id),
        ("code", &callback.code),
        ("code_verifier", &attempt.verifier),
        ("redirect_uri", &redirect_uri),
        ("resource", API_BASE_URL),
    ])
    .await
    .map_err(TokenError::into_app_error)?;
    let mut credential = login_credential(&token, &client_id, &attempt.nonce, now_ms())?;
    // Model discovery is a convenience: the settings form falls back to the catalog.
    let access = credential.get("access").and_then(Value::as_str).unwrap_or_default().to_string();
    let models = fetch_models(&access).await.unwrap_or_default();
    credential.insert("models".to_string(), json!(models));

    let _guard = REFRESH_LOCK.lock().await;
    update_entry(agent_dir, |entry| {
        *entry = Some(Value::Object(credential));
        Ok(())
    })?;
    account(&read_auth(agent_dir)?).ok_or_else(not_signed_in)
}

struct AuthAttempt {
    state: String,
    nonce: String,
    verifier: String,
}

impl AuthAttempt {
    fn new() -> AppResult<Self> {
        Ok(Self { state: random_token()?, nonce: random_token()?, verifier: random_token()? })
    }
}

struct AuthorizeParams<'a> {
    /// Issued client id for a returning sign-in; `None` registers a new client.
    client_id: Option<&'a str>,
    redirect_uri: &'a str,
    host_id: &'a str,
    id_token_hint: Option<&'a str>,
    attempt: &'a AuthAttempt,
}

fn authorize_url(params: &AuthorizeParams) -> AppResult<String> {
    let mut url = reqwest::Url::parse(AUTHORIZE_URL)
        .map_err(|_| AppError::invalid_input("ChatGPT authorize URL is invalid"))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", params.client_id.unwrap_or(DYNAMIC_CLIENT_ID))
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", params.redirect_uri)
            .append_pair("scope", SCOPE)
            .append_pair("resource", API_BASE_URL)
            .append_pair("state", &params.attempt.state)
            .append_pair("nonce", &params.attempt.nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &pkce_challenge(&params.attempt.verifier))
            .append_pair("ext_agent_host_id", params.host_id);
        match params.client_id {
            // The app name hint belongs to registration only.
            None => {
                query.append_pair("agent_name_hint", AGENT_NAME_HINT);
            }
            Some(_) => {
                if let Some(hint) = params.id_token_hint {
                    query.append_pair("id_token_hint", hint);
                }
            }
        }
    }
    Ok(url.into())
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn random_token() -> AppResult<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| AppError::storage_io("Failed to generate random OAuth state"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

async fn bind_callback_listener() -> AppResult<TcpListener> {
    // The registered redirect keeps scheme, host, and path; only the port may vary.
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", CALLBACK_PORT)).await {
        return Ok(listener);
    }
    TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| AppError::storage_io(format!("Failed to start the sign-in callback: {error}")))
}

#[derive(Debug, PartialEq)]
struct CallbackSuccess {
    code: String,
    client_id: Option<String>,
}

#[derive(Debug, PartialEq)]
enum CallbackOutcome {
    /// Not our callback (favicon, wrong path, stale state): keep waiting.
    Ignore,
    Denied(String),
    Success(CallbackSuccess),
}

fn parse_callback(request_target: &str, expected_state: &str) -> CallbackOutcome {
    let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{request_target}")) else {
        return CallbackOutcome::Ignore;
    };
    if url.path() != CALLBACK_PATH {
        return CallbackOutcome::Ignore;
    }
    let param = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    if param("state").as_deref() != Some(expected_state) {
        return CallbackOutcome::Ignore;
    }
    if let Some(error) = param("error") {
        return CallbackOutcome::Denied(error);
    }
    match param("code") {
        Some(code) => CallbackOutcome::Success(CallbackSuccess { code, client_id: param("client_id") }),
        None => CallbackOutcome::Ignore,
    }
}

async fn accept_callback(listener: &TcpListener, expected_state: &str) -> AppResult<CallbackSuccess> {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            continue;
        };
        let Some(target) = read_request_target(&mut stream).await else {
            continue;
        };
        let outcome = parse_callback(&target, expected_state);
        let (status, message) = match &outcome {
            CallbackOutcome::Ignore => ("404 Not Found", "Not found."),
            CallbackOutcome::Denied(_) => ("400 Bad Request", "ChatGPT was not connected. You can close this window."),
            CallbackOutcome::Success(_) => ("200 OK", "Signed in to Litera with ChatGPT. You can close this window."),
        };
        let body = format!(
            "<!doctype html><meta charset=\"utf-8\"><title>Litera</title><p style=\"font-family:sans-serif\">{message}</p>"
        );
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.shutdown().await;
        match outcome {
            CallbackOutcome::Ignore => continue,
            CallbackOutcome::Denied(error) => {
                return Err(AppError::cancelled(format!("ChatGPT sign-in was declined ({error})")))
            }
            CallbackOutcome::Success(success) => return Ok(success),
        }
    }
}

/// Reads the request line of an HTTP request and returns its target.
async fn read_request_target(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let read = async {
        while !buffer.windows(2).any(|window| window == b"\r\n") {
            let count = stream.read(&mut chunk).await.ok()?;
            if count == 0 || buffer.len() > 16 * 1024 {
                return None;
            }
            buffer.extend_from_slice(&chunk[..count]);
        }
        Some(())
    };
    // Browsers open spare connections that never send a request.
    tokio::time::timeout(Duration::from_secs(5), read).await.ok()??;
    let line = String::from_utf8_lossy(&buffer);
    let mut parts = line.lines().next()?.split_whitespace();
    (parts.next()? == "GET").then_some(())?;
    parts.next().map(str::to_string)
}

enum TokenError {
    /// The token endpoint answered with an OAuth error code.
    Rejected(String),
    Failed(String),
}

impl TokenError {
    fn into_app_error(self) -> AppError {
        match self {
            TokenError::Rejected(code) => {
                AppError::invalid_input(format!("ChatGPT token request was rejected ({code})"))
            }
            TokenError::Failed(message) => AppError::invalid_input(message),
        }
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Failed to initialize the HTTP client".to_string())
}

async fn post_token(form: &[(&str, &str)]) -> Result<Value, TokenError> {
    let client = http_client().map_err(TokenError::Failed)?;
    // Never surface reqwest errors or bodies verbatim: they may echo tokens.
    let response = client
        .post(TOKEN_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(form)
        .send()
        .await
        .map_err(|_| TokenError::Failed("Could not reach ChatGPT sign-in. Check your network connection.".to_string()))?;
    let status = response.status();
    let body = response.bytes().await.unwrap_or_default();
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    if status.is_success() && body.is_object() {
        return Ok(body);
    }
    match body.get("error").and_then(Value::as_str) {
        Some(code) => Err(TokenError::Rejected(code.to_string())),
        None => Err(TokenError::Failed(format!(
            "ChatGPT token request failed (HTTP {})",
            status.as_u16()
        ))),
    }
}

async fn revoke(refresh: &str, client_id: &str) -> Result<(), String> {
    let client = http_client()?;
    let configuration = client
        .get(OPENID_CONFIGURATION_URL)
        .send()
        .await
        .map_err(|_| "openid configuration unreachable".to_string())?
        .bytes()
        .await
        .map_err(|_| "openid configuration unreadable".to_string())?;
    let configuration: Value = serde_json::from_slice(&configuration)
        .map_err(|_| "openid configuration unreadable".to_string())?;
    let endpoint = configuration
        .get("revocation_endpoint")
        .and_then(Value::as_str)
        .filter(|endpoint| endpoint.starts_with(ISSUER))
        .ok_or_else(|| "no revocation endpoint".to_string())?;
    client
        .post(endpoint)
        .form(&[("token", refresh), ("token_type_hint", "refresh_token"), ("client_id", client_id)])
        .send()
        .await
        .map_err(|_| "revocation failed".to_string())?;
    Ok(())
}

async fn fetch_models(access: &str) -> AppResult<Vec<String>> {
    let body = crate::agent_config::fetch_models_body(MODELS_URL, access).await?;
    parse_models(&body)
}

/// Lists the plan's model ids: the ChatGPT shape (`models[].slug`, shown when
/// `visibility == "list"`) or the standard `data[].id` shape.
fn parse_models(body: &[u8]) -> AppResult<Vec<String>> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|_| AppError::invalid_input("Models response is not valid JSON"))?;
    let mut ids: Vec<String> = Vec::new();
    if let Some(models) = value.get("models").and_then(Value::as_array) {
        for model in models {
            let visible = model.get("visibility").and_then(Value::as_str).is_none_or(|v| v == "list");
            if let (true, Some(slug)) = (visible, model.get("slug").and_then(Value::as_str)) {
                ids.push(slug.to_string());
            }
        }
    } else if let Some(data) = value.get("data").and_then(Value::as_array) {
        ids.extend(data.iter().filter_map(|model| model.get("id")?.as_str().map(str::to_string)));
    }
    ids.dedup();
    Ok(ids)
}

type Credential = serde_json::Map<String, Value>;

fn token_string(token: &Value, field: &str) -> AppResult<String> {
    string_field(token, field)
        .ok_or_else(|| AppError::invalid_input(format!("ChatGPT token response is missing {field}")))
}

fn expires_at(token: &Value, now: i64) -> AppResult<i64> {
    let seconds = token
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .ok_or_else(|| AppError::invalid_input("ChatGPT token response is missing expires_in"))?;
    Ok(now + seconds * 1000)
}

fn scopes(scope: &str) -> Vec<String> {
    scope.split_whitespace().map(str::to_string).collect()
}

fn require_direct_scope(scopes: &[String]) -> AppResult<()> {
    if scopes.iter().any(|scope| scope == DIRECT_SCOPE) {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "ChatGPT plan usage was not granted. Sign in again and allow Litera to use your ChatGPT plan.",
        ))
    }
}

fn login_credential(token: &Value, client_id: &str, nonce: &str, now: i64) -> AppResult<Credential> {
    let id_token = token_string(token, "id_token")?;
    let claims = validate_id_token(&id_token, client_id, nonce, now)?;
    let granted = scopes(&token_string(token, "scope")?);
    require_direct_scope(&granted)?;
    let mut credential = Credential::new();
    credential.insert("type".into(), json!("oauth"));
    credential.insert("clientId".into(), json!(client_id));
    credential.insert("subject".into(), json!(claims.subject));
    if let Some(email) = claims.email {
        credential.insert("email".into(), json!(email));
    }
    credential.insert("idToken".into(), json!(id_token));
    credential.insert("access".into(), json!(token_string(token, "access_token")?));
    credential.insert("refresh".into(), json!(token_string(token, "refresh_token")?));
    credential.insert("expires".into(), json!(expires_at(token, now)?));
    credential.insert("scopes".into(), json!(granted));
    Ok(credential)
}

/// The fields a refresh grant replaces; the refresh token rotates on every use.
fn refreshed_credential(token: &Value, previous_scopes: Value, now: i64) -> AppResult<Credential> {
    let granted = match string_field(token, "scope") {
        Some(scope) => json!(scopes(&scope)),
        None => previous_scopes,
    };
    let granted_list: Vec<String> = serde_json::from_value(granted.clone()).unwrap_or_default();
    require_direct_scope(&granted_list)?;
    let mut credential = Credential::new();
    credential.insert("access".into(), json!(token_string(token, "access_token")?));
    credential.insert("refresh".into(), json!(token_string(token, "refresh_token")?));
    credential.insert("expires".into(), json!(expires_at(token, now)?));
    credential.insert("scopes".into(), granted);
    if let Some(id_token) = string_field(token, "id_token") {
        credential.insert("idToken".into(), json!(id_token));
    }
    Ok(credential)
}

#[derive(Debug, PartialEq)]
struct IdTokenClaims {
    subject: String,
    email: Option<String>,
}

/// Checks the ID token's issuer, audience, expiry, and nonce.
///
/// The token arrives over TLS straight from the issuer's token endpoint, so
/// the TLS server check stands in for the signature check (OpenID Connect
/// Core 3.1.3.7).
fn validate_id_token(id_token: &str, client_id: &str, nonce: &str, now: i64) -> AppResult<IdTokenClaims> {
    let invalid = || AppError::invalid_input("ChatGPT returned an invalid ID token");
    let payload = id_token.split('.').nth(1).ok_or_else(invalid)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).map_err(|_| invalid())?;
    let claims: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let audience_matches = match claims.get("aud") {
        Some(Value::String(aud)) => aud == client_id,
        Some(Value::Array(auds)) => auds.iter().any(|aud| aud.as_str() == Some(client_id)),
        _ => false,
    };
    let unexpired = claims.get("exp").and_then(Value::as_i64).is_some_and(|exp| exp * 1000 > now);
    if claims.get("iss").and_then(Value::as_str) != Some(ISSUER)
        || !audience_matches
        || !unexpired
        || claims.get("nonce").and_then(Value::as_str) != Some(nonce)
    {
        return Err(invalid());
    }
    Ok(IdTokenClaims {
        subject: string_field(&claims, "sub").ok_or_else(invalid)?,
        email: string_field(&claims, "email"),
    })
}

fn needs_refresh(expires_ms: i64, now: i64) -> bool {
    expires_ms - now < REFRESH_MARGIN_MS
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn not_signed_in() -> AppError {
    AppError::invalid_input("Not signed in with ChatGPT")
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_auth(agent_dir: &Path) -> AppResult<Value> {
    crate::agent_config::read_json_or_empty(&agent_dir.join("auth.json"), "auth.json")
}

/// Rewrites only the `chatgpt` entry of auth.json; `None` removes it.
fn update_entry(agent_dir: &Path, edit: impl FnOnce(&mut Option<Value>) -> AppResult<()>) -> AppResult<()> {
    let path = agent_dir.join("auth.json");
    let mut auth = read_auth(agent_dir)?;
    if auth.is_null() {
        auth = Value::Object(serde_json::Map::new());
    }
    let object = auth
        .as_object_mut()
        .ok_or_else(|| AppError::storage_corrupt("auth.json root is not a JSON object".to_string()))?;
    let mut entry = object.remove(PROVIDER_ID);
    edit(&mut entry)?;
    if let Some(entry) = entry {
        object.insert(PROVIDER_ID.to_string(), entry);
    }
    let bytes = serde_json::to_vec_pretty(&auth)
        .map_err(|error| AppError::storage_io(format!("Failed to serialize auth.json: {error}")))?;
    library::atomic_write(&path, &bytes, "auth.json")
}

fn load_or_create_host_id(agent_dir: &Path) -> AppResult<String> {
    let path = agent_dir.join(HOST_ID_FILE);
    match std::fs::read_to_string(&path) {
        Ok(existing) if existing.trim().starts_with("urn:uuid:") => return Ok(existing.trim().to_string()),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(AppError::storage_io(format!("Failed to read ChatGPT host id: {error}")))
        }
    }
    let host_id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    library::atomic_write(&path, host_id.as_bytes(), "ChatGPT host id")?;
    Ok(host_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIENT: &str = "app_issued123";
    const NOW: i64 = 1_800_000_000_000;

    fn id_token(claims: Value) -> String {
        let encode = |value: &Value| URL_SAFE_NO_PAD.encode(serde_json::to_vec(value).unwrap());
        format!("{}.{}.sig", encode(&json!({ "alg": "RS256" })), encode(&claims))
    }

    fn valid_claims() -> Value {
        json!({
            "iss": ISSUER,
            "aud": [CLIENT],
            "exp": NOW / 1000 + 3600,
            "nonce": "n0nce",
            "sub": "user-sub",
            "email": "reader@example.com",
        })
    }

    fn attempt() -> AuthAttempt {
        AuthAttempt { state: "st".into(), nonce: "n0nce".into(), verifier: "verifier".into() }
    }

    fn query(url: &str) -> std::collections::HashMap<String, String> {
        reqwest::Url::parse(url).unwrap().query_pairs().into_owned().collect()
    }

    #[test]
    fn first_sign_in_registers_with_the_dynamic_client_and_app_name() {
        let attempt = attempt();
        let url = authorize_url(&AuthorizeParams {
            client_id: None,
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            host_id: "urn:uuid:abc",
            id_token_hint: Some("ignored"),
            attempt: &attempt,
        })
        .unwrap();
        assert!(url.starts_with(AUTHORIZE_URL));
        let query = query(&url);
        assert_eq!(query["client_id"], DYNAMIC_CLIENT_ID);
        assert_eq!(query["agent_name_hint"], "Litera");
        assert_eq!(query["scope"], SCOPE);
        assert_eq!(query["resource"], API_BASE_URL);
        assert_eq!(query["ext_agent_host_id"], "urn:uuid:abc");
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["code_challenge"], pkce_challenge("verifier"));
        assert!(!query.contains_key("id_token_hint"));
    }

    #[test]
    fn returning_sign_in_reuses_the_client_and_hints_the_account() {
        let attempt = attempt();
        let url = authorize_url(&AuthorizeParams {
            client_id: Some(CLIENT),
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            host_id: "urn:uuid:abc",
            id_token_hint: Some("old.id.token"),
            attempt: &attempt,
        })
        .unwrap();
        let query = query(&url);
        assert_eq!(query["client_id"], CLIENT);
        assert_eq!(query["id_token_hint"], "old.id.token");
        assert!(!query.contains_key("agent_name_hint"));
    }

    #[test]
    fn pkce_challenge_matches_rfc_7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_parsing_waits_for_the_matching_state() {
        assert_eq!(parse_callback("/favicon.ico", "st"), CallbackOutcome::Ignore);
        assert_eq!(parse_callback("/auth/callback?code=c&state=other", "st"), CallbackOutcome::Ignore);
        assert_eq!(
            parse_callback("/auth/callback?error=access_denied&state=st", "st"),
            CallbackOutcome::Denied("access_denied".into())
        );
        assert_eq!(
            parse_callback("/auth/callback?code=c&state=st&client_id=app_1", "st"),
            CallbackOutcome::Success(CallbackSuccess { code: "c".into(), client_id: Some("app_1".into()) })
        );
        assert_eq!(
            parse_callback("/auth/callback?code=c&state=st", "st"),
            CallbackOutcome::Success(CallbackSuccess { code: "c".into(), client_id: None })
        );
    }

    #[test]
    fn id_token_validation_checks_issuer_audience_expiry_and_nonce() {
        let claims = validate_id_token(&id_token(valid_claims()), CLIENT, "n0nce", NOW).unwrap();
        assert_eq!(claims, IdTokenClaims { subject: "user-sub".into(), email: Some("reader@example.com".into()) });
        for (field, value) in [
            ("iss", json!("https://evil.example")),
            ("aud", json!("someone-else")),
            ("exp", json!(NOW / 1000 - 1)),
            ("nonce", json!("replayed")),
        ] {
            let mut claims = valid_claims();
            claims[field] = value;
            assert!(validate_id_token(&id_token(claims), CLIENT, "n0nce", NOW).is_err(), "{field}");
        }
        assert!(validate_id_token("not-a-jwt", CLIENT, "n0nce", NOW).is_err());
    }

    #[test]
    fn login_requires_the_plan_usage_scope() {
        let token = |scope: &str| {
            json!({
                "access_token": "at", "refresh_token": "rt", "expires_in": 3600,
                "id_token": id_token(valid_claims()), "scope": scope,
            })
        };
        let credential =
            login_credential(&token(SCOPE), CLIENT, "n0nce", NOW).unwrap();
        assert_eq!(credential["clientId"], CLIENT);
        assert_eq!(credential["email"], "reader@example.com");
        assert_eq!(credential["expires"], NOW + 3_600_000);
        assert!(login_credential(&token("openid profile email"), CLIENT, "n0nce", NOW).is_err());
    }

    #[test]
    fn refresh_keeps_previous_scopes_when_the_response_omits_them() {
        let token = json!({ "access_token": "at2", "refresh_token": "rt2", "expires_in": 3600 });
        let credential = refreshed_credential(&token, json!(scopes(SCOPE)), NOW).unwrap();
        assert_eq!(credential["refresh"], "rt2");
        assert!(!credential.contains_key("idToken"));
        assert!(refreshed_credential(&token, json!(["openid"]), NOW).is_err());
    }

    #[test]
    fn refresh_happens_inside_the_margin() {
        assert!(!needs_refresh(NOW + 10 * 60 * 1000, NOW));
        assert!(needs_refresh(NOW + 60 * 1000, NOW));
        assert!(needs_refresh(0, NOW));
    }

    #[test]
    fn models_parse_both_listing_shapes() {
        let chatgpt = br#"{"models":[{"slug":"gpt-6.1-sol","visibility":"list"},{"slug":"hidden","visibility":"hide"}]}"#;
        assert_eq!(parse_models(chatgpt).unwrap(), vec!["gpt-6.1-sol"]);
        let standard = br#"{"data":[{"id":"gpt-6-luna"}]}"#;
        assert_eq!(parse_models(standard).unwrap(), vec!["gpt-6-luna"]);
    }

    #[test]
    fn account_and_token_come_from_the_auth_entry() {
        let auth = json!({ "chatgpt": { "type": "oauth", "access": "at", "refresh": "rt", "email": "a@b.c", "models": ["m"] } });
        assert_eq!(access_token(&auth).unwrap(), "at");
        assert_eq!(account(&auth), Some(ChatgptAccount { email: Some("a@b.c".into()), models: vec!["m".into()] }));
        let signed_out = json!({ "chatgpt": { "type": "oauth", "clientId": CLIENT } });
        assert_eq!(account(&signed_out), None);
        assert!(access_token(&signed_out).is_err());
    }

    #[test]
    fn host_id_is_created_once_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create_host_id(dir.path()).unwrap();
        assert!(first.starts_with("urn:uuid:"));
        assert_eq!(load_or_create_host_id(dir.path()).unwrap(), first);
    }

    #[test]
    fn update_entry_leaves_other_providers_alone() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("auth.json"), r#"{"openai":{"type":"api_key","key":"sk-1"}}"#).unwrap();
        update_entry(dir.path(), |entry| {
            *entry = Some(json!({ "type": "oauth" }));
            Ok(())
        })
        .unwrap();
        update_entry(dir.path(), |entry| {
            *entry = None;
            Ok(())
        })
        .unwrap();
        let auth = read_auth(dir.path()).unwrap();
        assert_eq!(auth, json!({ "openai": { "type": "api_key", "key": "sk-1" } }));
    }
}
