// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const pickFontsMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  convertFileSrc: (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`,
}));

vi.mock("@/lib/platform-bridge", () => ({
  platformBridge: { pickFonts: () => pickFontsMock() },
}));

import {
  importFonts,
  importedFontFaceCss,
  importedFontFamilies,
  type ImportedFont,
} from "./imported-fonts";

function font(overrides: Partial<ImportedFont>): ImportedFont {
  return {
    id: "a",
    family: "Literata",
    weight: 400,
    italic: false,
    fileName: "Literata.ttf",
    path: "/data/fonts/a.ttf",
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  pickFontsMock.mockReset();
  document.getElementById("litera-imported-fonts")?.remove();
});

describe("importedFontFaceCss", () => {
  it("declares one face per file with its weight, style, and format", () => {
    const css = importedFontFaceCss([
      font({}),
      font({ id: "b", weight: 700, italic: true, path: "/data/fonts/b.otf" }),
    ]);

    expect(css).toContain(
      '@font-face { font-family: "Literata"; src: url("http://asset.localhost/%2Fdata%2Ffonts%2Fa.ttf") format("truetype"); font-weight: 400; font-style: normal;',
    );
    expect(css).toContain('format("opentype"); font-weight: 700; font-style: italic;');
  });

  it("escapes quotes in family names", () => {
    expect(importedFontFaceCss([font({ family: 'Odd "Name"' })])).toContain(
      'font-family: "Odd \\"Name\\"";',
    );
  });
});

describe("importedFontFamilies", () => {
  it("lists each family once", () => {
    expect(
      importedFontFamilies([font({}), font({ id: "b", weight: 700 }), font({ id: "c", family: "霞鹜文楷" })]),
    ).toEqual(["Literata", "霞鹜文楷"]);
  });
});

describe("importFonts", () => {
  it("imports each picked file, reports failures by name, and refreshes the faces", async () => {
    pickFontsMock.mockResolvedValue([
      { name: "Literata.ttf", path: "/cache/incoming-fonts/1.ttf" },
      { name: "broken.ttf", path: "/cache/incoming-fonts/2.ttf" },
      { name: "gone.ttf", error: "Permission denied" },
    ]);
    const imported = font({});
    invokeMock.mockImplementation((cmd: string, args?: { file?: { name: string } }) => {
      if (cmd === "import_incoming_font") {
        return args?.file?.name === "broken.ttf"
          ? Promise.reject({ code: "INVALID_INPUT", message: "The font file is damaged" })
          : Promise.resolve(imported);
      }
      if (cmd === "list_imported_fonts") return Promise.resolve([imported]);
      return Promise.resolve(undefined);
    });

    const outcome = await importFonts();

    expect(outcome.imported).toEqual([imported]);
    expect(outcome.errors).toEqual([
      "broken.ttf: The font file is damaged",
      "gone.ttf: Permission denied",
    ]);
    expect(document.getElementById("litera-imported-fonts")?.textContent).toContain(
      'font-family: "Literata"',
    );
  });

  it("does nothing when the picker is cancelled", async () => {
    pickFontsMock.mockResolvedValue([]);

    const outcome = await importFonts();

    expect(outcome).toEqual({ imported: [], errors: [] });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
