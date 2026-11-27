import { t, type MessageKey } from "@/lib/i18n";

/**
 * Classify prompt failures into preset, credential-free localized messages.
 *
 * Mirrors pi-ai error wording: providers surface HTTP status via
 * formatProviderError ("401: <body>", "prefix (503): <body>") or SDK text
 * ("Request failed with status code 401"). The returned message is always a
 * preset i18n string — the raw error text is never echoed (same constraint as
 * native-fetch).
 */
export type PromptErrorCode =
  | "auth"
  | "model_not_found"
  | "bad_request"
  | "rate_limited"
  | "server"
  | "network"
  | "context_overflow"
  | "image_unsupported"
  | "unknown";

const MESSAGE_KEYS: Record<PromptErrorCode, MessageKey> = {
  auth: "chat.error.auth",
  model_not_found: "chat.error.modelNotFound",
  bad_request: "chat.error.badRequest",
  rate_limited: "chat.error.rateLimited",
  server: "chat.error.server",
  network: "chat.error.network",
  context_overflow: "chat.error.contextOverflow",
  image_unsupported: "chat.error.imageUnsupported",
  unknown: "chat.error.unknown",
};

// Checked first: some overflow texts embed statuses like 413 or 400.
const CONTEXT_OVERFLOW_PATTERN = /prompt is too long|request_too_large|input is too long|exceeds the context window|maximum context length|exceeds.*context length|context length.*exceed|reduce the length of the messages|context window exceeds|exceeded model token limit|too many tokens|token limit exceeded/i;
// A model declared as accepting images that rejects them (OpenAI-compatible relays, vLLM, DeepSeek wording).
const IMAGE_UNSUPPORTED_PATTERN = /image_url.*(?:not supported|only supported|unsupported)|unknown variant `?image_url|(?:does not|doesn't|not) support(?:s)? (?:image|vision|multimodal)|not a multimodal model|(?:image|vision|multimodal) (?:input|content)s? (?:is |are )?not supported|invalid content type/i;
const AUTH_PATTERN = /\b40[13]\b|unauthorized|forbidden|invalid[-_ ]?api[-_ ]?key|api[-_ ]?key.*(invalid|missing|expired)|authentication/i;
const MODEL_NOT_FOUND_PATTERN = /\b404\b|model.*not.?found|does not exist|no such model|unknown model/i;
const RATE_LIMITED_PATTERN = /\b429\b|rate.?limit|too many requests|insufficient_quota|quota/i;
const SERVER_PATTERN = /\b(?:500|502|503|504|524|529)\b|internal server error|bad gateway|service unavailable|server.?error|internal.?error|overloaded/i;
const NETWORK_PATTERN = /fetch failed|failed to fetch|network.?error|模型网络请求失败|timed? ?out|timeout|connection|getaddrinfo|enotfound|eai_again|socket hang up|upstream|reset before headers/i;
const BAD_REQUEST_PATTERN = /\b400\b|bad request|invalid[-_ ]?request|unsupported parameter/i;

export function classifyPromptError(error: unknown): { code: PromptErrorCode; message: string } {
  const text = error instanceof Error ? error.message : String(error);
  const code: PromptErrorCode = CONTEXT_OVERFLOW_PATTERN.test(text) ? "context_overflow"
    : IMAGE_UNSUPPORTED_PATTERN.test(text) ? "image_unsupported"
    : AUTH_PATTERN.test(text) ? "auth"
    : MODEL_NOT_FOUND_PATTERN.test(text) ? "model_not_found"
    : RATE_LIMITED_PATTERN.test(text) ? "rate_limited"
    : SERVER_PATTERN.test(text) ? "server"
    : NETWORK_PATTERN.test(text) ? "network"
    : BAD_REQUEST_PATTERN.test(text) ? "bad_request"
    : "unknown";
  return { code, message: t(MESSAGE_KEYS[code]) };
}