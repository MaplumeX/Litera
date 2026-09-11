# 01: Sync configuration and connection test

**What to build:** A reader can open a new Sync section in the Settings dialog, enter their S3-compatible Sync Backend details (endpoint, region, bucket, path-style toggle, access key, secret), save them, and press a "Test connection" button that performs a real probe of the bucket and reports success or a readable error. The first time Sync is enabled, the UI states plainly that synced data is stored as-is (plaintext) on the bucket the user chooses. Configuration persists across restarts, stored locally in plaintext JSON following the existing conventions for LLM API keys. All UI copy exists in English and Simplified Chinese.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Settings dialog has a Sync section with fields for endpoint, region, bucket, path-style, access key, and secret
- [ ] Saving persists the configuration locally; it survives an app restart
- [ ] "Test connection" performs a real bucket probe and reports success/failure with a readable error
- [ ] First-enable flow shows the plaintext-storage disclosure once
- [ ] Sync remains off unless explicitly enabled (opt-in)
- [ ] S3 credentials are stored locally in plaintext JSON, never written anywhere remote
- [ ] UI copy in English and Simplified Chinese via the existing i18n mechanism
- [ ] Settings dialog tests follow the existing pattern (jsdom + RTL, mocked invoke)

## Comments (post-review)

- Bug fix (found in real use): saving twice in a row failed with "Endpoint, region, bucket, access key, and secret are all required". The secret is never sent back to the UI, so after the first save the form's secret field is blank; the second save then failed validation. `save_sync_config` now merges a blank secret with the stored one ("leave blank to keep", as the form's placeholder promises); a blank secret with nothing stored still fails. Covered by `blank_secret_tests`.
