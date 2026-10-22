// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../foliate-js/view.js", () => ({}));

vi.mock("../foliate-js/footnotes.js", () => ({
  FootnoteHandler: class FootnoteHandler {
    handle() {
      return undefined;
    }
    addEventListener() {}
    removeEventListener() {}
  },
}));

vi.mock("../foliate-js/overlayer.js", () => ({
  Overlayer: { highlight: vi.fn() },
}));

let initImpl: (opts: Record<string, unknown>) => Promise<void> = async () => {};
let openImpl: (view: FakeFoliateView) => void = () => {};
let resolveImpl: (target: string) => unknown = (target) =>
  String(target).startsWith("epubcfi(") ? { index: 1 } : undefined;

/** foliate's navigation history: push on jumps, replace on page turns. */
class FakeHistory extends EventTarget {
  states: unknown[] = [];
  index = -1;
  pushState = vi.fn((state: unknown) => {
    this.states.splice(this.index + 1);
    this.states.push(state);
    this.index += 1;
    this.dispatchEvent(new Event("index-change"));
  });
  replaceState = vi.fn((state: unknown) => {
    this.states[this.index] = state;
  });
  back = vi.fn(() => {
    if (this.index <= 0) return;
    this.index -= 1;
    this.dispatchEvent(new Event("index-change"));
  });
  forward = vi.fn(() => {
    if (this.index >= this.states.length - 1) return;
    this.index += 1;
    this.dispatchEvent(new Event("index-change"));
  });
  clear = vi.fn(() => {
    this.states = [];
    this.index = -1;
  });
  get canGoBack() {
    return this.index > 0;
  }
  get canGoForward() {
    return this.index < this.states.length - 1;
  }
}

class FakeFoliateView extends HTMLElement {
  history = new FakeHistory();
  open = vi.fn(async () => openImpl(this));
  init = vi.fn(async (opts: Record<string, unknown>) => {
    this.history.pushState(opts.lastLocation ?? 0);
    return initImpl(opts);
  });
  goToFraction = vi.fn(async (fraction: number) => {
    this.history.pushState({ fraction });
  });
  goTo = vi.fn(async (target: string) => {
    this.history.pushState(target);
    return { index: 0 };
  });
  next = vi.fn(async () => {});
  prev = vi.fn(async () => {});
  close = vi.fn();
  resolveNavigation = vi.fn((target: string) => resolveImpl(target));
  book = { toc: [] };
}

beforeAll(() => {
  if (!customElements.get("foliate-view")) {
    customElements.define("foliate-view", FakeFoliateView);
  }
});

import { ReaderView, type ReaderViewHandle } from "./ReaderView";

const fileData = {
  bytes: new Uint8Array(new ArrayBuffer(4)),
  name: "book.epub",
};

function viewEl(): FakeFoliateView {
  const el = document.querySelector("foliate-view");
  if (!el) throw new Error("missing foliate-view");
  return el as FakeFoliateView;
}

beforeEach(() => {
  initImpl = async () => {};
  openImpl = () => {};
  resolveImpl = (target) =>
    String(target).startsWith("epubcfi(") ? { index: 1 } : undefined;
});

afterEach(() => {
  cleanup();
});

