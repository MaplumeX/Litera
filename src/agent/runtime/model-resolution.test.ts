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
});
