import type * as React from "react";
import type { SortValue } from "./helpers";

/**
 * A single column of a {@link DataTable}. Rendering stays fully caller-owned
 * via {@link DataTableColumn.cell}; the table only adds sort + search on top.
 */
export interface DataTableColumn<TData> {
  /** Stable, unique column id. */
  id: string;
  /** Header content. Rendered inside the clickable sort button when sortable. */
  header: React.ReactNode;
  /** Renders the cell for a row. */
  cell: (row: TData) => React.ReactNode;
  /**
   * Provide to make the header click-to-sort (ascending -> descending ->
   * unsorted). Strings sort locale-aware/case-insensitive, numbers sort
   * numerically, `null`/`undefined` sort last. Omit for non-sortable columns
   * (chips, action clusters, ...).
   */
  sortValue?: (row: TData) => SortValue;
  /**
   * Provide to include this column's text in the global search box. Omit for
   * columns with no meaningful text to match.
   */
  searchValue?: (row: TData) => string;
  /**
   * Let this column absorb the table's spare width and ELLIPSIZE overflowing
   * content instead of letting one long value force the whole table to scroll
   * horizontally. The `<td>`/`<th>` get `max-width: 0`, so with the table at
   * `w-full` the column shrinks to the space the other columns leave, and its
   * content clips. The cell's own text must still carry `truncate` (single
   * line) inside a `min-w-0` box for the ellipsis to show. Use for a free-text
   * column (a name / description) that can be arbitrarily long.
   */
  truncate?: boolean;
  /** Extra class names for the `<th>` (e.g. width, text alignment). */
  headClassName?: string;
  /** Extra class names for the `<td>`. */
  cellClassName?: string;
  /** Hide this (lower-priority) column below the `md` breakpoint. */
  desktopOnly?: boolean;
}

export interface DataTableProps<TData> {
  /** The full row set (unfiltered, unsorted). */
  data: TData[];
  /** Column definitions, in display order. */
  columns: DataTableColumn<TData>[];
  /** Stable id for a row (used as the React key and for sort stability). */
  getRowId: (row: TData) => string;
  /**
   * Show the global search box. Defaults to `true` when any column declares a
   * `searchValue`, `false` otherwise.
   */
  searchable?: boolean;
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
  /** Initial sort. */
  defaultSort?: { columnId: string; direction: "asc" | "desc" };
  /** Called when a row is clicked (e.g. to open a detail drawer). */
  onRowClick?: (row: TData) => void;
  /**
   * Per-row presentation and behaviour. Return `selected` for the selected
   * highlight, plus any standard row attributes (`className`, `role`,
   * `tabIndex`, `aria-current`, `onKeyDown`, ...) - these are spread onto the
   * `<tr>`, so an interactive master-detail table keeps full keyboard/ARIA
   * support that `onRowClick` alone cannot express. Attributes you return win
   * over the defaults (e.g. a returned `onClick` overrides `onRowClick`).
   */
  getRowProps?: (
    row: TData,
  ) => { selected?: boolean } & React.HTMLAttributes<HTMLTableRowElement>;
  /**
   * Render a row as a stacked card on narrow (`< sm`) viewports. When provided,
   * the desktop table hides below `sm` and these cards show instead, driven by
   * the same filtered + sorted rows. Omit to keep the table (with horizontal
   * scroll) at every width.
   */
  renderMobileCard?: (row: TData) => React.ReactNode;
  /** Extra content shown in the toolbar, right of the search box. */
  toolbar?: React.ReactNode;
  /** Shown when `data` is empty (before any search). */
  emptyState?: React.ReactNode;
  /** Shown when a search/filter leaves no rows. */
  noResultsState?: React.ReactNode;
  /**
   * Wrap the table in an opaque, bordered `bg-card` surface. Defaults to
   * `true` - this is the readable, non-transparent panel look.
   */
  surface?: boolean;
  /** Extra class names for the outer wrapper. */
  className?: string;
}
