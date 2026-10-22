import { addPluginListener, invoke, type PluginListener } from "@tauri-apps/api/core";
import { isAndroid } from "@/lib/platform";
import type { VolumeKeyDirection } from "@/lib/reader-paging";

/**
 * A book the platform handed over (picker, "Open with", share), copied into
 * the app cache. `error` instead of `path` when the file couldn't be read.
 */
export interface IncomingBook {
  name: string;
  path?: string;
  error?: string;
}

export type LifecycleState = "foreground" | "background";

export interface BatteryStatus {
  /** Remaining charge, from 0 to 1. */
  level: number;
  charging: boolean;
}

/**
 * Where the system bars, the display cutout and the keyboard cover the
 * WebView, in CSS px. Hidden bars count as zero; the cutout is reported on
 * its own because it stays when the bars hide.
 */
export interface SystemInsets {
  top: number;
  bottom: number;
  /** Keyboard occlusion, separate from the navigation bar's safe area. */
  imeBottom: number;
  left: number;
  right: number;
  cutoutTop: number;
  cutoutBottom: number;
}

/**
 * The predictive Back gesture (Android 14+) as it happens: `start`, then
 * `progress` (0 to 1) as the finger moves, then either `back` commits it or
 * `cancel` here takes it back. `edge` is the side the swipe came from.
 */
export type BackProgress =
  | { phase: "start" | "progress"; progress: number; edge: "left" | "right" }
  | { phase: "cancel" };

export interface PlatformEvents {
  /** The system Back gesture or button. */
  back: Record<string, never>;
  backProgress: BackProgress;
  /** A volume key, only while volume-key paging is switched on. */
  volumeKey: { direction: VolumeKeyDirection };
  lifecycle: { state: LifecycleState };
  /** Books from an "Open with" or a share while the app is running. */
  incomingBooks: { books: IncomingBook[] };
  /** The system bars, cutout or keyboard moved. */
  insets: SystemInsets;
}

export type PlatformEvent = keyof PlatformEvents;

/** Stops listening. `ready` settles once the native side delivers events to the handler. */
export type PlatformUnlisten = (() => void) & { ready: Promise<void> };

/**
 * What the WebView can't do on its own. Android implements it with the
 * Litera platform plugin. Desktop uses the WebView for battery information;
 * mobile-only calls are no-ops and no event fires there.
 */
export interface PlatformBridge {
  /** Imports go through `pickBooks` instead of the Rust file dialog. */
  readonly hasDocumentPicker: boolean;
  listen<E extends PlatformEvent>(
    event: E,
    handler: (payload: PlatformEvents[E]) => void,
  ): PlatformUnlisten;
  /** The system document picker (multi-select EPUB). Cancelling gives `[]`. */
  pickBooks(): Promise<IncomingBook[]>;
  /** The same picker for TTF / OTF files, copied the same way. */
  pickFonts(): Promise<IncomingBook[]>;
  /** Books that arrived before anything listened (a cold-start "Open with"). */
  takePendingIncomingBooks(): Promise<IncomingBook[]>;
  /** The latest insets, or null before the first layout pass (the event follows). */
  getInsets(): Promise<SystemInsets | null>;
  /** Null when the device cannot report its battery. */
  getBatteryStatus(): Promise<BatteryStatus | null>;
  setImmersive(enabled: boolean): Promise<void>;
  /** Dark system bar icons for a light page (true), light icons for a dark one. */
  setSystemBarsLight(light: boolean): Promise<void>;
  setKeepScreenOn(enabled: boolean): Promise<void>;
  /** Intercept the volume keys for paging; otherwise they change the volume. */
  setVolumeKeyPaging(enabled: boolean): Promise<void>;
  /** Whether the active network is metered (mobile data). */
  isNetworkMetered(): Promise<boolean>;
  /** Leave the app, as Back on the root screen does in other Android apps. */
  exitApp(): Promise<void>;
}

const PLUGIN = "litera-platform";

function command<T = void>(name: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(`plugin:${PLUGIN}|${name}`, args);
}

const androidBridge: PlatformBridge = {
  hasDocumentPicker: true,
  listen(event, handler) {
    let disposed = false;
    let listener: PluginListener | undefined;
    const ready = addPluginListener(PLUGIN, event, handler)
      .then((registered) => {
        if (disposed) void registered.unregister();
        else listener = registered;
      })
      .catch((error: unknown) => console.error(`Failed to listen for ${event}:`, error));
    return Object.assign(
      () => {
        disposed = true;
        void listener?.unregister();
      },
      { ready },
    );
  },
  pickBooks: async () => (await command<{ books: IncomingBook[] }>("pickBooks")).books,
  pickFonts: async () => (await command<{ fonts: IncomingBook[] }>("pickFonts")).fonts,
  takePendingIncomingBooks: async () =>
    (await command<{ books: IncomingBook[] }>("takePendingIncomingBooks")).books,
  getInsets: async () => {
    const insets = await command<Partial<SystemInsets>>("getInsets");
    return typeof insets.top === "number" ? (insets as SystemInsets) : null;
  },
  setImmersive: (enabled) => command("setImmersive", { enabled }),
  getBatteryStatus: async () => {
    const status = await command<Partial<BatteryStatus>>("getBatteryStatus");
    return typeof status.level === "number" && Number.isFinite(status.level) &&
      status.level >= 0 && status.level <= 1 && typeof status.charging === "boolean"
      ? status as BatteryStatus
      : null;
  },
  setSystemBarsLight: (enabled) => command("setSystemBarsLight", { enabled }),
  setKeepScreenOn: (enabled) => command("setKeepScreenOn", { enabled }),
  setVolumeKeyPaging: (enabled) => command("setVolumeKeyPaging", { enabled }),
  isNetworkMetered: async () => (await command<{ metered: boolean }>("getNetworkStatus")).metered,
  exitApp: () => command("exitApp"),
};

const desktopBridge: PlatformBridge = {
  hasDocumentPicker: false,
  listen: () => Object.assign(() => {}, { ready: Promise.resolve() }),
  pickBooks: async () => [],
  pickFonts: async () => [],
  takePendingIncomingBooks: async () => [],
  getInsets: async () => null,
  getBatteryStatus: async () => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryStatus> };
    if (!nav.getBattery) return null;
    const battery = await nav.getBattery();
    return Number.isFinite(battery.level) && battery.level >= 0 && battery.level <= 1
      ? { level: battery.level, charging: battery.charging }
      : null;
  },
  setImmersive: async () => {},
  setSystemBarsLight: async () => {},
  setKeepScreenOn: async () => {},
  setVolumeKeyPaging: async () => {},
  // Desktops don't ration book-file transfers.
  isNetworkMetered: async () => false,
  exitApp: async () => {},
};

export const platformBridge: PlatformBridge =
  typeof navigator !== "undefined" && isAndroid() ? androidBridge : desktopBridge;
