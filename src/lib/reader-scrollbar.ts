import scrollbarCss from "@/scrollbar.css?raw";

let sheet: CSSStyleSheet | undefined;

/**
 * Give a Book's scroller the app's scrollbar. In scrolled flow it is foliate's
 * own container, inside a closed shadow root that page CSS cannot reach; the
 * iframe a loaded section lives in is the one way to that root.
 */
export function styleBookScrollbar(doc: Document): void {
  const root = doc.defaultView?.frameElement?.getRootNode();
  if (!(root instanceof ShadowRoot)) return;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(scrollbarCss);
  }
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
}
