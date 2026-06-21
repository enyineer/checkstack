import React from "react";
import { Command } from "lucide-react";
import { cn } from "../utils";
import { SEARCH_SHORTCUT_KEY, isMacPlatform } from "./searchTrigger";

interface SearchShortcutHintProps {
  className?: string;
}

/**
 * SearchShortcutHint - platform-aware keyboard shortcut badge for the global
 * search trigger (⌘K on Mac, Ctrl+K elsewhere). Shared by every search
 * affordance so the hint can never drift between them.
 */
export const SearchShortcutHint: React.FC<SearchShortcutHintProps> = ({
  className,
}) => {
  const isMac = isMacPlatform();

  return (
    <kbd
      className={cn(
        "items-center rounded bg-muted/50 border border-border/50",
        "text-xs text-muted-foreground font-mono",
        className,
      )}
    >
      {isMac ? (
        <>
          <Command className="w-3 h-3" />
          <span>{SEARCH_SHORTCUT_KEY}</span>
        </>
      ) : (
        <span>Ctrl+{SEARCH_SHORTCUT_KEY}</span>
      )}
    </kbd>
  );
};
