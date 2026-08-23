# Implement typography preview layout

## Checklist

1. Add `settings.stepper.decrease` and `settings.stepper.increase` to `src/locales/zh-CN.ts` and `src/locales/en.ts` (same `MessageKey` set).
2. In `SettingsDialog.tsx`, split the typography content pane: inspector column left (scope copy + controls, independent scroll), preview column right (independent scroll). Other sections keep the current single column.
3. Add a CSS container query (or Tailwind `@container`) so a narrow content pane stacks preview above controls with a capped preview height.
4. Replace typography `SliderRow` with `StepperRow`: `Button` −/+, shadcn `Input` draft/commit, `clampSnap` + `TYPOGRAPHY_RANGES`. Remove unused `SliderRow` if nothing else calls it. Keep Appearance's own `Slider`.
5. Stop stretching typography `SegmentedControl` to full width (override font/layout, alignment). Font picker stays full width of the inspector.
6. Rewrite `SettingsDialog.test.tsx`:
   - Preview is present with Typography open and still present after focusing/changing a lower control (not “above the controls”).
   - No typography sliders; `−` / `+` and the value input exist for a continuous field (e.g. 字体大小, 首行缩进).
   - `+` on font size calls `onTypographyChange("fontSize", 17)` from 16; `−` at min does not go below.
   - Typing a non-number and blurring reverts; typing a huge number clamps to max.
   - Override radiogroups still independent; restore-default still works.
   - Appearance still has `slider` 界面字号; switching to Appearance hides the preview.
   - Dialog still `w-[768px] h-[40rem]`.
7. Run `npx vitest run src/components/settings/SettingsDialog.test.tsx src/lib/i18n.test.ts`.

## Validation

```bash
npx vitest run src/components/settings/SettingsDialog.test.tsx src/lib/i18n.test.ts
npx tsc --noEmit
```

Manual: open Settings → Typography, scroll the inspector, confirm the preview stays; type a font size; switch to Appearance and back.

## Risky files

- `src/components/settings/SettingsDialog.tsx` — only file that owns the split and steppers.
- `src/components/settings/SettingsDialog.test.tsx` — slider-based assertions will fail until rewritten.

## Rollback

Revert the settings component, locales, and test file. No backend or preferences migration.

## Before start

- `implement.jsonl` / `check.jsonl` have real spec entries (not only `_example`).
- User has approved this planning summary.
