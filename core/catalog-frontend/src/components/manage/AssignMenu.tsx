import { useState, type ReactNode } from "react";
import { Popover, PopoverTrigger, PopoverContent, cn } from "@checkstack/ui";

export interface AssignMenuItem {
  id: string;
  label: string;
}

interface AssignMenuProps {
  /** Trigger button content (an icon and/or text). */
  trigger: ReactNode;
  items: AssignMenuItem[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  /** Accessible label for the trigger. */
  triggerLabel: string;
  /** Empty-state text when there are no items to choose. */
  emptyLabel?: string;
  className?: string;
}

/**
 * A compact "assign to …" picker (add a system to a group, a group to a system,
 * attach an environment, bulk-assign). Built on the Radix `Popover` so the menu
 * is PORTALED out of the table's `overflow-auto` wrapper - a plain absolute
 * popover would be clipped (and unclickable) inside a table cell.
 */
export function AssignMenu({
  trigger,
  items,
  onSelect,
  disabled,
  triggerLabel,
  emptyLabel = "Nothing to add",
  className,
}: AssignMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto p-1">
        {items.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                onSelect(item.id);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
