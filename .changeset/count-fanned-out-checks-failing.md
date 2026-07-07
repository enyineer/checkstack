---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": patch
---

Count fanned-out environment slices in the dashboard's "X of Y checks failing".

The dashboard problem card counted CHECKS, so a system with a single check that
fans out to three environments showed "Unhealthy 1 of 1 checks failing" even
when only one of the three environments was failing. It now counts (check ×
environment) slices: that system reads "1 of 3 checks failing", and a system
with a three-environment check plus a single-environment check with one
environment failing reads "1 of 4 checks failing". An env-less check counts as a
single slice, so a system with no environments reads exactly as before.

The per-check status DTO (`SystemCheckStatus`, returned by
`getSystemHealthStatus` / `getBulkSystemHealthStatus` /
`getBulkSystemHealthMatrix`) gains two fields: `sliceCount` (environment slices
this check currently fans out to, always >= 1) and `failingSliceCount` (how many
of those slices are non-healthy). `deriveHealthcheckSignals` sums them across
checks for the honest numerator/denominator.
