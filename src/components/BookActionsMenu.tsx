import type { ComponentType, ReactNode } from "react";
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
  STATUS_CHOICES,
  STATUS_LABEL_KEYS,
  type BookStatusChoice,
} from "@/components/BookStatusMenu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface BookActionHandlers {
  onOpen: () => void;
  onDetails: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
  /** Curation and selection entries render only when the host supplies them. */
  readingStatus?: ReadingStatus;
  starred?: boolean;
  onChangeStatus?: (choice: BookStatusChoice) => void;
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
  const current: BookStatusChoice = readingStatus ?? "unset";
  return (
    <>
      <Item onSelect={onOpen}>{t("library.open")}</Item>
      {onChangeStatus && (
        <Sub>
          <SubTrigger>{t("library.fieldReadingStatus")}</SubTrigger>
          <SubContent>
            {STATUS_CHOICES.map((choice) => (
              <Item key={choice} onSelect={() => onChangeStatus(choice)}>
                <Check
                  className={cn("size-4", choice === current ? "opacity-100" : "opacity-0")}
                />
                {t(STATUS_LABEL_KEYS[choice])}
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
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <BookActionItems parts={CONTEXT_PARTS} {...handlers} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
