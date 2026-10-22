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
    imageInput: false,
  })),
  updateCustomProvider: vi.fn(async () => ({
    id: "custom-abc12345",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama-3.1"],
    hasApiKey: true,
    imageInput: false,
  })),
  deleteCustomProvider: vi.fn(async () => {}),
  switchProvider: vi.fn(async () => {}),
  listRemoteModels: vi.fn(async () => ["qwen-2.5"]),
  chatgptLogin: vi.fn(async () => ({ email: "reader@example.com", models: ["gpt-6.1-sol"] })),
  chatgptCancelLogin: vi.fn(async () => {}),
  chatgptLogout: vi.fn(async () => {}),
  loading: false,
  saving: false,
  signingIn: false,
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
  providersWithKey: ["anthropic", "openai"],
  customProviders: [
    {
      id: "custom-abc12345",
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      models: ["llama-3.1"],
      hasApiKey: true,
      imageInput: false,
    },
  ],
};

const customSnapshot: AgentConfigSnapshot = {
  configured: true,
  provider: "custom-abc12345",
  model: "llama-3.1",
  hasApiKey: true,
  providersWithKey: [],
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

async function chooseProvider(view: ReturnType<typeof render>, name: string) {
  await openProviderSelect(view);
  act(() => {
    view.getByRole("option", { name }).click();
  });
  await waitFor(() => expect(view.queryByRole("listbox")).toBeNull());
}

function fillNewCustom(view: ReturnType<typeof render>, name: string, baseUrl: string) {
  fireEvent.change(view.getByPlaceholderText("如：本地 Ollama"), { target: { value: name } });
  fireEvent.change(view.getByPlaceholderText("如：http://localhost:11434/v1"), {
    target: { value: baseUrl },
  });
  fireEvent.change(view.getByPlaceholderText("本地服务填任意占位值"), {
    target: { value: "sk-local" },
  });
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
  hook.chatgptLogin.mockClear();
  hook.chatgptLogout.mockClear();
  hook.signingIn = false;
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
    expect(view.getByDisplayValue("http://localhost:11434/v1")).toBeTruthy();
  });

  it("keeps the saved key of an inactive built-in provider", async () => {
    const view = renderForm(builtinSnapshot);
    await chooseProvider(view, "Anthropic");

    expect(view.getByPlaceholderText("已配置，留空保持不变")).toBeTruthy();
    fireEvent.change(view.getByPlaceholderText("claude-opus-4-5"), {
      target: { value: "claude-opus-4-5" },
    });
    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.save).toHaveBeenCalledWith("anthropic", "", "claude-opus-4-5");
  });

  it("requires a key for a built-in provider without one", async () => {
    const view = renderForm(builtinSnapshot);
    await chooseProvider(view, "DeepSeek");
    fireEvent.change(view.getByPlaceholderText("deepseek-v4-pro"), {
      target: { value: "deepseek-v4-pro" },
    });

    expect(view.getByPlaceholderText("输入 API Key")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "保存并应用" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("orders fields provider, name, base url, key, model, then image input", () => {
    const view = renderForm(customSnapshot);
    const labels = Array.from(view.container.querySelectorAll("label")).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual([
      "供应商",
      "名称",
      "Base URL",
      "API Key",
      "Model",
      "支持图片输入开启后 AI 可以查看书中的插图。仅在模型确实支持图片时开启，否则请求会失败。",
    ]);
  });

  it("updates a custom provider when image input is toggled", async () => {
    const view = renderForm(customSnapshot);
    const toggle = view.getByRole("switch", { name: /支持图片输入/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.updateCustomProvider).toHaveBeenCalledWith(
      "custom-abc12345",
      "Ollama",
      "http://localhost:11434/v1",
      "",
      ["llama-3.1"],
      true,
    );
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "llama-3.1");
  });

  it("hides the image input toggle for built-in providers", () => {
    const view = renderForm(builtinSnapshot);
    expect(view.queryByRole("switch", { name: /支持图片输入/ })).toBeNull();
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
      false,
    );
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "llama-3.1");
  });

  it("creates and switches to a custom provider picked from the dropdown", async () => {
    const view = renderForm(builtinSnapshot);
    await chooseProvider(view, "添加自定义提供商…");

    expect(view.getByText("添加自定义 OpenAI 兼容供应商")).toBeTruthy();
    expect(view.queryByRole("button", { name: "删除自定义供应商" })).toBeNull();
    fillNewCustom(view, "vLLM", "http://localhost:8000/v1");
    await typeNewModelId(view, "qwen-2.5");

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.addCustomProvider).toHaveBeenCalledWith(
      "vLLM",
      "http://localhost:8000/v1",
      "sk-local",
      ["qwen-2.5"],
      false,
    );
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-new", "qwen-2.5");
    expect(hook.save).not.toHaveBeenCalled();
  });

  it("does not add the custom provider twice when the switch fails", async () => {
    hook.switchProvider.mockRejectedValueOnce(new Error("boom"));
    const view = renderForm(builtinSnapshot);
    await chooseProvider(view, "添加自定义提供商…");
    fillNewCustom(view, "vLLM", "http://localhost:8000/v1");
    await typeNewModelId(view, "qwen-2.5");

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });
    expect(hook.addCustomProvider).toHaveBeenCalledTimes(1);

    hook.snapshot = {
      ...builtinSnapshot,
      customProviders: [
        ...builtinSnapshot.customProviders,
        {
          id: "custom-new",
          name: "vLLM",
          baseUrl: "http://localhost:8000/v1",
          models: ["qwen-2.5"],
          hasApiKey: true,
          imageInput: false,
        },
      ],
    };
    view.rerender(<AgentConfigForm />);
    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.addCustomProvider).toHaveBeenCalledTimes(1);
    expect(hook.switchProvider).toHaveBeenLastCalledWith("custom-new", "qwen-2.5");
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

    expect(hook.deleteCustomProvider).toHaveBeenCalledWith("custom-abc12345");
  });

  it("refreshes the custom draft list and keeps a selection still returned upstream", async () => {
    hook.listRemoteModels.mockResolvedValueOnce(["qwen-2.5", "llama-3.1"]);
    const view = renderForm({
      ...customSnapshot,
      customProviders: [
        {
          ...customSnapshot.customProviders[0],
          models: ["llama-3.1", "retired-model"],
        },
      ],
    });

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
    expect(view.getByRole("combobox", { name: "Model" }).textContent).toBe("llama-3.1");

    await openModelCombobox(view);
    expect(view.getByRole("option", { name: "llama-3.1" })).toBeTruthy();
    expect(view.getByRole("option", { name: "qwen-2.5" })).toBeTruthy();
    expect(view.queryByRole("option", { name: "retired-model" })).toBeNull();
    expect(view.queryByRole("button", { name: "移除模型" })).toBeNull();
    expect(view.queryByRole("button", { name: "添加模型" })).toBeNull();
  });

  it("removes stale models and saves the replacement selection only on apply", async () => {
    hook.listRemoteModels.mockResolvedValueOnce(["qwen-2.5", "qwen-3"]);
    const view = renderForm(customSnapshot);

    await act(async () => {
      view.getByRole("button", { name: "刷新模型" }).click();
    });

    expect(view.getByRole("combobox", { name: "Model" }).textContent).toBe("qwen-2.5");
    expect(hook.updateCustomProvider).not.toHaveBeenCalled();
    expect(hook.switchProvider).not.toHaveBeenCalled();
    await openModelCombobox(view);
    expect(view.queryByRole("option", { name: "llama-3.1" })).toBeNull();
    expect(view.getByRole("option", { name: "qwen-3" })).toBeTruthy();
    act(() => {
      view.getByRole("option", { name: "qwen-2.5" }).click();
    });

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });

    expect(hook.updateCustomProvider).toHaveBeenCalledWith(
      "custom-abc12345",
      "Ollama",
      "http://localhost:11434/v1",
      "",
      ["qwen-2.5", "qwen-3"],
      false,
    );
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "qwen-2.5");
  });

  it.each(["Failed to fetch models", "no models returned"])(
    "keeps the existing models and selection when refresh fails: %s",
    async (message) => {
      hook.listRemoteModels.mockRejectedValueOnce({ code: "InvalidInput", message });
      const view = renderForm(customSnapshot);

      await act(async () => {
        view.getByRole("button", { name: "刷新模型" }).click();
      });

      expect(view.getByText(message)).toBeTruthy();
      expect(view.getByRole("combobox", { name: "Model" }).textContent).toBe("llama-3.1");
      await openModelCombobox(view);
      expect(view.getByRole("option", { name: "llama-3.1" })).toBeTruthy();
      act(() => {
        view.getByRole("option", { name: "llama-3.1" }).click();
      });

      await act(async () => {
        view.getByRole("button", { name: "保存并应用" }).click();
      });

      expect(hook.updateCustomProvider).not.toHaveBeenCalled();
      expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "llama-3.1");
    },
  );

  it("replaces the model draft when refreshing a new custom provider", async () => {
    const view = renderForm(builtinSnapshot);
    await chooseProvider(view, "添加自定义提供商…");
    fillNewCustom(view, "Ollama", "http://localhost:11434/v1");
    await typeNewModelId(view, "retired-model");

    await act(async () => {
      view.getByRole("button", { name: "刷新模型" }).click();
    });

    expect(view.getByRole("combobox", { name: "Model" }).textContent).toBe("qwen-2.5");
    expect(hook.listRemoteModels).toHaveBeenCalledWith(
      "http://localhost:11434/v1",
      "sk-local",
      undefined,
    );
    expect(hook.addCustomProvider).not.toHaveBeenCalled();
    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });
    expect(hook.addCustomProvider).toHaveBeenCalledWith(
      "Ollama",
      "http://localhost:11434/v1",
      "sk-local",
      ["qwen-2.5"],
      false,
    );
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
      false,
    );
    expect(hook.switchProvider).toHaveBeenCalledWith("custom-abc12345", "qwen-2.5");
    expect(hook.save).not.toHaveBeenCalled();
  });

  it("does not show refresh models for a built-in provider", () => {
    const view = renderForm(builtinSnapshot);
    expect(view.queryByRole("button", { name: "刷新模型" })).toBeNull();
    expect(hook.listRemoteModels).not.toHaveBeenCalled();
  });

  it("signs in with ChatGPT instead of asking for an API key", async () => {
    const view = renderForm(builtinSnapshot);
    await chooseProvider(view, "ChatGPT");

    expect(view.queryByPlaceholderText("输入 API Key")).toBeNull();
    expect((view.getByRole("button", { name: "保存并应用" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      view.getByRole("button", { name: "使用 ChatGPT 登录" }).click();
    });
    expect(hook.chatgptLogin).toHaveBeenCalledTimes(1);
  });

  it("applies a signed-in ChatGPT account through switch", async () => {
    const view = renderForm({
      ...builtinSnapshot,
      provider: "chatgpt",
      model: "gpt-6.1-sol",
      chatgptAccount: { email: "reader@example.com", models: ["gpt-6.1-sol", "gpt-6-luna"] },
    });
    expect(view.getByText("已登录：reader@example.com")).toBeTruthy();

    await act(async () => {
      view.getByRole("button", { name: "保存并应用" }).click();
    });
    expect(hook.switchProvider).toHaveBeenCalledWith("chatgpt", "gpt-6.1-sol");
    expect(hook.save).not.toHaveBeenCalled();

    await act(async () => {
      view.getByRole("button", { name: "退出登录" }).click();
    });
    expect(hook.chatgptLogout).toHaveBeenCalledTimes(1);
  });
});
