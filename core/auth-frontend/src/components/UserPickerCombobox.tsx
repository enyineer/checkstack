import React from "react";
import { Search, UserPlus } from "lucide-react";
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
import { useDebouncedValue } from "../hooks/useDebouncedValue";

export interface UserPickerComboboxProps {
  /**
   * Called when a user is picked from the results. The parent decides what to
   * do (e.g. add them to the team). The combobox clears itself afterwards.
   */
  onSelect: (user: { id: string; name: string; email: string }) => void;
  /** User ids already in the team — filtered out of the result list. */
  excludeUserIds: string[];
  /** Disables the input (e.g. while an add is in flight). */
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

/**
 * Single-control directory picker for the team add-member flow. Composes
 * `Popover` + `Input` (no Combobox primitive exists) and mirrors
 * `PackageNameCombobox`: a debounced, scrollable result list with a Search
 * icon and an explicit "Searching…" state.
 *
 * Replaces the older two-control (free-text Input + separate Select) pattern,
 * which showed a misleading "No matching users" while the search was still in
 * flight and split one action across two widgets. Search runs against
 * `searchUsers` (gated on teams.read, and further restricted server-side to
 * team administrators) so a team manager without the admin `users.read` rule
 * can still find people to add.
 */
export const UserPickerCombobox: React.FC<UserPickerComboboxProps> = ({
  onSelect,
  excludeUserIds,
  disabled,
  placeholder = "Search users by name or email",
  id,
}) => {
  const authClient = usePluginClient(AuthApi);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query, 300);
  const canSearch = query.trim().length >= 2;

  const searchQuery = authClient.searchUsers.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length >= 2 },
  );

  const excluded = new Set(excludeUserIds);
  const results = (searchQuery.data ?? []).filter((u) => !excluded.has(u.id));
  // The displayed query has changed but the debounced query (and thus the
  // result set) has not caught up yet — treat that as "still searching" so we
  // never flash "No matching users" mid-type.
  const isSearching =
    searchQuery.isFetching || (canSearch && debouncedQuery !== query.trim());

  const handleChange = (next: string) => {
    setQuery(next);
    setOpen(next.trim().length >= 2);
  };

  const handlePick = (user: { id: string; name: string; email: string }) => {
    onSelect(user);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <Popover open={open && canSearch} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-background px-2">
          <Search className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            id={id}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => {
              if (canSearch) setOpen(true);
            }}
            placeholder={placeholder}
            disabled={disabled}
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
              No matching users.
            </p>
          ) : (
            results.map((user) => (
              <button
                key={user.id}
                type="button"
                // Also gated on `disabled` (defense-in-depth): handlePick closes
                // the popover synchronously so the add-in-flight window is
                // already tiny, but this prevents a double-fire if a future
                // change keeps the list open across the mutation.
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(user)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">
                  <span className="font-medium">{user.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
