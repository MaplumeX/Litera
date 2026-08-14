/** A custom OpenAI-compatible provider entry listed in the settings dialog. */
export interface CustomProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
}

/** Snapshot of the agent configuration returned by `get_agent_config`. */
export interface AgentConfigSnapshot {
  configured: boolean;
  provider: string | null;
  model: string | null;
  hasApiKey: boolean;
  customProviders: CustomProviderEntry[];
}

/** Returns true when `id` is a custom provider (prefixes `custom-`). */
export function isCustomProviderId(id: string): boolean {
  return id.startsWith("custom-");
}

/** A built-in provider entry shown in the settings dropdown. */
export interface AgentProviderEntry {
  id: string;
  label: string;
  exampleModel: string;
}

/** Common api_key-type providers extracted from the pi-ai catalog. */
export const AGENT_PROVIDERS: AgentProviderEntry[] = [
  { id: "anthropic", label: "Anthropic", exampleModel: "claude-opus-4-5" },
  { id: "openai", label: "OpenAI", exampleModel: "gpt-4o" },
  { id: "deepseek", label: "DeepSeek", exampleModel: "deepseek-v4-pro" },
  { id: "google", label: "Google", exampleModel: "gemini-2.5-pro" },
  { id: "openrouter", label: "OpenRouter", exampleModel: "~anthropic/claude-opus-latest" },
  { id: "groq", label: "Groq", exampleModel: "llama-3.3-70b-versatile" },
  { id: "mistral", label: "Mistral", exampleModel: "mistral-large-latest" },
  { id: "xai", label: "xAI", exampleModel: "grok-4.3" },
  { id: "together", label: "Together", exampleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", label: "Fireworks", exampleModel: "accounts/fireworks/models/deepseek-v4-pro" },
];

/** Returns the example model id for a provider, or an empty string if unknown. */
export function findProviderExample(providerId: string): string {
  return AGENT_PROVIDERS.find((p) => p.id === providerId)?.exampleModel ?? "";
}
