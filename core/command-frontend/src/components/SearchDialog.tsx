import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  Input,
  DynamicIcon,
  type LucideIconName,
} from "@checkmate-monitor/ui";
import { useDebouncedSearch, useFormatShortcut } from "../index";
import type { SearchResult } from "@checkmate-monitor/command-common";
import { Search, ArrowUp, ArrowDown, CornerDownLeft } from "lucide-react";

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
  const { results, loading, search, reset } = useDebouncedSearch(300);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Trigger search when dialog opens or query changes
  useEffect(() => {
    if (open) {
      search(query);
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Reset state when dialog closes
      setQuery("");
      setSelectedIndex(0);
      reset();
    }
  }, [open, query, search, reset]);

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
      <button
        key={result.id}
        onClick={() => handleSelect(result)}
        onMouseEnter={() => setSelectedIndex(globalIndex)}
        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
          isSelected
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-muted/50"
        }`}
      >
        <DynamicIcon
          name={result.iconName as LucideIconName}
          className="w-4 h-4 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <span className="block truncate">{result.title}</span>
          {result.subtitle && (
            <span className="block text-xs text-muted-foreground truncate">
              {result.subtitle}
            </span>
          )}
        </div>
        {/* Show shortcuts for commands */}
        {result.type === "command" &&
          result.shortcuts &&
          result.shortcuts.length > 0 && (
            <div className="flex gap-1">
              {result.shortcuts.slice(0, 1).map((shortcut) => (
                <kbd
                  key={shortcut}
                  className="px-1.5 py-0.5 text-xs rounded bg-muted border border-border font-mono"
                >
                  {formatShortcut(shortcut)}
                </kbd>
              ))}
            </div>
          )}
        {isSelected && (
          <CornerDownLeft className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
    );
  };

  // Track global index for selection
  let globalIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(e.target.value)
            }
            placeholder="Search commands and systems..."
            className="border-0 bg-transparent focus-visible:ring-0 px-0 text-base"
          />
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {loading ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              Searching...
            </div>
          ) : flatResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              {query ? "No results found" : "Start typing to search..."}
            </div>
          ) : (
            Object.entries(groupedResults).map(
              ([category, categoryResults]) => (
                <div key={category}>
                  {/* Category header */}
                  <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/30">
                    {category} ({categoryResults.length})
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
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ArrowUp className="w-3 h-3" />
            <ArrowDown className="w-3 h-3" />
            <span>Navigate</span>
          </div>
          <div className="flex items-center gap-1">
            <CornerDownLeft className="w-3 h-3" />
            <span>Select</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1 rounded bg-muted border border-border font-mono">
              esc
            </kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