describe("ReaderView open restore", () => {
  it("inits with lastLocation when initialCfi is set", async () => {
    const cfi = "epubcfi(/6/8!/4/2/1:0)";
    render(<ReaderView fileData={fileData} initialCfi={cfi} initialFraction={0.4} />);
    await waitFor(() => {
      expect(viewEl().init).toHaveBeenCalledWith({ lastLocation: cfi });
    });
    expect(viewEl().goToFraction).not.toHaveBeenCalled();
    expect(viewEl().init).not.toHaveBeenCalledWith({});
  });

  it("uses goToFraction when there is no CFI", async () => {
    render(<ReaderView fileData={fileData} initialFraction={0.4} />);
    await waitFor(() => {
      expect(viewEl().init).toHaveBeenCalledWith({});
    });
    expect(viewEl().goToFraction).toHaveBeenCalledWith(0.4);
  });

  it("falls back to goToFraction when stored CFI does not resolve", async () => {
    resolveImpl = () => undefined;
    render(
      <ReaderView
        fileData={fileData}
        initialCfi="epubcfi(/6/99!/4/2/1:0)"
        initialFraction={0.3}
      />,
    );
    await waitFor(() => {
      expect(viewEl().goToFraction).toHaveBeenCalledWith(0.3);
    });
    expect(viewEl().init).toHaveBeenCalledWith({});
    expect(viewEl().init).not.toHaveBeenCalledWith({
      lastLocation: "epubcfi(/6/99!/4/2/1:0)",
    });
  });

  it("falls back to goToFraction when CFI init throws", async () => {
    const error = new Error("unresolvable cfi");
    initImpl = async () => {
      throw error;
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ReaderView
        fileData={fileData}
        initialCfi="epubcfi(/6/8!/4/2/1:0)"
        initialFraction={0.25}
      />,
    );
    await waitFor(() => {
      expect(viewEl().goToFraction).toHaveBeenCalledWith(0.25);
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("styles the renderer before the first section renders", async () => {
    const calls: string[] = [];
    openImpl = (view) => {
      (view as unknown as { renderer: unknown }).renderer = {
        setStyles: (css: string) => calls.push(`setStyles:${css}`),
      };
    };
    initImpl = async () => {
      calls.push("init");
    };
    render(<ReaderView fileData={fileData} stylesCss="body { font-family: Reader; }" />);
    await waitFor(() => expect(calls).toContain("init"));
    expect(calls[0]).toBe("setStyles:body { font-family: Reader; }");
  });
});

describe("ReaderView setColumnCount", () => {
  function renderWithHandle() {
    let handle: ReaderViewHandle | null = null;
    render(
      <ReaderView
        ref={(r: ReaderViewHandle | null) => {
          handle = r;
        }}
        fileData={fileData}
      />,
    );
    return { get handle() { return handle; } };
  }

  function attachRenderer() {
    const setAttribute = vi.fn();
    (viewEl() as unknown as { renderer: unknown }).renderer = { setAttribute };
    return setAttribute;
  }

  it("sets max-column-count on the renderer", async () => {
    const { handle } = renderWithHandle();
    await waitFor(() => expect(handle).not.toBeNull());
    const setAttribute = attachRenderer();
    handle!.setColumnCount(3);
    expect(setAttribute).toHaveBeenCalledWith("max-column-count", "3");
  });

  it("clamps out-of-range counts into 1–3", async () => {
    const { handle } = renderWithHandle();
    await waitFor(() => expect(handle).not.toBeNull());
    const setAttribute = attachRenderer();
    handle!.setColumnCount(0);
    expect(setAttribute).toHaveBeenLastCalledWith("max-column-count", "1");
    handle!.setColumnCount(4);
    expect(setAttribute).toHaveBeenLastCalledWith("max-column-count", "3");
  });

  it("does not throw when the renderer is missing", async () => {
    const { handle } = renderWithHandle();
    await waitFor(() => expect(handle).not.toBeNull());
    expect(() => handle!.setColumnCount(2)).not.toThrow();
  });
});

function renderReader(props: Partial<Parameters<typeof ReaderView>[0]> = {}) {
  const ref: { current: ReaderViewHandle | null } = { current: null };
  const onHistoryChange = vi.fn();
  const utils = render(
    <ReaderView
      ref={(r: ReaderViewHandle | null) => {
        ref.current = r;
      }}
      fileData={fileData}
      onHistoryChange={onHistoryChange}
      {...props}
    />,
  );
  return { ref, onHistoryChange, ...utils };
}

describe("ReaderView navigation history", () => {
  it("opens with nothing to go back to, even after restoring a fraction", async () => {
    const onBookReady = vi.fn();
    const { onHistoryChange } = renderReader({ initialFraction: 0.4, onBookReady });
    await waitFor(() => expect(onBookReady).toHaveBeenCalled());
    expect(viewEl().goToFraction).toHaveBeenCalledWith(0.4);
    expect(viewEl().history.canGoBack).toBe(false);
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: false, canGoForward: false, readOn: false });
  });

  it("offers the way back after a jump and walks it", async () => {
    const onBookReady = vi.fn();
    const { ref, onHistoryChange } = renderReader({ onBookReady });
    await waitFor(() => expect(onBookReady).toHaveBeenCalled());
    await act(async () => {
      await ref.current!.goToCfi("epubcfi(/6/10!/4/2/1:0)");
    });
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: false });
    act(() => ref.current!.goBack());
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: false, canGoForward: true, readOn: false });
    act(() => ref.current!.goForward());
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: false });
  });

  it("keeps a burst of seeks as one history entry", async () => {
    const onBookReady = vi.fn();
    const { ref } = renderReader({ onBookReady });
    await waitFor(() => expect(onBookReady).toHaveBeenCalled());
    const view = viewEl() as FakeFoliateView & { renderer?: unknown; resolveNavigation: unknown };
    const rendererGoTo = vi.fn(async () => {});
    view.renderer = { goTo: rendererGoTo };
    await act(async () => {
      await ref.current!.goToFraction(0.3);
      await ref.current!.goToFraction(0.31);
      await ref.current!.goToFraction(0.32);
    });
    expect(view.goToFraction).toHaveBeenCalledTimes(1);
    expect(rendererGoTo).toHaveBeenCalledTimes(2);
    expect(view.history.replaceState).toHaveBeenLastCalledWith({ fraction: 0.32 });
    expect(view.history.states).toHaveLength(2);
  });

  it("steps through chapters without stacking history entries", async () => {
    const onBookReady = vi.fn();
    const { ref, onHistoryChange } = renderReader({ onBookReady });
    await waitFor(() => expect(onBookReady).toHaveBeenCalled());
    resolveImpl = (target) => ({ index: Number(String(target).replace(/\D/g, "")) });
    const view = viewEl() as FakeFoliateView & { renderer?: unknown };
    const rendererGoTo = vi.fn(async () => {});
    view.renderer = { goTo: rendererGoTo };
    await act(async () => {
      await ref.current!.goToCfi("epubcfi(/6/10!/4/2/1:0)");
      await ref.current!.turnToChapter("ch2.xhtml");
      await ref.current!.turnToChapter("ch3.xhtml");
    });
    expect(view.goTo).toHaveBeenCalledTimes(1);
    expect(rendererGoTo).toHaveBeenCalledTimes(2);
    expect(view.history.states).toHaveLength(2);
    expect(view.history.states[1]).toBe("ch3.xhtml");
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: false });
  });
});

