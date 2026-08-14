# Design: settings segmented control

## Boundary

Replace local `ChoiceButton` in `SettingsDialog`. Keep `PresetRow`, sliders, font combobox, left nav, and `AgentConfigForm`.

No new settings keys. No `preferences.json` / `library.json` changes.

## Component

One local `SegmentedControl` in `src/components/settings/SettingsDialog.tsx` (or a sibling file under `src/components/settings/` if the dialog file gets noisy). Do not add shadcn `toggle-group` / `radio-group` for a three-call-site visual swap. Do not put it in `src/components/ui/` (that folder is shadcn-owned).

```ts
type SegmentedOption<T extends string> = { value: T; label: string };

function SegmentedControl<T extends string>(props: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}): JSX.Element
```

Call sites stay inside existing `PresetRow`s:

- text align → `styleState.textAlign` / `onTypographyChange("textAlign", value)`
- theme → `theme` / `onThemeChange`
- locale → `locale` / `setLocale`

## Visual

```
+--------------------------------------+
|  白天  | [ 夜间 ] |  护眼            |   muted track
+--------------------------------------+
              ^ selected: background + light shadow
```

- Track: `inline-flex w-full rounded-md bg-muted p-0.5`
- Segment: `flex-1`, no own border, compact `text-xs`, `rounded-sm`
- Selected: `bg-background text-foreground shadow-xs`
- Unselected: muted text, hover only (no outline button)
- Do not reuse `bg-primary text-primary-foreground`

## A11y

- Group: `role="radiogroup"` + `aria-label` from the row label
- Segment: `role="radio"` + `aria-checked`
- Arrow keys move within the group; Space / Enter select the focused segment
- Visible labels stay the existing i18n strings so tests can still find 白天 / English / 起始

## Tests

`SettingsDialog.test.tsx` currently uses `getByRole("button", { name: "白天" })` and `getByRole("button", { name: "English" })`. Switch those to `radio`. Add one assertion that the three groups expose `radiogroup` and the current value is `aria-checked`.

## Tradeoff

A local control is enough for three rows. A shadcn ToggleGroup would add a new `ui/` primitive and still need restyling to drop the primary-filled look.
