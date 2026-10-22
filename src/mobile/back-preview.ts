/**
 * The predictive Back preview, after Material 3: while the Back gesture is
 * held, what it will close shrinks a little toward where it goes. A bottom
 * sheet sinks toward the bottom, the drawer toward its edge, a dialog in
 * place, and a page shrinks and leans away from the swipe, its corners
 * rounding, with the shell dimmed behind it. A full-screen dialog (Settings)
 * does the same with the page below showing through its backdrop.
 *
 * Letting go commits: an overlay's own exit animation (keyframes with only
 * a `to`) carries on from the shrunk state, and a page stays shrunk until
 * the page change takes it away (`releaseBackPreview`). Cancelling springs
 * back.
 */
export type BackPreviewKind = "sheet" | "drawer" | "dialog" | "fullscreen" | "page";
export type BackEdge = "left" | "right";

interface Preview {
  element: HTMLElement;
  kind: BackPreviewKind;
  edge: BackEdge;
  /** A full-screen dialog's backdrop, fading to show what's below. */
  scrim: HTMLElement | null;
  /** Dimmed behind a page with nothing under it. */
  shell: HTMLElement | null;
}

const SETTLE_MS = 230;
const SETTLE = `${SETTLE_MS}ms var(--ease-standard)`;

let current: Preview | null = null;

function styleFor(kind: BackPreviewKind, edge: BackEdge, progress: number) {
  const p = Math.min(1, Math.max(0, progress));
  switch (kind) {
    case "sheet":
      return { transform: `scale(${1 - 0.05 * p})`, transformOrigin: "50% 100%" };
    case "drawer":
      return { transform: `scale(${1 - 0.05 * p})`, transformOrigin: "0% 50%" };
    case "dialog":
      return { transform: `scale(${1 - 0.08 * p})`, transformOrigin: "50% 50%" };
    case "fullscreen":
    case "page": {
      const lean = (edge === "left" ? 1 : -1) * 16 * p;
      return { transform: `translateX(${lean}px) scale(${1 - 0.1 * p})`, transformOrigin: "50% 50%" };
    }
  }
}

function apply(preview: Preview, progress: number, transition = "") {
  const { element, kind, edge, scrim, shell } = preview;
  const { transform, transformOrigin } = styleFor(kind, edge, progress);
  element.style.transition = transition && `transform ${transition}, border-radius ${transition}`;
  element.style.transformOrigin = transformOrigin;
  element.style.transform = transform;
  if (kind === "page" || kind === "fullscreen") {
    element.style.borderRadius = `${28 * Math.min(1, progress)}px`;
    element.style.overflow = "hidden";
    element.style.backgroundColor = "var(--background)";
  }
  if (scrim) {
    scrim.style.transition = transition && `opacity ${transition}`;
    scrim.style.opacity = String(1 - Math.min(1, progress));
  }
  if (shell) shell.style.backgroundColor = "color-mix(in oklch, var(--background), black 30%)";
}

function clear({ element, scrim, shell }: Preview) {
  for (const property of ["transition", "transform", "transform-origin", "border-radius", "overflow", "background-color"]) {
    element.style.removeProperty(property);
  }
  scrim?.style.removeProperty("transition");
  scrim?.style.removeProperty("opacity");
  shell?.style.removeProperty("background-color");
}

function settle(preview: Preview) {
  apply(preview, 0, SETTLE);
  setTimeout(() => clear(preview), SETTLE_MS);
}

/** The gesture began over `element`. A preview still on screen springs back first. */
export function startBackPreview(
  element: HTMLElement,
  kind: BackPreviewKind,
  edge: BackEdge,
  { scrim = null, shell = null }: { scrim?: HTMLElement | null; shell?: HTMLElement | null } = {},
) {
  if (current) settle(current);
  for (const animation of element.getAnimations()) animation.finish();
  current = { element, kind, edge, scrim, shell };
  apply(current, 0);
}

export function updateBackPreview(progress: number) {
  if (current) apply(current, progress);
}

/** The gesture was abandoned: back to how it was. */
export function cancelBackPreview() {
  if (!current) return;
  settle(current);
  current = null;
}

/**
 * Back committed. An overlay closes from where it is; one that stays
 * mounted (hidden) or didn't close after all is put back once its exit is
 * over. A page holds until `releaseBackPreview` or `cancelBackPreview`.
 */
export function commitBackPreview() {
  if (!current || current.kind === "page") return;
  const preview = current;
  current = null;
  setTimeout(() => {
    if (preview.element.isConnected) settle(preview);
  }, 400);
}

/** The page change a page preview was for has happened (or is happening). */
export function releaseBackPreview() {
  if (!current) return;
  clear(current);
  current = null;
}
