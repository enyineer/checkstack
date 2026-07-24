---
"@checkstack/telemetry-frontend": patch
"@checkstack/metricstream-frontend": patch
"@checkstack/tracestream-frontend": patch
"@checkstack/logstream-frontend": patch
"@checkstack/backend": patch
---

Stop anonymous page loads from logging authentication errors in the backend

Opening the app unauthenticated printed an error-level stack trace per stream
plugin:

```
error: [core] RPC /api/metricstream/listLinkedStreamStatuses failed: Authentication required
error: [core] Stack trace: Error: Authentication required ...
```

Two independent causes, both fixed:

- The dashboard is reachable anonymously (the catalog read is public, as are
  the health-check, incident, SLO and anomaly signal sources), but the three
  stream plugins' `listLinkedStreamStatuses` is authenticated-only. Their
  dashboard signal fillers queried it regardless of the caller, so every
  anonymous page load fired three requests that could only ever come back 401.
  The fillers now gate the lookup on the caller being authenticated.
- A contract-level 4xx (401/403/404/409/...) was logged at error level with a
  full stack trace. That is the authorization layer working as designed, not a
  server fault, and the access-log middleware already reports every 4xx
  response at warn with its method, path and status. Contract 4xx responses now
  log at debug without a stack; a 5xx stays as loud as before.

The three fillers were byte-for-byte the same component apart from their
client, source id and deriver, so the fetch/chunk/merge/report machinery moved
into a shared `useLinkedStreamSignals` hook exported by
`@checkstack/telemetry-frontend`. As a side effect the tracestream filler's
query is now namespaced under its plugin id like the other two, so the plugin's
signal auto-invalidator actually refreshes it.
