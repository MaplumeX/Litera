# Remote model catalog

## What exists

- No Tauri `list_models` command. No sidecar protocol method for listing models.
- Agent config stays in Rust file I/O by design (`08-12-agent-config-ui`); the sidecar was deliberately not used for provider/model lists.
- pi custom-provider docs fetch OpenAI-compatible `GET {baseUrl}/models` and expect `{ data: [{ id, name? }] }`.
- `src-tauri/Cargo.toml` has no HTTP client. Sidecar Node can `fetch`, but adding a command means versioned protocol + supervisor + tests on both sides.
- API keys never return to the WebView, so the WebView must not call vendor APIs itself (and would hit CORS anyway).

## Options

| Approach | Covers | Cost |
|---|---|---|
| Rust `GET {baseUrl}/models` (add `reqwest`) | Custom OpenAI-compatible (Ollama, vLLM, LM Studio, most proxies) | New crate; no protocol change; works if sidecar is down |
| Sidecar + pi `getModels()` | Built-in bundled catalog (local, not live) | Protocol change; not actually remote |
| Per-vendor APIs from Rust | Anthropic / Google / etc. live lists | One client per vendor; headers and pagination differ |

## Decision

Custom OpenAI-compatible only. Rust `GET {baseUrl}/models`. Built-in stays free-text. No sidecar protocol.

## Command shape

New command `list_remote_models { baseUrl, apiKey }`:

- `apiKey` from the form draft (user may not have saved yet). Empty → `InvalidInput`.
- `GET {baseUrl}/models` with `Authorization: Bearer`, timeout (~10s), body size cap.
- Parse `data[].id`; if missing, try a plain string array. Ignore unknown fields.
- Never log URL+key together; never log the key.
- Return `string[]`. Caller merges into the custom provider draft list.
- Tests: parse fixtures; reject empty url/key. Live HTTP is not required in unit tests (inject a stub or test the parser only).

Built-in providers keep a text field + example placeholder. Their catalogs live inside pi; writing them into `models.json` would override the builtin provider.

## Do not

- Fetch on every dropdown change.
- Persist the refresh result until「保存并应用」.
- Clear the draft list when the request fails.
