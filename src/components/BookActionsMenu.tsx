import type { ReactNode } from "react";
import { EllipsisVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface BookActionHandlers {
  onOpen: () => void;
  onDetails: () => void;
  onDelete: () => void;
}

export function BookActionDropdown({
  onOpen,
  onDetails,
  onDelete,
  className,
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
        <DropdownMenuItem onSelect={onOpen}>{t("library.open")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDetails}>{t("library.details")}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BookActionContext({
  children,
  onOpen,
  onDetails,
  onDelete,
}: BookActionHandlers & { children: ReactNode }) {
  const { t } = useT();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>{t("library.open")}</ContextMenuItem>
        <ContextMenuItem onSelect={onDetails}>{t("library.details")}</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
