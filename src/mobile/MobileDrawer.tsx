import { useRef, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useSwipeDismiss } from "@/mobile/swipe-dismiss";

/**
 * A modal side sheet from the left edge, full height below the status bar.
 * Built on the Radix dialog, so Back closes it; a swipe left or a tap on the
 * scrim does too.
 */
export function MobileDrawer({
  open,
  onOpenChange,
  title,
  header,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The accessible name; shown unless a header replaces it. */
  title: string;
  /** Shown in place of the title (which stays for screen readers). */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const swipeRef = useSwipeDismiss<HTMLDivElement>({
    direction: "left",
    onDismiss: () => onOpenChange(false),
    scrimRef,
  });
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Drawer and scrim stop at the status bar, so it stays the page's. */}
        <DialogPrimitive.Overlay
          ref={scrimRef}
          className="fixed inset-x-0 top-[var(--safe-top)] bottom-0 z-50 m-fade bg-black/40"
        />
        <DialogPrimitive.Content
          ref={swipeRef}
          aria-describedby={undefined}
          className={cn(
            "fixed top-[var(--safe-top)] bottom-0 left-0 z-50 flex w-[85%] max-w-sm flex-col rounded-r-2xl bg-background pt-3 pb-[var(--safe-bottom)] shadow-float outline-none m-drawer",
            className,
          )}
          onOpenAutoFocus={(event) => {
            // Focus the drawer, not its first control.
            event.preventDefault();
            const content = event.target;
            if (content instanceof HTMLElement) content.focus({ preventScroll: true });
          }}
        >
          <DialogPrimitive.Title
            className={cn("shrink-0 truncate px-6 pt-1 pb-2 text-base font-medium", header && "sr-only")}
          >
            {title}
          </DialogPrimitive.Title>
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
