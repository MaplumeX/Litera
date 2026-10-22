import { useEffect } from "react";
import { platformBridge, type SystemInsets } from "@/lib/platform-bridge";

const VARIABLES: Record<keyof SystemInsets, string> = {
  top: "--android-inset-top",
  bottom: "--android-inset-bottom",
  imeBottom: "--android-ime-bottom",
  left: "--android-inset-left",
  right: "--android-inset-right",
  cutoutTop: "--android-cutout-top",
  cutoutBottom: "--android-cutout-bottom",
};

export function applySystemInsets(insets: SystemInsets, style = document.documentElement.style) {
  for (const [key, name] of Object.entries(VARIABLES) as [keyof SystemInsets, string][]) {
    style.setProperty(name, `${insets[key]}px`);
  }
}

/**
 * Keeps the `--android-inset-*` CSS variables in step with the system bars,
 * the cutout and the keyboard (index.css keeps keyboard avoidance separate
 * from `--safe-*`, so a keyboard cannot become a sheet's padding). Asks
 * once on mount, so a page that loaded after the last change still gets
 * them, then follows the `insets` event. A no-op on desktop.
 */
export function useSystemInsets() {
  useEffect(() => {
    let disposed = false;
    // An event is newer than whatever the initial query returns.
    let heard = false;
    const unlisten = platformBridge.listen("insets", (insets) => {
      heard = true;
      applySystemInsets(insets);
    });
    void unlisten.ready
      .then(() => platformBridge.getInsets())
      .then((insets) => {
        if (insets && !disposed && !heard) applySystemInsets(insets);
      })
      .catch((error: unknown) => console.error("getInsets failed:", error));
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);
}
