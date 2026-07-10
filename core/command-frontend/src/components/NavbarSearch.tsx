import { useState, useEffect } from "react";
import {
  cn,
  usePerformance,
  SearchShortcutHint,
  SEARCH_TRIGGER_LABEL,
} from "@checkstack/ui";
import { Search } from "lucide-react";
import { SearchDialog } from "./SearchDialog";
import { PALETTE_TRIGGER_SHADOW } from "./paletteChrome";

/**
 * NavbarSearch - Compact command palette trigger for the navbar.
 * Displays a small search button that opens the global search dialog.
 * Includes the ⌘K keyboard shortcut listener.
 *
 * The trigger button is hidden below `md` to de-clutter the mobile navbar; the
 * mobile drawer offers its own "Search..." entry, which reaches this same
 * dialog through `openSearchPalette()`. Note this component is only visually
 * hidden, never unmounted: it OWNS the dialog's open state and the ⌘K listener
 * that `openSearchPalette()` re-dispatches into, so unmounting it on mobile
 * would break the drawer's search entry.
 */
export const NavbarSearch = () => {
  const [searchOpen, setSearchOpen] = useState(false);
  const { isLowPower } = usePerformance();

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
          // Base footprint. Hidden below `md` - see the component doc comment.
          "hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer",
          // Quiet premium depth: gradient surface + soft layered shadow
          "bg-gradient-to-b from-surface-2 to-surface border border-border/70",
          PALETTE_TRIGGER_SHADOW,
          // Hover: lift instead of glow (color-only fallback on low power)
          isLowPower
            ? "transition-colors hover:bg-surface-inset hover:border-primary/40"
            : "transition-all duration-200 hover:-translate-y-px hover:bg-surface-2 hover:border-primary/40 hover:shadow-md",
          // Focus ring
          "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
        )}
        aria-label="Open search"
      >
        <Search className="w-4 h-4 text-muted-foreground" />
        {/* Show placeholder text only on larger screens */}
        <span className="hidden md:inline text-sm text-muted-foreground">
          {SEARCH_TRIGGER_LABEL}
        </span>
        {/* Keyboard shortcut badge - hidden on small screens */}
        <SearchShortcutHint className="hidden sm:flex gap-0.5 px-1.5 py-0.5 bg-surface-inset border border-border/70" />
      </button>
    </>
  );
};
