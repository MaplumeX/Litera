import { Notice } from "@/components/Notice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConfirmRequest } from "@/lib/book-import";
import type { BookImportNotice } from "@/lib/use-book-import";
import { useT } from "@/lib/i18n";

export function BookImportNotices({
  notices,
  dismissNotice,
  onOpenBook,
  actionDisabled = false,
  variant,
}: {
  notices: BookImportNotice[];
  dismissNotice: (id: string) => void;
  onOpenBook?: (bookId: string) => void | Promise<void>;
  actionDisabled?: boolean;
  variant?: "card" | "snackbar";
}) {
  return (
    <>
      {notices.map((notice) => {
        const open = notice.action;
        return (
          <Notice
            key={notice.id}
            message={notice.message}
            tone={notice.kind === "error" ? "error" : "info"}
            variant={variant}
            action={
              open && onOpenBook
                ? {
                    label: open.label,
                    disabled: actionDisabled,
                    onClick: () => {
                      dismissNotice(notice.id);
                      void onOpenBook(open.bookId);
                    },
                  }
                : undefined
            }
            onDismiss={() => dismissNotice(notice.id)}
          />
        );
      })}
    </>
  );
}

export function BookImportConfirmDialog({
  confirmOpen,
  confirmRequest,
  settleConfirm,
}: {
  confirmOpen: boolean;
  confirmRequest: ConfirmRequest | null;
  settleConfirm: (value: boolean) => void;
}) {
  const { t } = useT();
  return (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        if (!open) settleConfirm(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmRequest?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmRequest?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settleConfirm(false)}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmRequest?.destructive ? "destructive" : "default"}
            onClick={() => settleConfirm(true)}
          >
            {confirmRequest?.confirmLabel ?? t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
