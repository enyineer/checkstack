# @checkstack/ai-backend

## 0.11.3

### Patch Changes

- 6c8b36b: Regenerate the AI docs search index to reflect the team-scoping of catalog
  Groups and Environments and the new `create.alsoAcceptCreatorOf` sibling
  create-capability seam (Teams and access, Systems and groups, and Environments
  concept pages, plus the backend Teams reference).
- 6c8b36b: Regenerate the docs index for the Phase 5 source-ecosystem documentation:
  the rewritten satellite-telemetry pull model, the telemetry-sources
  listener/derive/reference-type sections, the migrated Prometheus and
  syslog flows in the metric/log guides and concepts, and the satellite
  capability updates.
- 6c8b36b: Regenerate the docs index for the new stream-to-system links developer
  guide page and the tool-registry output-slimming (`projectResult`)
  convention section.
- 6c8b36b: Regenerate the docs index to include the new "Telemetry sources and sinks"
  developer-guide page (the platform-level source/sink abstraction, source
  types, sinks, RLAC and satellite execution), including the webhook
  signature-verification section's note that adding a signature descriptor to an
  already-shipped source type requires rotating each existing instance's webhook
  secret.
- 6c8b36b: Regenerate the docs index for the new trace-correlation developer guide
  page and the correlation sections added to the logstream and tracestream
  pages.
- 6c8b36b: Regenerate the docs index to include the new "Trace streams" developer-guide
  page (OTLP ingestion, tail-based sampling, storage tiers, query API and the
  traces telemetry sink).
- 6c8b36b: Regenerate the docs index for the tracestream health-integration and
  satellite-forwarding sections and the satellite-telemetry trace-receiver
  documentation.
- 6c8b36b: Promote the user-scoped cross-plugin RPC client into
  `@checkstack/backend-api` (`createUserScopedRpcClient` +
  `forwardableAuthHeadersFrom`): the caller-identity re-entry used by
  "cannot expose what you cannot see" gates (catalog readability on stream
  links, satellite binding auth, AI deferred tool routing, status-page
  publish) now has ONE implementation instead of six near-verbatim copies.
  Only the session cookie and bearer Authorization are ever forwarded, and a
  request without them re-enters anonymous (fail closed). ai-backend,
  status-page-backend and telemetry-backend migrate to the shared export;
  behavior is unchanged.
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/auth-common@0.15.0
  - @checkstack/backend-api@0.34.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/common@0.23.0
  - @checkstack/sdk@0.133.1
  - @checkstack/integration-backend@0.7.8
  - @checkstack/ai-common@0.6.7

## 0.11.2

### Patch Changes

- 56af572: Regenerate the docs index for the hidden-patterns documentation: the
  user-guide log-streams page now describes hiding noisy patterns (raw-line
  skip, aggregates keep counting, unhide via the Patterns tab), and the
  developer guide documents the engine's hidden-id set and its propagation.
- 56af572: Regenerate the docs index for the updated log-stream masking documentation:
  the pattern engine's number rule now keeps letter-attached digits (`S3`,
  `utf8`, `sha256`) literal and only masks numbers behind a non-alphanumeric
  separator.
  - @checkstack/ai-common@0.6.6
  - @checkstack/auth-common@0.14.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/common@0.22.0
  - @checkstack/integration-backend@0.7.7
  - @checkstack/sdk@0.132.0

## 0.11.1

### Patch Changes

- 6540703: Regenerate the docs index for the config-schemas guide update: dynamic
  dropdowns now document `configNumber` fields with `x-options-resolver`
  (numeric value coercion) and the requirement to declare same-form sibling
  reads in `x-depends-on`.
- 099045f: Make the pattern-metric VariableIndex picker self-explanatory:

  - Each variable option now shows its TEMPLATE CONTEXT (one token each side,
    `…`-elided), e.g. `Variable 0 (… after <*> retries) - samples: 3`. This
    disambiguates which `<*>` a variable is when the template also contains
    embedded wildcards (`db-<*>`) - those keep their static text during masking,
    their values are never captured, and they are NOT variables. The
    `variableIndex` field description now explains this too.
  - A position with no numeric buckets in the summary window now reads
    `no samples in the last 24h` (using the backend-reported
    `summaryWindowSeconds`, not a hardcoded claim) instead of the misleading
    `no recent samples (not numeric)` - an empty window says nothing about
    whether the values are numeric.
  - Contract: `PatternVariableSample` gains `context`, and
    `listPatternVariables` returns `summaryWindowSeconds`.
  - Docs: the logstream developer guide now documents the standalone-vs-embedded
    wildcard rule (docs index regenerated).

## 0.11.0

### Minor Changes

- d00e099: Make a catalog System's free-form `metadata` (custom fields) genuinely usable
  end to end, mirroring how Environment custom fields already work. Previously a
  System's `metadata` column was writable but nothing consumed it - it did not
  surface in templating, could not be set via GitOps, and had no UI editor, so
  models (and users) had no way to understand what it was for.

  Now a system's custom fields are surfaced everywhere an environment's already
  are:

  - **Config templating**: a system's fields render as
    `{{ system.metadata.<key> }}` in templatable health-check config (e.g. an
    HTTP URL). They are namespaced under `.metadata` so a field named `id`/`name`
    can never shadow the structural `{{ system.id }}` / `{{ system.name }}`.
  - **Satellites**: the fields ride the satellite assignment
    (`SatelliteAssignment.systemMetadata`) so satellite runs template
    `{{ system.metadata.<key> }}` identically to local runs.
  - **UI**: the System editor gains a free-form key/value custom-fields editor
    (extracted into a shared `CustomFieldsEditor` used by both the System and
    Environment editors).
  - **GitOps**: the `System` kind accepts optional `spec.fields`, replaced on
    every reconcile (same shape as the `Environment` kind).
  - **Script collectors**: inline TS collectors read `context.system.metadata`
    (SDK editor types updated), and shell collectors get one
    `CHECKSTACK_SYSTEM_<FIELD>` env var per field, mirroring
    `CHECKSTACK_ENV_<FIELD>`. A field that normalizes to a reserved name
    (`CHECKSTACK_SYSTEM_ID`/`_NAME`) is now skipped with a warning rather than
    clobbering the built-in; the same reserved-name guard was added to the
    environment shell-env builder (previously a custom field named `id`/`name`
    could shadow the structural var).
  - **Editor autocomplete/preview**: the health-check editor offers
    `{{ system.metadata.<key> }}` completions and previews their values when a
    concrete system is in context.

  The AI assistant is corrected on two fronts:

  - The catalog create/update-system (and create-environment) tool schemas now
    `.describe()` their `metadata` field, so a model knows it is free-form custom
    fields that surface in templating - not a tagging/labeling mechanism - and
    should only set keys the user explicitly asks for.
  - A new "Acting on requests" chat system-prompt rule tells the assistant to
    perform a requested change via its tool instead of deflecting to a manual
    GitOps/UI how-to, and to name the missing permission when a tool is genuinely
    unavailable. (This entry also covers the regenerated docs index reflecting the
    updated GitOps/templating docs.)

  State & scale: a system's metadata continues to live solely in the
  `catalog.systems.metadata` Postgres column and is read via the existing
  `getSystem` RPC, so every pod reads the same value. The satellite assignment
  carries a per-dispatch snapshot for the duration of that run (ephemeral,
  re-read on the next dispatch), not a second source of truth. No new table or
  migration.

### Patch Changes

- 4568dcc: Regenerate the bundled docs index so the assistant's docs search reflects the
  new satellite telemetry documentation: the satellite concept page's telemetry
  forwarding and scraping section, the ship-logs and ship-metrics satellite
  sections, the connect-a-satellite telemetry env-flag reference, and the new
  developer-guide "Satellite telemetry" reference page (capability extension
  point, protocol envelopes, backpressure, just-in-time secrets, and
  binding-based authorization).
- a74fa01: Redesign the assertion builder for readability by non-technical operators.
  Conditions now read as sentences with inline controls -
  "[Response Time] must [be less than] [500] ms" - driven by the collector
  metadata that already powers the auto-charts:

  - Field names come from `x-chart-label` (with a humanized fallback) instead
    of machine-derived paths like "Body → Status"; nested fields compose as
    "TLS › Days Left".
  - Numeric values render their `x-chart-unit` suffix; boolean conditions use
    the collector's `x-chart-true-label`/`x-chart-false-label` prose ("must be
    successful" instead of "Is True").
  - The field picker sorts by `x-chart-priority` and groups JSONPath fields
    under "Advanced" (with an inline expression input and example help);
    "Add condition" seeds the highest-priority field instead of the first one.
  - Incomplete conditions (missing value, invalid regex, blank JSONPath) show
    an inline explanation and block Save through the editor's existing
    validity plumbing; duplicate conditions get a hint.
  - Persisted data is untouched: field paths, operator strings, and the
    `CollectorAssertion` shape are byte-for-byte unchanged, so existing checks
    round-trip as-is. The builder is now typed against `CollectorAssertion`
    directly (the duplicated local `Assertion` type and its casts are gone),
    and the dead `CollectorList` component was removed.

  The `@checkstack/ai-backend` patch is the regenerated docs index for the
  documentation pages updated in this release (assignment flow, assertions,
  and the slimmed system/incident/maintenance edit dialogs).

- d9f2771: Regenerate the assistant's docs index to cover the new security-maintenance
  content: Renovate `lockFileMaintenance`, the `bunfig.toml` supply-chain
  cooldown, why the lockfile PR needs a changeset to rebuild the production
  image, and the PR-time split between the dependency-graph gate
  (`security_deps`, full npm graph incl. devDependencies) and the container gate
  (`security`, OS/apk packages only).
- 4568dcc: Regenerate the assistant's docs index to cover the new log-streams content: the
  Log streams concept page (tiered storage, Drain patterns, important events,
  source tokens, log health checks, absence, retention), the Ship logs to a stream
  guide (OTel Collector, Fluent Bit, Vector, curl, and rsyslog configs plus
  backpressure and size limits), and the Log streams backend architecture
  reference (ingestion pipeline, state-and-scale answers, Drain convergence, health
  integration, retention jobs, RLAC, and the token cache convention).
- 4568dcc: Regenerate the docs index for the new Metric Streams documentation (concept
  page, ship-metrics guide, and the backend architecture reference).
- 4568dcc: Regenerate the assistant's docs index to cover the new "Realtime signals: scope
  to a resource when a signal is high-frequency" section of the query-invalidation
  developer guide: declaring a signal `resourceKey`, registering resource-scoped
  signals on a frontend plugin, how a query is matched (input-keyed detail queries
  vs the `signalScopeMeta` opt-in for resource-agnostic lists), per-resource
  coalescing, and why foreign signals stay blanket.
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/catalog-common@2.7.3
  - @checkstack/backend-api@0.33.0
  - @checkstack/sdk@0.130.1
  - @checkstack/ai-common@0.6.6
  - @checkstack/auth-common@0.14.0
  - @checkstack/common@0.22.0
  - @checkstack/integration-backend@0.7.7

## 0.10.12

### Patch Changes

- 1f20b5a: chore(ai-backend): regenerate docs index

  Picks up the anomaly-detection page's updated state-machine and signals
  sections, which now document the `cleared` transition emitted when an
  unconfirmed suspicious anomaly row is deleted.

- 5e704cd: chore(ai-backend): regenerate docs index

  Picks up the frontend extension-points and plugins pages, which now document a
  single `UserMenuItemsSlot` ordered by `priority`, in place of the removed
  `UserMenuItemsBottomSlot` and a `group`-based grouping system that was never
  implemented.

  - @checkstack/sdk@0.129.1
  - @checkstack/catalog-common@2.7.2
  - @checkstack/backend-api@0.32.1
  - @checkstack/integration-backend@0.7.6

