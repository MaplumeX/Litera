/** Longest a freshly loaded chapter stays hidden waiting for its fonts. */
export const FONT_WAIT_LIMIT_MS = 3000;

/**
 * Hide a freshly loaded chapter document until the faces its text uses have
 * loaded. Every chapter is a new iframe document that loads its fonts anew;
 * a large imported CJK face would otherwise paint the fallback first and then
 * visibly swap. Resolves once the chapter is shown again.
 */
export function hideUntilFontsReady(
  doc: Document,
  limitMs = FONT_WAIT_LIMIT_MS,
): Promise<void> {
  const root = doc.documentElement;
  root.style.setProperty("visibility", "hidden", "important");
  return new Promise((resolve) => {
    // The paginator lays the chapter out right after `load`; wait a frame so
    // the faces are requested before asking whether they are ready.
    requestAnimationFrame(() => {
      // Layout requests the faces the text actually uses.
      doc.body?.getBoundingClientRect();
      const ready = doc.fonts?.ready ?? Promise.resolve();
      const limit = new Promise((r) => setTimeout(r, limitMs));
      void Promise.race([ready, limit]).then(() => {
        root.style.removeProperty("visibility");
        resolve();
      });
    });
  });
}
