// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
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
let resolveImpl: (target: string) => unknown = (target) =>
  String(target).startsWith("epubcfi(") ? { index: 1 } : undefined;

class FakeFoliateView extends HTMLElement {
  open = vi.fn(async () => {});
  init = vi.fn(async (opts: Record<string, unknown>) => initImpl(opts));
  goToFraction = vi.fn(async () => {});
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
