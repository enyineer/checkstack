# @checkstack/slo-frontend

## 0.2.4

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/dashboard-frontend@0.3.30

## 0.2.3

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/dashboard-frontend@0.3.29

## 0.2.2

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/dashboard-frontend@0.3.28

## 0.2.1

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/dashboard-frontend@0.3.27

## 0.2.0

### Minor Changes

- 3c34b07: Complete SLO Reliability Engine frontend and backend

  **Frontend** — 7 new visualization components:

  - `StreakCounter`: Fire-themed compliance streak counter with color-coded flame and best-streak trophy
  - `AchievementBadge`: Emoji-labeled badges for 9 achievement types with hover tooltip
  - `AttributionChart`: Horizontal stacked bar showing error budget split (self/upstream/remaining)
  - `DowntimeTimeline`: Dot-and-line timeline with attribution badges and timestamps
  - `SloTrendChart`: Pure SVG availability trend line chart from daily snapshots
  - `MilestoneFeed`: Organization-wide milestone feed on the SLO overview sidebar
  - `DependencyExclusionConfig`: Interactive upstream dependency picker for SLO editor

  **Backend** — Weekly digest scheduled integration event:

  - `weekly-digest.ts`: Cron job (Monday 09:00 UTC) emitting SLO performance summary
  - Top/worst performers, breach counts, and streak data delivered via configured notification channels
  - New `sloWeeklyDigest` hook registered as integration event

### Patch Changes

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/dashboard-frontend@0.3.26
  - @checkstack/frontend-api@0.3.9
  - @checkstack/slo-common@0.2.0
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/dependency-common@0.2.1
  - @checkstack/signal-frontend@0.0.15
