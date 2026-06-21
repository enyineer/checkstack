import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  cn,
  usePerformance,
} from "@checkstack/ui";
import { useDebouncedSearch, useFormatShortcut } from "../index";
import type { SearchResult } from "@checkstack/command-common";
import { Search, ArrowUp, ArrowDown, CornerDownLeft } from "lucide-react";
import { SearchResultRow } from "./SearchResultRow";
import { PaletteEmptyState } from "./PaletteEmptyState";
import { PALETTE_KBD_CHIP, PALETTE_SHELL_SHADOW } from "./paletteChrome";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SearchDialog: React.FC<SearchDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const navigate = useNavigate();
  const formatShortcut = useFormatShortcut();
  const { isLowPower } = usePerformance();
  const {
    results,
    loading,
    setQuery: setSearchQuery,
    reset,
  } = useDebouncedSearch(300);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Trigger search when dialog opens or query changes
  useEffect(() => {
    if (open) {
      setSearchQuery(query);
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Reset state when dialog closes
      setQuery("");
      setSelectedIndex(0);
      reset();
    }
  }, [open, query, setSearchQuery, reset]);

  // Group results by category
  const groupedResults: Record<string, SearchResult[]> = {};
  for (const result of results) {
    const category = result.category;
    if (!groupedResults[category]) {
      groupedResults[category] = [];
    }
    groupedResults[category].push(result);
  }

  // Flatten for navigation
  const flatResults = Object.values(groupedResults).flat();

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onOpenChange(false);
      if (result.route) {
        navigate(result.route);
      }
    },
    [navigate, onOpenChange]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, flatResults.length - 1)
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (flatResults[selectedIndex]) {
            handleSelect(flatResults[selectedIndex]);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          onOpenChange(false);
          break;
        }
      }
    },
    [flatResults, selectedIndex, handleSelect, onOpenChange]
  );

  // Render a single result item
  const renderResult = (result: SearchResult, globalIndex: number) => {
    const isSelected = globalIndex === selectedIndex;

    return (
      <SearchResultRow
        key={result.id}
        result={result}
        isSelected={isSelected}
        onSelect={() => handleSelect(result)}
        onHover={() => setSelectedIndex(globalIndex)}
        formatShortcut={formatShortcut}
      />
    );
  };

  // Track global index for selection
  let globalIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className={cn(
          "p-0 gap-0 overflow-hidden rounded-xl border border-border/70",
          "bg-gradient-to-b from-surface-2 to-surface",
          PALETTE_SHELL_SHADOW,
        )}
        hideCloseButton
        onKeyDown={handleKeyDown}
      >
        {/* Visually hidden but accessible title and description */}
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search commands and systems using the input below
        </DialogDescription>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-surface-2/60">
          <Search className="w-5 h-5 text-muted-foreground/70 flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(e.target.value)
            }
            placeholder="Search commands and systems..."
            className="border-0 bg-transparent focus-visible:ring-0 px-0 text-base placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {loading ? (
            <PaletteEmptyState message="Searching..." isLowPower={isLowPower} />
          ) : flatResults.length === 0 ? (
            <PaletteEmptyState
              message={query ? "No results found" : "Start typing to search..."}
              isLowPower={isLowPower}
            />
          ) : (
            Object.entries(groupedResults).map(
              ([category, categoryResults], groupIndex) => (
                <div
                  key={category}
                  className={cn(
                    groupIndex > 0 && "mt-1 border-t border-border/40",
                  )}
                >
                  {/* Category header */}
                  <div className="flex items-center gap-1.5 px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    <span>{category}</span>
                    <span className="text-muted-foreground/50">
                      ({categoryResults.length})
                    </span>
                  </div>
                  {/* Category results */}
                  {categoryResults.map((result) => {
                    const element = renderResult(result, globalIndex);
                    globalIndex++;
                    return element;
                  })}
                </div>
              )
            )
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div
          className={cn(
            "flex items-center gap-4 px-4 py-2 border-t border-border/60 text-xs text-muted-foreground",
            isLowPower ? "bg-surface-2" : "bg-surface-2/60 backdrop-blur",
          )}
        >
          <div className="flex items-center gap-1.5">
            <kbd className={PALETTE_KBD_CHIP}>
              <ArrowUp className="size-3" />
            </kbd>
            <kbd className={PALETTE_KBD_CHIP}>
              <ArrowDown className="size-3" />
            </kbd>
            <span>Navigate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className={PALETTE_KBD_CHIP}>
              <CornerDownLeft className="size-3" />
            </kbd>
            <span>Select</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className={PALETTE_KBD_CHIP}>esc</kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
