# @checkstack/slo-backend

## 0.2.15

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/healthcheck-backend@0.17.0
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0

## 0.2.14

### Patch Changes

- Updated dependencies [9a320fe]
  - @checkstack/healthcheck-backend@0.16.5

## 0.2.13

### Patch Changes

- @checkstack/catalog-backend@0.5.4
- @checkstack/healthcheck-backend@0.16.4

## 0.2.12

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/healthcheck-backend@0.16.3
  - @checkstack/catalog-backend@0.5.3

## 0.2.11

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/healthcheck-backend@0.16.2
  - @checkstack/catalog-backend@0.5.2

## 0.2.10

### Patch Changes

- @checkstack/catalog-backend@0.5.1
- @checkstack/catalog-common@1.4.1
- @checkstack/healthcheck-backend@0.16.1

## 0.2.9

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/healthcheck-backend@0.16.0
  - @checkstack/catalog-backend@0.5.0

## 0.2.8

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4
  - @checkstack/healthcheck-backend@0.15.1

## 0.2.7

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/healthcheck-backend@0.15.0
  - @checkstack/catalog-backend@0.4.3

## 0.2.6

### Patch Changes

- @checkstack/catalog-backend@0.4.2
- @checkstack/healthcheck-backend@0.14.3

## 0.2.5

### Patch Changes

- 86bab6a: ### GitOps: Fix authentication token handling

  - Made `authToken` optional in `ReconcileProviderParams` and `ScraperOptions` to support unauthenticated access to public repositories
  - GitHub and GitLab scrapers now conditionally set authentication headers only when a token is provided
  - Sync worker now decrypts the encrypted `authToken` from the database before passing it to scrapers, fixing authentication failures caused by sending encrypted values in HTTP headers

  ### SLO: Fix premature Nines Club achievement unlock

  - The "Nines Club" achievement now requires both ≥99.99% availability **and** a 365-day compliance streak, preventing immediate unlock on newly created SLOs with 100% default availability

  ### SLO: Align frontend achievement descriptions with backend criteria

  - Fixed mismatched descriptions for Iron Uptime (7-day, not 30), Diamond Uptime (30-day, not 90), Clean Sheet (rolling window, not quarter), Full Coverage (3+ SLOs, not all systems in group), and Nines Club (99.99%)

  ### SLO: Enrich milestones with system names

  - The `getRecentMilestones` endpoint now resolves human-readable system names via the Catalog API instead of returning raw system IDs
  - @checkstack/catalog-backend@0.4.1
  - @checkstack/healthcheck-backend@0.14.2

## 0.2.4

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0
  - @checkstack/healthcheck-backend@0.14.1

## 0.2.3

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0
  - @checkstack/healthcheck-backend@0.14.0

## 0.2.2

### Patch Changes

- Updated dependencies [aa2b3aa]
  - @checkstack/healthcheck-backend@0.13.1

## 0.2.1

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/healthcheck-backend@0.13.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24
  - @checkstack/command-backend@0.1.19
  - @checkstack/integration-backend@0.1.19
  - @checkstack/queue-api@0.2.13

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
  - @checkstack/backend-api@0.11.1
  - @checkstack/catalog-backend@0.2.23
  - @checkstack/healthcheck-backend@0.12.1
  - @checkstack/integration-backend@0.1.18
  - @checkstack/slo-common@0.2.0
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/dependency-common@0.2.1
  - @checkstack/integration-common@0.2.8
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12
