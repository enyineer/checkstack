import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "../../utils";
import { Input } from "../Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../Table";
import { compareSortValues, filterRows, toSortValue } from "./helpers";
import type { DataTableProps } from "./types";

export type { DataTableColumn, DataTableProps } from "./types";
export type { SortValue } from "./helpers";

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
  const [query, setQuery] = React.useState("");

  const searchAccessors = React.useMemo(
    () => columns.flatMap((c) => (c.searchValue ? [c.searchValue] : [])),
    [columns],
  );
  const showSearch = searchable ?? searchAccessors.length > 0;

  const filteredData = React.useMemo(
    () => filterRows({ rows: data, searchAccessors, query }),
    [data, searchAccessors, query],
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

  return (
    <div className={cn("space-y-3", className)}>
      {(showSearch || toolbar) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {showSearch ? (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder ?? "Search..."}
                aria-label={searchPlaceholder ?? "Search"}
                className="pl-8"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbar && (
            <div className="flex items-center gap-2">{toolbar}</div>
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
