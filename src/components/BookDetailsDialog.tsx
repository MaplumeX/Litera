import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { BookRecord } from "@/types/library";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { invokeErrorMessage } from "@/lib/app-error";
import { useT } from "@/lib/i18n";
import {
  MAX_COVER_BYTES,
  formatLibraryTimestamp,
  progressPercent,
  withCoverRevision,
} from "@/lib/library-shelf";

interface BookDetailsDialogProps {
  book: BookRecord | null;
  coverRev?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (record: BookRecord, coverChanged: boolean) => void;
}

export function BookDetailsDialog({
  book,
  coverRev,
  open,
  onOpenChange,
  onSaved,
}: BookDetailsDialogProps) {
  const { t, locale } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [publisher, setPublisher] = useState("");
  const [language, setLanguage] = useState("");
  const [series, setSeries] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !book) return;
    setTitle(book.title);
    setAuthor(book.author);
    setDescription(book.description ?? "");
    setPublisher(book.publisher ?? "");
    setLanguage(book.language ?? "");
    setSeries(book.series ?? "");
    setCoverFile(null);
    setError(null);
    setSaving(false);
  }, [open, book]);

  const previewUrl = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : null),
    [coverFile],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const titleOk = title.trim().length > 0;
  const pct = progressPercent(book?.lastFraction);
  const coverSrc =
    previewUrl ??
    (book?.coverPath
      ? withCoverRevision(convertFileSrc(book.coverPath), coverRev)
      : null);

  const handleSave = async () => {
    if (!book || !titleOk || saving) return;
    setSaving(true);
    setError(null);
    try {
      let coverBytes: number[] | undefined;
      if (coverFile) {
        const buffer = await coverFile.arrayBuffer();
        coverBytes = Array.from(new Uint8Array(buffer));
        if (coverBytes.length > MAX_COVER_BYTES) {
          setError(t("library.coverTooLarge"));
          setSaving(false);
          return;
        }
        if (coverBytes.length === 0) coverBytes = undefined;
      }
      const args: {
        bookId: string;
        title: string;
        author: string;
        description: string;
        publisher: string;
        language: string;
        series: string;
        coverBytes?: number[];
      } = {
        bookId: book.id,
        title: title.trim(),
        author,
        description,
        publisher,
        language,
        series,
      };
      if (coverBytes) args.coverBytes = coverBytes;
      const updated = await invoke<BookRecord>("update_book_metadata", args);
      onSaved(updated, Boolean(coverBytes));
      onOpenChange(false);
    } catch (err) {
      setError(t("library.saveFailed", { message: invokeErrorMessage(err) }));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("library.detailsTitle")}</DialogTitle>
          <DialogDescription>{t("library.detailsDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="book-title">{t("library.fieldTitle")}</Label>
            <Input
              id="book-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={!titleOk}
            />
            {!titleOk && (
              <p className="text-xs text-destructive">{t("library.titleRequired")}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="book-author">{t("library.fieldAuthor")}</Label>
            <Input
              id="book-author"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("library.fieldCover")}</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                {coverSrc ? (
                  <img
                    src={coverSrc}
                    alt={title || book?.title || ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-lg text-muted-foreground/40">
                    {(title || book?.title || "?").charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) setCoverFile(file);
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  {t("library.chooseCover")}
                </Button>
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="book-description">{t("library.fieldDescription")}</Label>
            <Textarea
              id="book-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="book-publisher">{t("library.fieldPublisher")}</Label>
            <Input
              id="book-publisher"
              value={publisher}
              onChange={(event) => setPublisher(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="book-language">{t("library.fieldLanguage")}</Label>
            <Input
              id="book-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="book-series">{t("library.fieldSeries")}</Label>
            <Input
              id="book-series"
              value={series}
              onChange={(event) => setSeries(event.target.value)}
            />
          </div>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("library.fieldProgress")}</dt>
              <dd className="tabular-nums">
                {pct == null ? t("library.noProgress") : t("reader.progressPercent", { pct })}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("library.fieldImported")}</dt>
              <dd>
                {book ? formatLibraryTimestamp(book.importedAt, locale) : ""}
              </dd>
            </div>
          </dl>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!titleOk || saving}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
