# 07: Preferences and provider settings sync

**What to build:** A reader's settings follow them across devices: typography and reader preferences, app preferences (language, theme, UI font), and LLM provider configuration (chosen provider, model, custom endpoints) sync via the Manifest so a new device feels pre-configured. LLM API keys are strictly excluded — they stay per-device in local storage, and a new device only needs keys re-entered once. Verifiable: configure typography and a provider on one machine, sync, open Litera on another and find both already in place minus the API key.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [x] Typography and reader preferences converge across devices after sync
- [x] App preferences (language, theme, UI font) converge after sync
- [x] LLM provider choice, model, and custom endpoints converge after sync
- [x] API keys never leave the device; a new device shows providers as needing keys (existing `has_api_key` semantics)
- [x] Merge-engine tests cover preference merge determinism; app-level tests cover the wiring

## Comments

- Preferences and provider settings ride the Manifest as `PreferenceEnvelope`s (newest `updatedAt` wins, ties by device id — merge-engine semantics). Explicit recorded dirty timestamps live in sync-state: bumped by `save_preferences` / agent-config mutations, baselined when Sync is first enabled, and by a UI-language change (locale passed to the export; language rides in the preferences envelope and is applied live by the frontend via the `litera:sync-applied` event).
- Provider envelope covers agent/settings.json + models.json (provider choice, model, custom providers) — auth.json is never read into or written from the envelope, so API keys stay per-device (`has_api_key` shows them as missing on a new device).
- Apply guards mid-sync local edits: envelopes apply only when strictly newer than the local dirty timestamp.
- Tests: Rust `preference_sync_tests` (dirty bumps, enable baseline, newer-wins both directions, auth untouched, envelope contents, locale-change bump) and a runner test asserting the language event.
