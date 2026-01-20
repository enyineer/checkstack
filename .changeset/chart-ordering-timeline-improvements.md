---
"@checkstack/healthcheck-frontend": patch
---

Improved chart ordering consistency and status timeline readability

- **Chart ordering**: All charts now display data from left (oldest) to right (newest) for consistency
  - Fixed `HealthCheckSparkline` to reverse status dots order
  - Fixed `AutoChartGrid` `getAllValues()` to return values in chronological order
- **Status timeline redesign**: Replaced thin bar charts with readable equal-width segment strips
  - Raw data: Each run gets equal visual space with 1px gaps between segments
  - Aggregated data: Each bucket shows stacked proportional segments for healthy/degraded/unhealthy
  - Added time span display in aggregated tooltips (e.g., "Jan 20, 09:00 - 10:00")
  - Removed Recharts dependency for timeline, now uses pure CSS flexbox
- **Label update**: Renamed "Response Latency" chart to "Execution Duration" for accuracy
- **UI polish**: Added "~" prefix to duration formats in AggregatedDataBanner
