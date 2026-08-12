# Frontend Development Guidelines

> Coding conventions for the Litera React frontend.

---

## Overview

Litera's frontend is a React 19 + TypeScript 5.8 single-page app running in the Tauri WebView. It uses Tailwind CSS v4, shadcn/ui components, and foliate.js (git submodule) for EPUB rendering. State is local `useState` + props; there is no global state library.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | `src/` layout, path alias, foliate-js submodule |
| [Component Guidelines](./component-guidelines.md) | shadcn/ui patterns, foliate-view web component, setStyles |
| [Hook Guidelines](./hook-guidelines.md) | `useDebouncedCallback`, ref-stable callbacks, `useImperativeHandle`, Tauri `listen()` |
| [State Management](./state-management.md) | Local state + props, Tauri events, persisted reading state |
| [Type Safety](./type-safety.md) | Rust↔TS serde contract, foliate.js typing, no `any` |
| [Quality Guidelines](./quality-guidelines.md) | CSP configuration, Tauri plugin registration |

---

**Language**: All documentation is written in **English**.