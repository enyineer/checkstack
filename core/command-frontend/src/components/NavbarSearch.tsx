import { useState, useEffect, useMemo } from "react";
import { cn } from "@checkmate-monitor/ui";
import { Search, Command } from "lucide-react";
import { SearchDialog } from "./SearchDialog";

/**
 * NavbarSearch - Compact command palette trigger for the navbar.
 * Displays a small search button that opens the global search dialog.
 * Includes the ⌘K keyboard shortcut listener.
 */
export const NavbarSearch = () => {
  const [searchOpen, setSearchOpen] = useState(false);

  // Detect Mac for keyboard shortcut display
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad/.test(navigator.userAgent),
    []
  );

  // Global keyboard shortcut for search (⌘K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {/* Search Dialog */}
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Compact trigger button */}
      <button
        onClick={() => setSearchOpen(true)}
        className={cn(
          // Base styles
          "flex items-center gap-2 px-3 py-1.5 rounded-lg",
          // Glassmorphism effect
          "bg-muted/50 border border-primary/30",
          // Subtle primary pulse animation
          "animate-pulse-subtle ring-1 ring-primary/20",
          // Hover state
          "hover:bg-muted hover:border-primary/50 hover:ring-primary/40",
          // Transition
          "transition-all duration-200",
          // Focus ring
          "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
          // Cursor
          "cursor-pointer"
        )}
        style={{
          animation: "pulse-glow 3s ease-in-out infinite",
        }}
        aria-label="Open search"
      >
        <Search className="w-4 h-4 text-muted-foreground" />
        {/* Show placeholder text only on larger screens */}
        <span className="hidden md:inline text-sm text-muted-foreground">
          Search...
        </span>
        {/* Keyboard shortcut badge - hidden on small screens */}
        <kbd
          className={cn(
            "hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded",
            "bg-background/50 border border-border/50",
            "text-xs text-muted-foreground font-mono"
          )}
        >
          {isMac ? (
            <>
              <Command className="w-3 h-3" />
              <span>K</span>
            </>
          ) : (
            <span>Ctrl+K</span>
          )}
        </kbd>
      </button>
    </>
  );
};
