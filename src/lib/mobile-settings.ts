import { useCallback, useSyncExternalStore } from "react";

/**
 * Settings only the mobile shell has. Device preferences (localStorage),
 * not synced: whether the volume keys turn pages or the phone may spend
 * mobile data says nothing about another device.
 */
export interface MobileSettings {
  /** Volume keys turn pages in the Reader. */
  volumeKeyPaging: boolean;
  /** The screen stays on while the Reader page is shown. */
  keepScreenOn: boolean;
  /** Book files (EPUB uploads and downloads) wait for Wi-Fi. */
  wifiOnlyBookFiles: boolean;
}

export const MOBILE_SETTINGS_KEY = "litera.mobileSettings";

export const DEFAULT_MOBILE_SETTINGS: MobileSettings = {
  volumeKeyPaging: false,
  keepScreenOn: false,
  wifiOnlyBookFiles: true,
};

export function parseMobileSettings(raw: string | null): MobileSettings {
  if (!raw) return DEFAULT_MOBILE_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof MobileSettings, unknown>>;
    const pick = (key: keyof MobileSettings) =>
      typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_MOBILE_SETTINGS[key];
    return {
      volumeKeyPaging: pick("volumeKeyPaging"),
      keepScreenOn: pick("keepScreenOn"),
      wifiOnlyBookFiles: pick("wifiOnlyBookFiles"),
    };
  } catch {
    return DEFAULT_MOBILE_SETTINGS;
  }
}

let cached: { raw: string | null; value: MobileSettings } | null = null;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(MOBILE_SETTINGS_KEY);
  } catch {
    return null;
  }
}

export function loadMobileSettings(): MobileSettings {
  const raw = readRaw();
  if (cached?.raw !== raw) cached = { raw, value: parseMobileSettings(raw) };
  return cached.value;
}

export function saveMobileSettings(patch: Partial<MobileSettings>): void {
  const next = { ...loadMobileSettings(), ...patch };
  try {
    localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota: keep the change for this session
    cached = { raw: readRaw(), value: next };
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileSettings(): [MobileSettings, (patch: Partial<MobileSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, loadMobileSettings, loadMobileSettings);
  const update = useCallback((patch: Partial<MobileSettings>) => saveMobileSettings(patch), []);
  return [settings, update];
}
