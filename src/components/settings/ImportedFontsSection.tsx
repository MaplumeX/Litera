import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invokeErrorMessage } from "@/lib/app-error";
import {
  deleteImportedFont,
  importFonts,
  importedFontFamilies,
  useImportedFonts,
} from "@/lib/imported-fonts";
import { useT } from "@/lib/i18n";
import { cssFontFamily } from "@/lib/reader-styles";

/**
 * Import and delete this device's font files (Android). Imported families
 * show up in every font picker; deleting one leaves Books that use it on
 * the serif fallback.
 */
export function ImportedFontsSection() {
  const { t } = useT();
  const fonts = useImportedFonts();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const families = importedFontFamilies(fonts);

  async function handleImport() {
    setBusy(true);
    setErrors([]);
    try {
      const outcome = await importFonts();
      setErrors(outcome.errors.map((message) => t("settings.font.importFailed", { message })));
    } catch (error) {
      setErrors([t("settings.font.importFailed", { message: invokeErrorMessage(error) })]);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(family: string) {
    setErrors([]);
    try {
      for (const font of fonts.filter((item) => item.family === family)) {
        await deleteImportedFont(font.id);
      }
    } catch (error) {
      setErrors([t("settings.font.deleteFailed", { message: invokeErrorMessage(error) })]);
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t("settings.font.importedList")}
      </div>
      {families.length > 0 && (
        <ul className="mb-2 divide-y rounded-md border">
          {families.map((family) => {
            const count = fonts.filter((item) => item.family === family).length;
            return (
              <li key={family} className="flex min-h-11 items-center gap-2 pl-3">
                <span
                  className="min-w-0 flex-1 truncate text-sm"
                  style={{ fontFamily: cssFontFamily(family) }}
                >
                  {family}
                </span>
                {count > 1 && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("settings.font.styles", { count })}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={t("settings.font.delete", { family })}
                  onClick={() => void handleDelete(family)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => void handleImport()}
      >
        <Plus />
        {busy ? t("settings.font.importing") : t("settings.font.import")}
      </Button>
      <p className="mt-1.5 text-xs text-muted-foreground">{t("settings.font.importHint")}</p>
      {errors.map((message) => (
        <p key={message} role="alert" className="mt-1.5 text-xs text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}
