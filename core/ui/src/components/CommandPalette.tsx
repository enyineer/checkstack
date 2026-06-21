import React from "react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";
import { SearchShortcutHint } from "./SearchShortcutHint";
import { SEARCH_TRIGGER_PLACEHOLDER } from "./searchTrigger";

// Re-export the shared search-trigger primitives so consumers (e.g. the wired
// navbar trigger) can import them from "@checkstack/ui" without index.ts churn,
// keeping a single source of truth for the trigger's copy + shortcut hint.
export { SearchShortcutHint } from "./SearchShortcutHint";
export {
  SEARCH_TRIGGER_LABEL,
  SEARCH_TRIGGER_PLACEHOLDER,
  SEARCH_SHORTCUT_KEY,
  isMacPlatform,
} from "./searchTrigger";

interface CommandPaletteProps {
  onClick?: () => void;
  placeholder?: string;
  className?: string;
}

/**
 * CommandPalette - Hero search bar with keyboard shortcut hint
 * Displays a prominent search input that triggers a search dialog on click
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  onClick,
  placeholder = SEARCH_TRIGGER_PLACEHOLDER,
  className,
}) => {
  const { isLowPower } = usePerformance();

  return (
    <button
      onClick={onClick}
      className={cn(
        // Base styles
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl",
        // Glassmorphism effect
        isLowPower ? "bg-card" : "bg-card/50 backdrop-blur-sm",
        "border border-border/50",
        // Glow and shadow
        "shadow-lg shadow-primary/5 hover:shadow-xl hover:shadow-primary/10",
        // Hover state
        "hover:border-primary/30 hover:bg-card/70",
        // Transition
        "transition-all",
        !isLowPower && "duration-300 ease-out",
        // Focus ring
        "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
        // Cursor
        "cursor-text",
        className,
      )}
    >
      {/* Search icon */}
      <svg
        className="w-5 h-5 text-muted-foreground flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>

      {/* Placeholder text with typewriter effect */}
      <span className="flex-1 text-left text-muted-foreground text-sm font-medium truncate">
        {placeholder}
      </span>

      {/* Keyboard shortcut badge */}
      <SearchShortcutHint className="hidden sm:flex gap-1 px-2 py-1 rounded-md" />
    </button>
  );
};
