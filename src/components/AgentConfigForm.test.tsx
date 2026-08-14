// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfigSnapshot } from "@/types/agent-config";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

const hook = {
  snapshot: null as AgentConfigSnapshot | null,
  load: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
  addCustomProvider: vi.fn(async () => ({
    id: "custom-new",
    name: "New",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama-3.1"],
    hasApiKey: true,
  })),
  updateCustomProvider: vi.fn(async () => ({
    id: "custom-abc12345",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama-3.1"],
    hasApiKey: true,
  })),
  deleteCustomProvider: vi.fn(async () => {}),
  switchProvider: vi.fn(async () => {}),
  listRemoteModels: vi.fn(async () => ["qwen-2.5"]),
  loading: false,
  saving: false,
  error: null as string | null,
};

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => hook,
}));

import { AgentConfigForm } from "./AgentConfigForm";

const builtinSnapshot: AgentConfigSnapshot = {
  configured: true,
  provider: "openai",
  model: "gpt-4o",
  hasApiKey: true,
  customProviders: [
    {
      id: "custom-abc12345",
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      models: ["llama-3.1"],
      hasApiKey: true,
    },
  ],
};

const customSnapshot: AgentConfigSnapshot = {
  configured: true,
  provider: "custom-abc12345",
  model: "llama-3.1",
  hasApiKey: true,
  customProviders: builtinSnapshot.customProviders,
};

function renderForm(snapshot: AgentConfigSnapshot) {
  hook.snapshot = snapshot;
  return render(<AgentConfigForm />);
}

async function openProviderSelect(view: ReturnType<typeof render>) {
  const trigger = view.getAllByRole("combobox")[0];
  act(() => {
    trigger.click();
  });
  await waitFor(() => view.getByRole("option", { name: "OpenAI" }));
}

async function openModelCombobox(view: ReturnType<typeof render>) {
  const trigger = view.getByRole("combobox", { name: "Model" });
  act(() => {
    trigger.click();
  });
  await waitFor(() => view.getByPlaceholderText("搜索模型…"));
}

async function typeNewModelId(view: ReturnType<typeof render>, id: string) {
  await openModelCombobox(view);
  fireEvent.change(view.getByPlaceholderText("搜索模型…"), { target: { value: id } });
  const create = await waitFor(() => view.getByRole("option", { name: `使用 ${id}` }));
  act(() => {
    create.click();
  });
}

beforeEach(() => {
  hook.snapshot = null;
  hook.error = null;
  hook.load.mockClear();
  hook.save.mockClear();
  hook.addCustomProvider.mockClear();
  hook.updateCustomProvider.mockClear();
  hook.deleteCustomProvider.mockClear();
  hook.switchProvider.mockClear();
  hook.listRemoteModels.mockClear();
  hook.listRemoteModels.mockResolvedValue(["qwen-2.5"]);
});

afterEach(() => {
  cleanup();
});

