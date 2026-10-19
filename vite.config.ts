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

/**
 * Source patches to foliate-js's paginator, which is an upstream submodule.
 *
 * - Paginated layout works in whole pixels. A phone's page width is
 *   fractional (e.g. 365.5px), and the column pitch Chromium lays out then
 *   differs from the scroll step by a subpixel, so each page turn shifts the
 *   text a little further sideways until the next page's text shows at the
 *   edge. An even gap keeps both half-gap paddings whole too.
 * - A cancelled touch (e.g. Android's edge Back gesture taking a swipe over)
 *   snaps like a lifted one, instead of leaving the page half turned.
 *
 * Each patch must match exactly once, so a submodule bump that changes the
 * code fails the build instead of dropping the fix.
 *
 * Patches are written with LF line endings; a Windows checkout of the
 * submodule (core.autocrlf) hands us CRLF, so the source is normalised first.
 */
const PAGINATOR_PATCHES: [string, string][] = [
  [
    `        const { width, height } = this.#container.getBoundingClientRect()
        const size = vertical ? height : width
`,
    `        const rect = this.#container.getBoundingClientRect()
        const flow = this.getAttribute('flow')
        const width = flow === 'scrolled' || vertical ? rect.width : Math.floor(rect.width)
        const height = flow === 'scrolled' || !vertical ? rect.height : Math.floor(rect.height)
        const size = vertical ? height : width
`,
  ],
  [
    `        const gap = -g / (g - 1) * size

        const flow = this.getAttribute('flow')
`,
    `        const gap = Math.round(-g / (g - 1) * size / 2) * 2

`,
  ],
  [
    `    get size() {
        return this.#container.getBoundingClientRect()[this.sideProp]
    }`,
    `    get size() {
        const size = this.#container.getBoundingClientRect()[this.sideProp]
        return this.scrolled ? size : Math.floor(size)
    }`,
  ],
  [
    `        this.addEventListener('touchend', this.#onTouchEnd.bind(this))
`,
    `        this.addEventListener('touchend', this.#onTouchEnd.bind(this))
        this.addEventListener('touchcancel', this.#onTouchEnd.bind(this))
`,
  ],
  [
    `            doc.addEventListener('touchend', this.#onTouchEnd.bind(this))
`,
    `            doc.addEventListener('touchend', this.#onTouchEnd.bind(this))
            doc.addEventListener('touchcancel', this.#onTouchEnd.bind(this))
`,
  ],
];

function patchFoliatePaginator(): Plugin {
  return {
    name: "patch-foliate-paginator",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?")[0].endsWith("/src/foliate-js/paginator.js")) return;
      let patched = code.replace(/\r\n/g, "\n");
      for (const [search, replace] of PAGINATOR_PATCHES) {
        if (patched.split(search).length !== 2) {
          throw new Error(`foliate-js paginator patch no longer applies:\n${search}`);
        }
        patched = patched.replace(search, () => replace);
      }
      return { code: patched, map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [patchFoliatePaginator(), fixFoliateGlob(), react(), tailwindcss()],

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
