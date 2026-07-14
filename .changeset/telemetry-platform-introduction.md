---
"@checkstack/telemetry-common": minor
"@checkstack/telemetry-backend": minor
"@checkstack/telemetry-frontend": minor
---

Introduce the telemetry platform: a signal-agnostic source/sink abstraction for
pluggable telemetry ingestion.

- `telemetry-common`: the signal model (`logs`/`metrics`/`traces`), OTel-shaped
  normalized record schemas (the lingua franca between sources and sinks),
  source instance + source type descriptor schemas, the team-scopable
  `telemetry.source` access pair, the oRPC contract (source CRUD, source-type
  catalog, webhook secret rotation, config dry-run testing), the
  `TELEMETRY_SOURCE_CHANGED` signal and the `SourceConfigSlot`.
- `telemetry-backend`: `telemetrySourceExtensionPoint` (any plugin contributes
  pull-, webhook- or listener-mode source types) and
  `telemetrySinkExtensionPoint` (the plugin owning a signal's streams
  contributes one sink per signal and the bind-time authorization for its
  streams), source instance storage with encrypted-at-rest secret config
  fields (boot-time validation of secret field shapes), the pull reconciler,
  the per-pod listener lifecycle manager with cross-pod convergence,
  per-instance webhook endpoints with hash-only secrets and rate limiting,
  an SSRF-guarded fetch for source implementations, and the `telemetry-pull`
  satellite capability (edge execution of satellite-bound pull instances with
  just-in-time secret resolution and binding-authorized re-ingestion).
- `telemetry-frontend`: the `StreamSourcesSection` embed (source catalog,
  schema-driven config dialogs with keep-existing secret semantics, webhook
  secret shown once, connection testing) that stream frontends mount on their
  settings/sources surfaces. The section self-hides while no source types are
  installed for the signal.
