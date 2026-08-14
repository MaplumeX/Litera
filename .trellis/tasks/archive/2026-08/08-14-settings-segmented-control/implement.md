# Implement: settings segmented control

## Checklist

1. Add `SegmentedControl` per `design.md` (local to settings, not `src/components/ui/`).
2. Replace the three `ChoiceButton` groups: text align, theme, locale. Delete `ChoiceButton` if unused.
3. Keep `PresetRow` layout A (label above, control full width).
4. Update `SettingsDialog.test.tsx` role queries (`button` → `radio`) and add a radiogroup / `aria-checked` assertion.
5. Run `npm test`.

## Validation

```bash
npm test
```

Need `SettingsDialog.test.tsx` green, including appearance language switch and the new radiogroup assertion.

## Rollback

Revert the settings UI file(s) and the test. No persistence or protocol rollback.
