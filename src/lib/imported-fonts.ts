import { useSyncExternalStore } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { invokeErrorMessage } from "@/lib/app-error";
import { platformBridge } from "@/lib/platform-bridge";

/**
 * Fonts the reader imported on this device (Android picker). Each face is a
 * file the WebView loads through the asset protocol; faces sharing a
 * `family` form one entry in the font pickers. Never synced: a Book whose
 * font isn't imported here falls back to serif in CSS.
 */
export interface ImportedFont {
  id: string;
  family: string;
  weight: number;
  italic: boolean;
  fileName: string;
  path: string;
}

export interface FontImportOutcome {
  imported: ImportedFont[];
  /** One message per file that couldn't be imported, prefixed with its name. */
  errors: string[];
}

const STYLE_ELEMENT_ID = "litera-imported-fonts";

let fonts: ImportedFont[] = [];
const listeners = new Set<() => void>();

function setFonts(next: ImportedFont[]): void {
  fonts = next;
  applyDocumentFontFaces(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getFonts(): ImportedFont[] {
  return fonts;
}

/** Re-read the list from disk; startup calls this once. */
export function refreshImportedFonts(): Promise<void> {
  return invoke<ImportedFont[]>("list_imported_fonts")
    .then(setFonts)
    .catch((error: unknown) => console.error("Failed to list imported fonts:", error));
}

/** The imported faces, kept current across the app. */
export function useImportedFonts(): ImportedFont[] {
  return useSyncExternalStore(subscribe, getFonts, getFonts);
}

/** Pick font files with the system picker and import them one by one. */
export async function importFonts(): Promise<FontImportOutcome> {
  const picked = await platformBridge.pickFonts();
  const outcome: FontImportOutcome = { imported: [], errors: [] };
  for (const file of picked) {
    if (!file.path) {
      outcome.errors.push(`${file.name}: ${file.error ?? "unreadable"}`);
      continue;
    }
    try {
      outcome.imported.push(
        await invoke<ImportedFont>("import_incoming_font", {
          file: { path: file.path, name: file.name },
        }),
      );
    } catch (error) {
      outcome.errors.push(`${file.name}: ${invokeErrorMessage(error)}`);
    }
  }
  if (picked.length > 0) await refreshImportedFonts();
  return outcome;
}

export async function deleteImportedFont(id: string): Promise<void> {
  try {
    await invoke("delete_imported_font", { id });
  } finally {
    await refreshImportedFonts();
  }
}

/** Unique family names, in list order. */
export function importedFontFamilies(list: readonly ImportedFont[]): string[] {
  return [...new Set(list.map((font) => font.family))];
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** One `@font-face` per imported face, for the app document and the reader. */
export function importedFontFaceCss(list: readonly ImportedFont[]): string {
  return list
    .map((font) => {
      const format = font.path.toLowerCase().endsWith(".otf") ? "opentype" : "truetype";
      return `@font-face { font-family: ${cssString(font.family)}; src: url(${cssString(convertFileSrc(font.path))}) format("${format}"); font-weight: ${font.weight}; font-style: ${font.italic ? "italic" : "normal"}; font-display: swap; }`;
    })
    .join("\n");
}

/** The app's own document (font pickers, UI chrome) uses the faces too. */
function applyDocumentFontFaces(list: readonly ImportedFont[]): void {
  if (typeof document === "undefined") return;
  let element = document.getElementById(STYLE_ELEMENT_ID);
  if (!element) {
    element = document.createElement("style");
    element.id = STYLE_ELEMENT_ID;
    document.head.appendChild(element);
  }
  element.textContent = importedFontFaceCss(list);
}