describe("ReaderView reading on past a jump", () => {
  class FakeRenderer extends EventTarget {
    scrolled = false;
    start = 0;
    size = 600;
    page = 1;
    goTo = vi.fn(async () => {});
    relocate(reason: string, index: number, page: number) {
      this.page = page;
      this.dispatchEvent(new CustomEvent("relocate", { detail: { reason, index } }));
    }
  }

  async function openWithRenderer() {
    const renderer = new FakeRenderer();
    const onBookReady = vi.fn();
    const utils = renderReader({ onBookReady });
    (viewEl() as unknown as { renderer: FakeRenderer }).renderer = renderer;
    await waitFor(() => expect(onBookReady).toHaveBeenCalled());
    return { renderer, ...utils };
  }

  it("marks the jump read on after a few page turns, and fresh again on the next jump", async () => {
    const { ref, renderer, onHistoryChange } = await openWithRenderer();
    await act(async () => {
      await ref.current!.goToCfi("epubcfi(/6/10!/4/2/1:0)");
    });
    act(() => renderer.relocate("navigation", 4, 1));
    act(() => renderer.relocate("page", 4, 2));
    act(() => renderer.relocate("snap", 4, 3));
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: false });
    act(() => renderer.relocate("page", 5, 1));
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: true });

    act(() => ref.current!.goBack());
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: false, canGoForward: true, readOn: false });
  });

  it("does not count a jump's own landing or a page left unturned", async () => {
    const { ref, renderer, onHistoryChange } = await openWithRenderer();
    await act(async () => {
      await ref.current!.goToCfi("epubcfi(/6/10!/4/2/1:0)");
    });
    act(() => renderer.relocate("anchor", 4, 1));
    act(() => renderer.relocate("navigation", 7, 9));
    act(() => renderer.relocate("snap", 7, 9));
    act(() => renderer.relocate("snap", 7, 9));
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: false });
  });

  it("counts scrolled flow in viewport heights", async () => {
    const { ref, renderer, onHistoryChange } = await openWithRenderer();
    renderer.scrolled = true;
    await act(async () => {
      await ref.current!.goToCfi("epubcfi(/6/10!/4/2/1:0)");
    });
    act(() => renderer.relocate("navigation", 4, 0));
    renderer.start = 1200;
    act(() => renderer.relocate("scroll", 4, 0));
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: false });
    renderer.start = 1800;
    act(() => renderer.relocate("scroll", 4, 0));
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canGoBack: true, canGoForward: false, readOn: true });
  });
});

