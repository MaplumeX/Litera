import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/lib/i18n";

export function CopyButton({
  text,
  className,
  label,
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={className ?? "text-muted-foreground/50 transition-colors hover:text-muted-foreground"}
      aria-label={label ?? t("chat.copy")}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
