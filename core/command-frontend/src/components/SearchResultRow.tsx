import React from "react";
import { cn, DynamicIcon, type LucideIconName } from "@checkstack/ui";
import type { SearchResult } from "@checkstack/command-common";
import { CornerDownLeft } from "lucide-react";
import { PALETTE_KBD_CHIP } from "./paletteChrome";

interface SearchResultRowProps {
  result: SearchResult;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
  formatShortcut: (shortcut: string) => string;
}

/**
 * A single command-palette result row.
 *
 * Leads with a framed icon tile for a consistent visual anchor, promotes the
 * title to the primary line and demotes the subtitle, and renders selection as
 * a contained pill (left accent stripe + ring) rather than a full-bleed wash.
 */
export const SearchResultRow: React.FC<SearchResultRowProps> = ({
  result,
  isSelected,
  onSelect,
  onHover,
  formatShortcut,
}) => {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        // mx-2 insets the pill; width is clamped so it never overflows the list
        "group relative flex items-center gap-3 mx-2 w-[calc(100%-1rem)] px-3 py-2.5 rounded-lg text-left transition-all",
        isSelected
          ? "bg-surface-2 ring-1 ring-primary/30 text-foreground"
          : "text-muted-foreground hover:bg-surface-inset",
      )}
    >
      {/* Left accent stripe for the selected state */}
      {isSelected && (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
      )}

      {/* Framed icon tile */}
      <span
        className={cn(
          "grid place-items-center size-9 flex-shrink-0 rounded-lg border bg-surface-inset transition-colors",
          isSelected ? "border-primary/40" : "border-border/60",
        )}
      >
        <DynamicIcon
          name={result.iconName as LucideIconName}
          className="size-4 text-muted-foreground"
        />
      </span>

      <div className="flex-1 min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">
          {result.title}
        </span>
        {result.subtitle && (
          <span className="block truncate text-xs text-muted-foreground/80 mt-0.5">
            {result.subtitle}
          </span>
        )}
      </div>

      {/* Shortcut chip for commands */}
      {result.type === "command" &&
        result.shortcuts &&
        result.shortcuts.length > 0 && (
          <div className="flex gap-1 flex-shrink-0">
            {result.shortcuts.slice(0, 1).map((shortcut) => (
              <kbd key={shortcut} className={PALETTE_KBD_CHIP}>
                {formatShortcut(shortcut)}
              </kbd>
            ))}
          </div>
        )}

      {isSelected && (
        <CornerDownLeft className="size-4 flex-shrink-0 text-primary" />
      )}
    </button>
  );
};
