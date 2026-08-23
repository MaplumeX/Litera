# Keep typography preview visible in settings

## Goal

In Settings → Typography, the live preview stays on screen while the user adjusts any control. Typography controls become a compact inspector so the existing 768px dialog can show controls and preview side by side.

## Background

The settings dialog is a fixed shell (`w-[768px] h-[40rem] max-h-[85vh]`). Left nav is 192px. The typography preview currently sits above a long `max-w-md` control list in one `overflow-y-auto` pane, so scrolling to lower sliders hides the sample text.

Widening the dialog is out of scope. Instead the typography controls become compact (on/off buttons; `−` / editable number / `+` instead of sliders) so they fit in about 240–280px. The remaining right-pane width is the preview.

Column order is controls left, preview right: `[nav | inspector | preview]`. Preview-left would wedge sample text between the nav and the controls, and switching to Appearance would make the form jump. The preview is a swatch, not the real book. Appearance / AI / About stay single-column with their current widgets.

`TYPOGRAPHY_RANGES` and `clampSnap` already define min / max / step / unit. Full `contentWidth` (default 42em) still cannot fit in the preview column; the preview already wraps today.

## Requirements

- R1. On the Typography section, the preview remains visible while the user scrolls or focuses any typography control.
- R2. Keep the settings dialog at `w-[768px]`. Do not widen it.
- R3. Typography layout is two columns: compact controls on the left (~240–280px, next to the nav), preview on the right (remaining width). Each column scrolls on its own.
- R4. Continuous fields (`fontSize`, `lineHeight`, `contentWidth`, `pagePadding`, `letterSpacing`, `paragraphSpacing`, `firstLineIndent`) use `−` / `+` and an editable number. No sliders on the Typography section.
- R5. Step, clamp, and unit follow `TYPOGRAPHY_RANGES`. `−` / `+` move by `step` and reuse `clampSnap`. Typed values commit on Enter or blur; out-of-range values clamp; non-numeric input reverts to the last valid value.
- R6. Boolean options (`overrideFont`, `overrideLayout`) are compact buttons, not full-width segmented bars.
- R7. Preview still reflects live `styleState` via `generatePreviewCss`.
- R8. Appearance, AI, and About keep their current single-column layout and current widgets. No typography preview there.
- R9. When the dialog is too narrow for two columns (`sm:max-w-[calc(100%-2rem)]`), stack preview above controls. Cap preview height and let it scroll internally.
- R10. Restore-default, font picker, alignment, locale-specific sample text, ranges, and persistence stay as they are.

## Out of Scope

- Widening the settings dialog.
- Redesigning Appearance / AI / About controls.
- Previewing the real open book.
- A 1:1 mock of `contentWidth`.
- Changing the typography property set, ranges, or persistence.
- A draggable split between the two columns.

## Acceptance Criteria

- [ ] AC1. With Typography open, scrolling the control column to the last control still leaves the preview visible.
- [ ] AC2. Default dialog width stays 768px. Typography is two columns: controls left, preview right.
- [ ] AC3. Typography has no sliders. Each continuous field has `−`, an editable number, and `+`.
- [ ] AC4. `−` / `+` honor `TYPOGRAPHY_RANGES` step and clamp via `clampSnap`. Invalid typed input does not stick.
- [ ] AC5. Changing font size, family, line height, or alignment still updates the visible preview.
- [ ] AC6. Switching to Appearance removes the typography preview. Appearance still uses its current slider / segmented controls.
- [ ] AC7. Dialog shell stays `h-[40rem] max-h-[85vh]` and does not grow with content.
- [ ] AC8. zh-CN and en sample paragraphs still follow locale.
