import React from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@checkstack/ui";

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
}

export interface ItemPickerProps {
  items: PickerItem[];
  value?: string;
  onSelect: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Type-as-you-go combobox for selecting an item from a registered list
 * (action ids, trigger event ids, artifact types). Composes
 * `<Popover>` + `<Input>` + a filtered list — Radix Select doesn't do
 * substring filtering, only jump-to-letter, so we roll our own.
 *
 * Groups items by `category` when set; otherwise renders a flat list.
 * Selecting an item closes the popover and fires `onSelect(id)`.
 */
export const ItemPicker: React.FC<ItemPickerProps> = ({
  items,
  value,
  onSelect,
  placeholder = "Select…",
  emptyText = "No matches",
  disabled,
  className,
}) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = items.find((item) => item.id === value);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q),
    );
  }, [items, query]);

  const grouped = React.useMemo(() => {
    const groups = new Map<string, PickerItem[]>();
    for (const item of filtered) {
      const key = item.category ?? "";
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={`w-full justify-between font-normal ${className ?? ""}`.trim()}
        >
          <span className={selected ? "" : "text-muted-foreground"}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter…"
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs italic text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            grouped.map(([category, list]) => (
              <div key={category || "default"}>
                {category && (
                  <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {category}
                  </p>
                )}
                {list.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelect(item.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground ${
                      item.id === value ? "bg-accent/50" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{item.label}</span>
                      <code className="font-mono text-[10px] text-muted-foreground">
                        {item.id}
                      </code>
                    </span>
                    {item.description && (
                      <span className="text-[10px] text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
