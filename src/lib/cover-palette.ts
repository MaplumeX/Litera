import { useEffect, useState } from "react";

/**
 * The two tones a cover lends the interface around it. Both are dark enough
 * to carry white text: `deep` for body text, `glow` for the lit corner.
 */
export interface CoverPalette {
  deep: string;
  glow: string;
}

const HUE_BUCKETS = 24;
/** Below this share of colourful pixels a cover reads as black and white. */
const MIN_COLOURFUL_WEIGHT = 0.02;
/** Sampling a thumbnail is plenty for a dominant hue. */
const SAMPLE_SIZE = 32;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = ((green - blue) / delta + 6) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

/** Yellows and greens are bright at any given HSL lightness, so they sit lower. */
function glowLightness(hue: number): number {
  return hue >= 30 && hue <= 200 ? 28 : 38;
}

function paletteFromHue(hue: number, saturation: number): CoverPalette {
  const h = Math.round(hue);
  const s = Math.round(Math.min(saturation, 0.62) * 100);
  return {
    deep: `hsl(${h} ${s}% 16%)`,
    glow: `hsl(${h} ${Math.min(s + 8, 68)}% ${glowLightness(h)}%)`,
  };
}

/**
 * The cover's dominant hue, as a palette. Vivid mid-tones count most, so a
 * small saturated emblem beats a large off-white page; a cover with almost no
 * colour gets a near-neutral palette rather than a hue picked from noise.
 * Null when there are no opaque pixels to read.
 */
export function paletteFromPixels(data: ArrayLike<number>): CoverPalette | null {
  const weights = new Array<number>(HUE_BUCKETS).fill(0);
  const saturationSums = new Array<number>(HUE_BUCKETS).fill(0);
  let pixels = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    pixels += 1;
    const [hue, saturation, lightness] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // Peaks at mid lightness, nothing at pure black or white.
    const weight = saturation * saturation * (1 - Math.abs(2 * lightness - 1));
    const bucket = Math.floor(hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    weights[bucket] += weight;
    saturationSums[bucket] += weight * saturation;
  }
  if (pixels === 0) return null;
  let best = 0;
  let total = 0;
  for (let bucket = 0; bucket < HUE_BUCKETS; bucket += 1) {
    total += weights[bucket];
    if (weights[bucket] > weights[best]) best = bucket;
  }
  if (total / pixels < MIN_COLOURFUL_WEIGHT) return paletteFromHue(230, 0.1);
  const hue = (best + 0.5) * (360 / HUE_BUCKETS);
  return paletteFromHue(hue, saturationSums[best] / weights[best]);
}

/** A stable palette for a Book with no cover to read, derived from its title. */
export function paletteFromText(text: string): CoverPalette {
  let hash = 0;
  for (const char of text) {
    hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0;
  }
  return paletteFromHue(Math.abs(hash) % 360, 0.5);
}

/** The custom properties `.cover-ambient` paints with. */
export function paletteStyle(palette: CoverPalette): Record<string, string> {
  return { "--cover-deep": palette.deep, "--cover-glow": palette.glow };
}

const cache = new Map<string, Promise<CoverPalette | null>>();
/** Palettes already read, so a cover seen before paints its colour on the first frame. */
const resolved = new Map<string, CoverPalette>();

function readPalette(src: string): Promise<CoverPalette | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // Tauri's asset protocol answers with the window's origin, so an anonymous
    // request leaves the canvas readable; anywhere it does not, the read throws
    // and the caller keeps its fallback.
    image.crossOrigin = "anonymous";
    image.onerror = () => resolve(null);
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        resolve(paletteFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
      } catch {
        resolve(null);
      }
    };
    image.src = src;
  });
}

/**
 * The palette of a cover image, read once per URL. Until it is read, or if it
 * cannot be, this is the palette derived from `fallbackText`.
 */
export function useCoverPalette(src: string | null, fallbackText: string): CoverPalette {
  const [read, setRead] = useState<{ src: string; palette: CoverPalette } | null>(null);

  useEffect(() => {
    if (!src || resolved.has(src)) return;
    let current = true;
    let pending = cache.get(src);
    if (!pending) {
      pending = readPalette(src).then((palette) => {
        if (palette) resolved.set(src, palette);
        return palette;
      });
      cache.set(src, pending);
    }
    void pending.then((palette) => {
      if (current && palette) setRead({ src, palette });
    });
    return () => {
      current = false;
    };
  }, [src]);

  if (src) {
    const known = resolved.get(src);
    if (known) return known;
  }
  return read && read.src === src ? read.palette : paletteFromText(fallbackText);
}
