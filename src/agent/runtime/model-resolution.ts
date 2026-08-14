import type { Api, Model } from "@earendil-works/pi-ai";

export interface RuntimeModelConfig {
  provider: string;
  model: string;
  api: string;
  baseUrl: string;
}

type ModelCatalog = Record<string, Model<Api>>;

async function builtinCatalog(provider: string): Promise<ModelCatalog | null> {
  switch (provider) {
    case "anthropic": return (await import("@earendil-works/pi-ai/providers/anthropic.models")).ANTHROPIC_MODELS;
    case "openai": return (await import("@earendil-works/pi-ai/providers/openai.models")).OPENAI_MODELS;
    case "deepseek": return (await import("@earendil-works/pi-ai/providers/deepseek.models")).DEEPSEEK_MODELS;
    case "google": return (await import("@earendil-works/pi-ai/providers/google.models")).GOOGLE_MODELS;
    case "openrouter": return (await import("@earendil-works/pi-ai/providers/openrouter.models")).OPENROUTER_MODELS;
    case "groq": return (await import("@earendil-works/pi-ai/providers/groq.models")).GROQ_MODELS;
    case "mistral": return (await import("@earendil-works/pi-ai/providers/mistral.models")).MISTRAL_MODELS;
    case "xai": return (await import("@earendil-works/pi-ai/providers/xai.models")).XAI_MODELS;
    case "together": return (await import("@earendil-works/pi-ai/providers/together.models")).TOGETHER_MODELS;
    case "fireworks": return (await import("@earendil-works/pi-ai/providers/fireworks.models")).FIREWORKS_MODELS;
    default: return null;
  }
}

export async function resolveRuntimeModel(config: RuntimeModelConfig): Promise<Model<Api>> {
  const catalog = await builtinCatalog(config.provider);
  if (catalog) {
    const resolved = catalog[config.model];
    if (!resolved) throw new Error("当前提供商不支持所选模型");
    return resolved;
  }
  if (!config.provider.startsWith("custom-")) {
    throw new Error("不支持的模型提供商");
  }
  return {
    id: config.model,
    name: config.model,
    api: config.api as Api,
    provider: config.provider,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}
