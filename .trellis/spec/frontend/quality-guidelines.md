# Quality Guidelines

> Code standards and forbidden patterns for the Litera project.

---

## CSP Configuration (Tauri 2)

### Convention: foliate.js CSP Requirements

**What**: `src-tauri/tauri.conf.json` must configure CSP to block EPUB-embedded scripts while allowing `blob:` URLs for foliate.js rendering.

**Why**: EPUB files can contain scripted content (JavaScript in e-book HTML). foliate.js renders chapters via `blob:` URLs. CSP must block scripts except `'self'` but allow `blob:` in resource directives.

**Current CSP** (production):
```
default-src 'self';
script-src 'self';
img-src 'self' blob: data:;
style-src 'self' 'unsafe-inline';
font-src 'self' blob: data:;
media-src 'self' blob:;
connect-src 'self' ipc: http://ipc.localhost;
frame-src 'self' blob:
```

**Dev CSP** (`devCsp`): additionally allows `script-src 'unsafe-inline'` for Vite HMR.

### Don't: Allow blob: in script-src

**Problem**:
```json
"script-src 'self' blob:"
```

**Why it's bad**: EPUB-embedded scripts could execute via blob: URLs, bypassing the security boundary foliate.js requires.

**Instead**: Keep `script-src 'self'` only. `blob:` goes in `img-src`, `font-src`, `media-src`, `frame-src` where foliate.js needs it for rendering, not script execution.

## Tauri 2 Plugin Registration

### Convention: Plugins in lib.rs, permissions in capabilities/

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```json
// src-tauri/capabilities/default.json
{
  "permissions": ["dialog:default"]
}
```

**Why**: Tauri 2 separates plugin registration (builder code) from permission grants (capabilities JSON). Don't inline permissions in Rust code.