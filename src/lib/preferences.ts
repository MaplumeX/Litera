import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import {
  DEFAULT_TYPOGRAPHY,
  DEFAULT_THEME,
  isFontFamily,
  migrateLineHeight,
  normalizeSettings,
  normalizeTextAlign,
  splitPageMargin,
  THEMES,
  type ReaderStyleState,
  type TypographyDefaults,
} from "@/lib/reader-styles";

export interface AppPreferences extends TypographyDefaults {
  theme: string;
}

interface PreferencesResponse {
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number | string;
  contentWidth?: number;
  pagePadding?: number;
  pageMargin?: string;
  textAlign?: string;
  letterSpacing?: number;
  paragraphSpacing?: number;
  firstLineIndent?: number;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: DEFAULT_THEME,
  ...DEFAULT_TYPOGRAPHY,
};

function normalizePreferences(response: PreferencesResponse | null | undefined): AppPreferences {
  const theme = response?.theme;
  const split = splitPageMargin(response?.pageMargin);
  const normalized = normalizeSettings(undefined, {
    theme: theme && (THEMES as readonly string[]).includes(theme) ? theme : DEFAULT_THEME,
    fontSize: response?.fontSize,
    fontFamily: isFontFamily(response?.fontFamily) ? response?.fontFamily : undefined,
    lineHeight: migrateLineHeight(response?.lineHeight),
    contentWidth: response?.contentWidth ?? split?.contentWidth,
    pagePadding: response?.pagePadding ?? split?.pagePadding,
    textAlign: normalizeTextAlign(response?.textAlign),
    letterSpacing: response?.letterSpacing,
    paragraphSpacing: response?.paragraphSpacing,
    firstLineIndent: response?.firstLineIndent,
  });
  const { theme: nextTheme, ...typography } = normalized;
  return { theme: nextTheme, ...typography };
}

export function usePreferences() {
  const [preferences, setPreferencesState] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);

  // Debounced save so rapid switches coalesce into one write of the latest full record.
  const savePreferences = useDebouncedCallback(
    async (next: AppPreferences) => {
      await invoke("save_preferences", {
        theme: next.theme,
        fontSize: next.fontSize,
        fontFamily: next.fontFamily,
        lineHeight: next.lineHeight,
        contentWidth: next.contentWidth,
        pagePadding: next.pagePadding,
        textAlign: next.textAlign,
        letterSpacing: next.letterSpacing,
        paragraphSpacing: next.paragraphSpacing,
        firstLineIndent: next.firstLineIndent,
      });
    },
    300,
    (error) => console.error("Failed to save preferences:", error),
  );

  useEffect(() => {
    let disposed = false;
    void invoke<PreferencesResponse>("get_preferences")
      .then((response) => {
        if (!disposed) setPreferencesState(normalizePreferences(response));
      })
      .catch((error) => {
        console.error("Failed to load preferences:", error);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const updatePreferences = useCallback(
    (patch: Partial<AppPreferences>) => {
      setPreferencesState((prev) => {
        const next = { ...prev, ...patch };
        savePreferences.schedule(next);
        return next;
      });
    },
    [savePreferences],
  );

  const setTheme = useCallback(
    (newTheme: string) => {
      updatePreferences({ theme: newTheme });
    },
    [updatePreferences],
  );

  return {
    theme: preferences.theme,
    setTheme,
    preferences,
    updatePreferences,
    loading,
    flush: savePreferences.flush,
  };
}

/**
 * Resolve the effective light/dark theme from the global preference.
 * "system" follows the OS `prefers-color-scheme`; anything else falls back
 * to light unless it is exactly "dark".
 */
export function resolveTheme(theme: string, systemDark: boolean): "light" | "dark" {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme === "dark" ? "dark" : "light";
}

/**
 * Derive the CSS class for the root container from the resolved theme.
 * Only light/dark reach this after resolution: "light" → empty string
 * (default :root), "dark" → "dark".
 */
export function themeToClassName(theme: string): string {
  return theme === "dark" ? "dark" : "";
}

/**
 * Type guard for ReaderStyleState theme field. Since theme is now derived from
 * global preferences, we export a helper to sync it.
 */
export function syncStyleTheme(
  style: ReaderStyleState,
  globalTheme: string,
): ReaderStyleState {
  if (style.theme === globalTheme) return style;
  return { ...style, theme: globalTheme };
}
