# Typography preview layout

## Boundaries

- **In**: `SettingsDialog` typography pane layout and widgets. Locale strings for stepper aria-labels. Tests in `SettingsDialog.test.tsx`.
- **Out**: `generatePreviewCss` / `TYPOGRAPHY_RANGES` / persistence. Appearance UI font slider. Dialog shell size. `react-resizable-panels`.

## Layout

The dialog shell stays `w-[768px] h-[40rem]`. Left nav is unchanged.

The current single `overflow-y-auto` content pane splits only when `section === "typography"`:

```
[nav 192] [inspector ~260, overflow-y-auto] [preview flex-1, overflow-y-auto]
```

- Inspector: `DialogDescription` (scope copy) + compact rows. Width ~260px (`w-64` or `w-[16.5rem]`), `shrink-0`.
- Preview: remaining width, `min-w-0 flex-1`. `TypographyPreview` stays; it may scroll internally when font size is large. It must not share the inspector's scrollport.
- Other sections: keep today's single scrolling column (`max-w-md`).

Narrow dialog (viewport shrinks `sm:max-w-[calc(100%-2rem)]`): container query on the content pane. Below ~520px inner width, `flex-col` with preview first (`max-h-[40%] overflow-y-auto`) and inspector below. No JS breakpoint.

Do not use `react-resizable-panels`.

## Inspector rows

Replace typography `SliderRow` with a local `StepperRow` in `SettingsDialog.tsx` (same file as today's `SliderRow`). Do not add a shared settings primitive unless a second caller appears.

Each continuous row is one line:

```
label                    [−] [value] [+] unit    restore?
```

- `−` / `+`: existing `Button` `size="icon-xs"` / `icon-sm`, `aria-label` from i18n (`settings.stepper.decrease` / `increase` with `{label}`).
- Value: shadcn `Input`, not native `<input>`, not `type="number"` (native spinners fight the buttons). `inputMode="decimal"`. Local draft string while focused; commit on blur and Enter; Escape restores the last committed value.
- Parse: trim, strip a trailing known unit (`px` / `em` / `rem`), `Number.parseFloat`. `NaN` / empty → revert. Otherwise `clampSnap(parsed, min, max, step)` and `onTypographyChange`.
- `−` / `+`: `clampSnap(value ± step, min, max, step)`. Disable `−` at min, `+` at max.
- Display unit as suffix text using `TYPOGRAPHY_RANGES[field].unit`, not inside the input. Visible committed text should still match `formatTypographyValue` once combined with the unit.

Boolean rows (`overrideFont`, `overrideLayout`): keep `SegmentedControl` + 开/关 copy and radiogroup semantics, but drop `w-full` so the pair sits on the right of the label. Alignment uses the same compact (not stretched) segmented pair.

Font picker stays the combobox, full width of the inspector column.

Appearance still uses `Slider` for 界面字号.

## Preview

`TypographyPreview` API unchanged (`styleState` in, `generatePreviewCss` in a `<style>` tag). Placement only. The preview column should fill height so two paragraphs remain readable; padding matches the inspector (`p-6`).

## i18n

Add matching keys in `src/locales/zh-CN.ts` and `src/locales/en.ts`:

- `settings.stepper.decrease` — e.g. 减小{label} / Decrease {label}
- `settings.stepper.increase` — e.g. 增大{label} / Increase {label}

Existing slider / override / preview keys stay. Do not rename `settings.slider.*` labels; they still name the fields.

## Compatibility

No persistence or CSS generator change. Existing `onTypographyChange` / `onRestoreDefault` contracts stay. Tests that query `getByRole("slider", { name: "字体大小" })` and "preview above the controls" must be rewritten; Appearance `界面字号` slider tests stay.

## Tradeoffs

- Compact steppers lose drag-to-explore. Acceptable: typography values are numeric, and typing is more precise than a short slider.
- Preview cannot show full `contentWidth`. Same as today; not solved by column order.
- Typography and Appearance widget languages diverge (stepper vs slider). Scoped on purpose so Appearance is not part of this task.
