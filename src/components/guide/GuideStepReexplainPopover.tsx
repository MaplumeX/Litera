import { useState } from "react";
import { CornerDownLeft, RefreshCw, Undo2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import type { GuideStepNode, GuideStepRevisionOption } from "@/lib/guide-document";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GuideStepPace, StepRevisionOptions } from "@/types/agent";

const PACES: readonly GuideStepPace[] = ["compact", "standard", "deep"];

function paceLabel(pace: GuideStepPace, t: ReturnType<typeof useT>["t"]): string {
  if (pace === "compact") return t("guide.paceCompact");
  if (pace === "deep") return t("guide.paceDeep");
  return t("guide.paceStandard");
}

function shortModelName(modelId: string): string {
  const parts = modelId.split("/");
  const base = parts[parts.length - 1] ?? modelId;
  return base.length > 22 ? `${base.slice(0, 21)}…` : base;
}

/** Human-readable semantic label for one revision option of a Guided step. */
export function formatRevisionLabel(
  rev: GuideStepRevisionOption,
  index: number,
  t: ReturnType<typeof useT>["t"],
): string {
  if (rev.isOriginal) {
    if (rev.pace && rev.pace !== "standard") {
      return `${t("guide.revisionOriginal")} · ${paceLabel(rev.pace, t)}`;
    }
    return t("guide.revisionOriginal");
  }
  const tags: string[] = [];
  if (rev.pace) tags.push(paceLabel(rev.pace, t));
  if (rev.styleOverride) {
    const clean = rev.styleOverride.trim();
    const snippet = clean.length > 14 ? `${clean.slice(0, 14)}…` : clean;
    tags.push(`“${snippet}”`);
  }
  if (rev.modelId && tags.length < 2) {
    tags.push(shortModelName(rev.modelId));
  }
  const version = t("guide.revisionVersion", { n: index + 1 });
  return tags.length > 0 ? `${version} · ${tags.join(" · ")}` : version;
}

interface GuideStepReexplainPopoverProps {
  step: GuideStepNode;
  disabled: boolean;
  availableModels?: readonly string[];
  currentModel?: string | null;
  onRevise: (options: StepRevisionOptions) => void;
  onUndoLatestStep?: () => void;
}

/**
 * Intent-driven re-explain popover for a single Guided step:
 * 1-click same-settings retry, depth quick-pills (`pace`), optional model
 * override, one-line steering instruction (`styleOverride`), and tip-only
 * "Undo step & re-pick range".
 */
export function GuideStepReexplainPopover({
  step,
  disabled,
  availableModels = [],
  currentModel = null,
  onRevise,
  onUndoLatestStep,
}: GuideStepReexplainPopoverProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");

  const activeRev = step.revisions.find((r) => r.id === step.activeRevisionId) ?? step.revisions[0];
  const activePace: GuideStepPace = activeRev?.pace ?? "standard";
  const otherModels = availableModels.filter((m) => m && m !== currentModel);

  const triggerRevise = (options: StepRevisionOptions) => {
    setOpen(false);
    setInstruction("");
    setSelectedModel("");
    onRevise(options);
  };

  const handleSubmitInstruction = () => {
    const clean = instruction.trim();
    if (!clean) return;
    triggerRevise({
      styleOverride: clean,
      ...(selectedModel ? { modelOverride: selectedModel } : {}),
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setInstruction("");
          setSelectedModel("");
        }
      }}
      modal={false}
    >
      <Tip label={t("guide.stepRegenerate")}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("guide.stepRegenerate")}
            data-testid="guide-step-reexplain-trigger"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-2rem)] space-y-2.5 p-2.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <button
          type="button"
          data-testid="guide-reexplain-same"
          onClick={() => triggerRevise({})}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
        >
          <RefreshCw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("guide.reexplainSame")}</span>
        </button>

        <div className="space-y-1 border-t border-border/60 pt-2">
          <div className="px-1 text-2xs font-medium text-muted-foreground">
            {t("guide.reexplainDepth")}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {PACES.map((pace) => {
              const isCurrent = pace === activePace;
              return (
                <button
                  key={pace}
                  type="button"
                  data-testid={`guide-reexplain-pace-${pace}`}
                  onClick={() => triggerRevise({ pace })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    isCurrent
                      ? "border-primary/40 bg-primary/10 font-medium text-primary"
                      : "border-border/70 bg-background text-foreground/85 hover:bg-foreground/5",
                  )}
                >
                  {paceLabel(pace, t)}
                </button>
              );
            })}
          </div>
        </div>

        {otherModels.length > 0 && (
          <div className="space-y-1 border-t border-border/60 pt-2">
            <label
              htmlFor={`reexplain-model-${step.id}`}
              className="block px-1 text-2xs font-medium text-muted-foreground"
            >
              {t("guide.reexplainModel")}
            </label>
            <select
              id={`reexplain-model-${step.id}`}
              data-testid="guide-reexplain-model-select"
              value={selectedModel}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  setSelectedModel("");
                  return;
                }
                if (instruction.trim()) {
                  setSelectedModel(value);
                } else {
                  triggerRevise({ modelOverride: value });
                }
              }}
              className="h-7 w-full rounded-md border border-border/70 bg-background px-2 font-mono text-2xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">{currentModel ? shortModelName(currentModel) : "—"}</option>
              {otherModels.map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmitInstruction();
          }}
          className="flex items-center gap-1 border-t border-border/60 pt-2"
        >
          <input
            type="text"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={t("guide.reexplainInstructionPlaceholder")}
            aria-label={t("guide.reexplainInstructionPlaceholder")}
            data-testid="guide-reexplain-instruction"
            className="h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={!instruction.trim()}
            aria-label={t("guide.reexplainSubmit")}
            data-testid="guide-reexplain-submit"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        </form>

        {step.isLatestStep && onUndoLatestStep && (
          <div className="border-t border-border/60 pt-2">
            <button
              type="button"
              data-testid="guide-step-undo-latest"
              onClick={() => {
                setOpen(false);
                onUndoLatestStep();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t("guide.stepUndoLatest")}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
