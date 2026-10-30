import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Lets a lone Tooltip (e.g. in a component test) bring its own provider, while
// tooltips under the app-wide one share its skip-delay: moving along a toolbar
// opens the next tip at once.
const ProvidedContext = React.createContext(false)

function TooltipProvider({
  delayDuration = 500,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <ProvidedContext.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
    </ProvidedContext.Provider>
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  return React.useContext(ProvidedContext) ? root : <TooltipProvider>{root}</TooltipProvider>
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) rounded-md bg-primary px-2 py-1 text-xs leading-snug whitespace-pre-line break-words text-primary-foreground shadow-soft select-none data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

function overflows(root: HTMLElement) {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].some(
    (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
  )
}

/**
 * The app's stand-in for the native `title` attribute: wraps a single element
 * and shows `label` on hover / keyboard focus. With `overflowOnly` the tip only
 * appears while the element's text is cut off (truncate / line-clamp), so rows
 * that show their full label stay quiet.
 */
function Tip({
  label,
  side = "top",
  align,
  overflowOnly = false,
  children,
}: {
  label: React.ReactNode
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"]
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"]
  overflowOnly?: boolean
  children: React.ReactElement
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement>(null)
  if (label == null || label === "") return children
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (next && overflowOnly && triggerRef.current && !overflows(triggerRef.current)) return
        setOpen(next)
      }}
    >
      <TooltipTrigger asChild ref={triggerRef as React.Ref<HTMLButtonElement>}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Tip }