describe("AgentConfigForm", () => {
  it("does not switch or save when the provider dropdown changes", async () => {
    const view = renderForm(builtinSnapshot);
    await openProviderSelect(view);
    act(() => {
      view.getByRole("option", { name: "Ollama (自定义)" }).click();
    });

    expect(hook.switchProvider).not.toHaveBeenCalled();
    expect(hook.save).not.toHaveBeenCalled();
    expect(hook.updateCustomProvider).not.toHaveBeenCalled();
    expect(view.getByText("这个提供商")).toBeTruthy();
    expect(view.getByDisplayValue("http://localhost:11434/v1")).toBeTruthy();
  });

  it("applies a built-in provider through save", async () => {
    const view = renderForm(builtinSnapshot);
    const model = view.getByPlaceholderText("gpt-4o");
    fireEvent.change(model, { target: { value: "gpt-4.1" } });

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.save).toHaveBeenCalledWith("openai", "", "gpt-4.1");
    expect(hook.switchProvider).not.toHaveBeenCalled();
  });

  it("applies a custom provider through switch, skipping unchanged update", async () => {
    const view = renderForm(customSnapshot);

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.updateCustomProvider).not.toHaveBeenCalled();
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "llama-3.1");
    expect(hook.save).not.toHaveBeenCalled();
  });

  it("updates a custom provider before switching when fields change", async () => {
    const view = renderForm(customSnapshot);
    fireEvent.change(view.getByDisplayValue("Ollama"), { target: { value: "本地 Ollama" } });

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.updateCustomProvider).toHaveBeenCalledWith(
      "custom-abc12345",
      "本地 Ollama",
      "http://localhost:11434/v1",
      "",
      ["llama-3.1"],
    );
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "llama-3.1");
  });

  it("adds a custom provider without switching", async () => {
    const view = renderForm(builtinSnapshot);
    act(() => {
      view.getByRole("button", { name: "添加自定义提供商" }).click();
    });

    fireEvent.change(view.getByPlaceholderText("如：本地 Ollama"), {
      target: { value: "vLLM" },
    });
    fireEvent.change(view.getByPlaceholderText("如：http://localhost:11434/v1"), {
      target: { value: "http://localhost:8000/v1" },
    });
    fireEvent.change(view.getByPlaceholderText("本地服务填任意占位值"), {
      target: { value: "sk-local" },
    });
    await typeNewModelId(view, "qwen-2.5");

    await act(async () => {
      view.getByRole("button", { name: "添加" }).click();
    });

    expect(hook.addCustomProvider).toHaveBeenCalledWith(
      "vLLM",
      "http://localhost:8000/v1",
      "sk-local",
      ["qwen-2.5"],
    );
    expect(hook.switchProvider).not.toHaveBeenCalled();
    expect(hook.save).not.toHaveBeenCalled();
    expect(view.getByText(/已添加/)).toBeTruthy();
  });

  it("requires delete confirmation before removing a custom provider", async () => {
    const view = renderForm(customSnapshot);
    act(() => {
      view.getByRole("button", { name: "删除自定义供应商" }).click();
    });

    expect(hook.deleteCustomProvider).not.toHaveBeenCalled();
    expect(view.getByRole("alertdialog")).toBeTruthy();

    await act(async () => {
      within(view.getByRole("alertdialog")).getByRole("button", { name: "删除" }).click();
    });

    expect(hook.deleteCustomProvider).toHaveBeenCalledWith("custom-abc12345", {
      restart: true,
    });
  });

  it("merges refreshed remote model ids into the custom draft list", async () => {
    hook.listRemoteModels.mockResolvedValueOnce(["qwen-2.5", "llama-3.1"]);
    const view = renderForm(customSnapshot);

    await act(async () => {
      view.getByRole("button", { name: "刷新模型" }).click();
    });

    expect(hook.listRemoteModels).toHaveBeenCalledWith(
      "http://localhost:11434/v1",
      "",
      "custom-abc12345",
    );
    expect(hook.save).not.toHaveBeenCalled();
    expect(hook.switchProvider).not.toHaveBeenCalled();
    expect(hook.updateCustomProvider).not.toHaveBeenCalled();

    await openModelCombobox(view);
    expect(view.getByRole("option", { name: "llama-3.1" })).toBeTruthy();
    expect(view.getByRole("option", { name: "qwen-2.5" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "移除模型" })).toBeNull();
    expect(view.queryByRole("button", { name: "添加模型" })).toBeNull();
  });

  it("appends a typed model id to the custom draft catalog", async () => {
    const view = renderForm(customSnapshot);
    await typeNewModelId(view, "qwen-2.5");

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.updateCustomProvider).toHaveBeenCalledWith(
      "custom-abc12345",
      "Ollama",
      "http://localhost:11434/v1",
      "",
      ["llama-3.1", "qwen-2.5"],
    );
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "qwen-2.5");
    expect(hook.save).not.toHaveBeenCalled();
  });

  it("does not show refresh models for a built-in provider", () => {
    const view = renderForm(builtinSnapshot);
    expect(view.queryByRole("button", { name: "刷新模型" })).toBeNull();
    expect(hook.listRemoteModels).not.toHaveBeenCalled();
  });
});
