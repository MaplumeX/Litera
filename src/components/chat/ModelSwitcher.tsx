import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listBuiltinModelIds } from "@/agent/runtime/model-resolution";
import { isCustomProviderId } from "@/types/agent-config";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export interface ModelSwitcherProps {
  provider: string | null;
  model: string | null;
  configured: boolean;
  customModels: string[];
  isStreaming: boolean;
  onModelSelect: (model: string) => void;
  onOpenConfig: () => void;
}

/**
 * Runtime model switcher for the chat composer. Lists the current provider's
 * models (built-in pi-ai catalog or a custom provider's saved models) and
 * switches via the explicit `switch_provider` path — unlike the draft-only
 * provider dropdown in AgentConfigForm, clicking an item here IS the switch
 * intent.
 */
export function ModelSwitcher({
  provider,
  model,
  configured,
  customModels,
  isStreaming,
  onModelSelect,
  onOpenConfig,
}: ModelSwitcherProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    if (isCustomProviderId(provider)) {
      setModels(customModels);
      return;
    }
    let cancelled = false;
    void listBuiltinModelIds(provider).then((ids) => {
      if (!cancelled) setModels(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, customModels]);

  const listModels = model && !models.includes(model) ? [model, ...models] : models;
  const label = !configured
    ? t("chat.modelNotConfigured")
    : (model ?? t("chat.modelNotConfigured"));
  const disabled = isStreaming;

  const handleSelect = (id: string) => {
    setOpen(false);
    onModelSelect(id);
  };

  const trigger =
    configured && provider && !disabled ? (
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("chat.modelLabel")}
            title={model ?? undefined}
            className="flex h-6 w-auto max-w-44 items-center gap-0.5 rounded-sm border-none bg-transparent px-1.5 text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-64 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div
            role="listbox"
            aria-label={t("chat.modelLabel")}
            className={cn("max-h-64 overflow-y-auto")}
          >
            {listModels.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={id === model}
                onClick={() => handleSelect(id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    id === model ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0 truncate font-mono">{id}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    ) : (
      <button
        type="button"
        aria-label={t("chat.modelLabel")}
        onClick={onOpenConfig}
        disabled={disabled}
        title={label}
        className="flex h-6 w-auto max-w-44 items-center gap-0.5 rounded-sm border-none bg-transparent px-1.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>
    );

  return trigger;
}
