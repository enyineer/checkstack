import React from "react";
import { Tag, X } from "lucide-react";
import {
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  comboboxAnchorProps,
  isAnchorInteraction,
} from "@checkstack/ui";

export interface AutomationGroupComboboxProps {
  /** Current group value (controlled). Empty string means "Ungrouped". */
  value: string;
  /** Called whenever the value changes (typing, picking, or clearing). */
  onValueChange: (next: string) => void;
  /** Distinct existing group values to suggest. */
  suggestions: string[];
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Type-new-or-pick-existing group field. Composes `Popover` + `Input` (no
 * Combobox primitive exists) and mirrors `PackageNameCombobox`'s structure:
 * a scrollable suggestion list filtered by the current input.
 *
 * Free-typed new groups are allowed (the input value IS the group). Selecting
 * a suggestion fills the value and closes the list. Reuses the shared
 * `comboboxInteraction` dismiss-guard so the very click that opens the list
 * does not immediately close it (Radix treats the anchor as "outside").
 */
export const AutomationGroupCombobox: React.FC<AutomationGroupComboboxProps> = ({
  value,
  onValueChange,
  suggestions,
  id,
  disabled,
  placeholder,
}) => {
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const query = value.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const seen = new Set<string>();
    return suggestions.filter((s) => {
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return query.length === 0 || key.includes(query);
    });
  }, [suggestions, query]);

  // Don't offer a suggestion that exactly equals the current value (nothing
  // to pick — the user already has it).
  const showList =
    filtered.length > 0 &&
    !(filtered.length === 1 && filtered[0]?.toLowerCase() === query);

  const handlePick = (group: string) => {
    onValueChange(group);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <Popover open={open && showList && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Tag className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            id={id}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              onValueChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder ?? "Ungrouped"}
            autoComplete="off"
            className="pl-8 pr-8"
            {...comboboxAnchorProps}
          />
          {value.length > 0 && !disabled && (
            <button
              type="button"
              aria-label="Clear group"
              onClick={() => {
                onValueChange("");
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          if (isAnchorInteraction(e.target)) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (isAnchorInteraction(e.target)) e.preventDefault();
        }}
      >
        <div className="max-h-60 overflow-y-auto py-1">
          {filtered.map((group) => (
            <button
              key={group}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handlePick(group)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{group}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
