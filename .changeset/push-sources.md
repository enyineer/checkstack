---
"@checkstack/telemetry-common": minor
"@checkstack/telemetry-backend": minor
"@checkstack/telemetry-frontend": minor
"@checkstack/logstream-common": minor
"@checkstack/logstream-backend": minor
"@checkstack/logstream-frontend": minor
"@checkstack/metricstream-common": minor
"@checkstack/metricstream-backend": minor
"@checkstack/metricstream-frontend": minor
"@checkstack/tracestream-common": minor
"@checkstack/tracestream-backend": minor
"@checkstack/tracestream-frontend": minor
---

Push ingestion becomes a first-class telemetry PUSH source mode: a stream's
OTLP/native push access is now a "Push (OTLP / native)" source instance on
the stream's Sources tab - one instance per token, created with the token
shown once, rotatable from the source row, revoked by disabling or deleting
the instance, with "last received" liveness on the list. The seam is a
generic platform surface any plugin can adopt for its own inbound endpoint:
declare `push: { tokenPrefix, endpoints }` on the source type, and verify
presented bearers with `createPushTokenLookup` (scoped to the source type -
a token minted for one push type never authenticates another) composed with
the shared ingest authenticator; cache convergence rides the new
`telemetry.push-token.invalidated` cross-pod hook, which also fixes
tracestream's previous mint-vs-negative-cache race.

EXISTING SHIPPER TOKENS KEEP WORKING: every non-revoked stream token is
promoted in place to a push source instance (same id, same sha256 hash,
same `ckls_`/`ckms_`/`cktr_` prefixes), so nothing needs re-minting. A
one-shot grant backfill mirrors each bound stream's team relations (and
public visibility) onto the promoted instances, so team-scoped users who
managed a stream's tokens keep managing its migrated push and scrape
sources.

Lifecycle correctness that shipped with the review round: deleting a
stream now CASCADES through the platform (`handleStreamDeleted`) - bound
sources lose that binding, sources left binding-less are fully deleted
(secrets, schedule, team grants, push token revoked), so a deleted
stream's shippers get 401s instead of black-holing data; a push
instance's cached ingest verdict is evicted cluster-wide on any binding
change, not only on disable/rotate.

BREAKING CHANGES (platform is BETA): the per-plugin token CRUD procedures
(`listTokens`/`mintToken`/`revokeToken`), their schemas, and the bespoke
token UI (TokensSection, MintTokenDialog, PushEndpointsCard, ship-snippet
components) are REMOVED from logstream, metricstream, and tracestream -
manage push access as telemetry sources instead. The legacy
`log_stream_tokens`/`metric_stream_tokens`/`trace_stream_tokens` tables are
DROPPED (safe: plugin migrations run in dependency order, so the platform's
promotion always precedes the owner's drop). All three stream detail pages
now have a dedicated Sources tab.
