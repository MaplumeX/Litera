import { describe, expect, it } from "vitest";
import { classifyPromptError } from "./prompt-error";

describe("classifyPromptError", () => {
  it("classifies auth failures", () => {
    for (const message of [
      "Request failed with status code 401",
      "401: Incorrect API key provided",
      "403 status code (no body)",
      "invalid api key",
      "Unauthorized",
    ]) {
      expect(classifyPromptError(new Error(message)).code).toBe("auth");
    }
    expect(classifyPromptError(new Error("Request failed with status code 401")).message).toBe("API Key 无效或无权限，请检查模型配置");
  });

  it("classifies rate limiting", () => {
    for (const message of ["429 Too Many Requests", "429: rate limit exceeded", "insufficient_quota: You exceeded your current quota"]) {
      expect(classifyPromptError(new Error(message)).code).toBe("rate_limited");
    }
    expect(classifyPromptError(new Error("429 Too Many Requests")).message).toBe("请求过于频繁或配额不足，请稍后重试");
  });

  it("classifies server errors", () => {
    for (const message of ["503 Service Unavailable", "500: Internal server error", "Bad Gateway (502): upstream", "Provider is overloaded"]) {
      expect(classifyPromptError(new Error(message)).code).toBe("server");
    }
    expect(classifyPromptError(new Error("503 Service Unavailable")).message).toBe("模型服务暂时不可用，请稍后重试");
  });

  it("classifies network failures", () => {
    for (const message of [
      "fetch failed",
      "模型网络请求失败，请检查提供商地址与网络连接",
      "getaddrinfo ENOTFOUND api.example.com",
      "socket hang up",
      "Connection error",
    ]) {
      expect(classifyPromptError(new Error(message)).code).toBe("network");
    }
    expect(classifyPromptError(new Error("fetch failed")).message).toBe("网络连接失败，请检查网络与提供商地址");
  });

  it("classifies context overflow", () => {
    for (const message of [
      "prompt is too long: 213462 tokens > 200000 maximum",
      "Your input exceeds the context window of this model",
      "Input length (265330) exceeds model's maximum context length (262144).",
      "413 request_too_large",
    ]) {
      expect(classifyPromptError(new Error(message)).code).toBe("context_overflow");
    }
    expect(classifyPromptError(new Error("prompt is too long: 213462 tokens")).message).toBe("对话过长，请开启新会话或压缩上下文");
  });

  it("falls back to unknown without echoing the raw error text", () => {
    const raw = "Secret leak https://api.example.com/v1?key=sk-abc123 weird failure";
    const result = classifyPromptError(new Error(raw));
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("模型请求失败，请检查配置后重试");
    expect(result.message).not.toContain(raw);
  });

  it("handles non-Error inputs", () => {
    expect(classifyPromptError("429 Too Many Requests").code).toBe("rate_limited");
    expect(classifyPromptError(undefined).code).toBe("unknown");
  });
});