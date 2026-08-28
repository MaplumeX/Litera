/**
 * Classify prompt failures into preset, credential-free Chinese messages.
 *
 * Mirrors pi-ai error wording: providers surface HTTP status via
 * formatProviderError ("401: <body>", "prefix (503): <body>") or SDK text
 * ("Request failed with status code 401"). The returned message is always a
 * preset string — the raw error text is never echoed (same constraint as
 * native-fetch).
 */
export type PromptErrorCode = "auth" | "rate_limited" | "server" | "network" | "context_overflow" | "unknown";

const MESSAGES: Record<PromptErrorCode, string> = {
  auth: "API Key 无效或无权限，请检查模型配置",
  rate_limited: "请求过于频繁或配额不足，请稍后重试",
  server: "模型服务暂时不可用，请稍后重试",
  network: "网络连接失败，请检查网络与提供商地址",
  context_overflow: "对话过长，请开启新会话或压缩上下文",
  unknown: "模型请求失败，请检查配置后重试",
};

// Checked first: some overflow texts embed statuses like 413.
const CONTEXT_OVERFLOW_PATTERN = /prompt is too long|request_too_large|input is too long|exceeds the context window|maximum context length|exceeds.*context length|context length.*exceed|reduce the length of the messages|context window exceeds|exceeded model token limit|too many tokens|token limit exceeded/i;
const AUTH_PATTERN = /\b40[13]\b|unauthorized|forbidden|invalid[-_ ]?api[-_ ]?key|api[-_ ]?key.*(invalid|missing|expired)|authentication/i;
const RATE_LIMITED_PATTERN = /\b429\b|rate.?limit|too many requests|insufficient_quota|quota/i;
const SERVER_PATTERN = /\b(?:500|502|503|504|524|529)\b|internal server error|bad gateway|service unavailable|server.?error|internal.?error|overloaded/i;
const NETWORK_PATTERN = /fetch failed|failed to fetch|network.?error|模型网络请求失败|timed? ?out|timeout|connection|getaddrinfo|enotfound|eai_again|socket hang up|upstream|reset before headers/i;

export function classifyPromptError(error:unknown):{ code:PromptErrorCode; message:string }{
  const text = error instanceof Error ? error.message : String(error);
  const code:PromptErrorCode = CONTEXT_OVERFLOW_PATTERN.test(text) ? "context_overflow"
    :AUTH_PATTERN.test(text) ? "auth"
    :RATE_LIMITED_PATTERN.test(text) ? "rate_limited"
    :SERVER_PATTERN.test(text) ? "server"
    :NETWORK_PATTERN.test(text) ? "network"
    :"unknown";
  return { code, message: MESSAGES[code] };
}