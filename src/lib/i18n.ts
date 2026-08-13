import { useSyncExternalStore } from "react";
import { en } from "@/locales/en";
import { zhCN, type MessageKey } from "@/locales/zh-CN";

export type AppLocale = "zh-CN" | "en";
export type { MessageKey };

export const LOCALE_STORAGE_KEY = "litera.locale";

const CATALOGS: Record<AppLocale, Record<MessageKey, string>> = {
  "zh-CN": zhCN,
  en,
};

const listeners = new Set<() => void>();

let currentLocale: AppLocale = "zh-CN";

function isAppLocale(value: string | null): value is AppLocale {
  return value === "zh-CN" || value === "en";
}

function getNavigatorLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const tags: string[] = [];
  if (navigator.languages?.length) tags.push(...navigator.languages);
  if (navigator.language) tags.push(navigator.language);
  return tags;
}

export function detectLocale(languages: readonly string[] = getNavigatorLanguages()): AppLocale {
  for (const tag of languages) {
    const primary = tag.split("-")[0]?.toLowerCase();
    if (primary === "zh") return "zh-CN";
  }
  return "en";
}

function readStoredLocale(): AppLocale | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isAppLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

function persistLocale(locale: AppLocale): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // private mode / quota
  }
}

function applyDocumentLang(locale: AppLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getLocale(): AppLocale {
  return currentLocale;
}

export function setLocale(locale: AppLocale): void {
  persistLocale(locale);
  applyDocumentLang(locale);
  if (currentLocale === locale) return;
  currentLocale = locale;
  notify();
}

export function initLocale(): AppLocale {
  const stored = readStoredLocale();
  const resolved = stored ?? detectLocale();
  currentLocale = resolved;
  persistLocale(resolved);
  applyDocumentLang(resolved);
  notify();
  return resolved;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const catalog = CATALOGS[currentLocale] as Record<string, string | undefined>;
  let template = catalog[key];
  if (template == null) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing key: ${key}`);
    }
    template = key;
  }
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value == null ? match : String(value);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useT() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, t, setLocale };
}
