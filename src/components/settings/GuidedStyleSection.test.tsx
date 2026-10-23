// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invalidateConfig } = vi.hoisted(() => ({ invalidateConfig: vi.fn() }));
vi.mock("@/agent/runtime/embedded-runtime", () => ({ embeddedAgentRuntime: { invalidateConfig } }));

import { DEFAULT_GUIDED_STYLE } from "@/agent/runtime/guide";
import { loadGuidedStyle } from "@/lib/guided-style";
import { GuidedStyleSection } from "./GuidedStyleSection";

afterEach(() => {
  cleanup();
  localStorage.clear();
  invalidateConfig.mockClear();
});

describe("GuidedStyleSection", () => {
  it("starts from the default and saves an edit for later prompts", () => {
    const view = render(<GuidedStyleSection />);
    const field = view.getByLabelText("带读风格") as HTMLTextAreaElement;
    expect(field.value).toBe(DEFAULT_GUIDED_STYLE);
    expect((view.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "Use tables." } });
    fireEvent.click(view.getByRole("button", { name: "保存" }));
    expect(loadGuidedStyle()).toBe("Use tables.");
    expect(invalidateConfig).toHaveBeenCalled();
    expect(view.getByText("已保存")).toBeTruthy();
  });

  it("restores the default, which clears the stored style", () => {
    localStorage.setItem("litera.guided-style", "Use tables.");
    const view = render(<GuidedStyleSection />);
    fireEvent.click(view.getByRole("button", { name: "恢复默认" }));
    expect((view.getByLabelText("带读风格") as HTMLTextAreaElement).value).toBe(DEFAULT_GUIDED_STYLE);
    fireEvent.click(view.getByRole("button", { name: "保存" }));
    expect(loadGuidedStyle()).toBeNull();
  });
});
