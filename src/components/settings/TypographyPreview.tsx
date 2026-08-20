import { useT } from "@/lib/i18n";
import { generatePreviewCss, type ReaderStyleState } from "@/lib/reader-styles";

interface TypographyPreviewProps {
  styleState: ReaderStyleState;
}

export function TypographyPreview({ styleState }: TypographyPreviewProps) {
  const { t } = useT();
  const css = generatePreviewCss(styleState);

  return (
    <div className="space-y-2">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="text-xs font-medium text-muted-foreground">{t("settings.preview")}</div>
      <div className="litera-typography-preview rounded-md border bg-muted/40 p-4 text-foreground">
        <p>{t("settings.preview.paragraph1")}</p>
        <p>{t("settings.preview.paragraph2")}</p>
      </div>
    </div>
  );
}