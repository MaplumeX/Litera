// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/agent/runtime/model-resolution", () => ({
  listBuiltinModelIds: vi.fn(async (provider: string) => {
    if (provider === "openai") return ["gpt-4o", "gpt-5", "gpt-5-mini"];
    return [];
  }),
}));

import { ModelSwitcher } from "./ModelSwitcher";
import { setLocale } from "@/lib/i18n";
import type { ModelSwitcherProps } from "./ModelSwitcher";

Element.prototype.scrollIntoView = vi.fn();

function baseProps(overrides: Partial<ModelSwitcherProps> = {}): ModelSwitcherProps {
  return {
    provider: "openai",
    model: "gpt-4o",
    configured: true,
    customModels: [],
    isStreaming: false,
    onModelSelect: vi.fn(),
    onOpenConfig: vi.fn(),
    ...overrides,
  };
}

function renderSwitcher(overrides: Partial<ModelSwitcherProps> = {}) {
  const props = baseProps(overrides);
  const view = render(<ModelSwitcher {...props} />);
  return { view, props };
}

beforeEach(() => {
  setLocale("zh-CN");
});

afterEach(() => {
  cleanup();
});

async function openList(view: ReturnType<typeof render>) {
  const label = document.documentElement.lang === "en" ? "Model" : "模型";
  fireEvent.click(view.getByRole("button", { name: label }));
  await waitFor(() => view.getByRole("listbox"));
  return view.getByRole("listbox");
}

describe("ModelSwitcher", () => {
  it("shows the current model id and lists built-in models on open", async () => {
    const { view } = renderSwitcher();
    expect(view.getByText("gpt-4o")).toBeTruthy();

    const list = await openList(view);
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "gpt-4o",
      "gpt-5",
      "gpt-5-mini",
    ]);
  });

  it("lists custom provider models instead of the builtin catalog", async () => {
    const { view } = renderSwitcher({
      provider: "custom-abc12345",
      model: "llama-3.1",
      customModels: ["llama-3.1", "qwen-2.5"],
    });
    expect(view.getByText("llama-3.1")).toBeTruthy();

    const list = await openList(view);
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["llama-3.1", "qwen-2.5"]);
  });

  it("prepends a free-text current model missing from the catalog", async () => {
    const { view } = renderSwitcher({ model: "legacy-free-text" });
    const list = await openList(view);
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "legacy-free-text",
      "gpt-4o",
      "gpt-5",
      "gpt-5-mini",
    ]);
  });

  it("marks the current model as selected", async () => {
    const { view } = renderSwitcher();
    const list = await openList(view);
    expect(
      within(list)
        .getAllByRole("option")
        .find((option) => option.getAttribute("aria-selected") === "true")?.textContent,
    ).toBe("gpt-4o");
  });

  it("fires onModelSelect with the picked id and closes the list", async () => {
    const onModelSelect = vi.fn();
    const { view } = renderSwitcher({ onModelSelect });
    const list = await openList(view);
    act(() => {
      within(list).getByRole("option", { name: "gpt-5" }).click();
    });
    expect(onModelSelect).toHaveBeenCalledWith("gpt-5");
    expect(view.queryByRole("listbox")).toBeNull();
  });

  it("disables the trigger while streaming", () => {
    const { view } = renderSwitcher({ isStreaming: true });
    expect((view.getByRole("button", { name: "模型" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("guides to config when not configured", () => {
    const onOpenConfig = vi.fn();
    const { view } = renderSwitcher({
      configured: false,
      provider: null,
      model: null,
      onOpenConfig,
    });
    expect(view.getByText("配置模型")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "模型" }));
    expect(onOpenConfig).toHaveBeenCalledTimes(1);
  });

  it("shows the English trigger label and options under the en locale", async () => {
    setLocale("en");
    const { view } = renderSwitcher();
    expect(view.getByText("gpt-4o")).toBeTruthy();
    const list = await openList(view);
    expect(within(list).getAllByRole("option").length).toBe(3);
  });
});
