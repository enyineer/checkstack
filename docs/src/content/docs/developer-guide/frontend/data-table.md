---
title: "Data tables"
description: "The shared DataTable component in @checkstack/ui: column-driven sorting, global search, an opaque surface, and a mobile card branch for every list."
---

Every list surface in Checkstack renders through one component: `DataTable` from `@checkstack/ui`. It gives each table click-to-sort headers, a global search box, and a readable opaque surface, while leaving cell rendering, per-row access gating, selection, and actions fully in your hands. Sort and filter state are powered by `@tanstack/react-table`; you never touch that API directly.

## When to use it

Use `DataTable` for any homogeneous list of records shown as aligned columns - systems, health checks, users, runs, providers, and so on. It replaces the older pattern of hand-composing the `Table` primitives with a separate mobile card list. For card galleries, pickers, editors, and stat strips (heterogeneous or form-like surfaces), keep the purpose-built layout - a grid adds no value there.

## Column contract

A column owns its own rendering and, optionally, how it sorts and how it is searched. Sorting is enabled by providing `sortValue`; searching by providing `searchValue` - there are no separate boolean flags.

```ts
export interface DataTableColumn<TData> {
  id: string;
  header: React.ReactNode;
  cell: (row: TData) => React.ReactNode;
  /** Provide to make the header click-to-sort (asc -> desc -> unsorted). */
  sortValue?: (row: TData) => string | number | null | undefined;
  /** Provide to include this column's text in the global search box. */
  searchValue?: (row: TData) => string;
  headClassName?: string;
  cellClassName?: string;
  /** Hide this lower-priority column below the `md` breakpoint. */
  desktopOnly?: boolean;
}
```

Strings sort locale-aware and case-insensitively (so `item 2` precedes `item 10`); numbers sort numerically; `null`/`undefined` always sort last. Leave `sortValue`/`searchValue` off purely-visual columns such as chip clusters or action buttons.

## Basic usage

```tsx
import { DataTable, type DataTableColumn } from "@checkstack/ui";

const columns: DataTableColumn<System>[] = [
  {
    id: "name",
    header: "Name",
    cell: (s) => <span className="font-medium">{s.name}</span>,
    sortValue: (s) => s.name,
    searchValue: (s) => s.name,
  },
  {
    id: "status",
    header: "Status",
    cell: (s) => <HealthBadge status={s.status} />,
    sortValue: (s) => s.status,
  },
];

<DataTable
  data={systems}
  columns={columns}
  getRowId={(s) => s.id}
  searchPlaceholder="Search systems..."
  defaultSort={{ columnId: "name", direction: "asc" }}
  emptyState={<ListEmptyState resource="systems" />}
  noResultsState={<ListEmptyState resource="systems" description="No matches." />}
/>;
```

## Selection

Selection is not a special prop - model it as an ordinary leading column. Put your "select all" checkbox in the column `header` and the per-row checkbox in `cell`, wired to your own state. Because sort and search are keyed by `getRowId`, "select all visible" stays correct after sorting or filtering. Use `getRowProps` to reflect the selected highlight:

```tsx
{
  id: "select",
  headClassName: "w-10",
  header: <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />,
  cell: (s) => (
    <Checkbox
      checked={selected.has(s.id)}
      disabled={!canManage(s.id)}
      onCheckedChange={() => toggle(s.id)}
      aria-label={`Select ${s.name}`}
    />
  ),
}
// ...
<DataTable /* ... */ getRowProps={(s) => ({ selected: selected.has(s.id) })} />
```

## Mobile

Pass `renderMobileCard` to swap to a stacked card layout below the `sm` breakpoint. The cards render from the same filtered + sorted rows, so search and sort apply on mobile too. Omit it to keep the table (with horizontal scroll) at every width.

```tsx
<DataTable
  data={systems}
  columns={columns}
  getRowId={(s) => s.id}
  renderMobileCard={(s) => (
    <Card className="p-3">
      <p className="font-medium">{s.name}</p>
      <HealthBadge status={s.status} />
    </Card>
  )}
/>
```

## Row actions

Row action buttons (edit, delete, and friends) must look identical in every
table. Use the shared `RowActions` container with `RowAction` items rather than
hand-rolling buttons - `RowAction` is the one canonical style: a subtle,
compact ghost icon button. `tone="destructive"` only tints it red; it is never
a loud filled button, so a delete carries the same visual weight as an edit
everywhere.

```tsx
import { RowActions, RowAction } from "@checkstack/ui";
import { Pencil, Trash2 } from "lucide-react";

{
  id: "actions",
  header: "Actions",
  headClassName: "text-right",
  cellClassName: "text-right",
  cell: (row) => (
    <RowActions>
      <RowAction icon={Pencil} label={`Edit ${row.name}`} onClick={() => onEdit(row)} />
      <RowAction
        icon={Trash2}
        tone="destructive"
        label={`Delete ${row.name}`}
        disabled={row.locked}
        title={row.locked ? "Managed by GitOps" : undefined}
        onClick={() => onDelete(row.id)}
      />
    </RowActions>
  ),
}
```

Pass the lucide icon component (`icon={Trash2}`), not an element. `label` is the
accessible name and default tooltip; `title` overrides the tooltip (e.g. a lock
reason). Never drop a `variant="destructive"` filled button into an actions
column - that is exactly the inconsistency `RowAction` exists to prevent.

## Surface and toolbar

The table is wrapped in an opaque, bordered `bg-card` panel by default, so it stays readable over any page background. Pass `surface={false}` to opt out. Use `toolbar` for actions that sit beside the search box (an "Add" button, domain filters such as status tabs or an environment picker that the free-text search cannot express).

> [!NOTE]
> Keep domain filters (status tabs, environment pickers) as `toolbar` content and let `DataTable` own only the free-text search. For empty and no-results states, reuse `ListEmptyState` / `EmptyState` - see [List states](/checkstack/developer-guide/frontend/list-states/).
