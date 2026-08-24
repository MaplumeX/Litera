# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning multiple layers |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Feature touches 3+ layers (API, Service, Component, Database)
- [ ] Data format changes between layers
- [ ] Multiple consumers need the same data
- [ ] You're not sure where to put some logic
- [ ] You are adding an event kind, JSONL record, RPC payload, or config field
- [ ] You want to persist a new user preference next to theme — `preferences.json` uses `deny_unknown_fields`; a new key resets old builds (UI locale, default reader/Agent mode, chrome font/size, TTS rate/voice, and library sort/view use `localStorage`, see frontend `i18n.md`)
- [ ] You want to edit an already-imported book's title/author/cover — `update_book_metadata`; do not reuse `save_book_metadata` (import commit only). Cover `None` keeps the file; empty `Some` is invalid. Sort the shelf in the WebView; do not add a `list_books` sort param (see backend `tauri-commands.md` "Scenario: update book metadata after import")
- [ ] You want to remember last reader vs Agent layout — per-book `lastReaderMode` via `update_reading_state`, not `ReadingSettings` or `preferences.json` (see backend `tauri-commands.md` "Scenario: lastReaderMode")
- [ ] You want to remember chat/book/session-rail open state — per-book `lastLayout` via `update_reading_state`, not `localStorage`, not `ReadingSettings`, not process-only flags; do not reset on Reader ↔ Agent switch (see backend `tauri-commands.md` "Scenario: lastLayout")
- [ ] You want reopen to land on the last page — persist `lastCfi` via `update_reading_state` and `init({ lastLocation })`; do not restore with `goToFraction` (`lastFraction` is percent). Do not `init({})` then `goTo(cfi)`. Do not put CFI on `annotations.json` / `ReadingSettings` / `localStorage` (see backend `tauri-commands.md` "Scenario: lastCfi")
- [ ] You want to remember window size/position/maximized — use `tauri-plugin-window-state`, not `preferences.json` (see frontend `quality-guidelines.md` "main window size / position / maximized")
- [ ] You want to change the OS title bar / traffic lights / window buttons — merge into existing headers; apply Overlay vs `set_decorations(false)` in `lib.rs` **before** `show()`; custom close must `close()` not `destroy()`; do not mix `data-tauri-drag-region` with JS `toggleMaximize` (see frontend `quality-guidelines.md` "main window chrome")
- [ ] You want the OS browser to open a URL — Settings → About uses scoped `tauri-plugin-opener` `openUrl`; do not `<a href>` / `window.open` / `npm run tauri add opener` (see frontend `quality-guidelines.md` "Settings About / system browser links")
- [ ] You want to store a named `fontFamily` — `is_supported` must use `is_valid_font_family`, not a three-value enum, or `ensure_file` resets theme + typography (see backend `tauri-commands.md` "reader system font family")
- [ ] You want user type to beat EPUB `@font-face` / chapter CSS — `overrideFont` / `overrideLayout` on `preferences.json` + per-book `ReadingSettings` (`Option<bool>`; `false` is a real override). Strengthen `generateStylesCss`; do not strip publisher sheets or use `localStorage` (see backend `tauri-commands.md` "Scenario: override publisher font and layout")
- [ ] You want to add highlight color/note — optional fields on `annotations.json` `schemaVersion: 1`, semantic ids not hex; `list_annotations` stays read-only (see backend `tauri-commands.md` "Scenario: highlight color and note")
- [ ] You want a click on a painted highlight — `pointerup` hitTest must suppress paging before `show-annotation` (see frontend `component-guidelines.md` "highlight click must beat page-turn")
- [ ] You want to add or restyle a Settings → Typography control — keep the 768px shell; inspector left + preview right, each scrolling; continuous fields are steppers (`clampSnap`), not sliders; Escape in a stepper must `onEscapeKeyDown` preventDefault or the dialog closes (see frontend `component-guidelines.md` "typography continuous fields are steppers")
- [ ] You want TOC rows to collapse — path keys in `App.tocExpanded`, helpers in `toc-items.ts`; do not persist; do not key by href; `currentHref` change unions ancestors (see frontend `component-guidelines.md` "TOC nested collapse uses path keys in App")
- [ ] UI / command code starts casting raw payload fields directly
- [ ] OS / argv / deep-link input can arrive twice or before the WebView mounts (drain a queue; see backend `tauri-commands.md` "OS EPUB open")

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're modifying any constant or config**
- [ ] You want continue-reading covers larger or four-across filling the row — reuse the shelf `grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6`; do not `grid-cols-4` or a second card size (see frontend `component-guidelines.md` "continue-reading cards match the shelf grid")
- [ ] **You're creating a new utility/helper function** ← Search first!
- [ ] Two files read the same untyped payload field with local casts
- [ ] Multiple branches update the same derived state from `kind` / `action`

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When Verifying AI Cross-Review Results

- [ ] Reviewer claims "user input can be malicious" → Check the actual data source (internal manifest? user config? external API?)
- [ ] Reviewer flags "missing validation" → Is the data from a trusted internal source?
- [ ] Reviewer says "behavior change" → Read the code comments — is it intentional design?
- [ ] Reviewer identifies a "bug" in test → Mentally delete the feature being tested — does the test still pass? If yes → tautological test

**Common AI reviewer false-positive patterns**:
1. **Trust boundary confusion**: Treating internal data (bundled JSON manifests) as untrusted external input
2. **Ignoring design comments**: Flagging intentional behavior documented in code comments as bugs
3. **Variable misreading**: Not tracing a variable to its actual definition (e.g., Map keyed by path vs name)

**Verification rule**: Every CRITICAL/WARNING finding must be verified against the actual code before prioritizing. Budget ~35% false-positive rate for AI reviews.

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
