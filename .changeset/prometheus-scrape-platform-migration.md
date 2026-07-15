---
"@checkstack/metricstream-common": minor
"@checkstack/metricstream-backend": minor
"@checkstack/metricstream-frontend": minor
"@checkstack/telemetry-backend": minor
"@checkstack/satellite": minor
---

Prometheus scraping now runs on the telemetry platform as the pull source
type `metricstream.prometheus-scrape` - the canonical reference for
external source types. Existing scrape targets are migrated in place: a
guarded cross-schema data migration copies every target into
`telemetry_sources` (bindings, interval, satellite assignment, state), and
a one-shot re-keys encrypted bearer tokens under the platform's secret
store; `${{ secrets.NAME }}` references pass through unchanged. The
per-stream Sources tab keeps one UX: the platform's sources section.

Parity and correctness details: the telemetry pull seam gains optional
`onRunFailure`/`onRunRecovery` health hooks (invoked with the stored
consecutive-failure count on both core-scheduled and satellite-reported
runs), which the scrape source type uses to keep emitting the
`scrape_failing` important event exactly when three consecutive
failures are crossed - once per outage episode, as before the
migration. Satellite execution honors the instance's own `timeoutMs`
(previously hard-capped at the platform's 30s default), resolves
just-in-time secrets fresh per run so a rotated `${{ secrets.NAME }}`
reference takes effect on the next scrape, and shares one
size/series-capped response reader with the core path. The bearer
re-key pass isolates per-source failures so one broken source cannot
stall the rest, and a satellite still configured with the removed
`CHECKSTACK_SATELLITE_SCRAPE` env var logs an explicit startup warning.
Telemetry listener sources additionally only bind on the DEFAULT
instance, so a namespaced secondary instance (PR preview) can never
race the primary for listener ports.

BREAKING CHANGES (platform is BETA): metricstream's private source
extension point (`metricSourceExtensionPoint`) and the scrape-target CRUD
procedures, schemas, and UI are REMOVED outright - manage scrape targets
as telemetry sources instead. The satellite `scrape` capability
(`CHECKSTACK_SATELLITE_SCRAPE`) is removed; satellites execute Prometheus
scrapes through the `telemetry-pull` capability
(`CHECKSTACK_SATELLITE_TELEMETRY_PULL`) via the statically-linked pull
executor - update satellite deployment env accordingly. The legacy
`metric_scrape_targets` table is DROPPED in the same release: plugin
migrations run in dependency order, so the platform's promotion migration
is guaranteed to precede metricstream's drop, and the bearer re-key
one-shot now also deletes each migrated internal secret after re-keying
it, leaving no orphans.
