import { useMemo, useState } from "react";
import { Input, Popover, PopoverTrigger, PopoverContent } from "@checkstack/ui";
import { ChevronDown, X, Plus, Search } from "lucide-react";

export interface MembershipItem {
  id: string;
  label: string;
}

export interface MembershipChipsProps {
  /** Singular/plural noun for the count pill + a11y (e.g. system/systems). */
  noun: { one: string; many: string };
  /** Currently-assigned members. */
  assigned: MembershipItem[];
  /** Items still addable (caller pre-filters, e.g. excludes current members). */
  available: MembershipItem[];
  /** Show the "add" control at all (coarse: can this row's parent be managed). */
  canAdd: boolean;
  /** Per-item removal gate (removal is authorized per member by the backend). */
  canRemove: (item: MembershipItem) => boolean;
  /** Freeze membership (e.g. a GitOps-managed parent). Hides add + remove. */
  isLocked?: boolean;
  /** Tooltip/title shown while locked. */
  lockReason?: string;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** a11y label for a chip's remove button. */
  removeLabel: (item: MembershipItem) => string;
  /** a11y label for the add trigger. */
  addLabel: string;
  /** Empty-state text for the add section (when nothing is left to add). */
  emptyAddLabel?: string;
}

const capitalize = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);

const byLabel = (a: MembershipItem, b: MembershipItem): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

/** Above this many addable items, the add list gets a search box. */
const SEARCH_THRESHOLD = 6;

/**
 * Compact membership editor shared by every manage tab (a system's groups /
 * environments, a group's / environment's systems). Collapses to a single
 * count pill ("N systems") whose popover holds BOTH the members (removable) and
 * a searchable add list, so a row with many memberships stays ONE line tall
 * instead of wrapping a chip wall. Replaces four near-identical chip renderers
 * that used to bloat each row.
 */
export function MembershipChips({
  noun,
  assigned,
  available,
  canAdd,
  canRemove,
  isLocked = false,
  lockReason,
  onAdd,
  onRemove,
  removeLabel,
  addLabel,
  emptyAddLabel,
}: MembershipChipsProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // The Radix Popover is heavy to instantiate, and a manage table mounts one of
  // these PER ROW (twice per Systems row). Defer mounting the Popover until the
  // pill is first clicked so opening a tab pays only for plain buttons.
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const count = assigned.length;
  const canReallyAdd = canAdd && !isLocked;
  const countLabel = `${count} ${count === 1 ? noun.one : noun.many}`;

  // Both lists are shown name-sorted, but only inside the (lazily-mounted)
  // popover - so the sort is skipped entirely on the initial per-row render.
  const sortedAssigned = useMemo(
    () => (mounted ? assigned.toSorted(byLabel) : assigned),
    [assigned, mounted],
  );
  const sortedAvailable = useMemo(
    () => (mounted ? available.toSorted(byLabel) : available),
    [available, mounted],
  );
  const showSearch = sortedAvailable.length > SEARCH_THRESHOLD;
  const filteredAvailable = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedAvailable;
    return sortedAvailable.filter((item) =>
      item.label.toLowerCase().includes(q),
    );
  }, [sortedAvailable, query]);

  // Nothing to show and nothing to add: a plain read-only hint.
  if (count === 0 && !canReallyAdd) {
    return <span className="text-xs text-muted-foreground">No {noun.many}</span>;
  }

  // Empty-but-addable renders a dashed "+ Noun"; a non-empty membership renders
  // the "N noun" count pill. Both share one styled button so the lazy-mount and
  // Popover-mounted variants look identical.
  const triggerClassName =
    count === 0
      ? "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      : "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground transition-colors hover:bg-secondary/80";
  const triggerInner =
    count === 0 ? (
      <>
        <Plus className="h-3 w-3 shrink-0" aria-hidden />
        {capitalize(noun.one)}
      </>
    ) : (
      <>
        {countLabel}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </>
    );
  const triggerAriaLabel = count === 0 ? addLabel : `${countLabel}, show list`;

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label={triggerAriaLabel}
        className={triggerClassName}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        {triggerInner}
      </button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerAriaLabel}
          className={triggerClassName}
        >
          {triggerInner}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        {count > 0 && (
          <>
            <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
              {capitalize(noun.many)}
            </p>
            {isLocked && (
              <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">
                {lockReason ?? "Managed by GitOps"}
              </p>
            )}
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {sortedAssigned.map((item) => {
                const removable = !isLocked && canRemove(item);
                return (
                  <span
                    key={item.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-xs text-foreground"
                  >
                    <span className="truncate">{item.label}</span>
                    {removable && (
                      <button
                        type="button"
                        title={removeLabel(item)}
                        aria-label={removeLabel(item)}
                        onClick={() => onRemove(item.id)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </>
        )}

        {canReallyAdd && (
          <>
            {count > 0 && <div className="my-2 border-t border-border" />}
            <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">
              Add {noun.one}
            </p>
            {available.length === 0 ? (
              <p className="px-1 py-0.5 text-xs text-muted-foreground">
                {emptyAddLabel ?? `No more ${noun.many}`}
              </p>
            ) : (
              <>
                {showSearch && (
                  <div className="relative mb-1">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={`Search ${noun.many}...`}
                      aria-label={`Search ${noun.many} to add`}
                      className="h-8 pl-7 text-sm"
                    />
                  </div>
                )}
                {filteredAvailable.length === 0 ? (
                  <p className="px-1 py-0.5 text-xs text-muted-foreground">
                    No matches.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto">
                    {filteredAvailable.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onAdd(item.id)}
                        className="flex w-full items-center gap-1.5 truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <Plus
                          className="h-3 w-3 shrink-0 opacity-70"
                          aria-hidden
                        />
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
