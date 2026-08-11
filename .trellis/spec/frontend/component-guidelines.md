# Component Guidelines

> Component patterns for the Litera frontend.

---

## Component Library: shadcn/ui

**Decision**: shadcn/ui (Radix UI primitives + Tailwind CSS, code-copy model).

**Why**: Desktop reader aesthetic needs restraint and full customizability. shadcn/ui copies component source into the project (`src/components/ui/`), giving full ownership without npm runtime dependency or version lock.

**How to add components**:
```bash
npx shadcn@latest add <component-name>
```

## Companion Libraries

| Library | Purpose |
|---------|---------|
| `react-resizable-panels` | Draggable split-pane layout (shadcn/ui Resizable component base) |
| `react-markdown` + `remark-gfm` | Agent response Markdown rendering (lists, code blocks, tables) |

## Patterns

### Mount foliate-view web component in React

```typescript
// foliate-view is a custom element, not a React component
import "../foliate-js/view.js"  // registers <foliate-view> in customElements

const ref = useRef<HTMLElement>(null)
useEffect(() => {
  const view = document.createElement("foliate-view")
  ref.current?.appendChild(view)
  return () => view.remove()
}, [])
```

### Import shadcn/ui components via path alias
```typescript
// Good
import { Button } from "@/components/ui/button"

// Bad — relative path
import { Button } from "../../components/ui/button"
```

### cn() for conditional classes
```typescript
import { cn } from "@/lib/utils"

<div className={cn("flex gap-4", isActive && "bg-muted")} />
```