## 0.10.11

### Patch Changes

- bd41130: docs(ai): regenerate the docs search index for the cache-system architecture updates

  The `cache-system` developer-guide page now documents the shipped Redis backend
  and a "Distributed caching and horizontal scale" section (why the platform
  caches use the shared `CacheManager` instead of pod-local caches, and that a
  horizontally-scaled deployment must select a distributed backend). Regenerated
  `core/ai-backend/src/generated/docs-index.ts` so the assistant's docs search
  reflects the new content.

- bd41130: Regenerate the docs search index for the status-pages architecture page (which
  now documents the per-category and per-environment-origin gates on status-page
  email subscription fan-out) and the frontend extension-points page (the catalog
  badge-data boundary is now used by the management systems table too).
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/auth-common@0.14.0
  - @checkstack/integration-backend@0.7.5
  - @checkstack/catalog-common@2.7.1
  - @checkstack/sdk@0.128.1

## 0.10.10

### Patch Changes

- 43e4484: Regenerate the docs search index to reflect the "monitor across environments"
  guide note that disabling an environment for a health-check assignment clears
  its status from the system rollup immediately.
- 43e4484: Regenerate the AI docs index to reflect the new "Resolve in bulk, never per
  item" guidance in `developer-guide/architecture/status-pages`, which documents
  the status-page bulk-by-id endpoints (`getBulkRunStats`,
  `getBulkIncidentUpdates`, `getBulkMaintenanceUpdates`) resolvers use to avoid
  N+1 RPC fan-outs.
- 43e4484: Add a database query profiler to the OpenTelemetry/Prometheus metrics layer.

  Two new scoped-db duration histograms answer "how long do queries take, and how long is a connection held", labelled by BOUNDED attributes only:

  - `checkstack.db.query.duration` (`schema`, `operation`) — wall-clock of a standalone scoped query (`BEGIN` + `SET LOCAL search_path` + query + `COMMIT`), recorded at the scoped-db proxy seam for every `.then`/`.execute`/`$count` path.
  - `checkstack.db.transaction.duration` (`schema`) — connection-hold time of a `withScopedTransaction` batch, the guard against a batch pinning a pooled connection (e.g. slow non-DB work wrapped in a transaction).

  For the per-statement drill-down (which exact SQL is hot, not just which operation kind), the host optionally exports Postgres' `pg_stat_statements` view: `checkstack.db.statements.{calls,exec_time_ms,rows}` counters plus a `mean_exec_time_ms` gauge, bounded to the top-N statements by total execution time (`CHECKSTACK_DB_STATEMENTS_TOP_N`, default 25). It is self-disabling: when metrics are enabled the backend probes the connected database once and, if `pg_stat_statements` is not active (extension absent or the role cannot read the view), registers nothing and logs a single info line — a clean no-op with zero cost. The whole layer remains off unless `CHECKSTACK_METRICS_ENABLED` is set.

  The `@checkstack/ai-backend` bump is the regenerated docs search index reflecting the expanded observability page.

- 43e4484: Regenerate the AI docs index to reflect the updated
  `CatalogSystemActionsSlot` contract documentation (the slot now passes
  `visibleSystemIds` so per-row fillers can bulk-fetch per-system data without an
  N+1) in `developer-guide/frontend/extension-points`.
- 43e4484: Regenerate the AI docs search index to cover the new SNMP health-check page
  (strategy/collector config, result metrics, transport-failure vs assertable-metric
  semantics, and Counter64 handling) and the rewritten "connect a satellite" step
  that sets execution per assignment via Catalog -> system -> Health Checks ->
  Execution, rather than on the check template.
- 43e4484: Regenerate the bundled docs search index to reflect updated documentation:
  SLO downtime now counting incident-forced health overrides
  (user-guide/concepts/slo), granular status-page email subscriptions
  (developer-guide architecture + notifications/subscriptions), and status-page
  environment publishing (user-guide/concepts/environments + status-pages
  architecture).
- 43e4484: Regenerate the AI docs search index to cover the new webhook notification
  channel page (stable JSON payload contract, HMAC-SHA256 request signing, and the
  SSRF egress guard on user-supplied webhook URLs) and the strategies-page best
  practice on guarding user-supplied URLs against SSRF with `validateWebhookUrl`
  plus `redirect: "error"`.
- 43e4484: Extend `{{ … }}` environment templating across every built-in health-check type
  and add editor UX for it, so one check config can cover N environments (mirrors
  the existing HTTP `url` pattern).

  Templatable connection/target fields now marked `x-templatable`:

  - TLS: `host`, `servername`; TCP: `host`; Ping: `host`; gRPC: `host`, `service`.
  - MySQL / Postgres: `host`, `database`, `user`, `query`.
  - SSH: `host`, `username`, `command`; Redis: `host`, `args`; RCON: `host`,
    `command`.
  - DNS: `hostname`, `nameserver`; Jenkins: `url` (`baseUrl`), `jobName`;
    Container: `endpoint`, `container`.
  - SNMP: `host` (strategy), `oid` (collector).
  - Script (shell): `cwd` (working directory).

  This closes the last gaps so the coverage is now truly every built-in
  health-check type. The Script collectors' `script` bodies are deliberately NOT
  templatable: rendering `{{ … }}` into shell/TypeScript source would splice env
  values into executed code. Per-environment data reaches those scripts safely via
  the reserved `CHECKSTACK_ENV_*` shell vars (shell collector) and
  `globalThis.context.environment` (inline collector) instead.

  Because templating strips `{{ }}` and renders an undefined variable to an empty
  string, every REQUIRED templatable field now has a post-render config-error
  guard so an empty/invalid render is treated as a transport failure instead of a
  silent "healthy" empty probe. Strategy connection fields (host, database, user,
  endpoint, container, Jenkins base URL, SNMP host) throw from `createClient`;
  collector target fields (query, command, hostname, jobName, SNMP oid) return a
  `CollectorResult` with an `error`. Jenkins `baseUrl` moves its `.url()` validation to post-render.
  Secret fields (passwords/tokens/keys) are never templatable; optional fields
  (SNI `servername`, gRPC `service`, DNS `nameserver`, Redis `args`, Script `cwd`)
  are templatable but not non-empty-guarded, since an empty render is a legitimate
  "unset". SSRF/egress guards continue to run on the rendered host (rendering
  happens before `createClient`).

  Editor UX (`@checkstack/ui` + `@checkstack/healthcheck-frontend`):

  - The environment "Preview as" picker + live preview line now also apply to the
    strategy (connection) form, not just collector forms, so host/port templates
    preview too.
  - A single-line templatable field shows a small "Templating" badge next to its
    label and, when a completion provider is supplied, renders a
    `TemplateValueInput` with `{{ … }}` autocomplete. The health-check editor
    seeds the provider with the fixed `environment.* / check.* / system.*`
    namespace (`createReferenceCompletionProvider`, new `@checkstack/ui` export),
    and `DynamicForm` gains a `templatableFieldsOnly` prop so only `x-templatable`
    fields become template inputs (automation keeps templating every string field).

  BREAKING CHANGE: none. Existing non-templatable configs and stored values are
  unaffected; only fields explicitly marked `x-templatable` change behavior.

  The `@checkstack/ai-backend` bump reflects the regenerated docs index for the
  updated health-check collector and config-schema templating documentation.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- 43e4484: Batch hot-path scoped-db reads/writes into single transactions to cut per-query round-trips.

  The scoped-db proxy wraps every standalone query in its own `BEGIN → SET LOCAL search_path → query → COMMIT`, so a path issuing N sequential queries paid N round-trips and checked out a connection N times. These reads/writes now run under one `withScopedTransaction`, collapsing the batch to a single `SET LOCAL` on one connection. Behavior is unchanged:

  - healthcheck: `getSystemHealthOverview`'s `1 + N·(2+E)` read fan-out.
  - incident/maintenance: `getIncident`/`getMaintenance` (4 reads), `getManyEntityStates`, `listOpenIncidentsBySystem` / `getActiveMaintenancesBySystem`, `getMaintenanceWindowsForRange`; the `list*` / `*ForSystem` per-row `N+1` system lookups collapsed to a single set-based `inArray` read; maintenance `transitionStatus` update+insert made atomic; `addUpdate`/`editUpdate`/`addLink` use `.returning()` instead of a follow-up re-select.
  - ai: `appendMessage`, memory `saveOrUpdate`.
  - notification: `resolveInheritedGroups`.
  - status-page: subscriber `verify` (4 reads) and `unsubscribe` (3 reads).
  - announcement: `getActiveAnnouncements` / `dismissAnnouncement` / `createAnnouncement`.
  - gitops: `upsertProvenance`.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/catalog-common@2.7.0
  - @checkstack/backend-api@0.31.1
  - @checkstack/sdk@0.127.1
  - @checkstack/integration-backend@0.7.4

## 0.10.9

### Patch Changes

- f93ee7a: Regenerate the in-app docs search index for the contract-derived access-gating docs.

  The bundled docs index (`generated/docs-index.ts`) is regenerated so the rewritten
  `developer-guide/frontend/access-gating` page and the updated
  `developer-guide/backend/teams` reference (now recommending the gate-fused
  `useGatedMutation` / `useProcedureAccess` / `useSurfaceAccess` hooks instead of the
  removed `useCanCreate`) are searchable by the in-app AI assistant. Generated content
  only; no code behavior change.

