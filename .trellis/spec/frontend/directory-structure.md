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
│   │   └── ui/             # shadcn/ui components (code-owned, not npm)
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
- **Tauri 2 capabilities**: permissions live in `src-tauri/capabilities/default.json`, not inline in builder code.