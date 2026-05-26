---
title: "List & Query States"
description: "Shared UI primitives for empty lists, query errors, skeleton loaders, dual desktop/mobile tables, performance-aware classes, and canonical toasts."
---

# List & Query States

`@checkstack/ui` ships a small family of primitives that cover the
recurring "loading / empty / error / responsive list" surfaces every
plugin frontend ends up reinventing. Reach for these before rolling
your own — they encode the project's accessibility, performance, and
copy conventions in one place.

The current page sweeps that retrofit existing screens onto these
primitives are tracked in Phases 5–7 of the v1 polishing plan.

> [!NOTE]
> Every helper on this page is additive — adopting them is opt-in and
> doesn't change the rendering of any existing screen. The page sweeps
> in Phases 5–7 will migrate consumers one plugin at a time.

## `ListEmptyState`

Thin wrapper around `EmptyState` for list-shaped resources. Supplies a
consistent "No {resource} yet" headline and an `Inbox` default icon so
callers don't have to pick one for every list.

```tsx
import { ListEmptyState, Button } from "@checkstack/ui";
import { Plus } from "lucide-react";

<ListEmptyState
  resource="checks"
  description="Create a health check to start monitoring an endpoint."
  actions={
    <Button>
      <Plus className="h-4 w-4 mr-2" />
      Create your first check
    </Button>
  }
/>;
```

## `QueryErrorState`

Canonical inline error UI for a failed TanStack Query. Renders an
`error`-variant `Alert` with the message extracted via
`extractErrorMessage` from `@checkstack/common`, plus a Retry button
wired to `onRetry` (use the failing query's `refetch()`).

```tsx
import { QueryErrorState } from "@checkstack/ui";

const { data, error, refetch } = healthCheckClient.list.useQuery();

if (error) {
  return (
    <QueryErrorState
      error={error}
      resource="checks"
      onRetry={() => refetch()}
    />
  );
}
```

## `Skeleton`

Pulsing placeholder block for loading states. Honours
`usePerformance().isLowPower`: when low-power mode is active the pulse
animation is dropped and a static `bg-muted` block is rendered, so
non-hardware-accelerated devices aren't forced through an infinite
animation loop.

```tsx
import { Skeleton } from "@checkstack/ui";

<div className="space-y-2">
  <Skeleton className="h-4 w-3/4" />
  <Skeleton className="h-4 w-full" />
  <Skeleton className="h-4 w-5/6" />
</div>;
```

## `ResponsiveTable` + `MobileCardList`

Dual-layout primitive for tabular data that has to degrade on narrow
viewports. `ResponsiveTable` renders the standard `Table` markup on
`sm` and up; `MobileCardList` renders a stacked card layout below the
`sm` breakpoint. Both wrappers swap purely in CSS via Tailwind's
`hidden` / `sm:hidden` utilities — no JS media-query gating and no
SSR/CSR mismatch risk.

```tsx
import {
  ResponsiveTable,
  MobileCardList,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
} from "@checkstack/ui";

<>
  <ResponsiveTable>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Latency</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell><Badge>{row.status}</Badge></TableCell>
            <TableCell className="text-right">{row.latency}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </ResponsiveTable>

  <MobileCardList>
    {rows.map((row) => (
      <div key={row.id} className="rounded-md border bg-card p-3">
        <div className="flex justify-between">
          <span className="font-medium">{row.name}</span>
          <Badge>{row.status}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">{row.latency}</div>
      </div>
    ))}
  </MobileCardList>
</>;
```

> [!TIP]
> An earlier draft considered a context-driven `priority` prop on a
> dedicated `ResponsiveTableHead`. That requires either cloning every
> cell to inject a context attribute or maintaining a parallel index
> from `TableHead` children to `TableCell` indices — both leak
> coordination into the primitive. The `MobileCardList` companion is
> deliberately the simpler, type-safe shape; callers decide which
> fields show on mobile.

## `toastSuccess` / `toastError`

Two named helpers in `@checkstack/ui` for the canonical post-mutation
toast shapes. `toastSuccess` is a verb-phrase passthrough;
`toastError` prefixes the action and funnels the error through
`extractErrorMessage`, truncating the final string to 100 characters.

```tsx
import { useToast, toastSuccess, toastError } from "@checkstack/ui";

const toast = useToast();
const { mutateAsync } = healthCheckClient.create.useMutation({
  onSuccess: () => toastSuccess(toast, "Check created"),
  onError: (error) => toastError(toast, "Failed to create check", error),
});
```

> [!IMPORTANT]
> There is intentionally **no** toast factory, DSL, or key-based
> template registry. If you need a domain-specific message just pass
> a string. Adding indirection here just spreads copy across files
> and obscures grep-ability.
