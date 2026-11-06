import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChoiceChip<T extends string> {
  value: T;
  label: string;
  /** A status dot shown in place of the check while the chip is not picked. */
  dotClass?: string;
}

/**
 * One choice out of a row of chips, as a radio group: the picked chip takes
 * the accent and a check. The shelf's status filter and a Book's Reading
 * status in its action sheet.
 */
export function ChoiceChips<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  wrap = false,
  className,
}: {
  value: T;
  options: readonly ChoiceChip<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Wrap onto more lines instead of scrolling sideways. */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex gap-2", wrap ? "flex-wrap" : "overflow-x-auto no-scrollbar", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors motion-reduce:transition-none",
              active
                ? "border-transparent bg-primary/10 font-medium text-primary"
                : "border-border text-foreground/80 active:bg-foreground/5",
            )}
          >
            {active ? (
              <Check className="size-4" aria-hidden />
            ) : (
              option.dotClass && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", option.dotClass)} />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
