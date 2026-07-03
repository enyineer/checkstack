---
title: "Master-detail pattern"
description: "Build a two-column master-detail view with SplitPane and VirtualList, a sticky detail pane on desktop, a Sheet on mobile, and the selection kept in the URL."
---

A master-detail view pairs a scrollable index of items on the left with a detail pane on the right that never moves the list when you pick a row. `@checkstack/ui` ships two primitives for it - `SplitPane` for the layout and `VirtualList` for a windowed index - and the health check run history page is the reference implementation. This page shows how to wire them together.

## When to use it

Reach for master-detail when a list is long enough to scroll and each row opens a rich detail view you want to page through without losing your place. Selecting a row swaps the detail pane in place; the master list stays put. On desktop the two columns scroll independently; below `md` the list takes the whole width and the detail opens in a `Sheet` layered over it.

If your list only needs empty, loading, and error affordances, reach for the [list states](/checkstack/developer-guide/frontend/list-states/) helpers first - master-detail is for the case where the detail pane is a first-class surface of its own.

## The primitives

`SplitPane` is purely structural: it renders two independently-scrolling columns on desktop and master-only below `md`. It brings no chrome of its own, and it deliberately does not own the mobile detail presentation.

```ts
interface SplitPaneProps {
  master: React.ReactNode;
  detail: React.ReactNode;                       // hidden below md
  masterWidth?: "1/3" | "2/5" | "1/2";           // desktop share, default "2/5"
  className?: string;                            // bounds the height; each column scrolls internally
}
```

`VirtualList` windows a long list over `@tanstack/react-virtual`, mounting only the visible rows plus an overscan, so a history of thousands of runs stays cheap to scroll. It owns the scroll container, so give it a bounded height through `className`.

```ts
interface VirtualListProps<T> {
  items: ReadonlyArray<T>;
  getKey: (props: { item: T; index: number }) => string;
  estimateSize: (props: { item: T; index: number }) => number;
  renderItem: (props: { item: T; index: number }) => React.ReactNode;
  overscan?: number;          // default 8
  scrollToIndex?: number;     // scrolls this index into view (e.g. the selection)
  className?: string;         // must carry a bounded height
}
```

## Keep the selection in the URL

The selected item belongs in the route, not in component state, so deep links and back/forward work. Read the id from the params, and select by navigating - never by `setState`.

```tsx
import { useParams, useNavigate } from "react-router-dom";
import { resolveRoute } from "@checkstack/common";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";

function useRunSelection({ systemId, configurationId }: {
  systemId: string;
  configurationId: string;
}) {
  const { runId } = useParams();
  const navigate = useNavigate();

  const selectRun = (nextRunId: string) =>
    navigate(
      resolveRoute(healthcheckRoutes.routes.historyRun, {
        systemId,
        configurationId,
        runId: nextRunId,
      }),
    );

  const clearSelection = () =>
    navigate(
      resolveRoute(healthcheckRoutes.routes.historyDetail, {
        systemId,
        configurationId,
      }),
      { replace: true },
    );

  return { runId, selectRun, clearSelection };
}
```

## Putting it together

The master column renders a `VirtualList` and scrolls the selected row into view; the detail column renders a sticky detail component with previous/next navigation. Below `md`, `SplitPane` hides the detail column, so render the detail a second time inside a `Sheet` gated on a selection.

```tsx
import {
  SplitPane,
  VirtualList,
  EmptyState,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  useIsMobile,
} from "@checkstack/ui";

// Your own chrome-free detail component, keyed by the selected id.
import { MyDetailPanel } from "./MyDetailPanel";

function RunHistory({ systemId, configurationId, runs }: {
  systemId: string;
  configurationId: string;
  runs: ReadonlyArray<{ id: string; status: string; startedAt: Date }>;
}) {
  const isMobile = useIsMobile();
  const { runId, selectRun, clearSelection } = useRunSelection({
    systemId,
    configurationId,
  });
  const selectedIndex = runs.findIndex((r) => r.id === runId);

  const list = (
    <VirtualList
      items={runs}
      getKey={({ item }) => item.id}
      estimateSize={() => 56}
      scrollToIndex={selectedIndex === -1 ? undefined : selectedIndex}
      className="max-h-full"
      renderItem={({ item }) => (
        <button
          type="button"
          onClick={() => selectRun(item.id)}
          aria-current={item.id === runId}
          className="w-full px-3 py-2 text-left"
        >
          {item.status}
        </button>
      )}
    />
  );

  const detail = runId ? (
    <MyDetailPanel runId={runId} onDismiss={clearSelection} />
  ) : (
    <EmptyState
      title="Select a run"
      description="Pick a run on the left to inspect it."
    />
  );

  return (
    <>
      <SplitPane masterWidth="2/5" master={list} detail={detail} />

      {/* Below md the detail column is hidden; the caller owns the Sheet.
          Gate it on the viewport so desktop keeps the split pane only. */}
      {isMobile && (
        <Sheet open={!!runId} onOpenChange={(open) => !open && clearSelection()}>
          <SheetContent size="xl">
            <SheetHeader>
              <SheetTitle>Run detail</SheetTitle>
            </SheetHeader>
            <SheetBody>
              {runId && <MyDetailPanel runId={runId} />}
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
```

## The reference implementation

The health check run history page (`HealthCheckHistoryDetailPage`) is the pattern in full. It adds the touches a real history view needs:

- A **virtualized master list** (`RunHistoryList`) of raw runs, ending on the last page with a retention divider and the aggregate-bucket rows that survive it. Run rows are keyboard-operable: Enter or Space selects, and ArrowUp/ArrowDown walk to the newer/older run.
- A shared **`RunDetailPanel`** in the detail column with previous/next buttons, ArrowUp/ArrowDown keyboard navigation, and Charts, Assertions, and Raw-payload tabs. Prev/next crosses page boundaries, flipping the page and selecting its first or last run once it arrives.
- A **retention message** when a deep-linked run has aged out of the raw window, instead of a blank pane.
- The **selection in the URL** (the `historyRun` route), so a link to a specific run opens straight to it.

`RunDetailPanel` is chrome-free by design, so the same component drops into the desktop split pane, the mobile `Sheet`, and the check drawer's nested detail sheet without change:

```ts
interface RunDetailPanelProps {
  runId: string;                     // fetches getRunById itself
  strategyId?: string;               // for the per-run auto-chart tiles
  onDismiss?: () => void;            // renders an X (omit inside a Sheet with its own)
  prevNext?: { onPrev?: () => void; onNext?: () => void };
}
```

## Next steps

- [Health check charts](/checkstack/developer-guide/frontend/healthcheck-charts/) - the auto tile grid `RunDetailPanel` renders in its Charts tab.
- [List states](/checkstack/developer-guide/frontend/list-states/) - empty, loading, and error affordances for the master list.
- [Performance and accessibility](/checkstack/developer-guide/frontend/performance/) - the `isLowPower` fallbacks the chart primitives honor.
</content>
