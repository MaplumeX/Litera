# 07: Settings stay per-device (preferences and provider sync retired)

**What to build:** Nothing: typography, reader preferences, app preferences (language, theme, UI font), and LLM provider configuration (chosen provider, model, custom endpoints, thinking level) are per-device and never sync. API keys were always excluded. Verifiable: configure typography and a provider on one machine, sync, open Litera on another and find both unchanged by Sync.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** done

- [x] App preferences (typography, reader, language, theme, UI font) are per-device and never applied from the Manifest (#117)
- [x] LLM provider choice, model, custom endpoints, and thinking level are per-device and never applied from the Manifest
- [x] API keys never leave the device (`has_api_key` semantics unchanged)
- [x] `preferences` and `provider` envelopes pass through untouched, so older clients keep converging among themselves
- [x] Tests cover envelope pass-through, and a state file with the retired timestamps still parses

## Comments

- Originally: preferences and provider settings rode the Manifest as `PreferenceEnvelope`s (newest `updatedAt` wins, ties by device id — merge-engine semantics), with dirty timestamps bumped by `save_preferences` / agent-config mutations and baselined when Sync was first enabled. Provider envelopes covered agent/settings.json + models.json; auth.json was never read or written, so API keys stayed per-device.
- Retired app preferences (#117): theme, language, and typography are per-device — desktop and phone are different interfaces. The `preferences` envelope is now written only by older clients and passes through untouched.
- Retired provider settings: a provider setup belongs to the machine that runs it (localhost endpoints, per-device keys), and keys already never synced — so provider choice, model, custom endpoints, and thinking level are per-device too. `note_provider_saved` and the first-enable provider baseline are gone; `providerUpdatedAt` is accepted on read and dropped on write; the `provider` envelope is passed through untouched like `preferences`.
