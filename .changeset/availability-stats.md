---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
---

Add availability statistics display to HealthCheckSystemOverview

- New `getAvailabilityStats` RPC endpoint that calculates availability percentages for 31-day and 365-day periods
- Availability is calculated as `(healthyRuns / totalRuns) * 100`
- Data is sourced from both daily aggregates and recent raw runs to include the most up-to-date information
- Frontend displays availability stats with color-coded badges (green ≥99.9%, yellow ≥99%, red <99%)
- Shows total run counts for each period
