import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_PAGE_MARGIN,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_THEME,
  normalizeLineHeight,
  normalizePageMargin,
  normalizeTextAlign,
  THEMES,
  type LineHeightValue,
  type PageMarginValue,
  type ReaderStyleState,
  type TextAlignValue,
} from "@/lib/reader-styles";

export interface AppPreferences {
  theme: string;
  lineHeight: LineHeightValue;
  pageMargin: PageMarginValue;
  textAlign: TextAlignValue;
}

interface PreferencesResponse {
  theme?: string;
  lineHeight?: string;
  pageMargin?: string;
  textAlign?: string;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: DEFAULT_THEME,
  lineHeight: DEFAULT_LINE_HEIGHT,
  pageMargin: DEFAULT_PAGE_MARGIN,
  textAlign: DEFAULT_TEXT_ALIGN,
};

function normalizePreferences(response: PreferencesResponse | null | undefined): AppPreferences {
  const theme = response?.theme;
  return {
    theme: theme && (THEMES as readonly string[]).includes(theme) ? theme : DEFAULT_THEME,
    lineHeight: normalizeLineHeight(response?.lineHeight),
    pageMargin: normalizePageMargin(response?.pageMargin),
    textAlign: normalizeTextAlign(response?.textAlign),
  };
}

export function usePreferences() {
  const [preferences, setPreferencesState] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);

  // Debounced save so rapid switches coalesce into one write of the latest full record.
  const savePreferences = useDebouncedCallback(
    async (next: AppPreferences) => {
      await invoke("save_preferences", {
        theme: next.theme,
        lineHeight: next.lineHeight,
        pageMargin: next.pageMargin,
        textAlign: next.textAlign,
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
 * Derive the CSS class for the root container from the global theme.
 * "light" → empty string (default :root), "dark" → "dark", "sepia" → "sepia".
 */
export function themeToClassName(theme: string): string {
  if (theme === "dark" || theme === "sepia") return theme;
  return "";
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
