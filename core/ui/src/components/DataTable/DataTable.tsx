import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "../../utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../Table";
import { compareSortValues, toSortValue } from "./helpers";
import { DataTableFilterBar } from "./DataTableFilterBar";
import {
  EMPTY_TABLE_FILTERS,
  applyTableFilters,
  columnDerivedFacets,
  type DataTableFilterState,
} from "./facets.logic";
import type { DataTableProps } from "./types";

export type { DataTableColumn, DataTableProps } from "./types";
export type { SortValue } from "./helpers";

/** Empty, frozen default so an unfiltered table allocates no facet array. */
const NO_FACETS: readonly [] = [];

/**
 * DataTable - the shared, sortable + globally-searchable table for every list
 * surface. Headless sort/filter state is powered by `@tanstack/react-table`;
 * all cell rendering, per-row access gating, selection and actions stay
 * caller-owned through the {@link DataTableColumn} config.
 *
 * - Click a column header (any column with `sortValue`) to sort
 *   ascending -> descending -> unsorted.
 * - The global search box filters rows across every column with `searchValue`.
 * - Provide `renderMobileCard` to swap to a stacked card layout below `sm`;
 *   the cards reflect the same active sort + search.
 * - The surface is an opaque `bg-card` panel by default (readable over any
 *   page background) - pass `surface={false}` to opt out.
 *
 * Selection is modelled as an ordinary leading column: give it a `header` with
 * your "select all" checkbox and a `cell` with the per-row checkbox.
 */
