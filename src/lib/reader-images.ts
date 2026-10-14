const XLINK_NS = "http://www.w3.org/1999/xlink";

export interface ReaderImage {
  src: string;
  alt: string;
}

/** A picture under the pointer, with its rendered height for the paging rule. */
export interface ReaderImageHit {
  image: ReaderImage;
  height: number;
}

interface ElementLike {
  nodeType?: number;
  parentElement?: unknown;
  localName?: string;
  closest?: (selector: string) => unknown;
  getAttribute?: (name: string) => string | null;
  getAttributeNS?: (ns: string, name: string) => string | null;
  getBoundingClientRect?: () => { height: number };
  currentSrc?: string;
  src?: string;
}

/**
 * The picture a click in a chapter landed on — an HTML `<img>` or an SVG
 * `<image>` — or null. A picture inside a link stays a link. Chapter
 * documents live in another realm, so this duck-types instead of `instanceof`.
 */
export function readerImageAt(target: unknown): ReaderImageHit | null {
  if (target == null || typeof target !== "object") return null;
  const node = target as ElementLike;
  if (node.nodeType === 3) return readerImageAt(node.parentElement ?? null);
  if (node.nodeType !== 1 || !node.closest) return null;
  if (node.closest("a[href]")) return null;
  const el = node.closest("img, image") as ElementLike | null;
  if (!el) return null;
  const alt = el.getAttribute?.("alt")?.trim() ?? "";
  const src =
    el.localName === "img"
      ? el.currentSrc || el.src || el.getAttribute?.("src") || ""
      : el.getAttribute?.("href") || el.getAttributeNS?.(XLINK_NS, "href") || "";
  if (!src) return null;
  return { image: { src, alt }, height: el.getBoundingClientRect?.().height ?? 0 };
}

/** A picture at least this share of the page tall is a full-page illustration. */
const PAGE_FILLING_SHARE = 0.75;

/**
 * Whether a click on a picture opens the viewer. Inline pictures open from
 * anywhere; a full-page illustration covers the tap zones, so its edges keep
 * turning pages and only its middle opens it. Scrolled flow has no tap zones.
 */
export function opensImageViewer(input: {
  scrolled: boolean;
  zone: "left" | "middle" | "right";
  imageHeight: number;
  pageHeight: number;
}): boolean {
  if (input.scrolled || input.zone === "middle") return true;
  if (input.pageHeight <= 0) return false;
  return input.imageHeight < input.pageHeight * PAGE_FILLING_SHARE;
}

export const IMAGE_ZOOM_RANGE = { min: 1, max: 6 } as const;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return IMAGE_ZOOM_RANGE.min;
  return Math.min(IMAGE_ZOOM_RANGE.max, Math.max(IMAGE_ZOOM_RANGE.min, scale));
}

/** Wheel notches multiply the zoom so each one feels the same at any scale. */
export function zoomFromWheel(scale: number, deltaY: number): number {
  return clampZoom(scale * Math.exp(-deltaY * 0.002));
}
