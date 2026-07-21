import { useState, type ReactElement } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFacet,
} from "../src/components/DataTable";
import { Badge } from "../src/components/Badge";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { Checkbox } from "../src/components/Checkbox";
import { ListEmptyState } from "../src/components/ListEmptyState";

const meta: Meta = {
  title: "Components/Data/DataTable",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

interface Service {
  id: string;
  name: string;
  team: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
}

const services: Service[] = [
  { id: "1", name: "api-gateway", team: "Platform", status: "healthy", latencyMs: 42 },
  { id: "2", name: "billing-worker", team: "Payments", status: "degraded", latencyMs: 340 },
  { id: "3", name: "cache", team: "Platform", status: "down", latencyMs: 0 },
  { id: "4", name: "search-index", team: "Discovery", status: "healthy", latencyMs: 88 },
  { id: "5", name: "notifications", team: "Growth", status: "healthy", latencyMs: 120 },
];

const statusVariant = {
  healthy: "success",
  degraded: "warning",
  down: "destructive",
} as const;

const baseColumns: DataTableColumn<Service>[] = [
  {
    id: "name",
    header: "Name",
    cell: (s) => <span className="font-medium">{s.name}</span>,
    sortValue: (s) => s.name,
    searchValue: (s) => s.name,
  },
  {
    id: "team",
    header: "Team",
    cell: (s) => s.team,
    sortValue: (s) => s.team,
    searchValue: (s) => s.team,
  },
  {
    id: "status",
    header: "Status",
    cell: (s) => <Badge variant={statusVariant[s.status]}>{s.status}</Badge>,
    sortValue: (s) => s.status,
  },
  {
    id: "latency",
    header: "Latency",
    headClassName: "text-right",
    cellClassName: "text-right tabular-nums",
    cell: (s) => (s.status === "down" ? "-" : `${s.latencyMs} ms`),
    sortValue: (s) => s.latencyMs,
  },
];

export const Default: Story = {
  render: () => (
    <div className="max-w-3xl">
      <DataTable
        data={services}
        columns={baseColumns}
        getRowId={(s) => s.id}
        searchPlaceholder="Search services..."
        defaultSort={{ columnId: "name", direction: "asc" }}
      />
    </div>
  ),
};

export const WithToolbar: Story = {
  render: () => (
    <div className="max-w-3xl">
      <DataTable
        data={services}
        columns={baseColumns}
        getRowId={(s) => s.id}
        toolbar={<Button size="sm">Add service</Button>}
      />
    </div>
  ),
};

function SelectionExample(): ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = selected.size === services.length;
  const columns: DataTableColumn<Service>[] = [
    {
      id: "select",
      headClassName: "w-10",
      header: (
        <Checkbox
          checked={allSelected}
          onCheckedChange={() =>
            setSelected(
              allSelected ? new Set() : new Set(services.map((s) => s.id)),
            )
          }
          aria-label="Select all"
        />
      ),
      cell: (s) => (
        <Checkbox
          checked={selected.has(s.id)}
          onCheckedChange={() =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(s.id)) next.delete(s.id);
              else next.add(s.id);
              return next;
            })
          }
          aria-label={`Select ${s.name}`}
        />
      ),
    },
    ...baseColumns,
  ];
  return (
    <div className="max-w-3xl">
      <DataTable
        data={services}
        columns={columns}
        getRowId={(s) => s.id}
        getRowProps={(s) => ({ selected: selected.has(s.id) })}
      />
    </div>
  );
}

export const WithSelection: Story = {
  render: () => <SelectionExample />,
};

export const WithMobileCards: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => (
    <DataTable
      data={services}
      columns={baseColumns}
      getRowId={(s) => s.id}
      renderMobileCard={(s) => (
        <Card className="space-y-1 p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{s.name}</span>
            <Badge variant={statusVariant[s.status]}>{s.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{s.team}</p>
        </Card>
      )}
    />
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="max-w-3xl">
      <DataTable
        data={[]}
        columns={baseColumns}
        getRowId={(s) => s.id}
        emptyState={<ListEmptyState resource="services" />}
      />
    </div>
  ),
};

export const NoResults: Story = {
  render: () => (
    <div className="max-w-3xl">
      <DataTable
        data={services}
        columns={baseColumns}
        getRowId={(s) => s.id}
        searchPlaceholder="Try typing something unmatched"
        noResultsState={
          <ListEmptyState
            resource="services"
            description="No services match your search."
          />
        }
      />
    </div>
  ),
};

/**
 * Facets are declarative: give each one an id, a label, its options and the
 * accessor that reads a row's value. The table renders the selects beside the
 * search box, applies them, and offers Clear once anything is constrained.
 *
 * This state is table-owned. Pair with `useDataTableFilters` (URL-backed) when a
 * filtered view should be shareable, or when the page needs to know what is
 * hidden - to gate a reorder control, say.
 */
const serviceFacets: DataTableFacet<Service>[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "healthy", label: "Healthy" },
      { value: "degraded", label: "Degraded" },
      { value: "down", label: "Down" },
    ],
    value: (s) => s.status,
  },
  {
    id: "team",
    label: "Team",
    options: [
      { value: "Platform", label: "Platform" },
      { value: "Payments", label: "Payments" },
      { value: "Discovery", label: "Discovery" },
      { value: "Growth", label: "Growth" },
    ],
    value: (s) => s.team,
  },
];

export const WithFacets: Story = {
  render: () => (
    <div className="max-w-4xl">
      <DataTable
        data={services}
        columns={baseColumns}
        getRowId={(s) => s.id}
        facets={serviceFacets}
        searchPlaceholder="Search services..."
        noResultsState={
          <ListEmptyState
            resource="services"
            description="No services match your filters."
          />
        }
      />
    </div>
  ),
};

/**
 * Nested inside a page's own opaque Card. `surface={false}` drops the table's
 * panel (no panel-in-panel) AND insets the filter bar with a separating rule, so
 * a full-bleed table's controls are not flush against the card's edges.
 */
export const FacetsInsideACard: Story = {
  render: () => (
    <div className="max-w-4xl">
      <Card className="p-0">
        <div className="border-b border-border p-4 font-semibold">Services</div>
        <DataTable
          data={services}
          columns={baseColumns}
          getRowId={(s) => s.id}
          facets={serviceFacets}
          surface={false}
          searchPlaceholder="Search services..."
        />
      </Card>
    </div>
  ),
};
