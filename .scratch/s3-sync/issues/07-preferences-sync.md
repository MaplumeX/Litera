# 07: Preferences and provider settings sync

**What to build:** A reader's settings follow them across devices: typography and reader preferences, app preferences (language, theme, UI font), and LLM provider configuration (chosen provider, model, custom endpoints) sync via the Manifest so a new device feels pre-configured. LLM API keys are strictly excluded — they stay per-device in local storage, and a new device only needs keys re-entered once. Verifiable: configure typography and a provider on one machine, sync, open Litera on another and find both already in place minus the API key.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [ ] Typography and reader preferences converge across devices after sync
- [ ] App preferences (language, theme, UI font) converge after sync
- [ ] LLM provider choice, model, and custom endpoints converge after sync
- [ ] API keys never leave the device; a new device shows providers as needing keys (existing `has_api_key` semantics)
- [ ] Merge-engine tests cover preference merge determinism; app-level tests cover the wiring
