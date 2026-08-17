export const TTS_OVERLAY_KEY = "litera-tts";
export const TTS_HIGHLIGHT_COLOR = "#7dd3fc";

export const TTS_RATE_KEY = "litera.ttsRate";
export const TTS_VOICE_KEY = "litera.ttsVoice";
export const DEFAULT_TTS_RATE = 1;
export const TTS_RATE_RANGE = { min: 0.5, max: 2, step: 0.1 } as const;
export const TTS_VOICES_TIMEOUT_MS = 2000;

export interface SsmlMark {
  name: string;
  text: string;
}

const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

export function isPunctuationOnly(text: string): boolean {
  return PUNCTUATION_ONLY.test(text);
}

function normalizeSpokenText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textUntilNextMark(mark: Element): string {
  let text = "";
  let node: ChildNode | null = mark.nextSibling;
  while (node) {
    if (node.nodeType === 1 && (node as Element).localName === "mark") break;
    text += node.textContent ?? "";
    node = node.nextSibling;
  }
  return normalizeSpokenText(text);
}

function collectMarks(root: Node): Element[] {
  const out: Element[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 1 && (node as Element).localName === "mark") {
      out.push(node as Element);
    }
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) walk(children[i]);
  };
  walk(root);
  return out;
}

function fallbackPlainText(ssml: string, root?: Element | null): SsmlMark[] {
  const plain = normalizeSpokenText(root?.textContent ?? ssml.replace(/<[^>]+>/g, " "));
  if (!plain || isPunctuationOnly(plain)) return [];
  return [{ name: "", text: plain }];
}

export function parseSsmlMarks(ssml: string): SsmlMark[] {
  if (!ssml.trim()) return [];
  const doc = new DOMParser().parseFromString(ssml, "application/xml");
  if (doc.querySelector("parsererror")) return fallbackPlainText(ssml);
  const root = doc.documentElement;
  const marks = collectMarks(root).flatMap((mark) => {
    const text = textUntilNextMark(mark);
    if (!text || isPunctuationOnly(text)) return [];
    return [{ name: mark.getAttribute("name") ?? "", text }];
  });
  return marks.length > 0 ? marks : fallbackPlainText(ssml, root);
}

export function parseTtsRate(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_TTS_RATE;
  const clamped = Math.min(TTS_RATE_RANGE.max, Math.max(TTS_RATE_RANGE.min, n));
  return Math.round(clamped * 10) / 10;
}

export function loadTtsRate(): number {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_TTS_RATE;
    return parseTtsRate(localStorage.getItem(TTS_RATE_KEY));
  } catch {
    return DEFAULT_TTS_RATE;
  }
}

export function saveTtsRate(rate: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TTS_RATE_KEY, String(parseTtsRate(rate)));
  } catch {
    // private mode / quota
  }
}

export function loadTtsVoice(): string {
  try {
    if (typeof localStorage === "undefined") return "";
    const value = localStorage.getItem(TTS_VOICE_KEY);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function saveTtsVoice(voiceURI: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TTS_VOICE_KEY, voiceURI);
  } catch {
    // private mode / quota
  }
}

function langMatches(voiceLang: string, preferred: string): boolean {
  const voice = voiceLang.toLowerCase();
  const want = preferred.toLowerCase();
  if (!voice || !want) return false;
  if (voice === want) return true;
  const voicePrefix = voice.split("-")[0];
  const wantPrefix = want.split("-")[0];
  return voicePrefix === wantPrefix;
}

export function pickDefaultVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferredLangs: readonly string[],
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  for (const lang of preferredLangs) {
    const match = voices.find((voice) => langMatches(voice.lang, lang));
    if (match) return match;
  }
  return voices[0];
}

export function preferredTtsLangs(
  documentLang?: string | null,
  bookLang?: string | null,
): string[] {
  const langs: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !langs.includes(trimmed)) langs.push(trimmed);
  };
  push(documentLang);
  push(bookLang);
  if (typeof navigator !== "undefined") push(navigator.language);
  return langs;
}

export function waitForVoices(
  timeoutMs = TTS_VOICES_TIMEOUT_MS,
): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  const existing = speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener("voiceschanged", onChange);
      clearTimeout(timer);
      resolve(speechSynthesis.getVoices());
    };
    const onChange = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    speechSynthesis.addEventListener("voiceschanged", onChange);
  });
}

export function isIgnorableSpeechError(error: string): boolean {
  return error === "canceled" || error === "interrupted";
}
