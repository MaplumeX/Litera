# 04: Inline original images in guided steps with `ImageViewer` and vision hints

**Status:** resolved

**Blocked by:** 03

**What to build:** Automatically display original book figures inline inside guided steps that contain images, click-to-zoom with the existing `ImageViewer`, and coordinate vision prompts without bloating session JSONL files.

- [x] Expose image references from chapter blocks:
  - Extend `GuideBlock` (or add a `stepImages(span)` helper backed by `epub-content.ts`) with `{ src: string; alt: string; caption?: string }` for `kind: "image"` blocks
  - Filter out tiny decorative ornaments/separators (e.g. images whose intrinsic dimensions or aspect/size heuristics indicate a tiny rule/icon) so only substantive figures appear
- [x] Full-resolution image loading for UI:
  - Add a worker/runtime method returning crisp original image bytes/blob URL by `src` (distinct from the 1.15MP downscaled `readImage` used for LLM vision input), backed by a small LRU cache with proper `URL.revokeObjectURL` cleanup on book close
- [x] Transcript **Step Image Strip**:
  - Derive each guided step's images lazily from its `GuideSpan` (zero base64 stored in session JSONL)
  - Render a compact, lazy-loaded thumbnail strip under `GuideStepMarker` (single centered figure card or horizontal scrollable strip for multiple figures, with caption/alt)
  - Clicking any figure opens the existing `ImageViewer` (`src/components/ImageViewer.tsx`) with zoom, pan, and keyboard controls; works on both desktop and mobile
- [x] Vision coordination in `guide_step`:
  - When a step contains non-decorative images, append a concise note to the `guide_step` result: if the active model supports image input, list the `src` values and instruct calling `view_image` when the explanation depends on visual details; otherwise state that images cannot be inspected directly
- [x] Tests: `epub-content.test.ts` (image block src/caption extraction & ornament filtering), `embedded-runtime.guided.test.ts` (vision/non-vision hints), UI test for Step Image Strip opening `ImageViewer`

## Comments
