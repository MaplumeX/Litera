import { Button } from "@/components/ui/button";
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

export function BookImportNotices({
  notices,
  dismissNotice,
  onOpenBook,
  actionDisabled = false,
}: {
  notices: BookImportNotice[];
  dismissNotice: (id: string) => void;
  onOpenBook?: (bookId: string) => void | Promise<void>;
  actionDisabled?: boolean;
}) {
  return (
    <>
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "error"
              ? "flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
              : "flex items-center gap-3 border-b bg-muted/60 px-4 py-2 text-sm"
          }
        >
          <span className="min-w-0 flex-1">{notice.message}</span>
          {notice.action && onOpenBook && (
            <Button
              size="sm"
              variant="ghost"
              disabled={actionDisabled}
              onClick={() => {
                dismissNotice(notice.id);
                void onOpenBook(notice.action!.bookId);
              }}
            >
              {notice.action.label}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => dismissNotice(notice.id)}
          >
            关闭
          </Button>
        </div>
      ))}
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
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmRequest?.destructive ? "destructive" : "default"}
            onClick={() => settleConfirm(true)}
          >
            {confirmRequest?.confirmLabel ?? "确定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
