import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../utils";
import { Button } from "../Button";
import { Input } from "../Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../Select";
import { pillToneStyles } from "../status-tone";
import {
  ANY_FACET_VALUE,
  hasActiveTableFilters,
  selectedFacetValue,
  withFacetValue,
  withQuery,
  type DataTableFacetControl,
  type DataTableFilterState,
} from "./facets.logic";

/**
 * The search box + facet selects + Clear affordance shown above a
 * {@link DataTable}.
 *
 * This is the extraction of `CatalogBrowseToolbar` and `HealthCheckListToolbar`,
 * which were the same component written twice - the second one's comments even
 * said so ("Mirrors the catalog browse toolbar layout", "Same convention as
 * `CatalogBrowseToolbar`"). Their shared layout is preserved verbatim so the
 * migrated pages look unchanged: stacked on mobile, a wrapping row from `md`.
 *
 * Exported in its own right for the list surfaces that are NOT tables (the
 * catalog browse grid, a card list) so they filter identically to one.
 *
 * Takes {@link DataTableFacetControl}s rather than full facets: rendering a
 * control needs no row accessor, so a surface whose matching the facet model
 * cannot express (multi-valued, or across two row types - see the catalog) is
 * not shut out of the shared bar. A `DataTable`'s facets satisfy this too.
 */
export function DataTableFilterBar({
  filters,
  onFiltersChange,
  facets,
  searchable = true,
  searchPlaceholder,
  onClear,
  className,
  children,
}: {
  filters: DataTableFilterState;
  onFiltersChange: (next: DataTableFilterState) => void;
  facets: ReadonlyArray<DataTableFacetControl>;
  /** Hide the search box for a facet-only bar. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /**
   * Reset handler for the Clear button, which appears only while something is
   * actually filtered. Omit to suppress the button entirely (a surface that
   * offers its own reset).
   */
  onClear?: () => void;
  className?: string;
  /** Extra controls (a date range, a density toggle) appended to the row. */
  children?: React.ReactNode;
}): React.ReactElement {
  const active = hasActiveTableFilters(filters);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center",
        className,
      )}
    >
      {searchable && (
        <div className="relative w-full md:w-56">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={filters.query}
            onChange={(event) =>
              onFiltersChange(withQuery(filters, event.target.value))
            }
            placeholder={searchPlaceholder ?? "Search..."}
            aria-label={searchPlaceholder ?? "Search"}
            className="pl-8"
          />
        </div>
      )}

      {facets.map((facet) =>
        facet.kind === "pills" ? (
          <FacetPills
            key={facet.id}
            facet={facet}
            selected={selectedFacetValue(filters, facet.id)}
            onSelect={(value) =>
              onFiltersChange(withFacetValue(filters, facet.id, value))
            }
          />
        ) : (
          <Select
            key={facet.id}
            value={selectedFacetValue(filters, facet.id)}
            onValueChange={(value) =>
              onFiltersChange(withFacetValue(filters, facet.id, value))
            }
            disabled={facet.disabled}
          >
            <SelectTrigger
              className={cn("w-full md:w-44", facet.triggerClassName)}
              aria-label={`Filter by ${facet.label.toLowerCase()}`}
              title={facet.disabled ? facet.disabledReason : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Named rather than blank, so the unconstrained state is
                  something you can read and deliberately return to. */}
              <SelectItem value={ANY_FACET_VALUE}>
                {facet.anyLabel ?? `Any ${facet.label.toLowerCase()}`}
              </SelectItem>
              {facet.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      )}

      {children}

      {onClear && active && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="mr-1 h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  );
}

/**
 * The `kind: "pills"` rendering: a segmented row where every option is visible
 * and one click away, led by the unconstrained option.
 *
 * `aria-pressed` is what makes the group announce its state - the hand-rolled
 * pill groups this replaces were split on whether to set it, and two shipped
 * without it, leaving screen-reader users no way to tell which filter was live.
 */
function FacetPills({
  facet,
  selected,
  onSelect,
}: {
  facet: DataTableFacetControl;
  selected: string;
  onSelect: (value: string) => void;
}): React.ReactElement {
  const options = [
    {
      value: ANY_FACET_VALUE,
      label: facet.anyLabel ?? `All ${facet.label.toLowerCase()}`,
    },
    ...facet.options,
  ];

  return (
    <div
      className="flex items-center gap-1 rounded-md border border-border bg-surface-inset p-0.5"
      role="group"
      aria-label={`Filter by ${facet.label.toLowerCase()}`}
    >
      {options.map((option) => {
        const active = option.value === selected;
        // A selected option that names a status wears that status's hue; every
        // other selection is neutral. Applied only when SELECTED, so an idle
        // group stays a quiet row of buttons rather than a traffic light.
        const toned = active && option.tone ? pillToneStyles[option.tone] : undefined;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={active && !toned ? "secondary" : "ghost"}
            aria-pressed={active}
            disabled={facet.disabled}
            title={facet.disabled ? facet.disabledReason : undefined}
            onClick={() => onSelect(option.value)}
            className={cn("h-7 px-2 text-xs", toned?.pill)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
