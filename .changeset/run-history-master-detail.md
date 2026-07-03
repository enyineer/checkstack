---
"@checkstack/ui": minor
"@checkstack/healthcheck-frontend": minor
---

Rebuild the health-check run history as a master-detail split view.

- `@checkstack/ui` gains `SplitPane` (master-detail grid with independently
  scrolling columns; the detail column hides below `md` so callers present
  mobile detail in a `Sheet`) and `VirtualList` (windowed list built on the
  new `@tanstack/react-virtual` dependency), both with Storybook stories.
- The run-history detail page pins the run detail beside a virtualized run
  list instead of mounting it above the table, so selecting a run never
  scrolls the list away. The selected run stays in the URL (deep links keep
  working), gains prev/next navigation with page fall-through, ArrowUp/Down
  keyboard walking, a loading skeleton, and an explicit "run not found"
  retention message. The raw run payload becomes viewable for the first time
  in a Raw payload tab.
- The list ends, on its last page, with an explicit "Aggregated before
  <date>" divider followed by the pre-retention aggregate buckets instead of
  an unexplained empty page. The retention config read falls back to the
  platform default for system-owner viewers without configuration access.
- `HealthCheckRunsTable` turns selection into a prop (`onRowSelect` /
  `selectedRunId`), gains keyboard operability (`role="button"`, Enter/Space,
  focus ring, `aria-current`) and a status-toned selected-row accent; its
  timestamp shows the exact datetime on hover for every viewer. The drawer
  reuses it and opens run details in a nested sheet instead of ejecting to
  the history page; its hand-rolled source filter is replaced by a shared,
  tokenized `SourceFilterPills` (removing the raw orange Tailwind colors).

BREAKING CHANGES: `HealthCheckRunsTable` no longer navigates on row click by
itself; callers pass `onRowSelect`. Its row type's `result` field is now
optional.