- 8aae4e2: Regenerate the in-app docs search index for the environment fan-out UI docs.

  The bundled docs index (`generated/docs-index.ts`) is regenerated so the updated
  "Monitor a service across staging and production" guide (per-(check, environment)
  overview rows, the last-healthy stamp, the environment-slice "X of Y checks
  failing" count, and the deduplicated per-environment notification) and the
  Notifications concept page (no duplicate rollup notification for fanned-out
  systems) are searchable by the in-app AI assistant. Generated content only; no
  code behavior change.

- d0eddc9: Regenerate the AI docs search index to cover the new health-check execution and
  scheduling page (per-environment recurring jobs, the convergence reconciler, the
  event-driven rollup consumer, and the slow-check bulkhead) and the
  `checkstack.healthcheck.deferred` metric added to the observability reference.
- d0eddc9: Regenerate the AI assistant docs index to reflect the new
  "Batching queries with `withScopedTransaction`" section in the Drizzle schema /
  scoped-database developer guide, the new
  "Metrics (OpenTelemetry + Prometheus)" section on the backend observability
  page, and the `startDelay` phase-offset / de-clustering guidance added to the
  queue-system recurring-scheduling section.
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/catalog-common@2.6.3
  - @checkstack/backend-api@0.31.0
  - @checkstack/auth-common@0.13.0
  - @checkstack/sdk@0.126.1
  - @checkstack/ai-common@0.6.6
  - @checkstack/integration-backend@0.7.3

## 0.10.8

### Patch Changes

- 390d9cf: Regenerate the docs search index to include the new "Monitor containers" guide,
  the container health-check documentation, and the integration-lane note about
  the Docker-backed socket-proxy test, so the AI assistant can surface the secure
  socket-proxy setup and the Container strategy/collectors.
- fc64fad: Regenerate the docs search index to reflect the updated dependency
  documentation: scoping a dependency to a specific check and/or environment with
  per-cell severity, the dependency-aware automatic map layout (layered
  arrangement, center-on-box, reset layout), and the read-only up/downstream
  dependency panel on system detail pages. This lets the AI assistant answer
  questions about all of it.
- 9d30324: Regenerate the AI docs search index for the incident health-override docs: the
  Incidents concept page now documents "Override system health" and the Health
  checks page notes that a system's worst-wins rollup folds in active incident
  overrides.
- b218e3e: Regenerate the bundled docs index to reflect the new "Data tables" frontend
  guide and the updated list-states page (DataTable replaces the removed
  ResponsiveTable/MobileCardList pattern).
- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/integration-backend@0.7.2
  - @checkstack/sdk@0.125.1

## 0.10.7

### Patch Changes

- c55d7c6: Regenerate the docs index for the healthcheck metrics refactor: the rewritten
  health-check charts guide (unified `@checkstack/ui` chart kit, prioritized
  auto-chart tile grid), the new master-detail frontend pattern page
  (`SplitPane` / `VirtualList`), the new chart metadata keys
  (`x-chart-priority`, `x-chart-good-direction`), and the assertion outcomes
  and analytics documentation (per-run outcomes, per-bucket pass/fail counts,
  ingest-time satellite evaluation, rollup survival).
- a83bcc2: Move the assistant memory UI onto a system's About sidebar.

  The **Assistant Memories** button now lives in the About card of a system's
  detail page (catalog `SystemMetaSlot`), where it belongs, instead of on the
  platform "About Checkstack" page. Clicking it opens a Sheet listing the memories
  the assistant has saved about that specific system. As before, the button hides
  entirely - and fires no `listMemories` request - for users without
  `ai.memory.read`; delete and always-apply remain server-enforced
  (`ai.memory.manage`).

  The platform `AboutSectionsSlot` (`plugin.about.sections`) remains available as
  a general extension point for plugins to contribute self-gating section cards to
  the About page; it just no longer hosts the memory button, and its About-page
  comment no longer references the memory feature.

  The `@checkstack/ai-backend` bundled docs index is regenerated to reflect the
  updated `ai/memory.md` and `frontend/extension-points.md` content.

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/sdk@0.123.1
  - @checkstack/ai-common@0.6.5
  - @checkstack/auth-common@0.12.2
  - @checkstack/catalog-common@2.6.2
  - @checkstack/integration-backend@0.7.1

## 0.10.6

### Patch Changes

- faf98f5: Regenerate the assistant docs index for the config-secrets documentation: the
  "three secret mechanisms" distinction and the "Config-secret extraction channel
  (`configSecret`)" section in the secrets platform page, the updated strategy and
  integration-provider examples (`configSecret({ id })`), and the health-checks
  concept page.
- faf98f5: Security: config secrets (health-check strategy/collector credentials such as
  SSH passwords, DB credentials, HTTP auth, and integration connection
  credentials) ride ONE shared, domain-agnostic extraction channel instead of
  being stored as plaintext or re-implemented per plugin.

  New primitive and shared service:

  - `configSecret({ id })` (in `@checkstack/backend-api`) declares an
    extraction-channel secret keyed by a STABLE `id`, independent of field name or
    position, so renaming or reordering a field never orphans its value. Use it
    (not `configString({ "x-secret": true })`) for any credential whose config is
    relayed to a satellite, projected to AI, or diffed by GitOps. `validateSecretIds`
    rejects, at plugin registration, an `x-secret` field with no `id`, a duplicate
    `id`, or a secret nested in an un-keyable container (array / record / tuple /
    map) - so a mis-keyable schema fails boot rather than at run time.
  - `ConfigSecretChannel` (in `@checkstack/secrets-backend`) is the single
    extract / inflate / collect / redact / merge / delete / prune implementation.
    Health-checks and integration connections both BIND it to their own scope
    (marker prefix + internal-secret key layout); neither re-implements the walk.

  Lifecycle (both bindings):

  - **Write**: an inline value is extracted into the encrypted internal secret
    store; the stored config keeps only an opaque marker. `${{ secrets.NAME }}`
    references are stored verbatim and resolve through the active backend (local
    or Vault) at run time.
  - **Read**: configuration and connection reads strip `x-secret` values and
    internal markers while keeping `${{ secrets.NAME }}` references visible; the
    AI `getConfigurations` tool and create/update responses are redacted too. A
    value never reaches a browser or an AI model context.
  - **Run**: the core executor inflates markers/references in memory just before
    the client is built. Satellites receive markers only and fetch values
    just-in-time over the authenticated WS channel, per run, never persisted, then
    fail CLOSED if any marker/reference survives resolution.
  - **No orphan**: clearing a secret, removing a field/collector, swapping an
    inline value for a reference, updating a connection, or deleting a
    configuration/connection deletes the now-unreferenced internal secret. Cleanup
    is schema-free (scans markers by prefix) and best-effort on delete, so it works
    even when the owning plugin is uninstalled and never blocks a delete.
  - **Forged-marker safe**: extract/inflate key each internal secret by the
    SCHEMA leaf's stable `id`, never by an id parsed out of a stored marker string,
    so a crafted marker can never resolve or delete another scope's secret.

  Health-checks additionally get an idempotent, advisory-locked backfill that
  moves pre-existing plaintext values into the internal store, and per-config-id
  locking so concurrent writers across pods can never leave a dangling marker.
  Integration connection credentials keep their released `__connref__:` marker
  prefix and key layout (id equals the flat field name), so existing stored
  connections are byte-compatible.

  BREAKING CHANGES:

  - Configuration and connection reads no longer include `x-secret` field values
    (clients must treat blank-on-save as keep-existing; the bundled editors
    already do).
  - Satellites must be upgraded together with the core: an old satellite cannot
    resolve the markers a new core stores, so its credentialed checks fail until
    upgraded.

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/integration-backend@0.7.0
  - @checkstack/sdk@0.122.1
  - @checkstack/ai-common@0.6.4
  - @checkstack/auth-common@0.12.1
  - @checkstack/catalog-common@2.6.1

## 0.10.5

### Patch Changes

- e819276: Update the generated docs index to reflect the new "Asserting on JSON response
  bodies" section in the health-checks concept page.
- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/integration-backend@0.6.10

## 0.10.4

### Patch Changes

- b4e0832: Update the generated docs index to reflect the new HTTP health check
  authentication documentation (the Authentication picker in the first-health-
  check guide).

## 0.10.3

### Patch Changes

- 0cac684: Update the generated docs index to reflect the access-gating documentation
  changes (anonymous behavior of the capability hooks, the new "Gate
  affordances, not structure" section, and the dependency map's signed-in-only
  note).
  - @checkstack/sdk@0.119.1
  - @checkstack/backend-api@0.27.1
  - @checkstack/integration-backend@0.6.9

## 0.10.2

### Patch Changes

- 7c18b25: Update the generated docs index to reflect the rewritten "Script styles"
  section of the script health-checks reference (renamed heading + new
  content clarifying the top-level `return` vs `export default` rule).
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/auth-common@0.12.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/sdk@0.118.1
  - @checkstack/ai-common@0.6.3
  - @checkstack/integration-backend@0.6.8

## 0.10.1

### Patch Changes

- baf9b6e: Regenerate the in-app docs search index for the updated script health-check
  reference (the editor now surfaces the assigned environment).

  The bundled docs index (`generated/docs-index.ts`) is regenerated so the
  revised `user-guide/reference/script-health-checks` page is searchable by the
  in-app AI assistant. Generated content only; no code behavior change.

## 0.10.0

### Minor Changes

- defb97b: feat(ai): clickable answer options in chat (askOperator)

  Add an `askOperator` tool the assistant calls to ask a question with clickable
  answer chips (plus an optional free-text box) instead of a plaintext list.
  Clicking a chip sends that answer as the operator's next message. The chat
  renders the chips from a `__question` tool-output card, mirroring the existing
  confirm-card pattern, and calling the tool ends the turn (the operator's choice
  arrives as their next message).

  The system prompt now steers the model to use `askOperator` for discrete-choice
  clarifications (which system, which protocol, how often, which environment),
  reserving prose questions for free-form values like a URL.

- defb97b: feat(ai): add an onboarding playbook to the chat assistant

  When a monitoring-setup tool is in scope this turn (creating a system, proposing
  a health check, or managing environments), the chat system prompt now injects an
  onboarding section that steers the model to prefer the HTTP strategy for a URL,
  ask before guessing, create-and-assign a check in one step, and use environments
  instead of cloning a system per deployment stage. Like the automation playbook,
  it stays out of the always-on prompt on pure read turns.

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/sdk@0.116.1
  - @checkstack/ai-common@0.6.2
  - @checkstack/auth-common@0.11.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/integration-backend@0.6.7

## 0.9.1

### Patch Changes

- 2e20792: Regenerate the in-app docs search index for the new "App boot" frontend guide

  The bundled docs index (`generated/docs-index.ts`) is regenerated so the new
  `developer-guide/frontend/app-boot` page is searchable by the in-app AI
  assistant. Generated content only; no code behavior change.

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/ai-common@0.6.1
  - @checkstack/auth-common@0.11.1
  - @checkstack/catalog-common@2.4.3
  - @checkstack/common@0.17.0
  - @checkstack/integration-backend@0.6.6
  - @checkstack/sdk@0.115.1

## 0.9.0

### Minor Changes

- 748dc50: Fix automation expression fields and harden the Jira search action so actions are reliable to author.

  - **Expression fields reject `{{ }}` at save time.** `when` / `conditions` / a `condition` guard / `wait_until.condition` / a trigger or `wait_for_trigger` `filter` / `repeat.for_each|while|until` / `numeric_state.value` are BARE expressions and reference fields directly. Wrapping one in `{{ }}` (template syntax) used to pass validation and then throw a parse error at dispatch time. A new schema refinement (`collectExpressionDelimiterIssues`) now blocks the save (create / update / GitOps / editor) with a clear message. The misleading "Template returning truthy/falsy" schema descriptions are reworded to say "bare expression (no `{{ }}`)".
  - **Fixed three built-in templates** that wrapped their `when` condition in `{{ }}` (`ai-triage-file-jira-bug`, `jira-comment-transition-on-recovery`, `ai-severity-escalation`) and the webhook-subscription migration that emitted a `{{ }}`-wrapped `systemFilter` condition.
  - **The artifact-wiring validator now scans bare expression conditions**, not just `{{ }}` template spans, so a dropped `<artifactType>` segment (e.g. `artifacts.find.found` instead of `artifacts.find.issue_search.found`) is still caught in a `when` / `condition`.
  - **Jira `search_issues` correlation overhaul.** `statusCategory` is now a dropdown (`new` / `indeterminate` / `done`) instead of free text. A new `labels` filter (`labels in (...)`, AND of all labels) is the reliable way to find the ticket for a specific system, and the two Jira built-in templates now tag issues with a stable `checkstack-sys-<systemId>` label on create and search by it instead of fuzzy `summaryContains`. A search whose CONFIGURED filter renders empty now fails loudly instead of silently broadening to "every ticket in the project". Results are ordered `created DESC` so `firstIssueKey` is deterministic.
  - **Fixed `{{ }}` autocomplete hiding upstream artifacts in raw config fields.** The raw multi-type editor (used by Jira `summary` / `description` and every other `["raw"]` action-config field) matched its autocomplete query without trimming the leading space after `{{`, so typing `{{ arti` produced the query `" arti"`, which matched nothing — the popup emptied the instant a letter was typed and `artifacts.*` (and all other fields) never appeared. The query is now trimmed before matching (the autocomplete logic was extracted to a pure, unit-tested helper). This was most visible on an action nested in a `choose` branch, where upstream artifacts are exactly what you reference. The popup rows also now keep the distinguishing leaf segment (`…analysis.summary`) visible instead of end-truncating every deep path to an identical shared prefix.
  - **Editor UX: expression vs template is now visible.** `TemplateValueInput` gains a `mode` prop; in `expression` mode it shows a focus hint ("reference fields directly, without `{{ }}`") and an inline error the moment a `{{ }}` delimiter is typed, instead of failing only at save / run time. Every expression-field editor (conditions, trigger / `wait_for_trigger` filters, `repeat` for_each/while/until, `window.partitionBy`) now runs in expression mode, and their misleading "Filter template" / "Condition template" labels and `{{ }}` placeholders are corrected.
  - **AI assistant guidance corrected.** The `building-automations` doc (bundled into the AI docs index) no longer tells the model to wrap a condition in `{{ }}`.
  - **Jira provider docs corrected.** The setup help advertised a fabricated nested `payload.system.name`; platform events expose flat `systemId` / `systemName`, so the example payload and template-syntax snippet now use the real flat shape.

  BREAKING CHANGE: An automation definition that wrongly wrapped a condition / filter in `{{ }}` is now rejected on save. These definitions already failed at run time; re-save them with the braces removed (e.g. `artifacts.find.issue_search.found != true`).

### Patch Changes

- @checkstack/sdk@0.113.1

## 0.8.0

### Minor Changes

- 8cad340: Stop the assistant from exposing its internal tools as a user how-to.

  Asked "how do I add a system to the catalog?", the chat assistant answered with
  the internal tool name (`catalog.createSystem`) and its input JSON schema - but
  the operator cannot call tools and never sees them; that is the assistant's own
  mechanism, not a workflow. The chat system prompt now instructs the model that
  tools are its own (not a public API), and that a how-to must be answered in
  product terms (the UI, grounded in docs) and/or by offering to do it for the
  operator - never by presenting tool names, tool input JSON, or parameter schemas
  as steps to follow. Chat-only; the headless runner is unchanged.

- 8cad340: Tell the assistant to re-fetch when resuming an idle conversation.

  The chat loop replays earlier tool results verbatim with no age annotation, and
  the system prompt injects "current time" but never how long the thread has been
  idle. So resuming an old chat, the model answered from stale captured data (a
  check's old name, a "failing" status) instead of the current state.

  The turn now measures the idle gap before the message (the conversation's
  last-activity timestamp, captured before the new message is appended) and, once
  it exceeds 10 minutes, folds a "Data freshness" directive into the system prompt
  instructing the model to re-call the relevant read tools for current state
  rather than trust results from earlier in the thread. The directive sits at the
  volatile end of the prompt (next to the time line), so the cache-friendly stable
  prefix is unaffected; an active back-and-forth never sees it.

- 8cad340: Improve AI chat/agent steering, MCP conformance, doc grounding, and provider seams.

  - Tool feedback self-correction: a validation failure or duplicate tool call now surfaces as a thrown tool error (a distinct AI-SDK `tool-error` result part) instead of an ordinary success value, so the model is told the call failed and retries. Confirm cards remain success results and carry a structured `status: "awaiting_operator"`. The headless agent runner surfaces tool failures the same way instead of returning `{ error }` as data.
  - System prompts are now sectioned (clear `##` headings, blank-line separation) with the safety-critical access-scope and investigation rules near the top. The ~600-token automation-building playbook is no longer always-on: it loads only when an automation tool is in scope (or via the `automation-author` skill). Headless author overrides are wrapped in an `<author_instructions>` delimiter.
  - Model-family seam: connections may declare `modelFamily` (`anthropic` | `openai` | `generic`, default `generic`). The transport stays `@ai-sdk/openai-compatible` for every value; capable families get a lighter-touch prompt-calibration note. Per-turn volatile preambles (memory/skill/summary) now follow the stable base prompt for prompt-cache friendliness on caching-capable gateways.
  - MCP Streamable-HTTP conformance (spec `2025-06-18`): `tools/list` advertises `outputSchema` and `tools/call` returns `structuredContent` for tools that declare an output; `Mcp-Session-Id` is required and validated on post-initialize requests; the negotiated `protocolVersion` is echoed; cross-site `Origin` requests are refused.
  - Doc grounding relevance is now a corpus-size-stable relative signal (top-hit gap to the runner-up) instead of an absolute BM25 threshold. The per-read result clamp budget derives from the connection's `contextWindowTokens` instead of a hardcoded constant.
  - The topical pre-classifier round-trip can be disabled per connection (`disableTopicalClassifier`); the in-prompt off-topic decline then carries it.
  - Steering de-duplication: the "when to call this / pass a UUID, not a name" trigger guidance now lives only in the tool `description` (where it travels with the tool), and the chat system prompt's investigation section keeps only cross-tool strategy and the universal id-discipline rule, so the two can no longer drift.
  - Tool descriptions are now stable across permission modes: the per-mode note ("(auto-applied...)", "(requires human confirmation...)") is no longer appended to a tool's `description` at wire time. The conversation's mode is conveyed once by the system prompt's permission-mode line, keeping tool identity decoupled from conversation state.

- 8cad340: Keep an active chat Skill's voice in force through the final answer.

  A user Skill (e.g. "write like a redneck") held during tool-calling steps but
  normalized back to professional tone in the synthesized reply. Cause: the
  multi-step loop's forced final-answer step (`prepareFinalAnswerStep`) REPLACES
  the whole system prompt with a tool-less "write your final answer now, be
  concise" instruction - dropping the skill preamble on the exact step that writes
  the user-visible answer.

  The final-answer step now carries the active skill guidance through (appended
  after the base final-answer instruction, so the style is the last thing the model
  reads), so the skill's voice governs the synthesized reply too instead of being
  silently dropped after tool calls.

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ai-common@0.6.0
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/drizzle-helper@0.0.6
  - @checkstack/auth-common@0.11.0
  - @checkstack/integration-backend@0.6.5
  - @checkstack/catalog-common@2.4.2
  - @checkstack/sdk@0.112.1

## 0.7.2

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/integration-backend@0.6.4

## 0.7.1

### Patch Changes

- b1a5f3c: Status pages: first-class custom domains with a locked-down public surface.

  A published status page can now be served on its own host (e.g. `status.acme.com`),
  isolated from the admin UI at three layers:

  - **Data.** A new platform extension point (`publicHostResolverExtensionPoint` in
    `@checkstack/backend-api`) lets the owning plugin map an incoming `Host` to a
    published page. On a matched custom domain, a core host-routing middleware
    serves ONLY the single public read (`getPublishedStatusPage`), `/api/config`,
    the public bundle's assets, and the on-demand-TLS hook. Every other `/api/*`,
    all of `/rest/*`, the admin docs, and the platform endpoints
    (`/.checkstack/*`, `/.well-known/jwks.json`) return 404. `/api/config` returns
    the custom domain itself as `baseUrl`, so the bundle's RPC client can only
    call back into the same locked-down origin - never the admin origin.
  - **Code.** The custom-domain host loads a separate minimal public bundle that
    ships none of the admin app (no sidebar, auth, signals, command palette, or
    plugin loader). The frontend entry checks `/api/config` first and dynamically
    imports only the public bundle on a public host, so the admin chunk is never
    fetched there.
  - **Ownership.** Domains are added in the builder, verified via a DNS TXT record
    (`_checkstack-verify.<domain>`), and route only once verified AND published.
    An `/.well-known/checkstack/authorize-domain` hook lets an on-demand-TLS edge
    (Caddy, Cloudflare for SaaS, cert-manager automation) mint certificates only
    for verified domains. TLS is terminated at the edge, matching how the platform
    already serves its primary domain.

  Builder gains a Custom domain panel (set / verify / remove + DNS instructions).

  Widget renderers are now pluggable too. A plugin that contributes a backend
  widget type can ship its frontend renderer with `defineStatusWidgetRenderer`
  (in `@checkstack/status-page-common`) via its `extensions[]`; the status-page
  frontend resolves each block's renderer by id, merging built-ins (which win on a
  clash) with plugin-contributed ones. Previously only the built-in renderers
  existed, so a third-party widget type had no way to draw on a page.

  Third-party renderers work on custom domains too. A backend widget type can
  declare `rendererRemote` (its frontend npm package); the published-page response
  then lists exactly the renderer remotes that page needs, and the minimal
  custom-domain bundle loads only those on demand via Module Federation. The set
  is derived from the page's widget types (operator-controlled, never visitor
  input) and the loaded code is the operator's own trusted plugin, so it does not
  widen the data surface (the only reachable data endpoint on a public host is
  still the single public read).

  Hardening (from review): WebSocket upgrades are gated on custom-domain hosts
  (they bypass the HTTP middleware), so no socket endpoint is reachable there;
  custom domains route ONLY `public`-visibility published pages (an
  `authenticated` page never routes nor leaks its slug); `setCustomDomain` rejects
  the platform's own host, IP literals, and internal suffixes; and the host-lookup
  cache is size-bounded against unique-host floods. The host-routing decision is
  unit-tested.

  NOT breaking. New `status-page-common` contract procedures (`setCustomDomain`,
  `verifyCustomDomain`, `removeCustomDomain`) and `customDomain*` columns on the
  `status_pages` table (additive migration).

  (`@checkstack/ai-backend` is a patch only: its generated docs index now includes the custom-domain documentation.)

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/integration-backend@0.6.3
  - @checkstack/catalog-common@2.4.1
  - @checkstack/sdk@0.109.1

