import { describe, expect, it, vi } from "vitest";
import { APP_USER_AGENT, createGuardedNativeFetch } from "./native-fetch";

describe("createGuardedNativeFetch", () => {
  it("uses the native adapter for the configured origin and disables redirects", async () => {
    const response = new Response("ok");
    const fetchImpl = vi.fn(async () => response);
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl,
    });

    await expect(guarded("https://models.example.test/v1/chat/completions", {
      method: "POST",
    })).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://models.example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST", maxRedirections: 0 }),
    );
  });

  it("clears Origin, sets Litera User-Agent, and strips browser/Stainless headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://api.anthropic.com",
      provider: "anthropic",
      fetchImpl,
    });

    const callerHeaders = new Headers({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
      "anthropic-dangerous-direct-browser-access": "true",
      "X-Stainless-Runtime": "browser:chrome",
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Lang": "js",
      "User-Agent": "pi (browser)",
      "Content-Type": "application/json",
    });

    await guarded("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: callerHeaders,
    });

    const sentInit = fetchImpl.mock.calls[0]?.[1];
    const sentHeaders = new Headers(sentInit?.headers);

    expect(APP_USER_AGENT).toMatch(/^Litera\/\d+\.\d+\.\d+$/);
    expect(sentHeaders.get("origin")).toBe("");
    expect(sentHeaders.get("user-agent")).toBe(APP_USER_AGENT);
    expect(sentHeaders.has("anthropic-dangerous-direct-browser-access")).toBe(false);
    expect(sentHeaders.has("x-stainless-runtime")).toBe(false);
    expect(sentHeaders.has("x-stainless-os")).toBe(false);
    expect(sentHeaders.has("x-stainless-lang")).toBe(false);
    expect(sentHeaders.get("x-api-key")).toBe("sk-ant-test");
    expect(sentHeaders.get("anthropic-version")).toBe("2023-06-01");
    expect(sentHeaders.get("anthropic-beta")).toBe("interleaved-thinking-2025-05-14");
    expect(sentHeaders.get("content-type")).toBe("application/json");
    expect(sentHeaders.has("http-referer")).toBe(false);
    expect(sentHeaders.has("x-title")).toBe(false);
    // Caller's Headers instance is never mutated.
    expect(callerHeaders.get("user-agent")).toBe("pi (browser)");
    expect(callerHeaders.has("x-stainless-os")).toBe(true);
  });

  it("replaces missing or Node-style pi User-Agent and preserves explicit custom User-Agent", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      userAgent: "Litera/9.9.9",
      fetchImpl,
    });

    await guarded("https://models.example.test/v1/chat/completions");
    await guarded("https://models.example.test/v1/chat/completions", {
      headers: { "User-Agent": "pi (linux 6.8.0; x64)" },
    });
    await guarded("https://models.example.test/v1/chat/completions", {
      headers: { "User-Agent": "CustomClient/1.0" },
    });

    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("user-agent")).toBe("Litera/9.9.9");
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("user-agent")).toBe("Litera/9.9.9");
    expect(new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get("user-agent")).toBe("CustomClient/1.0");
  });

  it("normalizes headers carried on a Request input", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl,
    });

    const request = new Request("https://models.example.test/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "X-Stainless-Arch": "unknown",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });

    await guarded(request);

    const sentHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(sentHeaders.get("authorization")).toBe("Bearer test-token");
    expect(sentHeaders.get("origin")).toBe("");
    expect(sentHeaders.get("user-agent")).toBe(APP_USER_AGENT);
    expect(sentHeaders.has("x-stainless-arch")).toBe(false);
    expect(sentHeaders.has("anthropic-dangerous-direct-browser-access")).toBe(false);
  });

  it("adds OpenRouter attribution headers only for the openrouter provider", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const openrouterFetch = createGuardedNativeFetch({
      baseUrl: "https://openrouter.ai/api/v1",
      provider: "openrouter",
      fetchImpl,
    });
    const openaiFetch = createGuardedNativeFetch({
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      fetchImpl,
    });

    await openrouterFetch("https://openrouter.ai/api/v1/chat/completions");
    await openaiFetch("https://api.openai.com/v1/chat/completions");

    const openrouterHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(openrouterHeaders.get("http-referer")).toBe("https://github.com/MaplumeX/Litera");
    expect(openrouterHeaders.get("x-title")).toBe("Litera");

    const openaiHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(openaiHeaders.has("http-referer")).toBe(false);
    expect(openaiHeaders.has("x-title")).toBe(false);
  });

  it("rejects another origin before invoking the native adapter", async () => {
    const fetchImpl = vi.fn();
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl,
    });

    await expect(guarded("https://evil.example/v1/chat/completions"))
      .rejects.toThrow("不在当前提供商允许范围内");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-http provider URLs", () => {
    expect(() => createGuardedNativeFetch({ baseUrl: "file:///tmp/key" }))
      .toThrow("必须使用 HTTP(S)");
  });

  it("does not echo request secrets when native fetch fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl,
    });

    const error = await guarded("https://models.example.test/v1/chat/completions", {
      headers: { Authorization: "Bearer secret-key" },
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain("模型网络请求失败");
    expect(String(error)).not.toContain("secret-key");
  });

  it("redacts malformed request URLs", async () => {
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl: vi.fn(),
    });
    const error = await guarded("not a url?api_key=secret-key").catch((caught: unknown) => caught);
    expect(String(error)).toContain("请求地址无效");
    expect(String(error)).not.toContain("secret-key");
  });
});
