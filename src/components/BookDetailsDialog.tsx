import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ImageUp } from "lucide-react";
import { notifySyncActivity } from "@/lib/sync-activity";
import type { BookRecord } from "@/types/library";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { invokeErrorMessage } from "@/lib/app-error";
import { paletteFromText, paletteStyle, useCoverPalette } from "@/lib/cover-palette";
import { useT } from "@/lib/i18n";
import {
  MAX_COVER_BYTES,
  formatLibraryTimestamp,
  progressPercent,
  withCoverRevision,
} from "@/lib/library-shelf";

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

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

  const palette = useCoverPalette(coverSrc, title || book?.title || "");

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
      // Curation (reading status, star) is not edited here: it lives on the
      // shelf card's status menu, and `update_book_metadata` replaces every
      // text field, so folding it in would risk clearing the star.
      const updated = await invoke<BookRecord>("update_book_metadata", args);
      notifySyncActivity({ prompt: true });
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
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl [&>[data-slot=dialog-close]]:text-white"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="cover-ambient flex shrink-0 gap-6 overflow-hidden p-6 pr-12" style={paletteStyle(palette)}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={t("library.chooseCover")}
            className="group/cover relative aspect-[2/3] w-24 shrink-0 self-start overflow-hidden rounded-cover shadow-[0_2px_4px_rgb(0_0_0/30%),0_14px_30px_rgb(0_0_0/40%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-28"
          >
            {coverSrc ? (
              <img
                src={coverSrc}
                alt={title || book?.title || ""}
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                className="generated-cover"
                style={paletteStyle(paletteFromText(title || book?.title || "?"))}
                data-title={title || book?.title || "?"}
                data-author={author}
              />
            )}
            <span aria-hidden className="cover-sheen" />
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-150 group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100 motion-reduce:transition-none"
            >
              <ImageUp className="size-5 text-white" />
            </span>
          </button>
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
          <div className="flex min-w-0 flex-1 flex-col">
            <DialogHeader className="gap-0 text-left">
              <DialogTitle className="text-xs leading-normal font-medium text-white/70">
                {t("library.detailsTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">{t("library.detailsDescription")}</DialogDescription>
            </DialogHeader>
            {/* Follows the field below, so the header shows what Save will write. */}
            <p aria-hidden className="mt-1 line-clamp-2 text-2xl leading-tight font-semibold tracking-[-0.02em] break-words">
              {title || "\u00a0"}
            </p>
            {author && <p aria-hidden className="mt-1 truncate text-sm text-white/75">{author}</p>}
            <dl className="mt-auto grid grid-cols-2 gap-x-6 gap-y-1 pt-4 text-xs">
              <div className="col-span-2 flex items-center gap-2.5">
                <dt className="sr-only">{t("library.fieldProgress")}</dt>
                <span aria-hidden className="h-1 max-w-64 flex-1 overflow-hidden rounded-full bg-white/20">
                  <span className="block h-full rounded-full bg-white" style={{ width: `${pct ?? 0}%` }} />
                </span>
                <dd className="shrink-0 text-white/85 tabular-nums">
                  {pct == null ? t("library.noProgress") : t("reader.progressPercent", { pct })}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-white/60">{t("library.fieldImported")}</dt>
                <dd className="truncate text-white/90">
                  {book ? formatLibraryTimestamp(book.importedAt, locale) : ""}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-white/60">{t("library.fieldLastOpened")}</dt>
                <dd className="truncate text-white/90">
                  {book?.lastOpenedAt
                    ? formatLibraryTimestamp(book.lastOpenedAt, locale)
                    : t("library.neverOpened")}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-x-4 gap-y-4 overflow-y-auto p-6 sm:grid-cols-6">
          <div className="grid gap-1.5 sm:col-span-3">
            <Label className={FIELD_LABEL_CLASS} htmlFor="book-title">{t("library.fieldTitle")}</Label>
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
          <div className="grid content-start gap-1.5 sm:col-span-3">
            <Label className={FIELD_LABEL_CLASS} htmlFor="book-author">{t("library.fieldAuthor")}</Label>
            <Input
              id="book-author"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-6">
            <Label className={FIELD_LABEL_CLASS} htmlFor="book-description">{t("library.fieldDescription")}</Label>
            <Textarea
              id="book-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label className={FIELD_LABEL_CLASS} htmlFor="book-series">{t("library.fieldSeries")}</Label>
            <Input
              id="book-series"
              value={series}
              onChange={(event) => setSeries(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label className={FIELD_LABEL_CLASS} htmlFor="book-publisher">{t("library.fieldPublisher")}</Label>
            <Input
              id="book-publisher"
              value={publisher}
              onChange={(event) => setPublisher(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label className={FIELD_LABEL_CLASS} htmlFor="book-language">{t("library.fieldLanguage")}</Label>
            <Input
              id="book-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>
        </div>
        {/* Outside the scroller, so Save is in reach however long the form runs. */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-3">
          {error && (
            <p role="alert" className="mr-auto min-w-0 text-sm break-words text-destructive">
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
