import React from "react";
import { cn } from "../utils";
import { Command } from "lucide-react";
import { usePerformance } from "./PerformanceProvider";

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
  placeholder = "Search systems, incidents, or run commands...",
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
      <kbd
        className={cn(
          "hidden sm:flex items-center gap-1 px-2 py-1 rounded-md",
          "bg-muted/50 border border-border/50",
          "text-xs text-muted-foreground font-mono",
        )}
      >
        <Command className="w-3 h-3" />
        <span>K</span>
      </kbd>
    </button>
  );
};
