---
"@checkstack/healthcheck-frontend": patch
"@checkstack/slo-frontend": patch
"@checkstack/integration-frontend": patch
---

Retrofit the highest-traffic configuration list tables
(`HealthCheckList`, `SloConfigPage`, and the integration
`DeliveryLogsPage`) onto the `ResponsiveTable` + `MobileCardList`
primitives from `@checkstack/ui`. On `sm` and up each page still
renders the unchanged 5- to 7-column table; below that breakpoint a
sibling stacked-card layout surfaces the same data with the resource
name + status badge at the top, secondary columns in a muted line, and
the existing action buttons in a right-aligned footer. The
`HealthCheckListSkeleton` placeholder mirrors both branches so the page
no longer jumps when data resolves. No business logic, column order,
or query inputs changed.
