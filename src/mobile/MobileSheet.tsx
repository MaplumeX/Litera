import { useRef, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useSwipeDismiss } from "@/mobile/swipe-dismiss";

/**
 * A modal bottom sheet. Built on the Radix dialog, so it traps focus and
 * the system Back closes it like any other dialog. Swiping it down closes
 * it too.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Keep the title for screen readers only (the content names itself). */
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const swipeRef = useSwipeDismiss<HTMLDivElement>({
    direction: "down",
    onDismiss: () => onOpenChange(false),
    scrimRef,
  });
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay ref={scrimRef} className="fixed inset-0 z-50 m-fade bg-black/40" />
        <DialogPrimitive.Content
          ref={swipeRef}
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100%-var(--safe-top)-2rem)] flex-col rounded-t-[1.75rem] bg-background pb-[var(--safe-bottom)] shadow-float outline-none m-sheet",
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-3 h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30" />
          <DialogPrimitive.Title
            className={cn("shrink-0 truncate px-6 pt-3 pb-2 text-base font-medium", hideTitle && "sr-only")}
          >
            {title}
          </DialogPrimitive.Title>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
