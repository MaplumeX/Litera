import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFunction } from "@earendil-works/pi-ai";

export interface NativeFetchOptions {
  baseUrl: string;
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

  return async (input, init) => {
    const url = requestUrl(input);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) {
      throw new Error("模型请求地址不在当前提供商允许范围内");
    }

    try {
      // Redirects are rejected so credentials cannot cross the validated origin.
      return await fetchImpl(input, { ...init, maxRedirections: 0 });
    } catch {
      // Never echo the native error: SDKs may include headers, bodies, or a URL
      // whose query contains credentials.
      throw new Error("模型网络请求失败，请检查提供商地址与网络连接");
    }
  };
}
