# Directory Structure

> Module organization and file layout for the Litera frontend.

---

## Project Layout

```
litera/
├── src/                    # React frontend (WebView)
│   ├── main.tsx            # React entry, imports index.css
│   ├── App.tsx             # Root component
│   ├── index.css           # Tailwind v4 entry + shadcn/ui theme variables
│   ├── components/
│   │   ├── chat/         # Reading-assistant chat panel (ChatPanel container + subcomponents)
│   │   └── ui/           # shadcn/ui components (code-owned, not npm)
│   │       └── button.tsx
│   ├── lib/
│   │   └── utils.ts        # cn() helper for shadcn/ui
│   └── assets/
├── src-tauri/              # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   └── lib.rs          # Tauri builder + plugin registration
│   ├── capabilities/       # Tauri 2 permission capabilities
│   │   └── default.json
│   ├── tauri.conf.json     # Tauri config (CSP, window, bundle)
│   └── Cargo.toml
├── sidecar/                # pi agent Node.js sidecar (Child 3+)
├── vite.config.ts          # Vite + Tailwind plugin + path aliases
├── tsconfig.json           # TS config with @/* path alias
└── components.json         # shadcn/ui config
```

## Key Conventions

- **shadcn/ui components are code-owned**: `src/components/ui/*.tsx` are copied source files, not an npm dependency. Modify them freely.
- **Path alias `@/*`**: maps to `src/*` in both `tsconfig.json` and `vite.config.ts`. Use `@/components/ui/button` not relative paths.
- **Multi-file feature components get their own directory**: `src/components/chat/` holds the ChatPanel container and its subcomponents (MessageBubble, AssistantMessage, ChatInput, EmptyState, SessionList, ToolCallCard, TypingIndicator). Sibling imports inside the directory use relative paths; cross-directory imports use `@/`. The container keeps all agent logic; subcomponents are render-only plus small purely-presentational state.
- **Tauri 2 capabilities**: permissions live in `src-tauri/capabilities/default.json`, not inline in builder code.
- **foliate-js as git submodule**: `src/foliate-js/` is a git submodule (commit `78914ae`). foliate.js API is unstable; submodule locks the version. Do NOT npm install foliate-js.
- **`<foliate-view>` is a web component**: Mount via `document.createElement("foliate-view")` + ref in React. Do NOT use it as a React component (`<foliate-view />`).
- **foliate.js internal imports are relative**: All foliate.js modules import each other via relative paths (`./epub.js`, `./vendor/zip.js`). No Vite alias needed for them.
- **Vite glob fix required**: foliate-js `pdf.js` uses `new URL('vendor/pdfjs/${path}', import.meta.url)` which Vite's import-glob plugin misinterprets. `fixFoliateGlob` plugin in `vite.config.ts` extracts `import.meta.url` to a variable to prevent this. See `vite.config.ts`.