describe("ReaderView keyboard", () => {
  it("turns the page with Space and back with Shift+Space", async () => {
    renderReader();
    fireEvent.keyDown(window, { key: " " });
    expect(viewEl().next).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    expect(viewEl().prev).toHaveBeenCalledTimes(1);
  });

  it("gives Space to read-aloud while it is active", async () => {
    const onTtsToggle = vi.fn();
    renderReader({ ttsActive: true, onTtsToggle });
    fireEvent.keyDown(window, { key: " " });
    expect(onTtsToggle).toHaveBeenCalledTimes(1);
    expect(viewEl().next).not.toHaveBeenCalled();
  });

  it("pages with PageDown / ArrowDown and walks history with Alt+←", async () => {
    renderReader();
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(viewEl().next).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(viewEl().history.back).toHaveBeenCalled();
  });

  it("jumps to the book's start and end with Home / End", async () => {
    renderReader();
    fireEvent.keyDown(window, { key: "End" });
    expect(viewEl().goToFraction).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(window, { key: "Home" });
    expect(viewEl().goToFraction).toHaveBeenLastCalledWith(0);
  });

  it("leaves ↓ / Space to a scroll area pressed outside the Book", async () => {
    renderReader();
    const transcript = document.createElement("div");
    transcript.style.overflowY = "auto";
    Object.defineProperty(transcript, "scrollHeight", { value: 1000 });
    Object.defineProperty(transcript, "clientHeight", { value: 200 });
    document.body.appendChild(transcript);
    fireEvent.pointerDown(transcript);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: " " });
    expect(viewEl().next).not.toHaveBeenCalled();
    // ←/→ only ever turn pages.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(viewEl().next).toHaveBeenCalledTimes(1);
    transcript.remove();
  });

  it("leaves a hidden Book pane alone", async () => {
    renderReader({ keysDisabled: true });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(viewEl().next).not.toHaveBeenCalled();
  });
});

describe("ReaderView flow", () => {
  it("sets the renderer's flow and scrolls by lines with ↑/↓", async () => {
    const { ref } = renderReader();
    const setAttribute = vi.fn();
    const rendererNext = vi.fn(async () => {});
    (viewEl() as unknown as { renderer: unknown }).renderer = { setAttribute, next: rendererNext };
    ref.current!.setFlow("scrolled");
    expect(setAttribute).toHaveBeenCalledWith("flow", "scrolled");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(rendererNext).toHaveBeenCalledWith(80);
    expect(viewEl().next).not.toHaveBeenCalled();
  });
});

describe("ReaderView search", () => {
  it("returns null before a Book is open and starts foliate's whole-book search after", async () => {
    const { ref } = renderReader();
    const view = viewEl() as unknown as { book: unknown; search?: unknown; clearSearch?: unknown };
    const search = vi.fn(() => (async function* () {})());
    const clearSearch = vi.fn();
    view.search = search;
    view.clearSearch = clearSearch;
    view.book = undefined;
    expect(ref.current!.searchBook("river")).toBeNull();
    view.book = { toc: [] };
    expect(ref.current!.searchBook("river")).not.toBeNull();
    expect(search).toHaveBeenCalledWith({ query: "river" });
    ref.current!.clearSearch();
    expect(clearSearch).toHaveBeenCalled();
  });
});

describe("ReaderView images", () => {
  it("opens a clicked chapter picture in the viewer", async () => {
    renderReader();
    const doc = document.implementation.createHTMLDocument("chapter");
    doc.body.innerHTML = '<p><img src="blob:map" alt="A map"></p>';
    Object.defineProperty(doc.documentElement, "getBoundingClientRect", {
      value: () => ({ width: 900, height: 600 }),
    });
    act(() => {
      viewEl().dispatchEvent(new CustomEvent("load", { detail: { doc } }));
    });
    const img = doc.querySelector("img")!;
    act(() => {
      img.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 450, clientY: 100 }));
      img.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 450, clientY: 100 }));
    });
    expect(document.querySelector('[role="dialog"][aria-label="A map"]')).not.toBeNull();
    expect(viewEl().next).not.toHaveBeenCalled();
  });
});