## 0.7.0

### Minor Changes

- 551eaa9: AI assistant context-window management + leaner health-check history for chat.

  The assistant previously sent the full conversation history verbatim every turn
  with no size bounds, so analyzing historical health-check runs blew the model's
  context window fast. Two problems are addressed:

  **Verbosity.** Read-tool results are now shaped for the model:

  - A generic, last-resort size clamp on every read result (head-trims the largest
    arrays and adds a `_truncated` hint to narrow/paginate) so one wide pull can't
    blow the context — and, since history replays each turn, keep blowing it.
  - Projections can declare an optional `projectResult` to return a LEANER
    model-facing shape than the UI procedure (authz + audit still see the full
    result). `healthcheck.runHistory` uses it to drop the opaque ids the model
    merely echoes, keeping time/status/latency/source.
  - New `healthcheck.runStats` AI tool (backed by a new public `getRunStats`
    procedure): compact window totals (counts by status, uptime %, latency
    avg/min/max/p95) plus a small capped time series, so "how often / how much
    downtime / uptime over the last N days" questions return aggregates instead of
    thousands of rows. `runHistory`'s description now steers wide-window questions
    here.

  **Context limits.** The chat loop now estimates the prompt's tokens (a
  provider-agnostic heuristic) against a budget derived from the connection's
  context window, and COMPACTS the conversation before it overflows: the oldest
  turns are summarized into a durable running summary (persisted on the
  conversation row in shared Postgres, so any pod resumes consistently) and dropped
  from the verbatim replay, with the summary folded into the system prompt.
  Splitting at message-row boundaries keeps tool-call/result pairs intact, and the
  summarization step is fail-open. A new optional `contextWindowTokens` on the
  OpenAI-compatible connection sets the window (blank = conservative default).

  All additive: a new optional connection field, a new public read endpoint, and an
  additive `ai-backend` migration (`0009`) adding nullable `summary` /
  `summarized_through_message_id` columns to `ai_conversations`.

