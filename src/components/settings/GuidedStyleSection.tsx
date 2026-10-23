import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";
import { DEFAULT_GUIDED_STYLE, GUIDED_STYLE_MAX_CHARS } from "@/agent/runtime/guide";
import { loadGuidedStyle, saveGuidedStyle } from "@/lib/guided-style";
import { useT } from "@/lib/i18n";

/** Settings › AI: the editable style part of the guided-reading prompt. */
export function GuidedStyleSection() {
  const { t } = useT();
  const [saved, setSaved] = useState(() => loadGuidedStyle() ?? DEFAULT_GUIDED_STYLE);
  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const isDefault = draft.trim() === DEFAULT_GUIDED_STYLE;

  const handleSave = () => {
    const next = draft.trim() ? draft : DEFAULT_GUIDED_STYLE;
    saveGuidedStyle(next.trim() === DEFAULT_GUIDED_STYLE ? null : next);
    // The cached Agent holds the old prompt; the next prompt rebuilds it.
    embeddedAgentRuntime.invalidateConfig();
    setSaved(next);
    setDraft(next);
    setJustSaved(true);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="guided-style" className="text-sm font-medium">
          {t("settings.guidedStyle.title")}
        </Label>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => { setDraft(DEFAULT_GUIDED_STYLE); setJustSaved(false); }}
          disabled={isDefault}
        >
          {t("settings.guidedStyle.reset")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.guidedStyle.description")}</p>
      <textarea
        id="guided-style"
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setJustSaved(false); }}
        maxLength={GUIDED_STYLE_MAX_CHARS}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        rows={12}
        spellCheck={false}
      />
      <div className="flex items-center justify-end gap-2">
        {justSaved && (
          <span className="text-xs text-muted-foreground" role="status">
            {t("settings.guidedStyle.saved")}
          </span>
        )}
        <Button size="sm" onClick={handleSave} disabled={draft === saved}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
