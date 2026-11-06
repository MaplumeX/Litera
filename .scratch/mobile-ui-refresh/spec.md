# Mobile UI refresh: bring #183's visual language to the phone

## Problem

#183 reworked the desktop shell around a few rules, but the phone only got
spot fixes (the resume card's ambient colour, gold stars, status dots in the
action sheet). The phone now mixes two "selected" looks, keeps its own copies
of controls the desktop shares, and has none of the desktop's layering, hero
or floating reader chrome.

## The rules from #183 (what the phone should follow)

- **Neutral ground; colour comes only from covers and the one accent.**
  `.cover-ambient` / `useCoverPalette` for covers, `--primary` (`ui-accent.ts`)
  for everything else.
- **Two layers.** `--sidebar` is the ground, `--background` the content that
  floats on it. Layers part by `--elevation-*`, not drawn lines.
- **The shelf opens on a Hero** (`ContinueReadingHero`): the Book last read,
  lit in its cover's colour.
- **Reader chrome floats** over the page and gets out of the way.
- **Shared primitives:** `SegmentedControl`, `NAV_ITEM_*`.

## Decisions

- **One "selected" look:** `bg-primary/10 text-primary` (icon in `text-primary`),
  as in `MobileBookActionSheet` since #183. `bg-secondary` stops meaning
  "selected" anywhere under `src/mobile/`.
- **Touch sizes come from the shared primitives**, not phone copies:
  `SegmentedControl` gets a touch size; the status chips become one component.
- **Phone layouts stay Android-shaped** (56dp app bar, 48dp targets, Back
  closes overlays). The refresh changes how things look, not how you get
  around.
- **No new colours.** Everything maps to existing tokens; new surfaces use
  `--sidebar` / `--background` / `--page` and `shadow-float`.
- Work splits into four issues, each shippable on its own, in order:
  1. Accent and primitives (low risk)
  2. Library Hero and large title
  3. Floating reader chrome and progress slider
  4. Book details page and system bar tint

## Out of scope

- Desktop changes, apart from the shared primitives gaining a size option.
- New settings or features; the accent picker already exists.
- The Book page's own colours (`--page`, reader themes).

## Testing

- Existing `MobileApp.test.tsx` / `AssistantSheet.test.tsx` keep passing;
  queries that relied on class names move to roles and `aria-*`.
- New tests where behaviour changes: the touch `SegmentedControl` keeps arrow
  key navigation, the Hero switches books on tap and opens on a second tap.
- Each issue is checked in the Android app (light and dark, two accents)
  before closing.
