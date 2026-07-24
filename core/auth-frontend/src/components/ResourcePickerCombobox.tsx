import React from "react";
import { Search } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import {
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  comboboxAnchorProps,
  isAnchorInteraction,
} from "@checkstack/ui";
import { useDebouncedValue } from "@checkstack/ui";

export interface ResourcePickerComboboxProps {
  /** Qualified resource type to search within (e.g. "catalog.system"). */
  resourceType: string;
  /** Called when a resource is picked. The combobox clears itself afterwards. */
  onSelect: (resource: { id: string; name: string }) => void;
  /** Ids already granted — filtered out of results. */
  excludeIds: string[];
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Searches an owning plugin's resources of a given type (via the auth backend's
 * `searchResources`, which delegates to the plugin's registered resolver) so an
 * admin can grant a team access to a specific resource from the Teams page.
 * Single debounced search-as-you-type control; mirrors UserPickerCombobox.
 */
export const ResourcePickerCombobox: React.FC<ResourcePickerComboboxProps> = ({
  resourceType,
  onSelect,
  excludeIds,
  disabled,
  placeholder = "Search resources by name",
}) => {
  const authClient = usePluginClient(AuthApi);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query, 300);
  const canSearch = query.trim().length >= 2;

  const searchQuery = authClient.searchResources.useQuery(
    { resourceType, query: debouncedQuery },
    { enabled: !!resourceType && debouncedQuery.trim().length >= 2 },
  );

  const excluded = new Set(excludeIds);
  const results = (searchQuery.data?.results ?? []).filter(
    (r) => !excluded.has(r.id),
  );
  const isSearching =
    searchQuery.isFetching || (canSearch && debouncedQuery !== query.trim());

  const handleChange = (next: string) => {
    setQuery(next);
    setOpen(next.trim().length >= 2);
  };

  const handlePick = (resource: { id: string; name: string }) => {
    onSelect(resource);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <Popover open={open && canSearch} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-surface-inset px-2">
          <Search className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => {
              if (canSearch) setOpen(true);
            }}
            placeholder={placeholder}
            disabled={disabled || !resourceType}
            autoComplete="off"
            className="border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            {...comboboxAnchorProps}
          />
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
        <div className="max-h-72 overflow-y-auto py-1">
          {isSearching && results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs italic text-muted-foreground">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs italic text-muted-foreground">
              No matching resources.
            </p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(r)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex-1 truncate text-sm">{r.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
