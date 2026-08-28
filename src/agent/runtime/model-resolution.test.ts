import { describe, expect, it } from "vitest";
import { resolveRuntimeModel } from "./model-resolution";

describe("resolveRuntimeModel", () => {
  it("uses pinned Pi catalog metadata for built-in models", async () => {
    await expect(resolveRuntimeModel({
      provider: "openai",
      model: "gpt-5",
      api: "openai-completions",
      baseUrl: "https://wrong.example/v1",
    })).resolves.toMatchObject({
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      contextWindow: 400_000,
    });
    await expect(resolveRuntimeModel({
      provider: "mistral",
      model: "codestral-latest",
      api: "openai-completions",
      baseUrl: "https://wrong.example/v1",
    })).resolves.toMatchObject({
      api: "mistral-conversations",
      baseUrl: "https://api.mistral.ai",
    });
  });

  it("rejects an unknown built-in model instead of guessing its protocol", async () => {
    await expect(resolveRuntimeModel({
      provider: "openai",
      model: "not-a-real-model",
      api: "openai-completions",
      baseUrl: "https://api.openai.com/v1",
    })).rejects.toThrow("不支持所选模型");
  });

  it("resolves a custom model from the pi-ai catalog, keeping the custom baseUrl", async () => {
    await expect(resolveRuntimeModel({
      provider: "custom-abc12345",
      model: "deepseek-v4-pro",
      api: "openai-completions",
      baseUrl: "https://relay.example/v1",
    })).resolves.toMatchObject({
      provider: "custom-abc12345",
      baseUrl: "https://relay.example/v1",
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      api: "openai-completions",
    });
  });

  it("skips a catalog entry whose wire api differs from the configured one", async () => {
    // claude-* exists in the pi-ai catalog as anthropic-messages; a custom
    // OpenAI-compatible relay must fall through to probe/default instead.
    await expect(resolveRuntimeModel({
      provider: "custom-abc12345",
      model: "claude-fable-5",
      api: "openai-completions",
      baseUrl: "https://relay.example/v1",
    })).resolves.toMatchObject({ api: "openai-completions", contextWindow: 128_000, maxTokens: 8_192 });
  });

  it("uses the Rust-probed context window for custom models missing from the catalog", async () => {
    await expect(resolveRuntimeModel({
      provider: "custom-abc12345",
      model: "private-model",
      api: "openai-completions",
      baseUrl: "https://relay.example/v1",
      contextWindow: 200_000,
    })).resolves.toMatchObject({
      provider: "custom-abc12345",
      baseUrl: "https://relay.example/v1",
      contextWindow: 200_000,
      maxTokens: 25_000,
    });
  });

  it("falls back to 128k/8192 when no catalog entry or probe value exists", async () => {
    await expect(resolveRuntimeModel({
      provider: "custom-abc12345",
      model: "private-model",
      api: "openai-completions",
      baseUrl: "https://relay.example/v1",
    })).resolves.toMatchObject({
      contextWindow: 128_000,
      maxTokens: 8_192,
    });
  });
});
