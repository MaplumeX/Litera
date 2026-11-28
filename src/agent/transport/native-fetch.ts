import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFunction } from "@earendil-works/pi-ai";

const OPENROUTER_REFERER = "https://github.com/MaplumeX/Litera";
const OPENROUTER_TITLE = "Litera";
const PI_DEFAULT_USER_AGENT = /^pi \([^)]+\)$/;

export const APP_USER_AGENT =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__.trim()
    ? `Litera/${__APP_VERSION__.trim()}`
    : "Litera";

export interface NativeFetchOptions {
  baseUrl: string;
  provider?: string;
  userAgent?: string;
  fetchImpl?: typeof tauriFetch;
}

function allowedOrigin(baseUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error("模型服务地址无效"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("模型服务地址必须使用 HTTP(S)");
  }
  return parsed.origin;
}

function requestUrl(input: URL | RequestInfo): URL {
  try {
    if (input instanceof Request) return new URL(input.url);
    return new URL(String(input));
  } catch {
    throw new Error("模型请求地址无效");
  }
}

function normalizeHeaders(
  input: URL | RequestInfo,
  init: RequestInit | undefined,
  provider: string | undefined,
  userAgent: string,
): Headers {
  const source =
    init?.headers != null
      ? init.headers
      : input instanceof Request
        ? input.headers
        : undefined;
  const headers = new Headers(source);

  // Strip browser-direct-access and Stainless SDK telemetry headers that leak
  // an inaccurate WebView environment.
  headers.delete("anthropic-dangerous-direct-browser-access");
  for (const name of Array.from(headers.keys())) {
    if (name.startsWith("x-stainless-")) {
      headers.delete(name);
    }
  }

  // With tauri-plugin-http's `unsafe-headers` feature enabled, an explicit
  // empty Origin instructs the plugin to omit Origin completely instead of
  // injecting `Origin: tauri://localhost`.
  headers.set("origin", "");

  const existingUa = headers.get("user-agent")?.trim();
  if (!existingUa || PI_DEFAULT_USER_AGENT.test(existingUa)) {
    headers.set("user-agent", userAgent);
  }

  if (provider === "openrouter") {
    if (!headers.has("http-referer")) {
      headers.set("http-referer", OPENROUTER_REFERER);
    }
    if (!headers.has("x-title")) {
      headers.set("x-title", OPENROUTER_TITLE);
    }
  }

  return headers;
}

/**
 * Pi providers receive this function instead of WebView `fetch`.
 *
 * Tauri's HTTP plugin performs the request in Rust, avoiding WebView CORS.  The
 * runtime guard is deliberately stricter than the plugin capability: a model
 * request may only target the origin selected by the Rust-owned configuration.
 */
export function createGuardedNativeFetch(options: NativeFetchOptions): FetchFunction {
  const origin = allowedOrigin(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? tauriFetch;
  const userAgent = options.userAgent ?? APP_USER_AGENT;

  return async (input, init) => {
    const url = requestUrl(input);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) {
      throw new Error("模型请求地址不在当前提供商允许范围内");
    }

    const headers = normalizeHeaders(input, init, options.provider, userAgent);

    try {
      // Redirects are rejected so credentials cannot cross the validated origin.
      return await fetchImpl(input, { ...init, headers, maxRedirections: 0 });
    } catch {
      // Never echo the native error: SDKs may include headers, bodies, or a URL
      // whose query contains credentials.
      throw new Error("模型网络请求失败，请检查提供商地址与网络连接");
    }
  };
}
