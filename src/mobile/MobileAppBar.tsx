import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A round 48dp touch target around a 24dp icon, the Android toolbar button.
 * The label is the accessible name; icons alone carry no text.
 */
export const AppBarIconButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { label: string }
>(function AppBarIconButton({ label, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex size-12 shrink-0 items-center justify-center rounded-full text-foreground/80 transition-colors outline-none active:bg-foreground/10 focus-visible:bg-foreground/10 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [&_svg]:size-6 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/**
 * The top app bar: it starts under the status bar (its background runs up
 * behind it), a 56dp row with the navigation icon, the title and actions.
 */
export function MobileAppBar({
  navigation,
  title,
  actions,
  children,
  className,
}: {
  navigation?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  /** Replaces navigation, title and actions (the search field). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("shrink-0 bg-background pt-[var(--safe-top)]", className)}>
      <div className="flex h-14 items-center gap-1 px-1">
        {children ?? (
          <>
            {navigation}
            <h1
              className={cn(
                "min-w-0 flex-1 truncate text-[1.375rem] leading-7 font-normal select-none",
                navigation ? "pl-1" : "pl-3",
              )}
            >
              {title}
            </h1>
            {actions}
          </>
        )}
      </div>
    </header>
  );
}
