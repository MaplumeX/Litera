import { useRef } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

/** One choice out of a few, as a radio group: arrow keys move, Space or Enter picks. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = true,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(from: number, delta: number) {
    const next = (from + delta + options.length) % options.length;
    buttonRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-lg bg-muted p-0.5", fullWidth && "w-full")}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(index, -1);
              } else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onChange(option.value);
              }
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              fullWidth && "flex-1",
              selected
                ? "bg-background font-medium text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
