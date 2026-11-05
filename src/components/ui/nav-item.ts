/** A row of side navigation on the window's base tone: the shelf's filters, Settings' sections. */
export const NAV_ITEM_CLASS =
  "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none";

export const NAV_ITEM_IDLE_CLASS = "text-muted-foreground hover:bg-foreground/5 hover:text-foreground";

export const NAV_ITEM_ACTIVE_CLASS =
  "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-soft [&>svg]:text-primary";
