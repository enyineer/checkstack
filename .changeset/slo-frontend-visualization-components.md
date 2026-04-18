---
"@checkstack/slo-frontend": minor
"@checkstack/slo-backend": minor
---

Complete SLO Reliability Engine frontend and backend

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
