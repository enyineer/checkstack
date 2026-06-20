import React from "react";
import { cn } from "@checkstack/ui";
import { Search } from "lucide-react";

interface PaletteEmptyStateProps {
  message: string;
  /** When true, the framed icon stays static (no pulse) per the performance rule. */
  isLowPower: boolean;
}

/**
 * Centered empty / loading state for the command palette.
 *
 * Frames a Search glyph in a soft inset circle above the message so an empty
 * result list still reads as a deliberate, premium surface rather than a lone
 * line of muted text.
 */
export const PaletteEmptyState: React.FC<PaletteEmptyStateProps> = ({
  message,
  isLowPower,
}) => {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <span
        className={cn(
          "grid place-items-center size-10 rounded-full bg-surface-inset",
          !isLowPower && "animate-pulse",
        )}
      >
        <Search className="size-5 text-muted-foreground/70" />
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
};
