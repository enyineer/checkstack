---
"@checkstack/backend": patch
---

Fix REST query-parameter coercion. Query-string values arrive as strings, but
contract input schemas declare real types (e.g. `listIncidents`'
`includeResolved: z.boolean()`), so `/rest/...?includeResolved=true` was
rejected with "expected boolean, received string". The REST handler now wires
oRPC's `SmartCoercionPlugin`, which reads each procedure's JSON schema and
coerces query/path/header strings to the declared type before validation -
correctly mapping the string `"false"` to the boolean `false` (rather than the
`Boolean("false") === true` trap). Booleans, numbers, and ISO-8601 dates now
work as query params across every plugin's REST surface. The native oRPC
surface is unaffected (it already carries real JSON types).