- d2077bd: Platform-wide team-scoped access control on a unified relation-tuple store.

  Admins can scope any resource to teams, and the **platform** (not each plugin)
  enforces it. A plugin opts in declaratively by adding `instanceAccess` to a
  procedure's contract; the auth middleware does the rest, so enforcement is
  consistent across catalog, health checks, incidents, maintenances, SLOs,
  automations, and the dependency map, and any third-party plugin gets it for free.

  Core model:

  - **Teams are optional.** A resource with no team grants behaves exactly as
    before.
  - **Team grants are additive and restrict who can CHANGE a resource, not who can
    SEE it.** Granting a team `Manage` lets its members view and change the
    resource; `Read-only` lets them view it. Either level grants access to team
    members **even when they lack the global permission**, and granting never
    removes read from anyone who already had it (e.g. a public status page stays
    readable). Privacy is a separate, explicit opt-in via the **Private** toggle,
    which removes the global read path so only the resource's teams can see it.
  - **Ownership at creation.** Create forms expose an **Owning team** picker. A
    non-admin can create a resource for a team they belong to that holds a
    create-capability grant for that type; the new resource is auto-granted to that
    team. Incidents and maintenances are **parent-gated**: anyone who can manage a
    system may open incidents/maintenances for it, no separate grant needed.
  - **Meaningful authorization errors.** A caller with neither the global rule nor
    any team grant for a resource type gets a `403` with a structured body instead
    of a silently-empty `200`. Anonymous callers on public endpoints are never
    `403`'d, so status pages keep rendering.

  Unified relation-tuple store:

  - The previously separate access primitives (`resource_team_access.canRead` /
    `.canManage`, ownership, `resource_access_settings.teamOnly`, and
    `resource_create_grant`) are collapsed onto ONE
    `relation_tuple(object, relation, subject)` store: "a team has
    `viewer`/`editor`/`owner` on an object, or `creator` on a type". Privacy is an
    explicit **`private` marker** tuple — its **presence** closes the global read
    path (team grants only), its **absence** is the readable-by-default state, so a
    private resource with zero grants is correctly inaccessible to everyone rather
    than silently globalized. The access decision is a pure, unit-tested function.
  - The auth API is generic: `writeRelation` / `removeRelation` / `setObjectPublic`
    / `listObjectRelations` / `listSubjectRelations` / `setCreateGrant` /
    `listTeamCreateGrants` (user-facing) and `check` / `listAccessibleObjectIds` /
    `hasAnyTypeGrant` / `authorizeCreate` / `setOwner` / `deleteObjectRelations`
    (service-to-service). Migration `0008` backfills tuples from the legacy tables
    and drops them.

  Explicit per-procedure scoping:

  - Access rules (`access()` / `accessPair()`) define only the rule (id, level,
    defaults); every procedure declares its own `instanceAccess`. This removes a
    "loaded gun" default that silently applied a shared `idParam` to any procedure
    which forgot its own override.
  - Modes: `idParam` (single-resource pre-check, fails **closed** if the id does
    not resolve), `listKey` / `recordKey` (post-filter a list/record to the
    accessible subset), `create` (authorize creation + write the owning-team
    grant), `parentScope` (scope by read/manage access to a PARENT type,
    cross-plugin single-hop: "you may see incidents/maintenances/SLOs/health for
    system S iff you may see S"), and `global: true` (the honest "intentionally not
    team-scoped" opt-out). A boot-time validator **rejects** any procedure gated on
    a team-scopable resource type that declares no `instanceAccess`, turning the
    previous fail-open into a boot error.

  Teams administration:

  - **Team managers** manage their own team's members and managers without the
    global `auth.teams.manage` rule; creating, deleting, and granting a team access
    remain admin-only.
  - A **standalone Teams page** (gated on `auth.teams.read`) lets managers reach
    team administration without the admin Auth Settings page; members are added via
    a debounced directory picker.
  - A **cross-plugin `ResourceResolverRegistry`** lets owning plugins register a
    name/search resolver for their resource types, so the Teams page lists a team's
    grants **by name** (grouped by type) and offers a resource picker — an admin can
    change a grant's level, revoke it, or add one, without auth depending on every
    plugin. Resolvers shipped for catalog systems, health-check configurations,
    incidents, maintenances, SLO objectives, and automations.

  Frontend:

  - The resource-side editor is **"Who can change this"** (one Manage checkbox per
    team; unticked = read-only), with an always-visible **Private** toggle
    (disabled until a team that can Manage exists, so a resource can't be stranded).
  - `TeamOwnershipPicker` explains _why_ there's nothing to pick (not a member of
    any team, or none of your teams manage the selected parent) instead of a bare
    "global resource" line.
  - Read-only **"who can change this"** indicators on resource detail pages expand
    to the actual people by name; bulk + per-row **Scope to team** actions in the
    catalog systems list; and the team-access copy spells out that grants are
    additive and that Read-only grants view (not change) even without the global
    permission.

  Security hardening:

  - Child deletes in catalog (`removeSystemContact` / `removeSystemLink`) are scoped
    to both the child id and its parent `systemId`, closing a cross-system IDOR for
    team-scoped managers.
  - `searchUsers` is restricted to team administrators, closing a directory/email
    enumeration path opened by the default `auth.teams.read` rule.
  - Grant setters reject unregistered resource types.

  BREAKING CHANGES (beta; shipped as minor bumps):

  - `access()` and `accessPair()` no longer accept `idParam` / `listKey` /
    `recordKey`; move instance config to the procedure's `instanceAccess`.
  - Boot fails if a procedure gated on a team-scopable resource type omits
    `instanceAccess`. Declare a scoping mode or `instanceAccess: { global: true }`.
  - The `AuthService` interface is reshaped: `check`, `listAccessibleObjectIds`,
    `hasAnyTypeGrant`, `authorizeCreate` (returns `isPrivate`), `setOwner`
    (`isPrivate`), and `deleteObjectRelations`. Custom `AuthService` implementations
    and mocks must update.
  - The auth RPC contract's per-concept resource-access endpoints are replaced by
    the generic tuple API above; external callers of the old
    `getResourceTeamAccess` / `setResourceTeamAccess` / `setResourceAccessSettings`
    / `grantResourceCreate` / etc. must move to the new procedures.
  - Several contract inputs changed from a bare `string` to an object so the
    middleware can resolve the resource id: catalog `deleteSystem` (`{ id }`),
    `removeSystemContact` / `removeSystemLink` (`{ id, systemId }`); health-check
    `deleteConfiguration` / `pauseConfiguration` / `resumeConfiguration` (`{ id }`).
    All in-tree callers are updated.
  - List/record endpoints that relied on returning an empty `200` to signal "no
    access" now return a `403` for categorically-unauthorized principals.
  - The mis-keyed bulk endpoints `getBulkIncidentsForSystems`,
    `getBulkMaintenancesForSystems`, and `getBulkObjectivesForSystems` no longer
    post-filter their (systemId-keyed) result; access is already gated by
    `catalog.system` upstream.
  - Team membership/manager mutations (`addUserToTeam`, `removeUserFromTeam`,
    `addTeamManager`, `removeTeamManager`) now require `auth.teams.read` instead of
    `auth.teams.manage` at the contract level (broadened to per-team managers).
  - The `resource_team_access`, `resource_access_settings`, and
    `resource_create_grant` tables are dropped (data backfilled into
    `relation_tuple` by migration `0008`). A previously inconsistent "team-only with
    zero grants" resource is now correctly inaccessible to global-access holders.

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [5c6393f]
  - @checkstack/ai-common@0.5.0
  - @checkstack/auth-common@0.10.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/sdk@0.108.1
  - @checkstack/integration-backend@0.6.2

## 0.6.1

### Patch Changes

- bb6f0fe: Fix REST query-parameter coercion. Query-string values arrive as strings, but
  contract input schemas declare real types (e.g. `listIncidents`'
  `includeResolved: z.boolean()`), so `/rest/...?includeResolved=true` was
  rejected with "expected boolean, received string". The REST handler now wires
  oRPC's `SmartCoercionPlugin`, which reads each procedure's JSON schema and
  coerces query/path/header strings to the declared type before validation -
  correctly mapping the string `"false"` to the boolean `false` (rather than the
  `Boolean("false") === true` trap). Booleans, numbers, and ISO-8601 dates now
  work as query params across every plugin's REST surface. The native oRPC
  surface is unaffected (it already carries real JSON types).

  Also regenerates the bundled docs index (`@checkstack/ai-backend`) to pick up
  the new "Typed query parameters" section in the public REST API reference.

  - @checkstack/sdk@0.107.1

## 0.6.0

### Minor Changes

- 4134ed9: Add persistent "operator memory" for the AI assistant: it can save a durable
  finding and recall it in later conversations, for knowledge the platform does
  not otherwise store. Memories are scoped `user` (a private preference/policy) or
  `system` (a fact about one system, shared with anyone who can read it), and the
  model picks the scope at save time. Recall is on-demand via a `searchMemory`
  tool; `saveMemory` is proposed (confirmed in chat, capped per run for the
  unattended automation agent) and deduplicates by updating a near-match instead
  of duplicating; `deleteMemory` is destructive (always confirmed, never offered
  to the agent). Each memory carries an `alwaysInject` flag (the model proposes it,
  the operator can flip it in the UI): an always-inject memory is prepended to the
  system prompt every turn, so an always-apply preference (e.g. a writing-style
  rule) takes effect during generation instead of waiting to be recalled. A new
  `ai_memory` table backs it; `user` memories are owner-scoped and `system`
  memories are gated by the same per-system team grants the catalog applies. New `ai.memory.read` / `ai.memory.manage` access rules
  (default-on, admin-revocable) gate the tools. Memory content is treated as data
  (never instructions), secret-scrubbed on save, and never used to cache live
  state. A Memories settings page and a per-system memory card let operators view
  and prune what the assistant has saved.
- 6005271: Add AI "skills" - reusable prompt templates for the chat assistant and the
  `ai_analyze` automation action. A skill bundles a system-prompt fragment, an
  optional starter prompt, and (for analyze) suggested output fields, tagged with
  the surfaces it targets.

  Skills come from two sources merged into one catalogue: builtin skills
  contributed by core/plugins via the new `aiSkillExtensionPoint`, and GLOBAL
  user skills authored by operators (new `ai_skill` table) and visible to everyone
  who can read skills. New access rules `ai.skill.read`, `ai.skill-create.manage`
  (a dedicated create permission), and `ai.skill.manage` (edit/delete, author-only
  with admin moderation) gate the feature - all default-on, admin-revocable.

  The chat composer gains a skill picker (its system prompt seeds the turn, its
  starter prompt seeds the message box); the `ai_analyze` action gains an optional
  `skillId` that seeds the system prompt, prompt (when blank), and output fields
  (when none) - explicit config always wins. A new "AI skills" settings page lets
  operators browse, view full details (prompts + output fields), publish, edit,
  and delete their global skills. Ships six builtin skills across chat and analyze.

  To support rich pickers, `@checkstack/ui`'s `DynamicForm` gains a `catalog`
  options style (`x-options-style: "catalog"`, with resolver options carrying an
  optional `description`) that renders a browsable modal of cards instead of a
  plain Select, and `@checkstack/backend-api` propagates the new annotation. The
  shared `PageHeader` now wraps a long subtitle beside its actions instead of
  letting them overlap.

### Patch Changes

- 079369a: Fix the AI analyze action's structured output (`outputFields`) failing on
  OpenAI-compatible providers without native structured-output support (OpenRouter,
  DeepSeek, Ollama, ...). The JSON schema sent via `responseFormat` is silently
  dropped by those providers, and the prompt never described the schema, so the
  model was never told which fields were required and omitted them ("No object
  generated: response did not match schema"). The structured-output pass now
  embeds the JSON Schema in the prompt, so it works on any OpenAI-compatible model.
  The repair loop is also more effective: on a failed attempt it now feeds back the
  specific field-level validation errors and the model's rejected output (instead
  of the generic "did not match schema" message) and reinforces the schema more
  firmly on repeated misses.
- 4134ed9: Stop the chat assistant from dead-ending on a guessed documentation slug. The
  `getDoc` tool now tells the model the slug must come from a `searchDocs` /
  `listDocs` result, and when an unknown slug is requested its error names the
  closest real pages (matched on the slug's own words) so the model recovers in
  one step instead of guessing another slug.
- Updated dependencies [4134ed9]
- Updated dependencies [6005271]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
  - @checkstack/ai-common@0.4.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/auth-common@0.9.1
  - @checkstack/integration-backend@0.6.1
  - @checkstack/sdk@0.106.1
  - @checkstack/catalog-common@2.3.6

## 0.5.0

### Minor Changes

- ebef442: feat(automation): gate integration actions on the runAs service account's permissions

  **BREAKING.** Integration automation actions resolve credentials through a
  trusted service rather than the bounded `runAs` client, so they previously
  bypassed the runAs least-privilege model entirely: anyone able to author an
  automation could create Jira tickets, send Teams/Webex messages, etc. on any
  configured connection, with a zero-permission service account. This closes that
  gap.

  - **Actions declare `requiredAccessRules`** and the dispatch engine enforces
    them against the resolved `runAs` principal BEFORE the action runs (failing
    the step if missing) - the authorization point integration actions lacked.
  - **Each integration plugin defines per-action access rules**, e.g.
    `integration-jira.create_issue.manage` / `search_issues.read` /
    `transition_issue.manage` / `add_comment.manage`,
    `integration-teams.post_message.manage`,
    `integration-webex.post_message.manage`.
  - **`automation.propose` checks the same up front**, surfacing a per-action
    missing-permission error on the review card; `listActions` now exposes each
    action's `requiredAccessRules`, and `getBindableApplications` now returns each
    app's effective `accessRules`.
  - **New `integration.read` rule** gates `listConnectionSummaries` /
    `resolveConnectionOptions` (previously open to any authenticated user), so
    discovering connections and resolving their field options requires a grant.
  - **The AI assistant picks a capable runAs up front.**
    `automation.listServiceAccounts` now returns each account's `accessRules` and
    `automation.getCapabilitySchema` returns each action's `requiredAccessRules`,
    so the model selects a service account whose permissions cover the actions it
    uses instead of proposing and being rejected. When the operator did not name a
    runAs and more than one account qualifies, it ASKS which to use rather than
    choosing the automation's identity itself; when none has the needed rules it
    says which rule(s) to grant.

  **Migration:** existing automations whose service account does not hold the new
  rules will fail at the gated action until an admin grants the matching rule(s)
  to the service account's role (e.g. add `integration-jira.create_issue.manage`).
  Admin (`*`) service accounts are unaffected. Grant `integration.read` to roles
  that author integration-using automations so the editor's connection pickers and
  dropdowns keep working for non-admins.

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/integration-backend@0.6.0
  - @checkstack/auth-common@0.9.0
  - @checkstack/ai-common@0.3.0
  - @checkstack/sdk@0.105.1
  - @checkstack/catalog-common@2.3.5
  - @checkstack/backend-api@0.21.7

## 0.4.0

### Minor Changes

- c4bebbb: feat(ai): close the agent feedback loop and harden boundary awareness

  Tighten the agentic workflows so the model understands its context, grounds
  itself in the docs, asks instead of guessing, and never surfaces unvalidated
  output to the user.

  - **Propose validation feedback loop.** A proposable tool's `dryRun` now throws
    the shared `ToolValidationError` (exported from `@checkstack/ai-backend`) when
    the model's drafted input is semantically invalid (fabricated `runAs`, unknown
    `connectionId`, unwired/wrong-typed artifact reference). Chat catches it and
    returns the structured `issues` to the MODEL as the tool result so it
    self-corrects and re-proposes, instead of throwing a raw "the assistant hit an
    error" at the operator and losing the proposal. Holds in both modes: in `auto`
    mode a draft that fails validation is fed back, never auto-applied, so a broken
    automation is never created. The failed attempt is not counted by the per-turn
    duplicate guard, so the corrected retry is allowed.
  - **Headless AI action hardening.** The unattended agent runner now injects a
    shared baseline prompt stating its boundaries (bounded service account;
    changes apply immediately and irreversibly; an empty result may be a
    permission boundary, not "nothing exists"; ground concepts in the docs; never
    fabricate). An author-supplied `systemPrompt` now APPENDS to this baseline
    instead of replacing it, so an override can never silently drop a safety line.
    The structured-output pass gained a bounded repair loop: on a schema miss it
    feeds the validation error back and retries before failing, so a recoverable
    near-miss self-corrects while a malformed object still never reaches a
    downstream `choose`/`condition`.
  - **Chat prompt clarity.** The chat system prompt now names the `searchDocs` /
    `getDoc` tools and tells the model to ground concept/how-to answers in the
    docs, to ASK the operator a clarifying question rather than invent a missing
    value, that an empty/short result may be its own access scope (never assert a
    definitive all-clear), and which permission mode the conversation is in.
  - **Schema polish.** `system.issues` `systemIds` and `automation.propose`
    `runAs` now carry field-level `.describe()` guidance steering the model to real
    ids from `catalog_listSystems` / `automation.listServiceAccounts` (never a name
    or an invented value). The propose-time connection check now emits a soft
    "could not verify" issue when the action catalog cannot be loaded, instead of
    silently skipping the check and letting a fabricated `connectionId` through.

- c4bebbb: feat(ai): teach the chat assistant how to build working automations

  The AI assistant fabricated values it should have sourced from the platform -
  an invented `runAs`, a hand-rolled HTTP fetch with a placeholder URL/token, or
  a script return value that was never wired downstream - so its proposed
  automations failed to save or run.

  The chat system prompt now carries an automation-building playbook that tells
  the model to discover before drafting: introspect capabilities and schemas,
  pick a real `runAs` from `automation.listServiceAccounts` (never invent one),
  reference a real `connectionId` from `automation.listConnections` for
  integrated systems (never hand-roll an HTTP fetch), model decisions and gates
  as a side-effect-free `choose`/`condition` over a prior query action's
  artifact, fall back to a fetch script with `secretEnv` secrets plus
  `variables`-sourced URL/params for non-integrated systems (and tell the
  operator to allowlist egress to that host), give every output-producing action
  an id and wire it downstream with the full
  `{{ artifacts.<actionId>.<artifactType>.<field> }}` path (the `<artifactType>`
  segment is required and easy to drop, which silently resolves to `undefined`),
  and validate any script with `automation.testScript` before proposing.

- c4bebbb: feat(ai): add a docs sitemap and stop the assistant looping on doc search

  On an under-documented conceptual question the assistant burned dozens of tool
  calls re-running near-identical `searchDocs` queries: the BM25 ranker returns
  hits for any query that shares a common word ("system", "health"), so "nothing
  found" never looked like nothing, and the model had no map of what pages exist.

  Two changes:

  - **New `ai.listDocs` tool** returns the documentation sitemap (every page's
    slug, title, description; optional `section` filter). The model can see what
    IS and ISN'T documented and jump straight to the right page with `getDoc`,
    instead of fuzzing `searchDocs` - and when no page fits, conclude the docs do
    not cover the topic.
  - **`ai.searchDocs` now returns a `note`** alongside the hits: empty results and
    weak-scoring hits tell the model to consult `listDocs` or say the docs do not
    cover it, rather than reword and retry. The system prompt's docs-grounding
    guidance leads with `listDocs` and forbids the re-search loop.

  Verified end-to-end: the conceptual question that previously took ~54 calls
  (mostly repeated junk searches) now resolves in ~21 distinct, purposeful calls
  (sitemap + a handful of distinct page reads) and returns a more precise,
  docs-grounded answer.

- c4bebbb: fix(ai): guarantee the agent turn always ends with an answer

  The chat loop and the headless AI action cap tool-call rounds with
  `stepCountIs(MAX_STEPS)`. A model that kept calling tools right up to the cap
  made the loop terminate on a tool-call step with NO final text - the operator
  got a blank reply and the AI action an empty summary. This was acute with
  reasoning models (e.g. DeepSeek-R1 style), which put their work in the hidden
  reasoning channel and "keep thinking about searching" indefinitely when a doc
  search does not surface a clean answer.

  The final allowed step is now a forced answer: `prepareStep` removes all tools
  for that step (`activeTools: []`) and overrides the step system prompt to tell
  the model its tool budget is spent and it must answer now from what it gathered
  (saying so plainly if the docs do not cover the question, rather than guessing).
  The same guard runs in the headless agent runner.

  `activeTools: []` is used deliberately instead of `toolChoice: "none"`: with some
  OpenAI-compatible models the latter makes the model emit its raw tool-call markup
  as the answer text. Verified end-to-end against a reasoning model: a hard
  conceptual question that previously returned an empty reply now returns a
  grounded answer that correctly distinguishes what the docs cover from what they
  do not.

- c4bebbb: feat(ai): allow more tool-call rounds per turn

  The agent loop's per-turn step budget was tight enough that a thorough
  investigation (resolve ids, fan out across signal sources, read several docs)
  could exhaust it before answering. Raise the budgets:

  - Chat: `MAX_STEPS` 8 -> 16 (the final step is the forced answer, so ~15 rounds
    of actual tool use).
  - AI action (headless runner): default `maxSteps` 8 -> 12, and the per-action
    config cap 20 -> 30 so authors can dial it higher for deep tasks.

  The per-principal tool rate-limit budget and the optional per-connection spend
  cap remain the real cost ceilings, so this only widens how much investigating a
  single turn may do, not how much a principal may spend overall.

### Patch Changes

- 0ffe357: fix(ai): make the chat off-topic classifier a deny-list (fewer false refusals)

  The topical pre-classifier refused legitimate operations questions such as
  "analyze the problems <system> has in <environment>" with "That looks outside
  my scope". The system prompt was an allow-list that enumerated resources and
  CRUD verbs, so anything phrased with an unlisted verb (analyze, investigate,
  diagnose, ...) or about an unlisted concept could fall through to OFF_TOPIC.

  The classifier is now a deny-list: everything is ON_TOPIC by default and only a
  few clearly-unrelated categories (general-purpose coding help, creative
  writing, math/homework, general trivia/world knowledge) are rejected. It no
  longer enumerates resources, tools, or verbs, so adding new tools/resources
  never requires a prompt edit. The fail-open parser is unchanged.

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/ai-common@0.2.0
  - @checkstack/integration-backend@0.5.0
  - @checkstack/sdk@0.104.1

## 0.3.0

### Minor Changes

- 0b6f01b: feat(ai): add the system.issues aggregator tool and system-signals extension point

  `ai-backend` gains a new read tool, `system.issues`, that returns ALL current
  system issues - failing health checks, breaching or at-risk SLOs, active
  anomalies, open incidents, active maintenances, and dependency problems -
  aggregated across every system in ONE call. The assistant is steered to reach
  for it FIRST whenever asked whether there are issues, what is down, or for an
  overall health overview, instead of polling each per-domain tool. The tool is
  gated by `catalog.system.read`.

  The tool owns no domain knowledge. A new backend `systemSignalsExtensionPoint`
  lets any plugin register ONE `SystemSignalsContributor` from its own `init`; the
  tool fans out across every contributor and merges their per-system maps. Each
  contributor enforces its OWN per-source access gate - returning an empty map
  (never throwing) when the principal lacks access - and reads from shared, durable
  storage so the answer is identical on every pod. `ai-backend` imports no
  capability plugin's `*-common` to collect signals; the dependency direction stays
  plugin -> `@checkstack/ai-backend`.

  The maintenance plugin now registers a `system.issues` contributor (sourceId
  `maintenance`) from its backend `init`, surfacing in-progress maintenances
  alongside the other sources. The contributor enforces its own
  `maintenance.read` gate and reads active maintenances for all systems globally
  via a new `getActiveMaintenancesBySystem` service method. The row->signal mapping
  is extracted into a new pure `deriveMaintenanceSignals` deriver in
  `@checkstack/maintenance-common`, shared by the backend contributor and the
  frontend `MaintenanceSignalsFiller` so the two surfaces stay in lockstep.

  The new `systemSignalsExtensionPoint`, `SystemSignalsContributor`,
  `SystemSignalsExtensionPoint`, and the `system.issues` tool factory plus its
  pure helpers (`mergeSystemSignalsMaps`, `collectSystemSignals`,
  `toSystemIssuesOutput`, schemas) are exported from `@checkstack/ai-backend`.

### Patch Changes

- dbb76a2: fix(ai): guide the assistant to find all issues and fix the anomaly tool

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

  - @checkstack/sdk@0.103.1
  - @checkstack/backend-api@0.21.6
  - @checkstack/integration-backend@0.4.6

## 0.2.0

### Minor Changes

- 2428bfc: fix(ai): make AI tool names provider-safe (no "." in names)

  LLM providers (and the MCP spec) require tool names to match
  `^[a-zA-Z0-9_-]+$`, but our tool names are qualified as `<plugin>.<tool>`
  (e.g. `incident.list`, `dependency.list`). The "." caused the model backend to
  reject the tool list, so chat tool-calling failed after deploy.

  Tool names are now normalized to a provider-safe form at the single
  registration chokepoint (the tool registry) and in the projection-routing
  table: the "." namespace separator is mapped to "\_" (so `incident.list`
  becomes `incident_list`). The registry key, the name serialized out to the
  model / MCP client, and the name the model echoes back in a tool call are all
  the same normalized string, so the round-trip needs no reverse lookup. Any
  other illegal character is an authoring mistake and is now rejected at
  registration rather than silently rewritten.

  BREAKING: AI tool names exposed over the MCP `tools/list` endpoint change from
  the dotted form (`incident.list`) to the underscored form (`incident_list`).
  MCP clients that referenced tools by their dotted names must update to the
  underscored names. (Chat was already broken by the provider rejection, so this
  only changes the working MCP surface.)

## 0.1.6

### Patch Changes

- f9cfdae: fix(dependency): gate the dependency map behind its own non-public access rule

  Anonymous users could see the "Dependency Map" nav entry and open the page
  (which then rendered empty) because the map was gated by `dependency.read`,
  which is public so that dependency _warning_ badges stay visible on the
  catalog and dashboard.

  The full topology map is now gated by a dedicated `dependency.map` access
  rule that is granted to authenticated users by default but is NOT public, so
  anonymous visitors no longer see the nav entry or reach the page. The
  `getAllDependencies`, `getNodePositions`, and `saveNodePositions` endpoints
  move to this rule too, and the dashboard dependency signal now renders as
  plain text (not a map link) for users without map access. Per-system
  dependency warnings stay on the public `dependency.read` rule, so warning
  badges/alerts/signals remain visible to everyone as before.

  Admins can still grant `dependency.map` to the anonymous role to make the
  map public again.

  Note: the default-rule sync is add-only, so on existing deployments the
  anonymous role keeps any rules already granted. Since `dependency.map` is a
  brand-new rule the anonymous role never had it, so the map is hidden from
  anonymous users immediately after upgrade with no admin action required.

  - @checkstack/sdk@0.101.1

## 0.1.5

### Patch Changes

- 56e7c75: Hide navigation, actions and links that the current user cannot use, so anonymous
  and read-only users no longer see entries that lead to "Access Denied" or to
  actions the server would reject.

  - **Sidebar**: a nav entry can now declare a dynamic `nav.isVisible({ accessRules, isAuthenticated })` predicate (in addition to the static `accessRule`). A group whose every entry is filtered out is no longer rendered. The filtering/grouping logic is extracted to a pure, unit-tested helper.
  - **Infrastructure**: its sidebar entry is shown only when the user can READ at least one contributed tab (queue, cache, …), instead of always (it previously had no static rule because tabs are contributed at runtime).
  - **Notification Settings**: hidden from anonymous users - notifications are per-user, so an anonymous visitor can't have any.
  - **Anomaly Mute / Suppress**: the "Mute" / "Mute all" controls (a per-user preference) are hidden from anonymous visitors; the "Suppress" control is gated on `anomalyAccess.feed.manage`. Both were previously always visible.
  - **Dashboard**: the "Open Catalog" actions (which open the manage-only Catalog config page) are hidden from users without `catalogAccess.system.manage`, and the "View catalog" link is gated on `catalogAccess.system.read`.
  - **Dashboard status signals**: the per-system status rows contributed by plugins (`SystemSignalsSlot`) now render as a LINK only when the user can open the target, and as plain text otherwise. `SystemSignal` gains an optional `accessRule`; the healthcheck, anomaly, and dependency fillers set it for their gated targets (check-history / assignments / dependency-map). Signals pointing at ungated pages (incident / maintenance / SLO detail) stay links.
  - **Plugin Manager**: the "Install plugin" button (which opens the install-gated page) is hidden from users with only `plugin` view access.
  - **Satellites**: the page is entirely manage-gated, but its route/sidebar entry was gated on `read`, so read-only users saw the nav item and hit "Access Denied" on click. The route and nav entry now require `satellite.manage`.

  The `@checkstack/ai-backend` bump is only the regenerated bundled docs index
  (the frontend routing guide gained the `nav.isVisible` section); no code change.

  **BREAKING (`@checkstack/frontend-api`):** the `AccessApi` interface gains a
  required `useIsAuthenticated()` method. Custom `AccessApi` implementations must
  add it (it returns `{ loading, isAuthenticated }`). The built-in auth
  implementation and the no-auth fallback already do. `NavEntry` also gains an
  optional `isVisible` predicate (purely additive).

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/ai-common@0.1.3
  - @checkstack/integration-backend@0.4.5
  - @checkstack/sdk@0.100.1

## 0.1.4

### Patch Changes

- b50916d: Fix "Date cannot be represented in JSON Schema" crashing the AI chat. Zod v4's
  `toJSONSchema()` throws on `z.date()` (and even `z.coerce.date()`) by default,
  and the chat hit this in TWO places:

  - **`@checkstack/backend-api`** `toJsonSchema()` (the OpenAPI generator and AI
    tool-introspection / MCP substrate) called it with no options.
  - **`@checkstack/ai-backend`** the agent loop hands the Vercel AI SDK the raw
    Zod tool input, and the SDK runs its OWN `toJSONSchema()` (throwing) to build
    the model-facing tool schema - so a single date field in any tool input
    crashed every chat turn (the whole tool list is projected before the model is
    called).

  Both now render dates as `{ type: "string", format: "date-time" }` (their wire
  shape) and degrade other unrepresentable types to `{}` instead of throwing.

  For the model boundary, a single `dateSafeModelSchema()` helper hands the SDK a
  ready-made date-safe schema plus a validator that COERCES the ISO strings the
  model emits back into real `Date`s before parsing with the original schema
  (refinements and the downstream RPC client, which expects `Date`s, keep
  working). A single `toModelSchema()` entry point applies this at EVERY point a
  schema is handed to the model - chat tool inputs, the headless agent runner's
  tool inputs (the automation "AI Action"), and `generateObject` structured
  output - gated so non-date schemas are untouched, so individual tool / agent
  definitions never special-case dates. Regression tests cover the converter, the
  AI tool serializer, and the model-schema generation + coercion helper, including
  the full inbound round-trip with the exact ISO shape a live model emits
  (`...T22:00:00Z`, no milliseconds).

  **Timezone correctness.** Because the model produces dates as text, the chat now
  enforces an unambiguous wire contract: a date-time tool argument MUST be RFC 3339
  with an explicit timezone offset. Zone-less (`2026-07-01T22:00:00`) and date-only
  (`2026-07-01`) values are rejected with a model-readable error (the model
  self-repairs), instead of being silently interpreted in the pod's local zone -
  which would resolve the same string to different instants across pods. To resolve
  an operator's bare "22:00", the browser's IANA timezone is sent with every chat
  turn and folded into the system prompt, so each operator's times are interpreted
  in their own zone by default. When no browser zone is available (a headless
  automation AI Action), the reference zone falls back to the host/container
  timezone (`TZ`), not UTC. A format-matrix test covers every common shape a model
  might emit. The chat UI shows the operator which timezone is in use, and the
  `TZ` override is documented for operators.

  **Current time in context.** The model has no clock, so the system prompt now
  includes the current instant (UTC plus the reference-zone wall clock), letting it
  resolve relative dates like "today at 10:00" without asking. Applied to both the
  chat and the headless agent runner, computed per turn/run so it is never stale.

  **Less-strict topic classifier.** The chat's off-topic pre-classifier was
  refusing legitimate requests like "create a maintenance" because maintenances
  (and several other domains) were not listed. The classifier now enumerates the
  full domain set and treats any create/list/update/delete action on a platform
  resource as on-topic by default.

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/integration-backend@0.4.4

## 0.1.3

### Patch Changes

- 00b9367: Refresh the bundled docs search index (`ai.searchDocs` / `ai.getDoc`) for the
  updated plugin-authoring documentation: one-off `bunx` examples now pin
  `@latest`, committed `pack` scripts use the installed `checkstack-scripts` bin,
  and a new "Keep the tooling current" section documents Bun's scaffolder cache
  behaviour (latest re-resolved per run within the ~5 min registry-manifest
  window; tarballs content-addressed by version). Cutting this release also
  rebuilds the Docker image, so the bundled in-app docs served at `/checkstack/*`
  pick up the changes.
  - @checkstack/ai-common@0.1.2
  - @checkstack/backend-api@0.21.3
  - @checkstack/common@0.14.1
  - @checkstack/integration-backend@0.4.3
  - @checkstack/sdk@0.98.1

## 0.1.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-common@0.1.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/integration-backend@0.4.2
  - @checkstack/sdk@0.96.1

## 0.1.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/ai-common@0.1.1
  - @checkstack/integration-backend@0.4.1
  - @checkstack/sdk@0.95.1

## 0.1.0

### Minor Changes

- 9dcc848: AI chat UX: ordered turns, readable diffs, persistent errors, auto-titles, decision acknowledgments, and a smarter topical guard.

  - Turns render as ordered parts (text / tool-call status / confirm card) in chronological order, with inline tool-error lines and a mid-turn "Thinking..." indicator, instead of one text blob plus a flat tool list. The confirm card and tool-step parts no longer vanish after a turn finishes (hydration seeds once per conversation id via `useInitOnceForKey`, so background refetches are no-ops).
  - Errors persist: in-stream provider errors are lifted into the chat hook's durable error state and shown in a dismissible banner with selectable text and a Copy button (single-line digest, full text on hover); it clears on send / open / new chat. The backend installs an `onError` handler that logs the provider's full HTTP response and returns a readable message, and normalizes the model message history (drop empty rows, merge consecutive same-role rows, strip a leading non-user row) so a single provider hiccup can no longer brick a conversation.
  - Confirm/applied card diffs render as a GitHub-style split diff (line-number gutters, per-line tint, word-level highlighting, an "Expand" pop-out). `computeFieldDiff` recurses into arrays element-wise so a single changed leaf is pinpointed instead of dumping whole serialized arrays.
  - Conversations auto-title after the first user message (cheap `generateText` reusing the turn's model, fire-and-forget, heuristic fallback). "New chat" opens immediately and reuses an empty untitled draft instead of spawning duplicates; "Delete" is a soft archive (`archived_at` on `ai_conversations`, data retained). A clean model picker always renders a `Select` of `[defaultModel, ...availableModels]` de-duplicated.
  - The assistant acknowledges a confirm-card decision (a new `decision` mode -> `streamDecision`) instead of going silent after an apply/decline; the decision note is derived server-side from the stored proposal and is ephemeral.
  - A cheap topical pre-classifier short-circuits off-topic turns with a canned refusal (fail-open, spend recorded). It marks meta/capability/greeting/how-to questions as ON_TOPIC; only clearly unrelated requests (coding help, creative writing, trivia) are refused.
  - The chat agent no longer emits duplicate proposals for one request: propose/auto-apply results carry an explicit model-facing "stop and wait" note, and a per-turn `<tool>:<argsHash>` dedupe short-circuits repeated identical mutating calls.
  - Assistant messages render through the shared `<MarkdownBlock>`: it now parses a SAFE subset of raw HTML (`rehype-raw` + `rehype-sanitize`) so native `<details>`/`<summary>` widgets render, and enables `remark-gfm` so GFM tables, strikethrough, and autolinks render (the assistant often summarizes drafts as tables).

  State and scale: the archive marker, titles, and permission mode all live in the shared `ai_conversations` table, read identically on every pod; the classifier holds no state and its spend is recorded in the shared `ai_spend` ledger. No new pod-local state.

  This is a beta minor.

- 9dcc848: Add the AI platform: a transport-agnostic tool spine, an OAuth Authorization Server + read-only MCP server, a propose/apply flow with audit log, a streaming in-app chat agent, per-conversation permission modes, per-integration spend caps, and user-scoped tool authorization.

  Two new packages, `@checkstack/ai-common` (the `AiTool` contract, `read`/`mutate`/`destructive` effect classification, the `ai.*` access rules, the OpenAI-compatible connection shape, and the wire contracts) and `@checkstack/ai-backend` (the tool registry, extension points, principal-to-tool resolver, shared zod-to-JSON-Schema serializer, and all transports). The OpenAI-compatible integration provider registers through the existing integration provider extension point, so its API key is stored in the Secrets Vault and configured in the generic Connections UI.

  What ships:

  - Tool spine and extension points: `aiToolExtensionPoint.registerTool` (hand-authored composite tools) and `aiToolProjectionExtensionPoint.expose` (opt-in projections of existing oRPC procedures). Authorization mirrors `autoAuthMiddleware` exactly - a tool is surfaced only when every `requiredAccessRules` entry is satisfied, so a scope-narrowed principal can only ever see fewer tools.
  - OAuth + MCP: Checkstack can act as its own OAuth 2.1 Authorization Server (authorization code + PKCE, consent screen, Dynamic Client Registration) and expose a read-only MCP server over Streamable HTTP at `/api/ai/mcp`. Off by default, enabled by the admin `ai.mcp-oauth` setting. A Bearer OAuth-token branch is added to the auth strategy; token scopes are intersected live with the bound user's access rules on every call. A shared-Postgres rate limiter throttles the DCR endpoint per client IP. `getMcpOAuthSettings` / `setMcpOAuthSettings` contracts added to `@checkstack/auth-common`. A minimal OAuth consent page (`/auth/oauth-consent`) renders the requesting client and scopes.
  - Propose/apply + audit: a transport-agnostic two-step service - `propose` re-checks authz, runs the tool's `dryRun` without mutating, and returns a single-use proposal token (the `proposed` audit row IS the token store, 10-minute TTL, atomic single-use); `apply` re-parses the server-stored payload, re-checks authz, and atomically commits. The `ai_tool_calls` audit table records every call across both transports with a SHA-256 args hash (never raw arguments) and stamps who proposed and who applied. An `ai.toolCalled` event carries metadata only.
  - In-app chat: a server-side, provider-agnostic Vercel AI SDK agent loop (OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio, ...). The model provider is built on the backend from the integration credentials, so the API key never leaves the backend. The loop offers only resolver-allowed tools, auto-runs read tools (re-entering the live router as the logged-in user) and routes mutating / destructive tools through propose/apply. Durable conversation persistence (`ai_conversations`, `ai_messages`, owner-scoped RPCs) plus a streaming chat UI with a confirm-card component and per-integration model picker.
  - Per-conversation permission mode (Claude-Code-style approve/auto), a durable `permission_mode` column on `ai_conversations` (default `approve`). `read` always auto-runs in both modes; `mutate` inherits the mode (auto-applies server-side in `auto`, confirm-carded in `approve`); `destructive` ALWAYS requires the human `applyTool` in both modes. Security invariant (structural + tested): the mode is consulted only on the `mutate` branch, so no `(effect, mode)` pair routes a destructive tool to auto-apply.
  - Per-integration LLM spend cap (optional `spendCap` = `tokenBudget` + `windowMinutes`, default OFF). Spend is tracked in a shared-Postgres `ai_spend` ledger; enforcement is a rolling-window SUM run before each turn (HTTP 429 over budget). Per-principal tool rate-limit budgets are a rolling COUNT over `ai_tool_calls`, enforced on both transports. An absent / empty / incomplete `spendCap` is treated as "no cap" rather than rejected.
  - Full tool-call replay: `ai_messages.model_messages` (jsonb) persists the canonical AI-SDK `ResponseMessage[]` per turn and replays them verbatim on the next turn; legacy rows fall back to text-only replay.
  - Enforced no-secret-leak scrubbing: `appendMessage` runs `scrubContent` on every write, redacting credential-shaped keys and high-confidence credential values; a canary regression test asserts injected secrets are stripped. A hardening test suite asserts no secret appears in any AI-surface DTO and that handler-side authz holds when the model misbehaves.
  - Provider correctness: the chat provider uses `@ai-sdk/openai-compatible`'s `chatModel` (plain `/chat/completions`), so OpenAI-compatible gateways (OpenRouter, DeepSeek, Ollama, vLLM) no longer reject turns with `invalid_prompt`; `@ai-sdk/openai` is removed.

  BREAKING CHANGES:

  - The `AiTool` contract (`@checkstack/ai-common`) gained a `TRpc` type parameter, and both `dryRun` and `execute` now receive a USER-SCOPED `rpcClient` arg bound to the originating user. Every plugin procedure a tool calls re-enters the live router AS THAT USER, so handler-side authorization (access rules AND per-resource/team scope) is enforced exactly as a direct UI/RPC call - closing a prior privilege-escalation where tools captured a trusted service client at construction. A hand-authored tool MUST resolve its plugin client from this per-call arg and MUST NOT capture a trusted service client at factory scope. Tool factories that previously took `{ rpcClient }` should drop that parameter.
  - `AiToolProjectionExtensionPoint.expose` no longer takes a second `pluginMetadata` argument; the owning metadata lives on `input.sourcePluginMetadata`. Callers must drop the second argument.

  State and scale: conversations, messages, the audit log, proposal tokens, the rate-limit counter, and the spend ledger all live in shared Postgres, so every pod answers identically and the agent loop is resumable on any pod. The only pod-local state is the live MCP connection registry (bookkeeping, never a source of truth). Cross-pod conversation readback, the spend cap, and the tool budget are verified by env-gated two-pod integration tests.

  This is a beta minor.

- 9dcc848: Plugin-owned AI tools: every domain plugin contributes its own AI tools (chat assistant + automation AI action), and `ai-backend` is platform-only.

  Every plugin-specific AI tool is owned by the plugin whose domain it acts on, registered via that plugin's own `aiToolExtensionPoint` / `aiToolProjectionExtensionPoint` from its init - the same path an external plugin author uses. `ai-backend` no longer imports or depends on any capability plugin's `*-common`; the dependency direction is strictly plugin -> ai-platform. Pure helpers (`computeFieldDiff`, capability-summary, `ScriptContextKind`) live in `@checkstack/ai-common`.

  Tools shipped:

  - Health checks and automations: full CRUD - `healthcheck.propose` / `automation.propose` and `*.update` (`mutate`, deep-validated) and `*.delete` (`destructive`, always confirm-gated). `healthcheck.propose`'s dry-run calls the new deep `validateConfiguration` so propose-time validation matches apply-time. Assertions are validated against the collector's result schema and the canonical operator vocabulary. Capability-catalog tools (`ai.listCapabilities`, `ai.getCapabilitySchema`), script context tools (`ai.getScriptContext`, `ai.testScript`), and notify-subscriber tools (`healthcheck.notifySystemSubscribers` / `...GroupSubscribers`).
  - Catalog: `catalog.createSystem` / `updateSystem` / `createGroup` / `updateGroup` (`mutate`), `catalog.deleteSystem` / `deleteGroup` (`destructive`), membership tools (`mutate`), plus `catalog.listSystems` / `listGroups` read projections.
  - Incident: `incident.create` / `update` / `addUpdate` / `resolve` / `addLink` (`mutate`), `incident.delete` / `removeLink` (`destructive`), and `incident.get` / `incident.list` read projections.
  - Maintenance: `maintenance.create` / `update` / `addUpdate` / `close` / `addLink` (`mutate`), `maintenance.delete` / `removeLink` (`destructive`), and `maintenance.list` / `get` read projections.
  - Read projections for SLO (`slo.listObjectives`), dependency (`dependency.list`), incident (`incident.list`), healthcheck (`healthcheck.status`), and anomaly (`anomaly.explain`), each gated by the source procedure's own access rule and routed as the principal.
  - Documentation grounding: `ai.searchDocs` / `ai.getDoc` over a build-time bundled docs index (BM25-ish ranking), so the assistant grounds how-to answers in Checkstack's own docs offline.
  - URL introspection: `ai.probeUrl`, an SSRF-guarded read tool the assistant uses to inspect a real endpoint before drafting a health check. Update tools compute a before -> after field diff rendered on the confirm card (approve mode) or an "Applied" card (auto mode), so a change is never silent.

  `ai_analyze` automation action (automation-backend, with an editor connection picker + audited tool calls): runs a bounded AI agent on the run context as the automation's `runAs` service account, so it can never exceed that identity's permissions; destructive tools are never offered; mutating tools auto-apply through the service account's client. Produces an `automation.analysis` artifact downstream actions can branch on. The agent loop is exposed as a headless `aiAgentRunnerRef` service so automation-backend can drive it without depending on ai-backend.

  `notification.notifyForSubscription` is now callable by user / application principals holding `notification.send` (previously service-only). Every tool routes through the user-scoped client, so handler-side authorization is enforced exactly as a direct UI/RPC action; the resolver gate plus the propose/apply re-check at propose AND apply are the additional authority. A systemic authz regression test asserts every registered tool falls into exactly one safe authorization category.

  A new `ai_transport` enum value `automation` records the AI action's tool calls in the `ai_tool_calls` audit log. No new durable state beyond that; each tool is a thin, deterministic wrapper over an existing RPC, so every pod behaves identically.

  This is a beta minor.

- 9dcc848: Add a deep `validateConfiguration` RPC to the health-check plugin so propose-time validation matches apply-time validation.

  - `validateConfiguration` (`@checkstack/healthcheck-common`): a new mutation procedure gated by `healthcheck.healthcheck.manage`, taking a proposed configuration (reusing the create skeleton) and returning `{ valid, errors: [{ path, message }] }`, mirroring automation's `validateDefinition`. It persists nothing.
  - Shared deep validation (`@checkstack/healthcheck-backend`): `collectConfigurationIssues` resolves strategy + collectors by fully-qualified id then migrate-then-validate-strict each config via `parseStrictAssumingV1`. The GitOps reconcile path is refactored to call the same `validateVersionedConfigStrict`, so create / gitops-apply / the new RPC share one implementation.
  - `healthcheck.propose`'s dry-run (`@checkstack/ai-backend`) now calls `validateConfiguration` as its validation authority, so a wrong config type or a typo'd key surfaces at propose time, bringing it to the same deep-validate level `automation.propose` already has.

  State and scale: no durable state; `validateConfiguration` is a pure read against the in-process registries plus zod validation, identical on every pod.

  This is a beta minor.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ai-common@0.1.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/integration-backend@0.4.0
  - @checkstack/common@0.13.0
  - @checkstack/sdk@0.93.1
