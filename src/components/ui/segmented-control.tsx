import { createContext, useContext, useRef } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedSize = "default" | "touch";

/** Sets the size of every SegmentedControl inside (the phone's Settings page uses "touch"). */
export const SegmentedSizeContext = createContext<SegmentedSize>("default");

/** One choice out of a few, as a radio group: arrow keys move, Space or Enter picks. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = true,
  size,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
  /** "touch" is the phone's: 36px pills on a rounded track. */
  size?: SegmentedSize;
}) {
  const contextSize = useContext(SegmentedSizeContext);
  const touch = (size ?? contextSize) === "touch";
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(from: number, delta: number) {
    const next = (from + delta + options.length) % options.length;
    buttonRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-size={touch ? "touch" : "default"}
      className={cn("inline-flex bg-muted", touch ? "rounded-full p-1" : "rounded-lg p-0.5", fullWidth && "w-full")}
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
              "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              touch ? "h-9 min-w-0 truncate rounded-full px-2 text-sm" : "rounded-md px-2.5 py-1 text-xs",
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
