import { flushSync } from "react-dom";

/**
 * How one page gives way to the next, after Material 3's transition
 * patterns: `push` and `pop` are the shared X axis (a sub-page and back),
 * `open` and `close` a container transform (a cover grows into the Book and
 * shrinks back into it), `fade` a fade-through for when there's no cover to
 * grow from. index.css draws each one.
 */
export type PageMotion = "push" | "pop" | "open" | "close" | "fade";

/** The one shared element of a container transform. */
const SHARED_NAME = "m-shared";

/**
 * Pages swap through the View Transitions API where the WebView has it:
 * the browser snapshots the old page, so both pages are on screen at once
 * and the new one's first, slow frame happens under a still picture.
 */
export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function";
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function onScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

// The cover the reader last tapped: a Book can be on the shelf twice
// ("Continue reading" and the grid), and it should open out of that one.
let coverOrigin: HTMLElement | null = null;

/** Remember the cover inside a tapped Book, for `bookCover`. */
export function rememberCoverOrigin(target: Element) {
  coverOrigin = target.querySelector<HTMLElement>("[data-book-cover]");
}

/** A Book's cover on screen now, the tapped one first. Null when it's scrolled away. */
export function bookCover(bookId: string): HTMLElement | null {
  if (coverOrigin?.isConnected && coverOrigin.dataset.bookCover === bookId && onScreen(coverOrigin)) {
    return coverOrigin;
  }
  const covers = document.querySelectorAll<HTMLElement>("[data-book-cover]");
  return Array.from(covers).find((cover) => cover.dataset.bookCover === bookId && onScreen(cover)) ?? null;
}

let running: ViewTransition | null = null;

/**
 * Change pages with a motion. `commit` makes the state change; it runs
 * synchronously (flushSync) so the browser captures the new page right
 * after. `guard` runs after the old page is captured (so its own state
 * changes, like closing the Book, don't show) and false calls the change
 * off. `prepare` is work the new page should already show (a fresh shelf
 * order) and gets a short grace period. `sharedFrom` and `sharedTo` are the
 * container transform's two ends; without both on screen, it fades through.
 *
 * Without the API, or with reduced motion, it just commits: the caller's
 * CSS entrance (or nothing) takes over.
 */
export async function transitionPage({
  motion,
  commit,
  guard,
  prepare,
  sharedFrom,
  sharedTo,
}: {
  motion: PageMotion;
  commit: () => void;
  guard?: () => Promise<boolean>;
  prepare?: () => Promise<unknown>;
  sharedFrom?: () => Element | null;
  sharedTo?: () => Element | null;
}): Promise<void> {
  if (!supportsViewTransitions() || reducedMotion()) {
    if (!guard || (await guard())) commit();
    return;
  }
  running?.skipTransition();

  const root = document.documentElement;
  const from = sharedFrom?.() ?? null;
  const fromEl = from instanceof HTMLElement && onScreen(from) ? from : null;
  let toEl: HTMLElement | null = null;
  if (fromEl) fromEl.style.viewTransitionName = SHARED_NAME;
  root.dataset.pageMotion = fromEl ? motion : motion === "open" || motion === "close" ? "fade" : motion;

  const transition = document.startViewTransition(async () => {
    if (fromEl) fromEl.style.viewTransitionName = "";
    if (guard && !(await guard())) {
      transition.skipTransition();
      return;
    }
    if (prepare) {
      await Promise.race([prepare().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 300))]);
    }
    flushSync(commit);
    const to = fromEl ? (sharedTo?.() ?? null) : null;
    if (to instanceof HTMLElement && onScreen(to)) {
      toEl = to;
      toEl.style.viewTransitionName = SHARED_NAME;
    } else if (fromEl) {
      // Nothing to land on: the old end fades out where it is.
      root.dataset.pageMotion = "fade";
    }
  });
  running = transition;
  void transition.finished.finally(() => {
    if (toEl) toEl.style.viewTransitionName = "";
    if (running !== transition) return;
    running = null;
    delete root.dataset.pageMotion;
  });
}
