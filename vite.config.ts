/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Vite's import-glob plugin misinterprets foliate-js's
 * `new URL('vendor/pdfjs/${path}', import.meta.url)` template literals
 * as glob patterns, causing a build error. We work around this by
 * assigning `import.meta.url` to a variable so the pattern no longer
 * matches `new URL(pattern, import.meta.url)`.
 */
function fixFoliateGlob(): Plugin {
  return {
    name: "fix-foliate-glob",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/src/foliate-js/") || !id.endsWith(".js")) return;
      if (!code.includes("import.meta.url")) return;
      // Replace `new URL(..., import.meta.url)` with a variable indirection
      // so Vite's glob scanner no longer detects the pattern.
      const fixed = code.replace(
        /new URL\(([^)]+),\s*import\.meta\.url\)/g,
        "new URL($1, __importMetaUrl)",
      );
      if (fixed === code) return;
      return {
        code: `const __importMetaUrl = import.meta.url;\n` + fixed,
        map: null,
      };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [fixFoliateGlob(), react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  test: {
    setupFiles: ["./src/test/setup-i18n.ts"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
