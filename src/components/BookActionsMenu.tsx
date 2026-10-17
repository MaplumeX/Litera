import {
  createContext,
  useContext,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Slot } from "radix-ui";
import { Check, EllipsisVertical } from "lucide-react";
import type { ReadingStatus } from "@/types/library";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  READING_STATUSES,
  STATUS_LABEL_KEYS,
} from "@/components/BookStatusMenu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface BookActionHandlers {
  /** The Book's title, for a host that names it (the mobile action sheet). */
  title?: string;
  onOpen: () => void;
  onDetails: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
  /** Curation and selection entries render only when the host supplies them. */
  readingStatus?: ReadingStatus;
  starred?: boolean;
  onChangeStatus?: (status: ReadingStatus) => void;
  onToggleStar?: () => void;
  onSelect?: () => void;
}

/**
 * The parts of a Radix menu the item list needs. The dropdown and the context
 * menu expose the same shape under different names, so one item list renders
 * into either and the two menus cannot drift apart.
 */
interface MenuParts {
  Item: ComponentType<{
    onSelect?: () => void;
    variant?: "default" | "destructive";
    disabled?: boolean;
    children: ReactNode;
  }>;
  Separator: ComponentType;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
  SubContent: ComponentType<{ children: ReactNode }>;
}

const DROPDOWN_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

const CONTEXT_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

/** Touch-sized rows for the mobile shell's action sheet. */
const SHEET_PARTS: MenuParts = {
  Item: ({ onSelect, variant, disabled, children }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm transition-colors active:bg-accent disabled:opacity-50",
        variant === "destructive" && "text-destructive",
      )}
    >
      {children}
    </button>
  ),
  Separator: () => <div role="separator" className="my-1 h-px bg-border" />,
  Sub: ({ children }) => <div role="group">{children}</div>,
  SubTrigger: ({ children }) => (
    <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{children}</div>
  ),
  SubContent: ({ children }) => <div className="pl-2">{children}</div>,
};

/**
 * Set by the mobile shell: a long-press (the touch context menu) or the ⋮
 * button hands the Book's actions to it, to show as a bottom sheet, instead
 * of opening a menu.
 */
const BookActionSheetContext = createContext<((actions: BookActionHandlers) => void) | null>(null);
export const BookActionSheetProvider = BookActionSheetContext.Provider;

/** The actions as sheet rows; the host closes the sheet after a row is picked. */
export function BookActionSheetItems(handlers: BookActionHandlers) {
  return <BookActionItems parts={SHEET_PARTS} {...handlers} />;
}

function BookActionItems({
  parts: { Item, Separator, Sub, SubTrigger, SubContent },
  onOpen,
  onDetails,
  onDelete,
  deleteDisabled = false,
  readingStatus,
  starred = false,
  onChangeStatus,
  onToggleStar,
  onSelect,
}: BookActionHandlers & { parts: MenuParts }) {
  const { t } = useT();
  return (
    <>
      <Item onSelect={onOpen}>{t("library.open")}</Item>
      {onChangeStatus && (
        <Sub>
          <SubTrigger>{t("library.fieldReadingStatus")}</SubTrigger>
          <SubContent>
            {READING_STATUSES.map((status) => (
              <Item key={status} onSelect={() => onChangeStatus(status)}>
                <Check
                  className={cn("size-4", status === readingStatus ? "opacity-100" : "opacity-0")}
                />
                {t(STATUS_LABEL_KEYS[status])}
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {onToggleStar && (
        <Item onSelect={onToggleStar}>
          {t(starred ? "library.unstar" : "library.star")}
        </Item>
      )}
      <Item onSelect={onDetails}>{t("library.details")}</Item>
      {onSelect && <Item onSelect={onSelect}>{t("library.select")}</Item>}
      <Separator />
      <Item variant="destructive" onSelect={onDelete} disabled={deleteDisabled}>
        {t("library.deleteEllipsis")}
      </Item>
    </>
  );
}

export function BookActionDropdown({
  className,
  ...handlers
}: BookActionHandlers & { className?: string }) {
  const { t } = useT();
  const openSheet = useContext(BookActionSheetContext);
  if (openSheet) {
    return (
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className={cn("text-muted-foreground hover:text-foreground", className)}
        aria-label={t("library.actions")}
        onClick={(event) => {
          event.stopPropagation();
          openSheet(handlers);
        }}
      >
        <EllipsisVertical />
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className={cn("text-muted-foreground hover:text-foreground", className)}
          aria-label={t("library.actions")}
        >
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <BookActionItems parts={DROPDOWN_PARTS} {...handlers} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BookActionContext({
  children,
  ...handlers
}: BookActionHandlers & { children: ReactNode }) {
  const openSheet = useContext(BookActionSheetContext);
  if (openSheet) {
    return (
      <Slot.Root
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          openSheet(handlers);
        }}
      >
        {children}
      </Slot.Root>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <BookActionItems parts={CONTEXT_PARTS} {...handlers} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
