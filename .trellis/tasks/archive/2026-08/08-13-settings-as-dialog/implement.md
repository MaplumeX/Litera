# Settings dialog — implement

## Checklist

1. Convert `src/components/settings/SettingsPage.tsx` into `SettingsDialog.tsx`: wrap current body in shadcn `Dialog` / `DialogContent`, drop the back header, take `open` + `onClose`.
2. Rewrite `SettingsPage.test.tsx` to `SettingsDialog.test.tsx`. Keep section / restore / language assertions; add open/close coverage (`role="dialog"`, close via Dialog).
3. In `App.tsx`:
   - `view` is only `"library" | "reader"`.
   - Add `settingsOpen`. Delete `settingsReturnTo` and the `view === "settings"` branch.
   - Gear / Aa set `settingsOpen`. `editingBook` uses `view === "reader"`.
   - Stop snapshotting `lastFraction` when opening settings.
   - Mount `SettingsDialog` in both remaining trees. Close flushes then clears `settingsOpen`.
4. Do not touch `ChatPanel`, `AgentConfigDialog`, Rust, or sidecar.
5. Update specs in Phase 3.3 (not during implement): settings surface is a dialog overlay, not a root view.

## Validation

```bash
npm test
npm run build
```

Manual: library gear → dialog over shelf → close stays on library. Reader Aa → dialog over book, sliders change the page, close stays on the same book. Chat gear still only opens「LLM 设置」.

## Risky points

- Closing settings must not call `handleBackToLibrary` / `close_book`.
- Flush failure on close must leave the dialog open.
- Do not pass an `onOpenSettings` callback into `ChatPanel`.
- `lastKnownFractionRef` is still required for open-book / relocate; only the settings-open snapshot goes away.

## Rollback

Revert the settings component rename and `App.tsx` view-state change. No data files to undo.
