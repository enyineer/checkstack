import React from "react";
import { Search } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  ScriptPackagesApi,
  type PackageSearchHit,
} from "@checkstack/script-packages-common";
import {
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  comboboxAnchorProps,
  isAnchorInteraction,
} from "@checkstack/ui";
import { useDebouncedValue } from "@checkstack/ui";

export interface PackageNameComboboxProps {
  /** Current package-name value (controlled). */
  value: string;
  /**
   * Called ONLY when the user manually edits the name (typing). Selecting a
   * suggestion does NOT fire this - it fires `onSelect` instead, so the
   * parent can distinguish "user typed a new name" (reset version) from
   * "user picked a suggestion" (auto-fill version).
   */
  onValueChange: (next: string) => void;
  /** Called when a suggestion is picked, with the full search hit. */
  onSelect?: (hit: PackageSearchHit) => void;
  id?: string;
  placeholder?: string;
}

/**
 * Package-name field with live, backend-proxied npm search. Composes
 * `Popover` + `Input` (no Combobox primitive exists) and mirrors
 * `VariablePicker`'s structure: a scrollable result list with a Search icon.
 *
 * Search is debounced ~300ms and only runs at >= 2 chars. Selecting a hit
 * sets the value and closes the list. The query is the script-packages
 * plugin's own `searchPackages`, so its `useQuery` is same-plugin (no manual
 * invalidation needed).
 */
export const PackageNameCombobox: React.FC<PackageNameComboboxProps> = ({
  value,
  onValueChange,
  onSelect,
  id,
  placeholder,
}) => {
  const client = usePluginClient(ScriptPackagesApi);
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const debouncedName = useDebouncedValue(value, 300);
  const searchQuery = client.searchPackages.useQuery(
    { text: debouncedName },
    { enabled: debouncedName.trim().length >= 2 },
  );

  const items = searchQuery.data?.items ?? [];
  const canSearch = value.trim().length >= 2;

  const handleChange = (next: string) => {
    onValueChange(next);
    setOpen(next.trim().length >= 2);
  };

  const handlePick = (hit: PackageSearchHit) => {
    onSelect?.(hit);
    setOpen(false);
    // Keep focus in the name input; we don't want it to bounce to the version
    // field automatically (the user moves there deliberately).
    inputRef.current?.focus();
  };

  return (
    <Popover open={open && canSearch} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          id={id}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            if (canSearch) setOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          {...comboboxAnchorProps}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
        // Keep focus in the input so typing continues uninterrupted, and don't
        // yank focus on close (would re-trigger the anchor's onFocus).
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Clicking/focusing the anchor input must NOT dismiss the list - that
        // is what produced the "opens then immediately closes" flicker: Radix
        // saw the focusing click on the anchor as an outside interaction.
        onPointerDownOutside={(e) => {
          if (isAnchorInteraction(e.target)) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (isAnchorInteraction(e.target)) e.preventDefault();
        }}
      >
        <div className="max-h-80 overflow-y-auto py-1">
          {searchQuery.isFetching && items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground italic">
              Searching…
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground italic">
              No matching packages.
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.name}
                type="button"
                // Use mousedown so the pick lands before the input's blur/focus
                // shuffle, and prevent default so the input keeps focus.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(item)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
              >
                <span className="flex w-full items-center gap-2">
                  <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <code className="flex-1 truncate font-mono text-xs">
                    {item.name}
                  </code>
                  {item.version && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {item.version}
                    </span>
                  )}
                </span>
                {item.description && (
                  <span className="line-clamp-1 pl-5 text-[10px] text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
