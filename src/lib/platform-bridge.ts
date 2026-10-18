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

export interface PlatformEvents {
  /** The system Back gesture or button. */
  back: Record<string, never>;
  /** A volume key, only while volume-key paging is switched on. */
  volumeKey: { direction: VolumeKeyDirection };
  lifecycle: { state: LifecycleState };
  /** Books from an "Open with" or a share while the app is running. */
  incomingBooks: { books: IncomingBook[] };
}

export type PlatformEvent = keyof PlatformEvents;

/** Stops listening. `ready` settles once the native side delivers events to the handler. */
export type PlatformUnlisten = (() => void) & { ready: Promise<void> };

/**
 * What the WebView can't do on its own. Android implements it with the
 * Litera platform plugin; on desktop every call is a no-op and no event
 * ever fires, so shared code can depend on it unconditionally.
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
  /** Books that arrived before anything listened (a cold-start "Open with"). */
  takePendingIncomingBooks(): Promise<IncomingBook[]>;
  setImmersive(enabled: boolean): Promise<void>;
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
  takePendingIncomingBooks: async () =>
    (await command<{ books: IncomingBook[] }>("takePendingIncomingBooks")).books,
  setImmersive: (enabled) => command("setImmersive", { enabled }),
  setKeepScreenOn: (enabled) => command("setKeepScreenOn", { enabled }),
  setVolumeKeyPaging: (enabled) => command("setVolumeKeyPaging", { enabled }),
  isNetworkMetered: async () => (await command<{ metered: boolean }>("getNetworkStatus")).metered,
  exitApp: () => command("exitApp"),
};

const desktopBridge: PlatformBridge = {
  hasDocumentPicker: false,
  listen: () => Object.assign(() => {}, { ready: Promise.resolve() }),
  pickBooks: async () => [],
  takePendingIncomingBooks: async () => [],
  setImmersive: async () => {},
  setKeepScreenOn: async () => {},
  setVolumeKeyPaging: async () => {},
  // Desktops don't ration book-file transfers.
  isNetworkMetered: async () => false,
  exitApp: async () => {},
};

export const platformBridge: PlatformBridge =
  typeof navigator !== "undefined" && isAndroid() ? androidBridge : desktopBridge;
