---
"@checkstack/ingest-utils": patch
"@checkstack/logstream-common": patch
"@checkstack/metricstream-common": patch
"@checkstack/satellite": patch
---

Harden parsing and dispatch flagged by CodeQL (5 high-severity alerts):

- Ingest-token extraction (`ckls_`/`ckms_`/generic source tokens) matched the
  `Authorization` header with `^Bearer\s+(.+)$`, whose `\s+` and `.+` overlap on
  whitespace and backtrack polynomially on crafted input (ReDoS). It now matches
  only the `Bearer ` scheme prefix and slices the remainder - linear time, same
  behavior.
- The Prometheus text parser's `# TYPE`/`# HELP` line regex had the same
  overlapping-quantifier shape (`\s*(.*)$`); it now matches through the metric
  name and slices the rest.
- The satellite client resolved a pending capability-secret callback from a map
  keyed by the untrusted `requestId` and invoked it directly, which reads as an
  unvalidated dynamic dispatch. The pending entry is now an object with a
  statically-named `settle` method, so the invocation is never a callee derived
  purely from external input.
