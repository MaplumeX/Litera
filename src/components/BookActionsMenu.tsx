import {
  createContext,
  useContext,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Slot } from "radix-ui";
import {
  BookOpen,
  Bookmark,
  CircleCheck,
  Ellipsis,
  Info,
  Star,
  Trash2,
} from "lucide-react";
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
import { READING_STATUSES, StatusMenuRow } from "@/components/BookStatusMenu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface BookActionHandlers {
  /** The Book's id, for a host that looks the Book up (the mobile action sheet). */
  bookId?: string;
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

/**
 * Set by the mobile shell: a long-press (the touch context menu) or the ⋮
 * button hands the Book's actions to it, to show as a bottom sheet, instead
 * of opening a menu.
 */
const BookActionSheetContext = createContext<((actions: BookActionHandlers) => void) | null>(null);
export const BookActionSheetProvider = BookActionSheetContext.Provider;

const MENU_ICON_CLASS = "text-muted-foreground";

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
      <Item onSelect={onOpen}>
        <BookOpen aria-hidden className={MENU_ICON_CLASS} />
        {t("library.open")}
      </Item>
      {onChangeStatus && (
        <Sub>
          <SubTrigger>
            <Bookmark aria-hidden className={MENU_ICON_CLASS} />
            {t("library.fieldReadingStatus")}
          </SubTrigger>
          <SubContent>
            {READING_STATUSES.map((status) => (
              <Item key={status} onSelect={() => onChangeStatus(status)}>
                <StatusMenuRow status={status} current={readingStatus} />
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {onToggleStar && (
        <Item onSelect={onToggleStar}>
          <Star aria-hidden className={cn(MENU_ICON_CLASS, starred && "fill-star text-star")} />
          {t(starred ? "library.unstar" : "library.star")}
        </Item>
      )}
      <Item onSelect={onDetails}>
        <Info aria-hidden className={MENU_ICON_CLASS} />
        {t("library.details")}
      </Item>
      {onSelect && (
        <Item onSelect={onSelect}>
          <CircleCheck aria-hidden className={MENU_ICON_CLASS} />
          {t("library.select")}
        </Item>
      )}
      <Separator />
      <Item variant="destructive" onSelect={onDelete} disabled={deleteDisabled}>
        <Trash2 aria-hidden />
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
        <Ellipsis />
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
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
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
      <ContextMenuContent className="min-w-44">
        <BookActionItems parts={CONTEXT_PARTS} {...handlers} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
