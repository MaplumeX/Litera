// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { setLocale } from "@/lib/i18n";
import { FootnotePopup, placeFootnotePopup } from "./FootnotePopup";

function PopupHarness(props: Omit<Parameters<typeof FootnotePopup>[0], "mountRef">) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  return <FootnotePopup {...props} mountRef={mountRef} />;
}

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

describe("FootnotePopup", () => {
  it("renders a loading placeholder before the inner view is attached", () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <PopupHarness x={100} y={200} height={null} viewElement={null} onClose={onClose} />,
    );
    expect(getByText("加载脚注中…")).toBeTruthy();
  });

  it("mounts the passed view element into the popup container", () => {
    const onClose = vi.fn();
    const view = document.createElement("div");
    view.dataset.testInner = "footnote-view";
    const { container } = render(
      <PopupHarness x={100} y={200} height={300} viewElement={view} onClose={onClose} />,
    );
    const popup = container.querySelector('[data-testid="footnote-popup"]');
    expect(popup?.querySelector('[data-test-inner="footnote-view"]')).toBe(view);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <PopupHarness x={100} y={200} height={300} viewElement={null} onClose={onClose} />,
    );
    fireEvent.click(getByRole("button", { name: "关闭脚注" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<PopupHarness x={100} y={200} height={300} viewElement={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores Escape while closed", () => {
    const onClose = vi.fn();
    render(<PopupHarness x={null} y={null} height={null} viewElement={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("unbinds Escape when unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <PopupHarness x={100} y={200} height={300} viewElement={null} onClose={onClose} />,
    );
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("placeFootnotePopup", () => {
  it("centers horizontally on the anchor and prefers below", () => {
    expect(
      placeFootnotePopup({
        x: 400,
        y: 200,
        width: 416,
        height: 100,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ left: 192, top: 208 });
  });

  it("clamps against the right viewport edge", () => {
    expect(
      placeFootnotePopup({
        x: 790,
        y: 120,
        width: 416,
        height: 80,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ left: 376, top: 128 });
  });

  it("flips above a bottom-edge anchor when there is more space above", () => {
    expect(
      placeFootnotePopup({
        x: 400,
        y: 550,
        width: 416,
        height: 200,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({ left: 192, top: 342 });
  });
});
