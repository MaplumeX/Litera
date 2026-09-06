import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

interface BranchSwitcherProps {
  /** 1-based index of the active branch. */
  current: number;
  total: number;
  disabled?: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * ChatGPT-style branch switcher for a forked user message: `[<] 2/3 [>]`.
 * Renders nothing for single branches; boundary arrows are disabled (no
 * cycling).
 */
export function BranchSwitcher({
  current,
  total,
  disabled = false,
  onPrev,
  onNext,
}: BranchSwitcherProps) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-0.5" data-testid="branch-switcher">
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={onPrev}
        disabled={disabled || current <= 1}
        aria-label={t("chat.branchPrev")}
        className="text-muted-foreground/50"
      >
        <ChevronLeft />
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {current}/{total}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={onNext}
        disabled={disabled || current >= total}
        aria-label={t("chat.branchNext")}
        className="text-muted-foreground/50"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
