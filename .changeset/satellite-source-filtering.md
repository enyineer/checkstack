---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Source attribution and filtering for satellite health checks

**Source Attribution**
- Fixed satellite result attribution: runs from satellites now correctly display their source instead of defaulting to "Local"
- Added `sourceId` and `sourceLabel` to both public and detailed history API responses

**Source Filtering**
- Added `sourceFilter` parameter to `getHistory`, `getDetailedHistory`, and `getDetailedAggregatedHistory` RPC endpoints
- Source filter supports "local" (core-only), specific satellite UUID, or all sources
- Filter applies to all three aggregation tiers (raw, hourly, daily)

**Frontend**
- System detail accordion shows source filter buttons (All / Local / per-satellite) next to date range filter
- Filter applies to both charts and recent runs table
- Source column added to the recent runs table with Local/Remote badges
- Health check history detail page includes per-satellite source filter buttons
