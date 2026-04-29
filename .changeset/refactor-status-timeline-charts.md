---
"@checkstack/healthcheck-frontend": minor
---

Refactor Status Timeline and Assertion charts to use Recharts with cursor-tracking tooltips, downsampling, and proportional pass/fail stacking.

- Replaces div-based bar strips with Recharts `BarChart`, so hovering anywhere over the chart resolves the closest bucket.
- Adds a lightweight time x-axis with smart tick formatting based on the bucket interval.
- Caps bar count (60 for Status Timeline, 50 for Assertion) by aggregating adjacent buckets, so individual bars stay clickable on dense ranges.
- Each downsampled Assertion bar is now stacked proportionally — green height shows passed runs and red height shows failed runs across the aggregated window, instead of a worst-case binary color.