export function DataTable<TData>({
  data,
  columns,
  getRowId,
  searchable,
  searchPlaceholder,
  facets = NO_FACETS,
  filters,
  onFiltersChange,
  onClearFilters,
  defaultSort,
  onRowClick,
  getRowProps,
  renderMobileCard,
  toolbar,
  emptyState,
  noResultsState,
  surface = true,
  className,
}: DataTableProps<TData>): React.ReactElement {
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSort
      ? [{ id: defaultSort.columnId, desc: defaultSort.direction === "desc" }]
      : [],
  );

  // Controlled/uncontrolled: the internal state is always declared (stable hook
  // order) and simply goes unread when the caller supplies `filters`.
  const [ownFilters, setOwnFilters] = React.useState<DataTableFilterState>(
    EMPTY_TABLE_FILTERS,
  );
  const activeFilters = filters ?? ownFilters;
  const setFilters = React.useCallback(
    (next: DataTableFilterState) => {
      if (onFiltersChange) onFiltersChange(next);
      else setOwnFilters(next);
    },
    [onFiltersChange],
  );
  const clearFilters = React.useCallback(() => {
    if (onClearFilters) onClearFilters();
    else setFilters(EMPTY_TABLE_FILTERS);
  }, [onClearFilters, setFilters]);

  const searchAccessors = React.useMemo(
    () => columns.flatMap((c) => (c.searchValue ? [c.searchValue] : [])),
    [columns],
  );
  const showSearch = searchable ?? searchAccessors.length > 0;

  // Columns that declare `filterValue` become facets, in column order, ahead of
  // any the caller passed explicitly. Derived from the FULL `data` so an option
  // list stays stable no matter what is currently filtered out.
  const allFacets = React.useMemo(() => {
    const derived = columnDerivedFacets({ columns, rows: data });
    return derived.length > 0 ? [...derived, ...facets] : facets;
  }, [columns, data, facets]);

  const filteredData = React.useMemo(
    () =>
      applyTableFilters({
        rows: data,
        state: activeFilters,
        facets: allFacets,
        searchAccessors,
      }),
    [data, activeFilters, allFacets, searchAccessors],
  );

  const tableColumns = React.useMemo<ColumnDef<TData>[]>(
    () =>
      columns.map((col) => {
        const sortValue = col.sortValue;
        if (sortValue) {
          return {
            id: col.id,
            accessorFn: (row: TData) => sortValue(row) ?? undefined,
            enableSorting: true,
            sortUndefined: "last",
            sortingFn: (a, b, columnId) =>
              compareSortValues(
                toSortValue(a.getValue(columnId)),
                toSortValue(b.getValue(columnId)),
              ),
          } satisfies ColumnDef<TData>;
        }
        return { id: col.id, enableSorting: false } satisfies ColumnDef<TData>;
      }),
    [columns],
  );

  const table = useReactTable({
    data: filteredData,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  const headerRow = (
    <TableRow>
      {columns.map((col) => {
        const column = table.getColumn(col.id);
        const sortable = Boolean(col.sortValue);
        const sorted = column?.getIsSorted() ?? false;
        return (
          <TableHead
            key={col.id}
            className={cn(
              col.desktopOnly && "hidden md:table-cell",
              col.truncate && "w-full max-w-0",
              col.headClassName,
            )}
            aria-sort={
              sorted === "asc"
                ? "ascending"
                : sorted === "desc"
                  ? "descending"
                  : undefined
            }
          >
            {sortable ? (
              <button
                type="button"
                onClick={(event) => column?.getToggleSortingHandler()?.(event)}
                className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {col.header}
                {sorted === "asc" ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : sorted === "desc" ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                )}
              </button>
            ) : (
              col.header
            )}
          </TableHead>
        );
      })}
    </TableRow>
  );

  const bodyRows = rows.map((row) => {
    const { selected, className: rowClassName, ...rowRest } =
      getRowProps?.(row.original) ?? {};
    return (
      <TableRow
        key={row.id}
        data-state={selected ? "selected" : undefined}
        className={cn(onRowClick && "cursor-pointer", rowClassName)}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
        {...rowRest}
      >
        {columns.map((col) => (
          <TableCell
            key={col.id}
            className={cn(
              col.desktopOnly && "hidden md:table-cell",
              col.truncate && "w-full max-w-0",
              col.cellClassName,
            )}
          >
            {col.cell(row.original)}
          </TableCell>
        ))}
      </TableRow>
    );
  });

  const showEmpty = data.length === 0 && emptyState;
  const showNoResults = !showEmpty && rows.length === 0 && noResultsState;
  const showFilterBar = showSearch || allFacets.length > 0;

  // `surface={false}` means the table is nested in someone else's opaque panel
  // (a Card with `p-0` content), so it is full-bleed to that panel's edges.
  // Its toolbar then has to carry its own inset and a separating rule, or the
  // search box sits flush against the card's border. With its own surface the
  // toolbar is a free-standing row and the wrapper's gap is the right spacing.
  const inset = !surface;

  return (
    <div className={cn("space-y-3", className)}>
      {(showFilterBar || toolbar) && (
        <div
          className={cn(
            "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
            inset && "border-b border-border px-4 py-3",
          )}
        >
          {showFilterBar ? (
            <DataTableFilterBar
              filters={activeFilters}
              onFiltersChange={setFilters}
              facets={allFacets}
              searchable={showSearch}
              searchPlaceholder={searchPlaceholder}
              // Only offer Clear once there is more than a search box to clear:
              // an empty search box is self-evidently already cleared.
              onClear={allFacets.length > 0 ? clearFilters : undefined}
              className="min-w-0 flex-1"
            />
          ) : (
            <div />
          )}
          {toolbar && (
            <div className="flex shrink-0 items-center gap-2">{toolbar}</div>
          )}
        </div>
      )}

      {showEmpty ? (
        emptyState
      ) : showNoResults ? (
        noResultsState
      ) : (
        <>
          <div
            className={cn(
              renderMobileCard && "hidden sm:block",
              surface &&
                "overflow-hidden rounded-lg border border-border bg-card",
            )}
          >
            <Table>
              <TableHeader>{headerRow}</TableHeader>
              <TableBody>{bodyRows}</TableBody>
            </Table>
          </div>

          {renderMobileCard && (
            <div className="flex flex-col gap-2 sm:hidden">
              {rows.map((row) => (
                <React.Fragment key={row.id}>
                  {renderMobileCard(row.original)}
                </React.Fragment>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
