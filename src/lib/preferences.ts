import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import type { ReaderStyleState } from "@/lib/reader-styles";

interface PreferencesResponse {
  theme: string;
}

export function usePreferences() {
  const [theme, setThemeState] = useState<string>("light");
  const [loading, setLoading] = useState(true);

  // Debounced save so rapid theme switches coalesce into one write.
  const savePreferences = useDebouncedCallback(
    async (newTheme: string) => {
      await invoke("save_preferences", { theme: newTheme });
    },
    300,
    (error) => console.error("Failed to save preferences:", error),
  );

  useEffect(() => {
    let disposed = false;
    void invoke<PreferencesResponse>("get_preferences")
      .then((response) => {
        if (!disposed) setThemeState(response.theme);
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

  const setTheme = useCallback(
    (newTheme: string) => {
      setThemeState(newTheme);
      savePreferences.schedule(newTheme);
    },
    [savePreferences],
  );

  return { theme, setTheme, loading, flush: savePreferences.flush };
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