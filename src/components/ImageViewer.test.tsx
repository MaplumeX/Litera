// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "@/components/ImageViewer";

afterEach(cleanup);

const image = { src: "blob:map", alt: "A map" };

function picture(): HTMLImageElement {
  return screen.getByRole("img", { name: "A map" }) as HTMLImageElement;
}

describe("ImageViewer", () => {
  it("opens as a dialog fitted to the window with focus inside", () => {
    render(<ImageViewer image={image} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "A map" })).toBeTruthy();
    expect(picture().style.transform).toContain("scale(1)");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭" }));
  });

  it("zooms with the buttons and resets to fit", () => {
    render(<ImageViewer image={image} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(picture().style.transform).toContain("scale(1.5)");
    expect(screen.getByText("150%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "适应窗口" }));
    expect(picture().style.transform).toContain("scale(1)");
  });

  it("closes on Esc without letting it reach the reader", () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    render(<ImageViewer image={image} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    window.removeEventListener("keydown", outer);
    expect(onClose).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it("closes on a click on the backdrop but not on the picture", () => {
    const onClose = vi.fn();
    render(<ImageViewer image={image} onClose={onClose} />);
    const stage = screen.getByTestId("image-viewer-stage");
    fireEvent.pointerDown(picture(), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(picture(), { button: 0, clientX: 10, clientY: 10 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(stage, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(stage, { button: 0, clientX: 10, clientY: 10 });
    expect(onClose).toHaveBeenCalled();
  });
});
