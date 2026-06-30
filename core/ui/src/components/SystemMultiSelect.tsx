import * as React from "react";
import { cn } from "../utils";
import { Input } from "./Input";
import { Checkbox } from "./Checkbox";

export interface SystemMultiSelectProps {
  /** Systems to pick from. Sorted stably by name (case-insensitive). */
  systems: Array<{ id: string; name: string }>;
  /** Currently selected system ids. */
  selectedIds: string[];
  /** Emitted with the full new selection whenever a system is toggled. */
  onChange: (ids: string[]) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  noMatchText?: string;
  /** Renders the "{n} selected" count line. Override to localise. */
  countLabel?: (count: number) => string;
  className?: string;
  listClassName?: string;
  /** id of the labelling element, surfaced via aria-labelledby on the list. */
  labelledBy?: string;
}

const defaultCountLabel = (n: number) => `${n} system(s) selected`;

/**
 * Searchable, counted multi-select of systems. Sorts the options stably by
 * name (case-insensitive) so the rendered list does not jump around between
 * renders, and provides a substring filter to find systems quickly.
 */
export const SystemMultiSelect: React.FC<SystemMultiSelectProps> = ({
  systems,
  selectedIds,
  onChange,
  searchPlaceholder = "Search systems\u2026",
  emptyText = "No systems available",
  noMatchText = "No matches",
  countLabel = defaultCountLabel,
  className,
  listClassName,
  labelledBy,
}) => {
  const [query, setQuery] = React.useState("");

  // Stable, case-insensitive sort by name. `numeric: true` keeps "system-2"
  // before "system-10". useMemo avoids re-sorting on every keystroke.
  const sorted = React.useMemo(
    () =>
      [...systems].toSorted((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    [systems],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => s.name.toLowerCase().includes(q));
  }, [sorted, query]);

  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange([...next]);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8"
          aria-label="Filter systems"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {countLabel(selected.size)}
        </span>
      </div>
      <div
        role="group"
        aria-labelledby={labelledBy}
        className={cn(
          "max-h-48 space-y-1 overflow-y-auto rounded-md border bg-surface-inset p-2",
          listClassName,
        )}
      >
        {systems.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">{noMatchText}</p>
        ) : (
          filtered.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                checked={selected.has(s.id)}
                onCheckedChange={(c) => toggle(s.id, Boolean(c))}
              />
              {s.name}
            </label>
          ))
        )}
      </div>
    </div>
  );
};
