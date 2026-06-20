---
"@checkstack/healthcheck-frontend": patch
---

Improve health check readability on narrow viewports. The health check history
table and the drawer's recent-runs table now render a stacked `MobileCardList`
below the `sm` breakpoint (the desktop `<table>` is unchanged), and the latency
and auto-generated line charts reduce x-axis tick density on phones so labels
stay legible. No change to chart data or the desktop layout.
