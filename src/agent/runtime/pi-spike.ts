import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { Type } from "typebox";
import { createGuardedNativeFetch } from "@/agent/transport/native-fetch";

// The compatibility test reads this value while the production runtime imports
// the same core and provider paths from embedded-runtime.ts.
export const PI_WEBVIEW_RUNTIME_READY = typeof Agent === "function" && typeof streamSimple === "function";

export interface PiSpikeConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export function createPiSpikeModel(config: PiSpikeConfig): Model<"openai-completions"> {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: config.provider,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

/** Minimal product-side Pi construction used by the WebView compatibility gate. */
export function createPiSpikeAgent(config: PiSpikeConfig): Agent {
  const nativeFetch = createGuardedNativeFetch({ baseUrl: config.baseUrl });
  const probeParameters = Type.Object({ marker: Type.String() });
  const probeTool: AgentTool<typeof probeParameters> = {
    name: "litera_runtime_probe",
    label: "Litera Runtime Probe",
    description: "Return a short marker proving that tool execution works.",
    parameters: probeParameters,
    execute: async (_toolCallId, { marker }) => ({
      content: [{ type: "text", text: marker }],
      details: { marker },
    }),
  };

  return new Agent({
    initialState: {
      systemPrompt: "You are Litera's embedded WebView runtime compatibility probe.",
      model: createPiSpikeModel(config),
      thinkingLevel: "off",
      tools: [probeTool],
    },
    streamFn: (model, context, options) => streamSimple(
      model as Model<"openai-completions">,
      context,
      {
      ...options,
      fetch: nativeFetch,
      maxRetries: 0,
      },
    ),
    getApiKey: () => config.apiKey,
    transport: "sse",
    onPayload: (_payload) => undefined,
  });
}
