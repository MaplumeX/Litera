# 03: Guided retelling style prompt

**Status:** resolved

**What to build:** A default style prompt for Guided sessions implementing the retelling style in the spec (narrative first, structure second; full and in order; key sentences as `cite:` Citations; explanations inline; omissions named at the end). Settings expose it as an editable text with "Reset to default".

- [x] Guided sessions append the style prompt to `SYSTEM_PROMPT`; ordinary Sessions do not
- [x] A Session's own `session_config` prompt still applies
- [x] Settings: edit and reset the guided style prompt (local preference, en + zh-CN labels)
- [x] Skim steps get a skim variant of the instruction (compressed, and says so)
- [x] Tests: system prompt composition per Session kind; settings round-trip

**Notes:** The style is easy to get wrong in both directions (too terse/outline-like vs. pure prose); see the spec's "Retelling style" and issue 07.

## Comments

- Only the **style** is editable (`DEFAULT_GUIDED_STYLE` in `src/agent/runtime/guide.ts`): content and formatting rules. The mechanics stay fixed in `guidedPrompt()` (read the named part, skims, the Continue button, side questions, language), so an edit cannot break guided reading.
- Stored in localStorage (`litera.guided-style`), not synced. Saving drops the cached Agent, so the next step uses it.
- Skims no longer need a separate prompt variant: the skim rule sits in the fixed mechanics, and the step's reading context says it is a skim.
