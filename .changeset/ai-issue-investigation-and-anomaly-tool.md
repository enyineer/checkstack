---
"@checkstack/anomaly-backend": minor
"@checkstack/ai-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/slo-backend": patch
---

fix(ai): guide the assistant to find all issues and fix the anomaly tool

Two assistant problems reported in production:

1. Asked "are there any issues?", the model answered from a single source (an
   SLO breach) and missed a system with a failing health check. The chat
   system prompt now instructs the model to check ALL issue sources before
   answering - failing health checks (`healthcheck_status`), breaching/at-risk
   SLOs (`slo_listObjectives`), active anomalies (`anomaly_list`), and open
   incidents (`incident_list`) - and not to stop after the first source. It
   also tells the model that `systemId` must be a real system UUID (resolve a
   name via the catalog tool first) and to never invent ids or filter values.

2. The anomaly tool was named `anomaly.explain` but actually LISTS anomalies
   with optional filters. The misleading name led the model to pass a
   non-existent filter value ("Type validation failed") and a system
   name/anomaly id as `systemId` ("a value was malformed"). Renamed to
   `anomaly.list` with a description that spells out the optional filters and
   their valid enum values (state: suspicious|anomaly|recovered, kind:
   spike|drift, suppression: active|suppressed|all) and that `systemId` is a
   system UUID.

Also sharpened the `healthcheck.status` and `slo.listObjectives` tool
descriptions to be use-case oriented ("use when asked what is failing /
breaching").

BREAKING: the anomaly read tool's name changes from `anomaly_explain` to
`anomaly_list` over the MCP `tools/list` surface. MCP clients referencing it by
the old name must update.
