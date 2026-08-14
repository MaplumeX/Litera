# Replace sepia theme with system-following theme

## Goal

Remove the sepia (eye-care) theme option and replace it with a system-following theme that resolves to light/dark based on `prefers-color-scheme`, updating live when the OS theme changes.

## Requirements

- Theme options become: 白天 (light) / 夜间 (dark) / 跟随系统 (system).
- "跟随系统" resolves to light or dark from the OS `prefers-color-scheme` and follows OS theme changes live (app window chrome + reader content).
- The sepia theme (CSS variables, reader CSS injection, i18n labels) is removed.
- Old persisted `"sepia"` values (global preferences or per-book settings) are accepted on read and fall back to light; they are never written back.
- Per-book `theme` stays deprecated: not written, only accepted for old files.

## Acceptance Criteria

- [ ] Settings dialog shows 白天 / 夜间 / 跟随系统; no 护眼 option anywhere in the UI.
- [ ] Selecting 跟随系统 makes the app follow the OS light/dark scheme, including live updates when the OS theme changes (window chrome and reader iframe content).
- [ ] Selecting 白天 / 夜间 overrides the system scheme as before.
- [ ] The chosen theme persists across restarts (global preference).
- [ ] Old `"sepia"` values in stored preferences / book settings load without errors and behave as light.
- [ ] No `.sepia` CSS or sepia reader CSS remains; frontend and backend tests pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
