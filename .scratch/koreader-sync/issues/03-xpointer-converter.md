# 03: XPointer ⇄ DOM Range converter

**What to build:** Pure module `src/lib/xpointer.ts` with `xpointerFromRange(doc, range, spineIndex)` and `rangeFromXPointer(doc, xpointer)` following CREngine's serialization (spec "Protocol facts"). Clean-room — do not copy BookOrbit (AGPL-3.0) code. Resolve spec open question 2 (DocFragment numbering) first and record the answer here.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Same-name sibling indices, omitted `[1]` when unique, nested inline markup
- [x] Text step + code-point offset when computable; element-level otherwise
- [x] Unresolvable XPointer returns `null` (caller falls back to percentage)
- [x] Round-trip tests land in the same block element
- [ ] Verified on at least one real book against positions written by KOReader

## Comments

- DocFragment numbering: one per spine itemref including `linear="no"` (CREngine `epubfmt.cpp`), so `DocFragment[n]` = foliate section `n-1`.
- Text steps are written only when the element has a single text child and the prefix has no whitespace CREngine would collapse; otherwise element-level. On resolve, whitespace-only text nodes are skipped when counting `text()[k]`.
- Not yet verified against positions written by a real KOReader device (checkbox above is ticked for the unit fixtures only).
