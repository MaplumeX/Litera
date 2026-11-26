// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuideStepImages } from "./GuideStepImages";
import type { GuideStep } from "@/types/agent";

afterEach(cleanup);

const step: GuideStep = {
  from: { chapterIndex: 0, block: 0 },
  to: { chapterIndex: 0, block: 2 },
};

describe("GuideStepImages", () => {
  it("loads step figures lazily and opens ImageViewer on click", async () => {
    const loadImages = vi.fn(async () => [
      { src: "images/fig1.png", alt: "Figure 1", caption: "图 1 财政收支结构" },
    ]);
    const loadImageUrl = vi.fn(async () => "blob:fig1");
    const view = render(
      <GuideStepImages step={step} loadImages={loadImages} loadImageUrl={loadImageUrl} />,
    );
    const img = await view.findByAltText("图 1 财政收支结构");
    expect(img.getAttribute("src")).toBe("blob:fig1");
    fireEvent.click(img.closest("button")!);
    expect(await view.findByRole("dialog", { name: "图 1 财政收支结构" })).toBeTruthy();
  });

  it("hides tiny decorative images once their natural dimensions load", async () => {
    const loadImages = vi.fn(async () => [
      { src: "images/rule.png", alt: "divider" },
    ]);
    const loadImageUrl = vi.fn(async () => "blob:rule");
    const view = render(
      <GuideStepImages step={step} loadImages={loadImages} loadImageUrl={loadImageUrl} />,
    );
    const img = await view.findByAltText("divider");
    Object.defineProperty(img, "naturalWidth", { value: 24, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 12, configurable: true });
    fireEvent.load(img);
    await waitFor(() => expect(view.queryByTestId("guide-step-images")).toBeNull());
  });
});
