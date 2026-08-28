import type { Api, Model } from "@earendil-works/pi-ai";

export interface RuntimeModelConfig {
  provider: string;
  model: string;
  api: string;
  baseUrl: string;
  contextWindow?: number;
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

const FULL_CATALOG_PROVIDERS = ["anthropic", "openai", "deepseek", "google", "openrouter", "groq", "mistral", "xai", "together", "fireworks"] as const;
let fullCatalogPromise: Promise<Map<string, Model<Api>>> | null = null;

function fullCatalogIndex(): Promise<Map<string, Model<Api>>> {
  fullCatalogPromise ??= (async () => {
    const index = new Map<string, Model<Api>>();
    for (const provider of FULL_CATALOG_PROVIDERS) {
      const catalog = await builtinCatalog(provider);
      if (!catalog) continue;
      for (const model of Object.values(catalog)) index.set(model.id, model);
    }
    return index;
  })();
  return fullCatalogPromise;
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
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  // Catalog hit is only valid when its wire API matches the configured one
  // (a custom OpenAI-compatible relay must not inherit an anthropic-messages
  // stream function just because the model id exists in the pi-ai catalog).
  const catalogModel = (await fullCatalogIndex()).get(config.model);
  if (catalogModel && catalogModel.api === config.api) {
    return { ...catalogModel, provider: config.provider, baseUrl };
  }
  const probed = config.contextWindow;
  if (probed && probed > 0) {
    return {
      id: config.model,
      name: config.model,
      api: config.api as Api,
      provider: config.provider,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: probed,
      maxTokens: Math.max(256, Math.floor(probed / 8)),
    };
  }
  return {
    id: config.model,
    name: config.model,
    api: config.api as Api,
    provider: config.provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}