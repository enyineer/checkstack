---
"@checkstack/backend-api": minor
"@checkstack/ai-backend": patch
"@checkstack/status-page-backend": patch
"@checkstack/telemetry-backend": patch
---

Promote the user-scoped cross-plugin RPC client into
`@checkstack/backend-api` (`createUserScopedRpcClient` +
`forwardableAuthHeadersFrom`): the caller-identity re-entry used by
"cannot expose what you cannot see" gates (catalog readability on stream
links, satellite binding auth, AI deferred tool routing, status-page
publish) now has ONE implementation instead of six near-verbatim copies.
Only the session cookie and bearer Authorization are ever forwarded, and a
request without them re-enters anonymous (fail closed). ai-backend,
status-page-backend and telemetry-backend migrate to the shared export;
behavior is unchanged.
