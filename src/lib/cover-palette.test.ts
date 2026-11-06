import { describe, expect, it } from "vitest";
import { paletteFromPixels, paletteFromText, type CoverPalette } from "@/lib/cover-palette";

function solid(r: number, g: number, b: number, count = 16): number[] {
  return Array.from({ length: count }, () => [r, g, b, 255]).flat();
}

function hueOf(color: string): number {
  return Number(/hsl\((\d+)/.exec(color)?.[1]);
}

/** WCAG contrast of white on an `hsl(h s% l%)` colour. */
function whiteContrast(color: string): number {
  const match = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(color);
  if (!match) throw new Error(`not hsl: ${color}`);
  const [h, s, l] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
  return 1.05 / (luminance + 0.05);
}

describe("paletteFromPixels", () => {
  it("takes the hue of a solid colour", () => {
    const red = paletteFromPixels(solid(200, 40, 40)) as CoverPalette;
    expect(Math.min(hueOf(red.deep), 360 - hueOf(red.deep))).toBeLessThan(15);
    const blue = paletteFromPixels(solid(40, 60, 200)) as CoverPalette;
    expect(Math.abs(hueOf(blue.deep) - 232)).toBeLessThan(15);
  });

  it("lets a vivid emblem win over a larger off-white page", () => {
    const pixels = [...solid(245, 243, 238, 90), ...solid(30, 150, 80, 10)];
    const palette = paletteFromPixels(pixels) as CoverPalette;
    expect(Math.abs(hueOf(palette.deep) - 142)).toBeLessThan(15);
  });

  it("stays near neutral on a black and white cover", () => {
    const palette = paletteFromPixels([...solid(0, 0, 0), ...solid(255, 255, 255), ...solid(128, 128, 128)]);
    expect(palette?.deep).toMatch(/hsl\(230 10% /);
  });

  it("skips transparent pixels and has nothing to say without opaque ones", () => {
    expect(paletteFromPixels([200, 40, 40, 0])).toBeNull();
    expect(paletteFromPixels([])).toBeNull();
  });
});

describe("paletteFromText", () => {
  it("is stable for a title and varies between titles", () => {
    expect(paletteFromText("呐喊")).toEqual(paletteFromText("呐喊"));
    expect(paletteFromText("呐喊").deep).not.toEqual(paletteFromText("Walden").deep);
  });
});

describe("palette contrast", () => {
  it("carries white text at every hue", () => {
    for (let hue = 0; hue < 360; hue += 5) {
      const rad = (hue / 60) % 6;
      const x = 1 - Math.abs((rad % 2) - 1);
      const [r, g, b] = [
        [1, x, 0],
        [x, 1, 0],
        [0, 1, x],
        [0, x, 1],
        [x, 0, 1],
        [1, 0, x],
      ][Math.floor(rad)];
      const palette = paletteFromPixels(solid(r * 255, g * 255, b * 255)) as CoverPalette;
      expect(whiteContrast(palette.deep)).toBeGreaterThanOrEqual(7);
      expect(whiteContrast(palette.glow)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
