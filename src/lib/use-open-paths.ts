import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { registerOpenPathsListener } from "@/lib/open-paths";

export function useOpenPaths(options: {
  importPaths: (paths: string[]) => Promise<string[]>;
  openBook: (bookId: string) => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  const importPathsRef = useRef(options.importPaths);
  const openBookRef = useRef(options.openBook);
  const onErrorRef = useRef(options.onError);
  importPathsRef.current = options.importPaths;
  openBookRef.current = options.openBook;
  onErrorRef.current = options.onError;

  useEffect(() => {
    const subscription = registerOpenPathsListener({
      listen: async (handler) => listen("open-paths-available", () => handler()),
      takePending: () => invoke<string[]>("take_pending_open_paths"),
      importPaths: (paths) => importPathsRef.current(paths),
      openBook: (bookId) => openBookRef.current(bookId),
      onError: (error) => onErrorRef.current(error),
    });
    return () => subscription.dispose();
  }, []);
}
