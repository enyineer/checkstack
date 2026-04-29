---
"@checkstack/healthcheck-frontend": patch
---

Refactor auto-chart layout to make collector grouping more dominant. Chart titles now show only the metric label (e.g. "Avg Response Time") instead of the prefixed "{collectorId}: Metric" form. Collector groups display the collector name as a heading with a badge containing the full collector id. Cards now stack at full width and their contents are center-aligned.
