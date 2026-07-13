# @checkstack/incident-backend

## 1.13.2

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d9f2771]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/ai-backend@0.11.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/backend-api@0.33.0
  - @checkstack/catalog-backend@1.9.0
  - @checkstack/automation-backend@0.11.4
  - @checkstack/ai-common@0.6.6
  - @checkstack/auth-common@0.14.0
  - @checkstack/automation-common@0.10.1
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/incident-common@1.10.3
  - @checkstack/integration-backend@0.7.7
  - @checkstack/integration-common@0.9.9
  - @checkstack/notification-common@1.7.1
  - @checkstack/status-page-backend@0.6.2
  - @checkstack/status-page-common@0.6.3

## 1.13.1

### Patch Changes

- Updated dependencies [1f20b5a]
- Updated dependencies [5e704cd]
  - @checkstack/ai-backend@0.10.12
  - @checkstack/automation-backend@0.11.3
  - @checkstack/catalog-backend@1.8.1
  - @checkstack/catalog-common@2.7.2
  - @checkstack/incident-common@1.10.2
  - @checkstack/status-page-common@0.6.2
  - @checkstack/backend-api@0.32.1
  - @checkstack/status-page-backend@0.6.1
  - @checkstack/command-backend@0.2.24
  - @checkstack/integration-backend@0.7.6

## 1.13.0

### Minor Changes

- bd41130: perf(incident): add indexes for reverse system lookup and update status derivation

  Add two Postgres indexes to speed up hot read paths:

  - `incident_systems_system_idx` on `incident_systems (system_id)` - the junction
    primary key leads with `incident_id`, leaving the `system_id` direction
    unindexed. This index serves the reverse lookup used by
    `getIncidentsForSystem` / `getActiveHealthOverrides`, which fans out per
    system on every status-page render.
  - `incident_updates_incident_created_idx` on
    `incident_updates (incident_id, created_at)` - serves the status-derivation
    query (`WHERE incident_id, status_change IS NOT NULL ORDER BY created_at DESC
LIMIT 1`) and the bulk timeline fetch.

- bd41130: fix(status-page): scope email subscriptions to published environments and author-selected systems

  Two correctness fixes to status-page email subscriptions:

  - **Health notifications now respect the page's published environments.** A
    per-environment health transition carries the environment it happened in
    (`originEnvironmentId`, threaded through `notifyForSubscription` ->
    `NotificationAudienceEvent` -> the status-page fan-out). A page that publishes
    a specific environment set is now skipped for a change in an environment it
    does not publish - so a `development` failure never emails a prod-only page's
    subscribers, even for a system that is also shown in prod. Pages publishing all
    environments, and env-less sources (incident, maintenance, whole-system health
    rollup), are unaffected.
  - **Notifications are scoped per category to the widgets the author placed.** The
    send-time fan-out now surfaces a notification only through widgets of its own
    category: a health status change reaches a page only through a HEALTH widget
    (`banner` / `systemHealth` / `groupStatus` / `uptime`, which now implement
    `resolveScopedSystems` and declare `subscriptionCategory: "health"`), an
    incident only through an incident widget, and so on. A page that lists a
    system's incidents but never its health no longer emails health subscribers
    about it, and a health-only page now correctly surfaces its systems for
    subscription. Health widgets also participate in the public subscribe picker.

  BREAKING CHANGE: on a page publishing a specific environment set, health
  subscribers now only receive changes that occurred in a published environment
  (previously any environment of a surfaced system triggered a notification), and a
  notification is surfaced only by a widget of its own category (previously any
  scoping widget on the page could surface any category). Legacy subscribers (NULL
  categories) and all-environment pages are unchanged; no data migration is needed.

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/auth-common@0.14.0
  - @checkstack/cache-utils@0.3.0
  - @checkstack/catalog-backend@1.8.0
  - @checkstack/ai-backend@0.10.11
  - @checkstack/notification-common@1.7.0
  - @checkstack/status-page-backend@0.6.0
  - @checkstack/automation-backend@0.11.2
  - @checkstack/command-backend@0.2.23
  - @checkstack/integration-backend@0.7.5
  - @checkstack/catalog-common@2.7.1
  - @checkstack/incident-common@1.10.1
  - @checkstack/status-page-common@0.6.1

## 1.12.0

### Minor Changes

- 43e4484: Incidents and maintenance: richer, safer update timelines.

  - **Markdown updates and descriptions.** Update messages and descriptions now
    render sanitized Markdown (bold, links, lists) everywhere they appear -
    detail pages, editors, the shared status-update timeline, and the public
    status page (which stays sanitized via `rehype-sanitize`). An "Markdown
    supported" hint is shown under the update composer.
  - **Edit and delete published updates.** New `editUpdate` / `deleteUpdate`
    procedures let a manager correct or remove an update in place; edited updates
    are marked "edited". Editing the `statusChange` of the latest update
    re-derives the incident/maintenance status. Deletion is irreversible and, on
    the AI path, always routes through propose/apply. Both procedures are
    object-scoped on the owning incident/maintenance (`idParam`), so team-scoped
    managers can use them without a global rule.
  - **Edit the published time of an update.** `editUpdate` now accepts an optional
    `createdAt`, and the update editor exposes a date/time picker (the same
    `DateTimePicker` used for maintenance windows) when editing an existing update.
    Re-timing an update re-orders the timeline and re-derives the incident/
    maintenance status (the header still follows the latest status-bearing
    update), so moving an update never leaves the header and timeline diverged.
  - **Per-update edit history (GitHub-style "history of edits").** Each in-place
    edit now archives the prior version of the update into a new durable
    `edit_history` `jsonb` column (a snapshot of message, status, visibility, and
    the published time it carried, plus when it was superseded). The shared status
    timeline turns the "edited" marker into an "edited (N)" disclosure that
    expands to show those prior versions. History is **manager-facing only**: the
    read path attaches `editHistory` solely for the manager audience and strips it
    for public / logged-in readers, so a version that was `internal` before being
    made `public` can never leak its prior internal content. A no-op edit
    (nothing actually changed) neither archives a snapshot nor marks the update
    "edited". Adds a forward-only, additive migration to each backend
    (`edit_history jsonb NOT NULL DEFAULT '[]'`, backfilling existing rows).
    We framed this as "either a delayed publish with undo OR a history of
    edits"; edit history satisfies the ask, so undo-send / delayed-publish is
    intentionally **deferred** (it would need a queue-delay + pending state and is
    redundant with history).
  - **Status updates are now editable from the editor dialog too, via one shared
    implementation.** The status-updates surface (add / edit / delete an update,
    including its published time and edit history) is extracted into a single
    `IncidentUpdatesSection` / `MaintenanceUpdatesSection` used by BOTH the detail
    page and the create/edit editor dialog, so the two surfaces can no longer
    drift. Previously the editor dialog showed a read-only timeline with no way to
    edit an existing update.
  - **Editable hotlinks.** Added-links can now be edited in place (label, URL, and
    visibility where applicable) instead of only added/removed. The shared
    `LinksEditor` gains an inline edit affordance, backed by a new `updateLink`
    procedure on incidents and maintenances and `updateSystemLink` on catalog
    systems (so system links are editable too). Each is object-scoped on its
    parent (`incidentId` / `maintenanceId` / `systemId`) with the same anti-spoof
    WHERE-clause scoping as the remove path, so a link id cannot be paired with a
    foreign parent the caller happens to manage. No migration is needed (the
    columns already exist).
  - **Per-update / per-link visibility.** A new shared visibility level
    (`public` / `logged_in` / `internal`) can be set on both updates and hotlinks
    via the same three-way visibility select in the editor (the update composer
    previously exposed only a binary public/internal toggle, so `logged_in` was
    unreachable for updates even though the backend already accepted and filtered
    it). Filtering is enforced SERVER-SIDE on every read path: anonymous callers
    and the public status-page projection see only `public`; authenticated
    non-managers additionally see `logged_in`; managers see everything. Updates
    still default to `public`, and `internal` updates never broadcast a
    notification. Adds a forward-only migration to each backend (new visibility
    enum + column, plus a nullable `edited_at` on updates).
  - **"Keep Current" shows the current status**, e.g. "Keep Current
    (Investigating)".
  - **Status colors.** Adds a blue `--status-info` token and a shared
    `StatusPillTone` / `pillToneStyles` in `@checkstack/ui`; incident "monitoring"
    and maintenance "scheduled" now read as informational (blue) instead of grey.
    The incident severity ramp is now blue(minor) -> amber(major) -> red(critical):
    a minor incident uses the blue `info` hue instead of grey, with no minor/major
    amber collision. This corrected ramp now also applies on the public status
    page (active-incident cards, severity pills, and the incident detail page) and
    in the system-detail active-incidents panel, which both previously still
    rendered `minor` grey.
  - **Logged-out overview.** Incidents and maintenance now expose a public,
    read-gated overview page and sidebar entry (the manage-gated config page is
    renamed "Manage ..."), so anonymous visitors who hold the default read rule
    can browse them.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- 43e4484: Include the latest incident and maintenance update text in subscriber
  notifications. The update message is now escaped, single-lined, truncated, and
  appended to the notification body as a blockquote, so subscribers see WHAT
  changed rather than a generic "has been updated"/"has been scheduled".
  Message-only updates (no status change) now notify too, and an incident's
  initial message is carried into its "reported" notification. Maintenance now has
  full parity with incidents: its update text reaches subscribers, internal-only
  operator notes never notify or leak text, and a completion note is carried into
  the "completed" notification.

  The escaping/truncation helper (`sanitizeUpdateMessage` /
  `buildUpdateMessageSuffix`) now lives in `@checkstack/notification-common` so
  both domain backends share one implementation.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- 43e4484: Count incident-forced downtime against SLOs. When an incident forces a system to
  degraded/unhealthy via its health override, that downtime is now recorded as an
  SLO downtime event for each of the system's objectives (consuming the error
  budget and appearing in the downtime history) and is closed when the incident is
  resolved, deleted, or its override is cleared - and only once the system's health
  checks are also healthy. Downtime is never double-counted with a concurrent
  health-check outage, and one cause never closes downtime the other is still
  holding open (resolving an incident while checks still fail, or checks recovering
  while an override is still active, both leave the outage open).

  Adds a nullable `source` column (`healthcheck` | `incident`, NULL read as
  `healthcheck`) to `slo_downtime_events` and a `DowntimeSource` schema in
  slo-common, so the cause of each downtime event is recorded and the orphan
  self-heal skips incident-owned events. incident-backend now emits an
  `incident.lifecycle.changed` hook (contract in incident-common) on every incident
  lifecycle change - including override-only edits that the reactive `incident`
  entity change does not surface - which slo-backend subscribes to with
  exactly-once delivery to reconcile downtime.

- 43e4484: Status pages can now publish only a subset of catalog environments. The page
  builder gains a "Published environments" picker (empty = all environments, the
  backward-compatible default). When a non-empty set is selected, the page omits
  status, incidents, maintenances and uptime for systems that belong to none of
  the selected environments.

  - Status pages store an optional `publishedEnvironmentIds` set (new nullable
    `published_environment_ids` column; NULL = all environments, so existing pages
    are unchanged) exposed on `StatusPage`, `createStatusPage`, and
    `updateStatusPage`.
  - The scope is threaded onto `WidgetResolveContext.publishedEnvironmentIds` as
    opaque strings and passed identically to `resolvePublic`,
    `resolveScopedSystems`, and `resolveScopedSystemsDetailed` (and the email
    subscribe clamp + fan-out), so what a page shows, offers for subscription, and
    emails about all agree.
  - Health widgets recompute per environment: they read the per-environment health
    matrix and roll up only the selected environments. `getBulkRunStats` and
    `getRunStats` gain an optional `environmentIds` filter so uptime counts only
    runs recorded in the selected environments.
  - Incident and maintenance widgets filter their feed and scope by intersecting
    each item's affected systems with the environment-visible systems. Incidents
    and maintenance windows carry no environment of their own, so a system in
    several environments makes its items visible on a page publishing ANY of them
    (the multi-environment caveat).

### Patch Changes

- 43e4484: Batch hot-path scoped-db reads/writes into single transactions to cut per-query round-trips.

  The scoped-db proxy wraps every standalone query in its own `BEGIN → SET LOCAL search_path → query → COMMIT`, so a path issuing N sequential queries paid N round-trips and checked out a connection N times. These reads/writes now run under one `withScopedTransaction`, collapsing the batch to a single `SET LOCAL` on one connection. Behavior is unchanged:

  - healthcheck: `getSystemHealthOverview`'s `1 + N·(2+E)` read fan-out.
  - incident/maintenance: `getIncident`/`getMaintenance` (4 reads), `getManyEntityStates`, `listOpenIncidentsBySystem` / `getActiveMaintenancesBySystem`, `getMaintenanceWindowsForRange`; the `list*` / `*ForSystem` per-row `N+1` system lookups collapsed to a single set-based `inArray` read; maintenance `transitionStatus` update+insert made atomic; `addUpdate`/`editUpdate`/`addLink` use `.returning()` instead of a follow-up re-select.
  - ai: `appendMessage`, memory `saveOrUpdate`.
  - notification: `resolveInheritedGroups`.
  - status-page: subscriber `verify` (4 reads) and `unsubscribe` (3 reads).
  - announcement: `getActiveAnnouncements` / `dismissAnnouncement` / `createAnnouncement`.
  - gitops: `upsertProvenance`.

- 43e4484: Eliminate N+1 RPC fan-outs in the public status-page widget resolvers.

  Each of these widgets renders a PUBLIC page, so every per-item RPC was real
  external DB load. Three bulk-by-id endpoints replace the per-item fetches:

  - `healthcheck-common`: new `getBulkRunStats({ systemIds, startDate, endDate,
maxBuckets })` -> `{ stats: Record<systemId, RunStats> }`. The `systemHealth`
    widget's uptime column now issues ONE request for all systems instead of one
    `getRunStats` per system. Systems with no runs in the window are omitted, so
    the resolver's output is unchanged.
  - `incident-common`: new `getBulkIncidentUpdates({ incidentIds })` ->
    `{ updates: Record<incidentId, IncidentUpdate[]> }`. The incidents widget now
    fetches every selected incident's update timeline in ONE request instead of
    one `getIncident` per incident.
  - `maintenance-common`: new `getBulkMaintenanceUpdates({ maintenanceIds })` ->
    `{ updates: Record<maintenanceId, MaintenanceUpdate[]> }` (symmetric with the
    incident endpoint) for the maintenance widget.

  The new update endpoints apply the same per-item audience filter as
  `getIncident` / `getMaintenance`, so internal/logged-in updates and author
  identity never leak to a non-manager caller. Each endpoint is keyed by the
  resource id and gated with the record post-filter (`recordKey`) matching the
  single endpoint's read scope, mirroring `getBulkSystemHealthStatus` /
  `getBulkIncidentsForSystems`. Widget DTO output is unchanged - this is a pure
  request-count optimization.

- 43e4484: Status page enhancements:

  - Group-status widget can collapse its member rows while every member is
    operational (auto-expanding on any issue or maintenance).
  - New "Announcements" status-page widget, contributed fully externally by the
    announcement plugin: it surfaces active `visibility: "all"` announcements
    through a public-safe DTO (title/message/severity/timestamps only) and never
    affects the page status rollup.
  - Incident and maintenance widgets can scope by catalog GROUPS with per-system
    exceptions. Scope is resolved at read time (`(systemIds ∪ members(groupIds)) −
excludedSystemIds`), so members added to a group later are reflected
    automatically. The builder gets a nested group/system picker.
  - Incident and maintenance items on a public page link to dedicated public
    detail pages, gated server-side to items the page's published widgets actually
    surface (no enumeration, no internal-field leak). The custom-domain public
    bundle gains a minimal in-memory router for the two detail pages.
  - Fix the custom-domain "Cannot connect to Checkstack backend" screen: a
    configured-but-not-servable custom domain now serves the lean public
    "not available" page instead of the admin shell; the public bundle skips the
    cross-origin `/api/config` probe; CORS admits resolved custom domains; the
    request origin is normalized for proxy scheme/port variance; and re-saving an
    unchanged custom domain no longer clears its verification.
  - Anonymous email subscriptions (double opt-in) for incident updates, opt-in per
    status page (`emailSubscriptionsEnabled`, default off): a new
    `status_page_subscribers` table, public subscribe/verify/unsubscribe
    procedures with constant-time responses that fail closed when the page has not
    enabled subscriptions, and team-scoped admin list/remove + an enable toggle in
    the builder. Emails are delivered through a new `sendRawEmail` primitive in
    notification-backend that sends to an arbitrary external address (no auth
    account) via every enabled email strategy (SMTP), with a mandatory unsubscribe
    link.
  - Incident/maintenance update fan-out to subscribers via a new
    `notificationAudienceExtensionPoint` in notification-backend. Every
    notification funnelled through `notifyForSubscription` (incident, maintenance,
    health - all unchanged) now also invokes each registered audience sink exactly
    once, enriched with the affected systems and their catalog groups (resolved
    from notification-backend's own resource-parent graph, never a domain import).
    status-page-backend contributes a sink that, AT SEND TIME, matches each
    notification's affected systems against the systems each published + public +
    email-enabled page currently surfaces in its incident/maintenance widgets
    (honoring group membership and per-system exclusions) and emails that page's
    verified subscribers. Send-time scoping against the live layout is the privacy
    boundary: a page only ever emails about systems its widgets surface right now.
    Because `notifyForSubscription` is a single-pod point RPC, each notification
    fans out exactly once cluster-wide.
  - Subscriber reconcile on page deletion: the subscriber FK is `ON DELETE
CASCADE` and page deletion also explicitly purges subscribers (invalidating
    pending verify/unsubscribe tokens) - no orphan rows, no post-deletion send.
    Removing all systems from a page or disabling email is intentionally NOT a
    prune: send-time scoping plus the email-enabled gate make those subscribers
    dormant with no data loss, and re-enabling restores the audience without a
    re-subscribe.
  - Send-time scoping is single-source: the fan-out asks each event-feed widget for
    its CURRENT effective system scope (the same live catalog group expansion the
    widget renders from) instead of a parallel copy of group membership, so it can
    never over- or under-deliver relative to what the page shows.
  - `sendRawEmail` in notification-backend is now `userType: "service"` (was an
    authenticated procedure gated on `notification.send`). Sending to an arbitrary
    address is an open-relay / email-bomb primitive, so it is callable only by a
    trusted backend-to-backend caller (the status-page subscriber mailer), never by
    an end user.
  - Incident/maintenance widgets gain an optional per-system PUBLIC label override
    (`systemLabels`), the same override path the system-health widget uses, so the
    public incident/maintenance detail pages present clean labels instead of raw
    catalog names.
  - The anonymous subscribe endpoint adds a coarse per-page quota (max new
    subscribers per rolling hour, counted over durable rows so it holds across
    pods) on top of the per-(page,email) cooldown, capping verification-email
    amplification. The quota is CONFIGURABLE per status page (new nullable
    `email_subscribers_hourly_quota` column; null uses the default of 50, so
    existing pages are unchanged), validated as a positive integer up to 5000,
    editable in the builder next to the email opt-in toggle and gated by the same
    page-manage capability.
  - Email verification is now per-page configurable and backed by a platform-global
    once-per-address registry:
    - New `email_verification_required` column (boolean, default true) on
      `status_pages`, exposed on the admin StatusPage DTO + `updateStatusPage`
      input (same page-manage gate) with a builder toggle. When OFF, a new
      subscriber is created active immediately - no verification email, and the
      address is NOT written to the global registry (the operator's trust choice
      for e.g. an internal page).
    - New `status_page_verified_emails` table: one row per normalized address that
      has completed verification on ANY page. When a verification-required page is
      subscribed by an already-globally-verified address, the row is created active
      immediately and a COURTESY email (with one-click unsubscribe) is sent instead
      of a verification email, so a malicious add is always caught. `verify` upserts
      the address into this registry and activates every other pending row for the
      same address in one update (confirm once, all pages).
    - Fan-out is unchanged: it still gates on the per-row `verified` flag; the
      registry only governs whether a NEW subscribe short-circuits to active.

  BREAKING CHANGE: `sendRawEmail` is now service-only. Any (non-existent in-tree)
  authenticated caller must invoke it through a trusted service client instead.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ai-backend@0.10.10
  - @checkstack/automation-backend@0.11.1
  - @checkstack/catalog-common@2.7.0
  - @checkstack/catalog-backend@1.7.0
  - @checkstack/backend-api@0.31.1
  - @checkstack/incident-common@1.10.0
  - @checkstack/notification-common@1.6.0
  - @checkstack/status-page-backend@0.5.0
  - @checkstack/status-page-common@0.6.0
  - @checkstack/command-backend@0.2.22
  - @checkstack/integration-backend@0.7.4

## 1.11.0

### Minor Changes

- f93ee7a: Fix a class of 403s where team-scoped managers were blocked from endpoints they
  needed. A repo-wide audit of every `instanceAccess: { global: true }` procedure
  found more instances of the same bug behind the health-check editor fix: an
  endpoint on a team-scopable resource type, gated so only the GLOBAL access rule
  (never a team grant) authorizes it.

  Automation: the editor utilities and catalogs (`validateDefinition`,
  `listTriggers`, `listActions`, `listArtifactTypes`, `listAutomationGroups`,
  `listAutomationTemplates`, `renderTemplate`, `testScript`) now use `typeScoped`
  so a team-scoped automation manager can author without the global rule. The run
  endpoints (`listRuns`, `getRun`, `cancelRun`, `getRunScopeForReplay`) are scoped
  to their parent automation via `parentScope` on `automationId`; `getRun`,
  `cancelRun`, and `getRunScopeForReplay` now take the owning `automationId`
  (always available in the run URL/editor) and the handler filters the run fetch by
  it, so a run id cannot be paired with a foreign automation the caller happens to
  hold a grant on. The two migration-admin endpoints stay `global: true` (genuine
  platform-admin actions).

  Health check: `validateConfiguration` (editor deep-validate) and
  `getPlatformNotificationDefaults` (fetched on every assignment-editor mount) move
  to `typeScoped`. The paired WRITE `setPlatformNotificationDefaults` stays
  `global: true` on purpose - it rewrites instance-wide defaults for every team, so
  a single team grant must not authorize it. Because that write stays global-only,
  the assignment editor's "Notification defaults" button is now gated on the global
  `configuration.manage` rule (`healthcheck-frontend`), so a team-scoped manager no
  longer sees an editor whose Save always 403'd.

  Anomaly: the anomaly settings panels embedded in the health-check editor
  (`updateAnomalyConfig` / `getAnomalyConfig` and `updateAnomalyAssignmentConfig` /
  `getAnomalyAssignmentConfig`) were authorized against the non-team-scopable
  `anomaly_feed` type (via `global: true` or an `idParam` that could never match a
  team grant), so a team-scoped manager who owns the check/system saw "Save
  Defaults" / "Save Exceptions" buttons whose Save always 403'd. They now
  `parentScope` on the owning health-check configuration (`healthcheck.healthcheck`)
  and catalog system (`catalog.system`) respectively, so managing the check/system
  authorizes reading and editing its anomaly settings. The frontend needed no
  change: those buttons were already disabled for non-managers, and the panels are
  only reachable inside the manager-gated editor. Also, the automation "New
  automation" template picker (`automation-frontend`) gated its page on the bare
  global manage rule; it now uses the create capability, so a team-scoped creator
  (whom the route already reveals the page to) is no longer shown a blocked page.

  Incident & maintenance: `removeLink` was `global: true` because its input carried
  only the link id. It now takes the owning `incidentId` / `maintenanceId`
  (mirroring `addLink`), authorizes per-instance via `idParam`, and the service
  scopes the delete by that parent id so a link cannot be removed by pairing its id
  with a different incident/maintenance the caller manages. The AI `removeLink`
  tools carry the parent id too.

  BREAKING CHANGES: `automation.getRun`, `automation.cancelRun`,
  `automation.getRunScopeForReplay`, `incident.removeLink`, and
  `maintenance.removeLink` now require a parent id (`automationId` /
  `incidentId` / `maintenanceId`) in their input. Endpoints previously gated by a
  global rule alone now also accept the owning team's grant; no endpoint became
  more permissive for a user who lacks both the global rule and a relevant team
  grant.

  Not team-scopable, so intentionally left `global: true` (verified by the audit):
  catalog environments, anomaly config, SLO list/streak/milestone reads and
  health-check history/stats (their read rules are public/default), and every
  hand-rolled HTTP route (global admin/infra or already team-aware).

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/catalog-common@2.6.3
  - @checkstack/ai-backend@0.10.9
  - @checkstack/backend-api@0.31.0
  - @checkstack/automation-common@0.10.0
  - @checkstack/automation-backend@0.11.0
  - @checkstack/incident-common@1.9.0
  - @checkstack/auth-common@0.13.0
  - @checkstack/ai-common@0.6.6
  - @checkstack/cache-api@0.3.19
  - @checkstack/catalog-backend@1.6.9
  - @checkstack/command-backend@0.2.21
  - @checkstack/integration-backend@0.7.3
  - @checkstack/integration-common@0.9.8
  - @checkstack/notification-common@1.5.3
  - @checkstack/signal-common@0.2.17
  - @checkstack/status-page-backend@0.4.8
  - @checkstack/status-page-common@0.5.3
  - @checkstack/cache-utils@0.2.24

## 1.10.0

### Minor Changes

- 9d30324: Incidents can now optionally override the health status of their affected
  systems. When creating or editing an incident you can pick "Override system
  health" (Degraded or Unhealthy); while the incident is active (not resolved)
  that status is folded into every affected system's derived health via
  worst-wins, so it shows on every health surface (status pages, dashboards,
  dependency map, catalog badges). A health check reporting a worse status still
  wins, and the override lifts automatically when the incident resolves. This
  covers components that no automated check can monitor (e.g. a running app whose
  licenses were revoked so it won't open).

  The override is a deliberate operator choice, independent of the incident's
  severity. A new service-typed incident RPC `getActiveHealthOverrides` exposes
  active overrides per system, which `@checkstack/healthcheck-backend` reads and
  folds into `getSystemHealthStatus`. The system-health response gains an optional
  `override` field naming the contributing incident so UIs can explain why a
  system reads unhealthy when its checks look fine. The system health badge uses
  it to show, on hover, when a status was forced by an incident.

  The dashboard "problem system" signal attributes an override-forced status to
  the incident ("Forced by incident: <title>") instead of misreporting
  "0 of N checks failing", while a genuinely worse health check still drives the
  signal and its detail. Public status pages reflect the forced status but never
  carry the incident title (the widget DTOs project only the status), so an
  override cannot leak the name of a hidden incident.

  Behavior change: a system's derived health now reflects active incident
  overrides in addition to its health checks. Adds a forward-only migration for
  the new nullable `incidents.health_override` column.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
  that shaped this release.

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
  - @checkstack/ai-backend@0.10.8
  - @checkstack/backend-api@0.30.0
  - @checkstack/incident-common@1.8.0
  - @checkstack/automation-backend@0.10.10
  - @checkstack/catalog-backend@1.6.8
  - @checkstack/command-backend@0.2.20
  - @checkstack/integration-backend@0.7.2
  - @checkstack/status-page-backend@0.4.7

## 1.9.5

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [a83bcc2]
- Updated dependencies [c55d7c6]
  - @checkstack/ai-backend@0.10.7
  - @checkstack/common@0.21.0
  - @checkstack/automation-backend@0.10.9
  - @checkstack/catalog-backend@1.6.7
  - @checkstack/backend-api@0.29.1
  - @checkstack/ai-common@0.6.5
  - @checkstack/auth-common@0.12.2
  - @checkstack/automation-common@0.9.2
  - @checkstack/cache-api@0.3.18
  - @checkstack/catalog-common@2.6.2
  - @checkstack/command-backend@0.2.19
  - @checkstack/incident-common@1.7.2
  - @checkstack/integration-backend@0.7.1
  - @checkstack/integration-common@0.9.7
  - @checkstack/notification-common@1.5.2
  - @checkstack/signal-common@0.2.16
  - @checkstack/status-page-backend@0.4.6
  - @checkstack/status-page-common@0.5.2
  - @checkstack/cache-utils@0.2.23

## 1.9.4

### Patch Changes

- Updated dependencies [faf98f5]
- Updated dependencies [faf98f5]
  - @checkstack/ai-backend@0.10.6
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/integration-backend@0.7.0
  - @checkstack/automation-backend@0.10.8
  - @checkstack/catalog-backend@1.6.6
  - @checkstack/command-backend@0.2.18
  - @checkstack/status-page-backend@0.4.5
  - @checkstack/ai-common@0.6.4
  - @checkstack/auth-common@0.12.1
  - @checkstack/automation-common@0.9.1
  - @checkstack/cache-api@0.3.17
  - @checkstack/catalog-common@2.6.1
  - @checkstack/incident-common@1.7.1
  - @checkstack/integration-common@0.9.6
  - @checkstack/notification-common@1.5.1
  - @checkstack/signal-common@0.2.15
  - @checkstack/status-page-common@0.5.1
  - @checkstack/cache-utils@0.2.22

## 1.9.3

### Patch Changes

- Updated dependencies [e819276]
- Updated dependencies [e819276]
  - @checkstack/ai-backend@0.10.5
  - @checkstack/backend-api@0.28.0
  - @checkstack/automation-backend@0.10.7
  - @checkstack/catalog-backend@1.6.5
  - @checkstack/command-backend@0.2.17
  - @checkstack/integration-backend@0.6.10
  - @checkstack/status-page-backend@0.4.4

## 1.9.2

### Patch Changes

- Updated dependencies [b4e0832]
  - @checkstack/ai-backend@0.10.4
  - @checkstack/automation-backend@0.10.6
  - @checkstack/catalog-backend@1.6.4

## 1.9.1

### Patch Changes

- Updated dependencies [0cac684]
  - @checkstack/ai-backend@0.10.3
  - @checkstack/automation-backend@0.10.5
  - @checkstack/catalog-backend@1.6.3
  - @checkstack/backend-api@0.27.1
  - @checkstack/command-backend@0.2.16
  - @checkstack/integration-backend@0.6.9
  - @checkstack/status-page-backend@0.4.3

## 1.9.0

### Minor Changes

- e430fbe: Add "Mass delete" and "Mass resolve" to the Incidents and Maintenances lists,
  authorized per item (RLAC).

  The incidents and maintenances list pages now support multi-select with a bulk
  action bar. A user may only select and act on entries they are allowed to
  MANAGE: a row's checkbox appears only when the caller can manage it (the same
  `canAccess(id)` gate as the per-row actions), so a team-scoped member sees
  checkboxes only for their team's entries. Mass delete confirms before running;
  mass resolve (incidents) and mass complete (maintenances, the "resolve"
  equivalent = close, status -> completed) skip entries that are already
  resolved/completed. Each action reports a per-id partial-success summary
  (e.g. "3 deleted, 1 skipped").

  New backend procedures: `incident.bulkDeleteIncidents`,
  `incident.bulkResolveIncidents`, `maintenance.bulkDeleteMaintenances`, and
  `maintenance.bulkCloseMaintenances`. Each authorizes EACH id against the
  caller's manage grant and never fails open: unauthorized ids are filtered out
  before the handler runs and returned as `forbidden`; missing ids as `notFound`;
  a per-id failure is isolated as `error` without aborting the batch. Per-id cache
  invalidation, realtime signals, and subscriber notifications run for every
  success so dashboards and status pages stay consistent.

  Platform: a new `instanceAccess` mode `bulkManage: { idsParam }` is the
  enforcement point for bulk writes. Before the handler runs, `autoAuthMiddleware`
  partitions the input id array into the caller's manageable subset and the denied
  remainder and exposes both on `context.bulkAccess` (fail-closed on an S2S
  error). The boot-time contract validator (`validateContractInstanceAccess`)
  accepts `bulkManage` as one of the mutually-exclusive scoping modes, marks its
  type team-scopable, and cross-checks `idsParam` against the input schema.

  State and scale: authorization is derived per request from the shared team-grant
  store via the existing auth S2S path (no process-local state); the read returns
  the same answer on every pod. No database migration.

### Patch Changes

- Updated dependencies [d1b71b6]
- Updated dependencies [7c18b25]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [53666a7]
- Updated dependencies [0d912a3]
  - @checkstack/notification-common@1.5.0
  - @checkstack/ai-backend@0.10.2
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/incident-common@1.7.0
  - @checkstack/auth-common@0.12.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/automation-common@0.9.0
  - @checkstack/status-page-common@0.5.0
  - @checkstack/catalog-backend@1.6.2
  - @checkstack/automation-backend@0.10.4
  - @checkstack/ai-common@0.6.3
  - @checkstack/cache-api@0.3.16
  - @checkstack/cache-utils@0.2.21
  - @checkstack/command-backend@0.2.15
  - @checkstack/integration-backend@0.6.8
  - @checkstack/integration-common@0.9.5
  - @checkstack/signal-common@0.2.14
  - @checkstack/status-page-backend@0.4.2

## 1.8.7

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ai-backend@0.10.1
  - @checkstack/automation-backend@0.10.3
  - @checkstack/catalog-backend@1.6.1

## 1.8.6

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/ai-backend@0.10.0
  - @checkstack/catalog-backend@1.6.0
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/automation-backend@0.10.2
  - @checkstack/incident-common@1.6.4
  - @checkstack/ai-common@0.6.2
  - @checkstack/auth-common@0.11.2
  - @checkstack/automation-common@0.8.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/cache-api@0.3.15
  - @checkstack/command-backend@0.2.14
  - @checkstack/integration-backend@0.6.7
  - @checkstack/integration-common@0.9.4
  - @checkstack/notification-common@1.4.2
  - @checkstack/signal-common@0.2.13
  - @checkstack/status-page-backend@0.4.1
  - @checkstack/status-page-common@0.4.1
  - @checkstack/cache-utils@0.2.20

## 1.8.5

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/ai-backend@0.9.1
  - @checkstack/backend-api@0.26.0
  - @checkstack/status-page-common@0.4.0
  - @checkstack/status-page-backend@0.4.0
  - @checkstack/ai-common@0.6.1
  - @checkstack/auth-common@0.11.1
  - @checkstack/automation-common@0.8.1
  - @checkstack/catalog-common@2.4.3
  - @checkstack/incident-common@1.6.3
  - @checkstack/integration-common@0.9.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/signal-common@0.2.12
  - @checkstack/automation-backend@0.10.1
  - @checkstack/cache-api@0.3.14
  - @checkstack/cache-utils@0.2.19
  - @checkstack/catalog-backend@1.5.5
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0
  - @checkstack/integration-backend@0.6.6

## 1.8.4

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-common@0.8.0
  - @checkstack/automation-backend@0.10.0
  - @checkstack/ai-backend@0.9.0
  - @checkstack/catalog-backend@1.5.4

## 1.8.3

### Patch Changes

- 8cad340: refactor: typed router-factory args and structured logging

  Internal router factories that took long positional argument lists
  (`incident-backend`, `maintenance-backend`, and `notification-backend`'s
  `createNotificationRouter`) now take a single typed `deps` object, matching the
  `RouterDeps` convention already used by sibling routers and removing a class of
  easy-to-transpose call sites.

  Backend code paths that wrote to `console.*` now use the injected structured
  `Logger` so they respect log levels and correlation: the catalog router's
  notification-resource lifecycle warnings, the notification OAuth callback
  handler's errors, and the command router's search-provider failures. The
  command router factory now takes a typed `{ logger }` object.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ai-backend@0.8.0
  - @checkstack/ai-common@0.6.0
  - @checkstack/automation-backend@0.9.3
  - @checkstack/status-page-backend@0.3.0
  - @checkstack/backend-api@0.25.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/common@0.17.0
  - @checkstack/auth-common@0.11.0
  - @checkstack/integration-backend@0.6.5
  - @checkstack/command-backend@0.2.12
  - @checkstack/catalog-backend@1.5.3
  - @checkstack/status-page-common@0.3.0
  - @checkstack/catalog-common@2.4.2
  - @checkstack/incident-common@1.6.2
  - @checkstack/automation-common@0.7.1
  - @checkstack/cache-api@0.3.14
  - @checkstack/integration-common@0.9.2
  - @checkstack/signal-common@0.2.11
  - @checkstack/cache-utils@0.2.19

## 1.8.2

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/catalog-backend@1.5.2
  - @checkstack/automation-backend@0.9.2
  - @checkstack/ai-backend@0.7.2
  - @checkstack/command-backend@0.2.11
  - @checkstack/integration-backend@0.6.4
  - @checkstack/status-page-backend@0.2.1

## 1.8.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/status-page-common@0.2.0
  - @checkstack/status-page-backend@0.2.0
  - @checkstack/ai-backend@0.7.1
  - @checkstack/automation-backend@0.9.1
  - @checkstack/catalog-backend@1.5.1
  - @checkstack/command-backend@0.2.10
  - @checkstack/integration-backend@0.6.3
  - @checkstack/catalog-common@2.4.1
  - @checkstack/incident-common@1.6.1

## 1.8.0

### Minor Changes

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

- 9ab73c5: Status pages: configurable incident/maintenance updates + recently resolved/completed items.

  The Incidents and Maintenance widgets gain four config options (in the builder):

  - **Show updates** (default on) — render the per-item update timeline so visitors
    can follow progress. The maintenance widget now renders its timeline too
    (previously it fetched updates but didn't show them). Turning this off also
    skips the per-item detail fetch (a perf win).
  - **Max updates per item** (default 3) — show only the latest N updates,
    most-recent first, so a chatty incident doesn't dominate the page.
  - **Show recently resolved / completed** (default off) — include resolved
    incidents / completed maintenances, rendered in a separate "Recently resolved"
    / "Past maintenance" subsection below the active items.
  - **Max age (days)** (default 7) — only include past items resolved/completed
    within the window.

  Scoping and isolation are unchanged: still only the systems the operator bound,
  still fail-closed when none are bound, still field-allow-listed DTOs (no
  `createdBy`). The active/past partition + max-age + cap is a pure, unit-tested
  helper (`selectEvents`).

- 5c6393f: Add operator-built public Status Pages (phase 1: secure, extensible core).

  Operators compose a public status page from widgets (status banner, system
  health, group status, 90-day uptime, incidents, scheduled maintenance) plus
  content blocks (text/Markdown, heading, links, image, divider), each bound to the
  resources they choose, then publish it.

  Security model — "only published widgets reveal data":

  - A single public endpoint, `getPublishedStatusPage(slug)`, returns the layout
    plus each widget's already-resolved, field-ALLOW-LISTED DTO. The public surface
    has no generic data API, so it can only ever show what was placed on the page.
  - Three gates: edit-time (you can only bind resources you can access), publish-time
    (an audited, deliberate exposure that re-checks the editor can read every bound
    resource via a user-scoped client), and render-time (resolvers run as a trusted
    service but emit only DTO fields — never internal config, ids, or `createdBy`;
    the service re-validates each DTO against its schema, so a resolver bug fails
    closed).
  - The overall banner rolls up only the bound systems; private resources are never
    exposed beyond their public-safe status; per-binding label overrides avoid
    internal-name leaks.

  Coherence + extensibility:

  - Status pages are team-scopable resources (RLAC): created via the standard
    owning-team picker + create-capability flow, resolvable by name in the Teams
    admin.
  - Widget types come from an extension-point registry, so any plugin can contribute
    a widget (config schema + public DTO + `resolvePublic`); the public renderers
    are pure, prop-only components with no data access, so third-party widgets can
    never leak.
  - Draft vs published layouts; per-page visibility (public / authenticated-only)
    and theming (brand color, logo).

  Dependency direction: the status-page platform owns the widget-type registry and
  the content widgets, but the DOMAIN widgets are contributed by their owning
  plugins via the `statusWidgetTypeExtensionPoint` — system health / uptime /
  banner / group status by `healthcheck-backend`, incidents by `incident-backend`,
  scheduled maintenance by `maintenance-backend`. So `status-page-backend` depends
  only on `backend-api` / `common` / `status-page-common`; the owning plugins
  depend on the platform, never the reverse. `catalog-common` gains
  `assertCatalogResourcesReadable` for the publish-time access check.

  Phase 1 scope: the secure core, the admin builder, and the public page (served as
  a no-access-rule route). A fully separate public bundle, custom domains + TLS,
  drag-reorder, live-data preview, and distribution (embeds/badges/RSS/subscriptions)
  are the next phases.

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/ai-backend@0.7.0
  - @checkstack/ai-common@0.5.0
  - @checkstack/auth-common@0.10.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-backend@0.9.0
  - @checkstack/automation-common@0.7.0
  - @checkstack/catalog-backend@1.5.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/incident-common@1.6.0
  - @checkstack/status-page-common@0.1.0
  - @checkstack/status-page-backend@0.1.0
  - @checkstack/command-backend@0.2.9
  - @checkstack/integration-backend@0.6.2
  - @checkstack/cache-api@0.3.13
  - @checkstack/integration-common@0.9.1
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-common@0.2.10
  - @checkstack/cache-utils@0.2.18

## 1.7.4

### Patch Changes

- Updated dependencies [bb6f0fe]
  - @checkstack/ai-backend@0.6.1
  - @checkstack/automation-backend@0.8.1
  - @checkstack/catalog-backend@1.4.12

## 1.7.3

### Patch Changes

- Updated dependencies [079369a]
- Updated dependencies [4134ed9]
- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
- Updated dependencies [079369a]
  - @checkstack/ai-backend@0.6.0
  - @checkstack/ai-common@0.4.0
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/automation-common@0.6.0
  - @checkstack/auth-common@0.9.1
  - @checkstack/integration-backend@0.6.1
  - @checkstack/catalog-backend@1.4.11
  - @checkstack/command-backend@0.2.8
  - @checkstack/catalog-common@2.3.6
  - @checkstack/incident-common@1.5.2

## 1.7.2

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/integration-common@0.9.0
  - @checkstack/integration-backend@0.6.0
  - @checkstack/automation-backend@0.7.0
  - @checkstack/automation-common@0.5.0
  - @checkstack/auth-common@0.9.0
  - @checkstack/ai-backend@0.5.0
  - @checkstack/ai-common@0.3.0
  - @checkstack/catalog-backend@1.4.10
  - @checkstack/catalog-common@2.3.5
  - @checkstack/incident-common@1.5.1
  - @checkstack/backend-api@0.21.7
  - @checkstack/command-backend@0.2.7

## 1.7.1

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [0ffe357]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/ai-backend@0.4.0
  - @checkstack/automation-backend@0.6.0
  - @checkstack/ai-common@0.2.0
  - @checkstack/integration-common@0.8.0
  - @checkstack/integration-backend@0.5.0
  - @checkstack/catalog-backend@1.4.9

## 1.7.0

### Minor Changes

- 0b6f01b: feat(incident): contribute incident signals to the backend system.issues aggregator

  The incident plugin now registers a `system.issues` contributor (sourceId
  `incident`) from its backend `init`, so the AI assistant surfaces open incidents
  alongside SLOs, health checks, anomalies, and dependency problems.

  The contributor enforces its own `incident.read` access gate (returning an empty
  map - never throwing - when the principal lacks access; service users carry no
  access rules and so get no signals), then reads every OPEN (not-resolved)
  incident for all systems from the shared, durable `incidents` +
  `incident_systems` tables via a new global `listOpenIncidentsBySystem` service
  method. The answer is therefore identical on every pod, and only systems with an
  open incident appear in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/since/iconName)
  is extracted into a new pure `deriveIncidentSignals` deriver in
  `@checkstack/incident-common`, shared by both the backend contributor and the
  frontend `IncidentSignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

### Patch Changes

- Updated dependencies [dbb76a2]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/ai-backend@0.3.0
  - @checkstack/incident-common@1.5.0
  - @checkstack/automation-backend@0.5.8
  - @checkstack/catalog-backend@1.4.8
  - @checkstack/backend-api@0.21.6
  - @checkstack/command-backend@0.2.6
  - @checkstack/integration-backend@0.4.6

## 1.6.7

### Patch Changes

- Updated dependencies [2428bfc]
  - @checkstack/ai-backend@0.2.0
  - @checkstack/automation-backend@0.5.7
  - @checkstack/catalog-backend@1.4.7

## 1.6.6

### Patch Changes

- Updated dependencies [f9cfdae]
  - @checkstack/ai-backend@0.1.6
  - @checkstack/automation-backend@0.5.6
  - @checkstack/catalog-backend@1.4.6

## 1.6.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/auth-common@0.8.3
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ai-backend@0.1.5
  - @checkstack/common@0.15.0
  - @checkstack/ai-common@0.1.3
  - @checkstack/automation-common@0.4.3
  - @checkstack/incident-common@1.4.4
  - @checkstack/integration-common@0.7.3
  - @checkstack/notification-common@1.3.3
  - @checkstack/automation-backend@0.5.5
  - @checkstack/catalog-backend@1.4.5
  - @checkstack/command-backend@0.2.5
  - @checkstack/integration-backend@0.4.5
  - @checkstack/cache-api@0.3.12
  - @checkstack/signal-common@0.2.9
  - @checkstack/cache-utils@0.2.17

## 1.6.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/ai-backend@0.1.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/catalog-backend@1.4.4
  - @checkstack/command-backend@0.2.4
  - @checkstack/integration-backend@0.4.4

## 1.6.3

### Patch Changes

- Updated dependencies [00b9367]
  - @checkstack/ai-backend@0.1.3
  - @checkstack/automation-backend@0.5.3
  - @checkstack/catalog-backend@1.4.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/incident-common@1.4.3
  - @checkstack/ai-common@0.1.2
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/backend-api@0.21.3
  - @checkstack/cache-api@0.3.11
  - @checkstack/cache-utils@0.2.16
  - @checkstack/command-backend@0.2.3
  - @checkstack/common@0.14.1
  - @checkstack/integration-backend@0.4.3
  - @checkstack/integration-common@0.7.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8

## 1.6.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-backend@0.1.2
  - @checkstack/ai-common@0.1.2
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-backend@0.5.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/catalog-backend@1.4.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/command-backend@0.2.2
  - @checkstack/incident-common@1.4.2
  - @checkstack/integration-backend@0.4.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8
  - @checkstack/cache-utils@0.2.16

## 1.6.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/cache-api@0.3.10
  - @checkstack/ai-backend@0.1.1
  - @checkstack/ai-common@0.1.1
  - @checkstack/auth-common@0.8.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/automation-common@0.4.1
  - @checkstack/catalog-backend@1.4.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/command-backend@0.2.1
  - @checkstack/incident-common@1.4.1
  - @checkstack/integration-backend@0.4.1
  - @checkstack/integration-common@0.7.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/signal-common@0.2.7
  - @checkstack/cache-utils@0.2.15

## 1.6.0

### Minor Changes

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

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Write-path hardening: post-commit side effects can no longer fail a committed write, multi-row mutations are now atomic, and retry-duplication is blocked at the database.

  **Platform-level (automatic for all current and future plugins):**

  - signal-backend: `SignalService` (broadcast / sendToUser / sendToUsers / sendToAuthorizedUsers) is now resilient by construction - a transient event-bus/queue failure is caught and logged instead of thrown. Real-time signals are best-effort UI nudges; the authoritative data is already committed by the time a mutation broadcasts, so a signal-transport blip must never turn a successful write into a client-visible error. Every plugin's broadcasts inherit this without per-call-site `try/catch` (which would inevitably be forgotten and regress). This mirrors `createCachedScope`, which already makes cache invalidation non-throwing - so the cache + signal halves of the "post-commit side effect fails the response" class are both closed at the platform seam. Durable side effects (events/hooks that drive automations, queue jobs) intentionally still surface failures. Documented in `developer-guide/backend/signals.md`.

  **Atomic multi-write mutations (each previously committed row-by-row in autocommit, so a mid-sequence failure left partial/orphaned state):**

  - slo-backend: `createObjective` now inserts the objective and its 1:1 streak row in one transaction; the post-create reconcile/status/notify steps are best-effort and can no longer fail the (committed) create.
  - incident-backend: `createIncident`, `updateIncident`, `addUpdate`, and `resolveIncident` wrap their row + system-link + timeline writes in a transaction (no more wiped system associations on a failed re-insert, or status flips with no matching timeline entry).
  - maintenance-backend: same for `createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`.
  - automation-backend: `cancelRun` marks the run cancelled and tears down its wait locks + durable state in one transaction - previously a failure after the status update could leave a wait lock behind, letting a later trigger event resume an already-cancelled run.
  - healthcheck-backend: `ingestSatelliteResult` commits the run row and its hourly-aggregate increment together (no orphaned run, no aggregate without a backing run). NOTE: this guarantees run/aggregate consistency but does not yet make a _duplicate satellite delivery_ idempotent - that needs a dedupe key on the high-volume runs table and is tracked as a follow-up.

  **Retry-duplication blocked at the DB (paired with the SQLSTATE 23505 -> 409 mapping shipped separately):**

  - catalog-backend: new unique indexes on `groups.name`, `environments.name` (consistent with `systems.name`), on `system_links (system_id, url)`, and on `system_contacts (system_id, user_id)` + `(system_id, email)` (NULLs are distinct, so user vs mailbox contacts don't interfere). Name uniqueness is CASE-INSENSITIVE: the three name indexes are functional `lower(name)` indexes (the existing `systems.name` index is rebuilt this way too), so "Api" and "api" collide while the stored value keeps its original casing. The systems pre-write name check (`getSystemByName`) is case-folded to match. Migration `0005` de-dupes any pre-existing rows first - names are preserved by suffixing later case-insensitive duplicates (" (2)", " (3)", ...), redundant contact/link rows are removed keeping the earliest. (Link URLs stay case-sensitive - URL paths are; contact emails are deduped exact-match.)
  - incident-backend / maintenance-backend: unique index on `incident_links (incident_id, url)` / `maintenance_links (maintenance_id, url)`, with a de-dupe step in the migration.

    **Behavior change:** creating a group/environment with a duplicate name, or attaching a duplicate contact/link, now returns `409 Conflict` instead of silently creating a duplicate. The migrations resolve existing duplicates on upgrade.

  This is a beta patch.

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ai-backend@0.1.0
  - @checkstack/ai-common@0.1.0
  - @checkstack/auth-common@0.8.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/automation-backend@0.5.0
  - @checkstack/catalog-backend@1.4.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/automation-common@0.4.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/integration-backend@0.4.0
  - @checkstack/common@0.13.0
  - @checkstack/command-backend@0.2.0
  - @checkstack/incident-common@1.4.0
  - @checkstack/integration-common@0.7.0
  - @checkstack/cache-api@0.3.9
  - @checkstack/signal-common@0.2.6
  - @checkstack/cache-utils@0.2.14

## 1.5.0

### Minor Changes

- a57f7db: fix(backend): give advisory locks a dedicated connection pool to prevent pool-starvation deadlock

  Both the session-lock service and `withXactLock` HOLD a Postgres connection for
  the lock's whole lifetime while the gated work runs on a _different_ connection.
  Both lock and work were drawing from the single shared `adminPool` (which, with
  no explicit config, defaulted to `max: 10` and `connectionTimeoutMillis: 0` -
  wait forever). Under concurrency >= pool size, every slot became a lock-holding
  connection waiting for a work connection that could never free up: a permanent
  deadlock. It surfaced as all connections stuck `idle in transaction` on
  `pg_advisory_xact_lock` and every API request hanging into an upstream 502,
  only after the server had been running long enough to hit that concurrency
  (e.g. a burst of health-check evaluations or incident dedups).

  Advisory locks now run on a dedicated `lockPool`, separate from `adminPool`, so
  the acquire graph is acyclic (`lockPool -> adminPool`, never back) and the
  deadlock class is impossible. `AdvisoryLockService` gains a pooled
  `withXactLock({ key, fn })` method (lock on the lock pool, work on the admin
  pool); healthcheck's per-system serializer, incident's dedup-create, and the
  automation single-mode concurrency lock now use it. The deadlock-prone
  standalone `withXactLock({ db, ... })` helper is REMOVED.

  Both pools are explicitly configured with `connectionTimeoutMillis` so any
  future exhaustion fails fast and self-heals instead of hanging, and both get a
  pool-level `error` handler (an idle pooled client whose backend dies otherwise
  crashes the pod). The lock pool additionally sets
  `idle_in_transaction_session_timeout` and `lock_timeout` so a stalled critical
  section is reaped server-side (auto-releasing the lock) rather than stranding a
  key forever. The advisory-lock service also now removes its per-client error
  listener on release (it previously leaked one listener per acquisition on each
  reused pooled connection - an unbounded `MaxListenersExceeded` leak).

  New env vars (all optional): `DATABASE_POOL_MAX` (default 20),
  `DATABASE_LOCK_POOL_MAX` (default 10), `DATABASE_POOL_CONNECTION_TIMEOUT_MS`
  (default 10000), `DATABASE_POOL_IDLE_TIMEOUT_MS` (default 30000),
  `DATABASE_LOCK_IDLE_TX_TIMEOUT_MS` (default 30000), `DATABASE_LOCK_TIMEOUT_MS`
  (default 30000). Size pools off
  `N_pods * (DATABASE_POOL_MAX + DATABASE_LOCK_POOL_MAX) <= max_connections`.

  BREAKING CHANGE: the standalone `withXactLock({ db, key, fn })` export is
  removed - use `coreServices.advisoryLock.withXactLock({ key, fn })` instead.
  `IncidentService`'s constructor now requires an `AdvisoryLockService` as its
  second argument, and the healthcheck `createHealthEntitySerializer` /
  `executeHealthCheckJob` / `setupHealthCheckWorker` helpers take `advisoryLock`
  instead of `db` for the serializer.

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/cache-api@0.3.8
  - @checkstack/catalog-backend@1.3.1
  - @checkstack/command-backend@0.1.33
  - @checkstack/integration-backend@0.3.1
  - @checkstack/cache-utils@0.2.13

## 1.4.0

### Minor Changes

- 270ef29: Replace the hardcoded auto-incident path with default automations (Wave 2 Phase 20).

  BREAKING CHANGES: Auto-incident is now automation-driven. The hardcoded background path that opened incidents on sustained-unhealthy / flapping and closed them after a cooldown (`auto-incident.ts`, `auto-incident-close-job.ts`) is removed. On upgrade, an idempotent, threshold-preserving migration seeds equivalent default automations from each assignment's existing `NotificationPolicy`, so alerting behaviour is preserved 1:1:

  - `sustainedUnhealthyTrigger.durationMinutes` -> the `for:` dwell on a `healthcheck.system_degraded` trigger -> `incident.create`.
  - auto-close `autoCloseAfterMinutes` -> a `wait_until` (healthy continuously for the cooldown) -> `incident.resolve`.
  - `useNotificationSuppression` -> the incident's `suppressNotifications`.
  - `skipDuringMaintenance` -> a `{{ !health.system.in_maintenance }}` pre-run condition.
  - `flappingTrigger.{transitions,windowMinutes}` -> a second automation on the `healthcheck.flapping_detected` trigger -> `incident.create`.

  Auto-incidents remain ONE OPEN INCIDENT PER SYSTEM, faithful to the old behaviour. `incident.create` gains an opt-in `dedupe_open_for_system` config flag (default false, so existing/custom automations are unaffected): when true, it reuses an existing open incident on the target system instead of opening a duplicate (the old `findActiveAutoIncident(systemId)` semantic), returning the reused incident as the produced `incident` artifact. The seeded default automations set this flag, so a system with several failing checks - sustained and/or flapping - still gets a single open incident; whichever check crosses its threshold first opens it, and the rest dedupe to it. Both sustained and flapping default automations open at `critical` severity (parity with the old path). Per-system run dedup within an automation uses `concurrency_scope: "context_key"` + `mode: "single"`.

  Operators can read, edit, disable, and extend these automations (see the "Customise auto-incident" guide). Seeded automations are tagged via `managedBy` (`auto-incident:<systemId>:<configurationId>:<kind>`) so the migration is a no-op on re-runs; anything unmappable is recorded as a migration-failure row.

  Flapping DETECTION (transition recording + the `healthcheck.flapping_detected` emit) is relocated into `flapping-detector.ts` and survives; the emit now fires unconditionally on a threshold cross (no longer gated on `autoOpenIncidentOnUnhealthy`), matching the hook's documented intent and required for the flapping default automation. The legacy `health_check_auto_incidents` mapping table is no longer written or read (it will be dropped in a follow-up migration); `health_check_unhealthy_transitions` is retained for the flapping detector.

  New service-typed `HealthCheckApi.listAutoIncidentPolicies` RPC exposes each assignment's effective notification policy for the migration. `incident.create` adds the `dedupe_open_for_system` flag (additive, defaults off).

- 270ef29: Add an `incident` artifact type to the incident automation actions (Phase 20 prerequisite).

  Closes GAP 2 from the Phase 20 analysis - a single automation can now open an incident and reference it downstream (open then wait then resolve) without the operator repeating the id.

  - New `incident` artifact type registered in incident-backend (`{ incidentId, status, severity, systemIds }`).
  - `incident.create` now declares `produces: "incident"`, so the created incident is queryable in run scope (mirrors the Jira `produces: "jira.issue"` pattern).
  - `incident.resolve` / `incident.add_update` / `incident.update_status` now declare `consumes: ["incident"]` and make their `incidentId` config optional, falling back to the upstream `incident` artifact (config takes priority, else artifact - the `resolveIssueKey` pattern). They fail with a clear error when neither is present.

- 270ef29: Fix several correctness defects around distributed coordination and stored-data handling.

  - Dwell `for:` timers now fire via an atomic `DELETE ... RETURNING` claim, so two pods (or the stalled sweeper vs the queue consumer) can no longer both fire the same dwell.
  - Postgres session-level advisory locks now keep connection affinity. A shared `AdvisoryLockService` (backed by a dedicated pooled client) replaces the previous acquire/release-on-different-connection pattern that leaked locks. Used by the script-packages installer election, the automation run resume + stalled sweeper, and (via a new transaction-scoped `withXactLock`) incident dedup.
  - A storage migration that crashed mid-flight is now resumed on startup under the installer-election lock, instead of permanently wedging installs.
  - Distributed script-package blobs carry a `blobSha256` and are verified before extraction (the SRI `integrity` hashes the npm tarball, not the transported archive). Backward-safe: entries without the field skip verification until a re-install regenerates the manifest.
  - Archive extraction rejects zip-slip paths (absolute or `..` entries) before writing anything.
  - `incident.create` with `dedupe_open_for_system` serializes its check-then-create per system, so concurrent triggers for the same system can't both open a duplicate incident.
  - Seeded auto-incident filter expressions JSON-encode interpolated ids so a quote/backslash can't corrupt the expression.
  - Stored jsonb snapshots (dwell `actorSnapshot`, wait-lock `waitConfig`) are validated with zod on load and degrade safely instead of flowing through as the wrong type.

- b995afb: Make incident automation actions fully reactive.

  Only the `incident.create` action routed through the reactive `incident` entity; the `resolve`, `add_update`, and `update_status` actions called the incident service directly. Action-driven status flips therefore appended NO `entity_transitions` row, emitted NO `ENTITY_CHANGED` (so no `wait_until` woke), and fired NO `incident.resolved` / `.updated` derived trigger events — unlike the RPC router, which routes the same mutations through the entity handle.

  The three actions now drive their writes through `writeIncidentEntity({ handle, incidentId, opts: { runId }, apply })` (re-reading the post-write state inside `apply` for the status-flipping actions), matching the router. As a result an action-driven resolve/status change now appends a transition, wakes suspended `wait_until` runs, and fires `incident.resolved` / `incident.updated`. The dispatch `runId` is passed so run-resolved secrets in the reactive state are masked.

- b995afb: Make `incident` a plugin-backed reactive entity via the Model-B entity state machine.

  The `incidents` + `incident_systems` tables are BOTH authoritative AND the `incident` entity's current-state storage - there is no framework `entity_state` row for an incident. `defineEntity` is given a plugin `read` accessor (`IncidentService.getManyEntityStates`) that projects the reactive subset `{ status, severity, systemIds }` straight off those tables, and every reactive-state write goes through `handle.mutate` / `handle.remove`: `apply` performs the REAL `incidents` / junction write (the plugin's own db/tx) and returns the new state; the framework snapshots `prev` via `read` BEFORE the write, appends the transition log (its own db), and emits `ENTITY_CHANGED` AFTER the write commits. Covered sites: create, update, add-update, resolve, auto-create, auto-resolve, and delete (tombstone), plus the `incident.create` / `incident.resolve` automation actions.

  A change -> trigger-event deriver reproduces the existing qualified events so automations keep firing:

  - create (`prev === null`) -> `incident.created`
  - transition to `resolved` -> `incident.resolved`
  - any other field change -> `incident.updated`
  - delete (tombstone) -> no event (there is no `incident.deleted` trigger)

  The old `incident.created` / `incident.updated` / `incident.resolved` change hooks are removed in favor of these reactive change events; the catalog `system.deleted` consumer switched from `onHook(catalogHooks.systemDeleted)` to `onEntityChanged({ kind: "catalog-system" })` filtered to tombstones, keeping `work-queue` delivery (association cleanup must run once per cluster).

  BREAKING CHANGES:

  - The `incident.created` / `incident.updated` / `incident.resolved` cross-plugin hooks (the `createHook` descriptors) are removed. Incident lifecycle is now the reactive `incident` entity; the matching trigger events still fire (via the entity change deriver), so existing automations on `incident.created/.updated/.resolved` and external event-routing (e.g. the Jira integration's `incident.created` event type) keep working. No in-repo plugin subscribed to the removed hooks via `onHook`.
  - The `addUpdate`-with-status=resolved path previously emitted BOTH `incident.updated` and `incident.resolved`; it now fires only `incident.resolved` (the deriver classifies a transition-to-resolved as a resolution). Automations meant to react to a resolution should use the `incident.resolved` trigger, not `incident.updated`.
  - NARROWING: `incident.updated` now fires only on a change to the REACTIVE state (`status`, `severity`, or affected `systemIds`). A comment-only `addUpdate` (no status change) no longer fires `incident.updated` (the posted message is not reactive entity state). Re-author any automation that needed to react to a comment-only update against a different signal.
  - The `incident.create` automation ACTION path now drives its write through `handle.mutate`, so an action-created incident is now reactive - it emits `incident.created` and other automations can trigger on it. Previously the action path created incidents silently (no lifecycle event). A dedupe REUSE still emits nothing (the open incident is unchanged).

- b995afb: Restore the documented domain payload fields on entity-driven automation triggers.

  Migrated triggers declare domain-named `payloadSchema`s (incident `incidentId`; health `systemId` / `previousStatus`; catalog `systemId` / `changedFields`; dependency `dependencyId`), but Stage-2 dispatch built `trigger.payload` from the generic entity-change shape (`{ kind, id, prev, next, delta, ...next }`). Operator filters and templates reading `trigger.payload.incidentId` / `.systemId` / `.previousStatus` silently resolved to `undefined` — a regression vs the legacy hook payloads.

  Changes:

  - `@checkstack/automation-backend`: `registerChangeDeriver` now accepts an optional per-kind `toPayload(changed) => Record<string, unknown>` mapper (at most one per kind; a second distinct mapper throws). Stage-2's `changedToPayload` uses the registered mapper to build `trigger.payload` so it matches the kind's declared `payloadSchema`, falling back to the generic change shape for kinds without a mapper. New exported type `EntityChangePayloadMapper`.
  - `@checkstack/incident-backend`, `@checkstack/healthcheck-backend`, `@checkstack/catalog-backend`, `@checkstack/dependency-backend`: implement and register a `toPayload` for each entity-driven kind so `trigger.payload` carries the legacy domain keys again.

  Descriptive incident payload fields not derivable from the reactive entity state (`title`, `description`, `createdAt`, `resolvedAt`) are now OPTIONAL on the incident trigger `payloadSchema`s — they were always absent from an entity-driven payload.

### Patch Changes

- 270ef29: Fix suspend/resume durability + complete the run-wide secret-masking guarantee.

  A panel review confirmed several defects in the automation dispatch engine's suspend/resume durability and in the run-wide masking choke point. These survived because the unit suite stubbed the seam under test; the fixes ship with tests that exercise the real suspend / sweep / resume paths.

  Suspend/resume durability:

  - **Stalled sweeper no longer re-runs intentional waits.** `findStalledRunIds` now joins `automation_runs` and returns only `status = 'running'` runs, and suspend-finalisation no longer clobbers the run's `lastActionPath` checkpoint to `null`. Previously any wait longer than the stale window (>60s) was re-walked from the top every sweep cycle, re-firing pre-wait side effects and leaking wait locks. The wait-aware sweeps now also run before the stalled-run sweep.
  - **Stalled recovery refuses a run holding a live wait lock.** `recoverStalledRun` now only recovers a genuinely-`running` run with no wait lock; a crash-mid-wait recovery is left to the wait/resume paths instead of re-walking from the top and creating a duplicate lock + duplicate delay job.
  - **Cancelled runs can no longer resurrect.** `resumeRun` guards on `status === 'waiting'` (mirroring `checkWaitUntil`) and drops any stale lock for a non-waiting run, so `wakeWaitingRuns` / delay-expiry / a racing queue job can't wake a cancelled or terminal run. `cancelActiveRuns` (restart mode) now deletes the cancelled runs' wait locks + run-state in the same operation.
  - **Concurrency check-then-create is serialized.** The `mode` check + `createRun` now run under a transaction-scoped advisory lock keyed on `(automationId, scope)`, so two concurrent fires can't both pass a `single`-mode "no active run" check and double-run.

  Masking guarantee (now genuinely covers scope + artifacts):

  - **The run-wide masking choke point now also masks the durable scope snapshot and produced artifacts.** The `RunSecretRegistry` is threaded into `RunStateStore.upsert` (masks `scopeSnapshot`) and `ArtifactStore.record` (masks `data`) so a resolved connection credential threaded into `scope.variables` or surfaced into an artifact is redacted before persist - and therefore cannot reach a read-only user via `getRunScopeForReplay`. **GUARANTEE CHANGE**: run-wide masking now covers step output, run error, scope snapshot, and artifact data for every action.
  - **`testConnection` / `testProviderConnection` mask provider errors.** These RPCs run outside a dispatch run, so they build a per-call mask set from the resolved/submitted connection config and run any provider error through it before returning, so a provider error echoing a token can't cross back to the browser.
  - **Short secrets surface a warning.** `setSecret` now warns when a value is shorter than `MIN_MASKABLE_LENGTH` (4) that it cannot be auto-redacted (the threshold is intentionally not lowered).

  Internal:

  - `@checkstack/backend-api`: `withXactLock`'s `fn` now receives the transaction handle `tx` so a critical section can run on the locked connection; the doc clarifies why running on the pool inside the lock window is still safe. The incident dedup caller's comment is corrected accordingly. `RunStore` gains `findWaitLocksByRun`.

- b995afb: Extract a shared `withEntityWrite` / `withEntityRemove` guard for PLUGIN-BACKED (Model B) reactive entities and refactor the per-domain copies onto it.

  Every plugin-backed domain (incident, catalog, dependency, maintenance, slo, satellite) reimplemented the same "no handle wired → run the plugin write directly; handle wired → route through `handle.mutate` / `handle.remove`" guard, varying only in the id-key name. `@checkstack/automation-backend` now exports `withEntityWrite` / `withEntityRemove` (from the entity barrel) and each domain's thin, well-named wrappers (`writeIncidentEntity`, `writeMaintenanceEntity`, satellite's `mirror`, …) delegate to it, so the branch lives in exactly one place. Behavior is unchanged.

  `writeHealthEntity` (healthcheck-backend) is intentionally NOT migrated onto the helper — it is genuinely bespoke (closure-captured durable state, distinct rethrow-vs-fail-soft branches, a per-system serializer, and it returns the computed state). SLO keeps its fail-soft `onError` wrapper around the shared guard.

- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/automation-backend@0.3.0
  - @checkstack/automation-common@0.3.0
  - @checkstack/catalog-backend@1.3.0
  - @checkstack/integration-backend@0.3.0
  - @checkstack/cache-api@0.3.7
  - @checkstack/command-backend@0.1.32
  - @checkstack/cache-utils@0.2.12

## 1.3.0

### Minor Changes

- 41c77f4: feat(automation): type enum-able trigger/artifact fields as enums for editor value autocompletion

  The automation editor's staged completion offers concrete values after a
  comparator (`{{ trigger.payload.severity == "high" }}`) only when the
  field's JSON Schema carries an `enum`. Several trigger payload + artifact
  schemas declared closed-set fields as loose `z.string()`, so no values
  were suggested. Tightened them to the canonical enums that already
  existed in each plugin's `-common` package (and matched the hook payload
  types in lockstep so the trigger's `payloadSchema` and `hook` keep the
  same `TPayload`):

  - **incident** — trigger payloads: `severity` → `IncidentSeverityEnum`,
    `status` / `statusChange` → `IncidentStatusEnum`.
  - **healthcheck** — trigger payloads: `previousStatus` / `newStatus` /
    `status` → `HealthCheckStatusSchema` (across systemDegraded,
    systemHealthy, systemHealthChanged, checkFailed; plus checkCompleted's
    hook type).
  - **dependency** — trigger + artifact: `impactType` → `ImpactTypeSchema`;
    impactPropagated `previousState` / `newState` → `DerivedStateSchema`.
    Also deduped the inline `impactTypeSchema` action-config enum to reuse
    the canonical `ImpactTypeSchema`.
  - **maintenance** — trigger + artifact: `status` →
    `MaintenanceStatusEnum`; deduped the inline `maintenanceStatusEnum`
    (used by `add_update.statusChange`) to the canonical one.
  - **slo** — `achievement.unlocked` trigger + hook: `achievement` →
    `AchievementTypeSchema`.

  Runtime behaviour is unchanged — these fields always carried valid enum
  values (the underlying records are enum-constrained); only the schema
  types were loose. The hook payload generics are now precise too, which
  caught one stale test fixture asserting an invalid `impactType: "soft"`.

  Fields that look enum-ish but are genuinely free-form were intentionally
  left as `z.string()`: satellite `region` (user-entered), Jira issue
  `status` (per-instance workflow name), notification `strategyQualifiedId`
  / `errorMessage`, healthcheck collector `result`, and script
  `stdout` / `stderr`.

- 41c77f4: feat(incident): register incident lifecycle as automation triggers + actions

  Adds three triggers (`incident.created`, `incident.updated`,
  `incident.resolved`) backed by the existing hooks, each exposing
  `incidentId` as the context key so `wait_for_trigger` waits match the
  same incident across the run. Adds four actions (`incident.create`,
  `incident.resolve`, `incident.add_update`, `incident.update_status`)
  wrapping the existing `IncidentService` methods so operators can compose
  incident flows in the Automation editor.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-backend@0.2.0
  - @checkstack/automation-common@0.2.0
  - @checkstack/integration-backend@0.2.0
  - @checkstack/integration-common@0.6.0
  - @checkstack/catalog-backend@1.2.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/incident-common@1.3.1
  - @checkstack/auth-common@0.7.2
  - @checkstack/command-backend@0.1.31
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5
  - @checkstack/cache-api@0.3.6
  - @checkstack/cache-utils@0.2.11

## 1.2.0

### Minor Changes

- ba07ae2: Quiet down notification spam on flapping systems, auto-open incidents when a check goes critical, and let operators land directly on the broken checks.

  Notification policy lives **per healthcheck assignment** (one row per `system × configuration`). Different checks on the same system are fully independent — disabling a setting on one check does not affect the others. Defaults preserve existing behaviour for `suppressDeEscalations`; **auto-incident defaults to on** for new and existing assignments.

  - **`suppressDeEscalations`** (off by default). When on, transitions from a worse state to a better-but-still-failing state (e.g. `unhealthy → degraded`) no longer fire a notification. Escalations and full recoveries to `healthy` are unaffected. Resolved per assignment (the just-ran check is the one driving any aggregate transition).
  - **`autoOpenIncidentOnUnhealthy`** (on by default). Either of two independent triggers can open the auto-incident:
    - **`sustainedUnhealthyTrigger`** (default 30 min) — opens when the check stays continuously unhealthy for the configured duration. Catches real outages.
    - **`flappingTrigger`** (default 3 transitions in 60 min) — opens when the check flips to unhealthy that many times in the window. Catches persistent flapping where each unhealthy phase is too brief for the sustained trigger.
      Each trigger can be individually disabled. One incident per system: triggering checks attach to an existing active auto-incident.
  - **`useNotificationSuppression`** (on by default, only meaningful when auto-open is on). Controls whether the auto-opened incident is created with `suppressNotifications: true` — leaving this off opens the incident but still pings operators on each transition.
  - **`skipDuringMaintenance`** (on by default). No auto-incident is opened while the system has an active maintenance window with suppression. The system is intentionally down and shouldn't trip the on-call.
  - **`autoCloseAfterMinutes`** (default 30). Auto-close cooldown is now per-assignment and snapshotted per-incident at open time — later policy edits don't alter in-flight incidents. Setting `null` ("Never auto-close") leaves the incident for manual resolution.
  - **Require-recovery rule.** After any auto-incident closes (manual or auto), no new auto-incident can open until the check has logged at least one healthy run. Prevents a "operator dismissed but it's still broken" loop.
  - **Auto-close worker** ticks every 60s and resolves auto-opened incidents whose systems have been healthy for their per-row `cooldownMinutes`. Rows with `null` cooldown are skipped entirely. Per-incident: failed close attempts are logged but never abort the sweep.
  - **`incidentResolved` hook subscriber** syncs the auto-incident mapping when an operator manually resolves the incident, so the require-recovery rule sees the close immediately.
  - **Platform-wide defaults.** New admin RPCs `getPlatformNotificationDefaults` / `setPlatformNotificationDefaults` (under the existing `healthcheck.configuration.{read,manage}` access rules) let operators set notification policy once for the whole instance. Per-assignment rows with `notificationPolicy: null` inherit the platform defaults at read time. UI: a "Notification defaults" button in the Assignment IDE opens a modal editor. The per-assignment Notifications panel shows an inheritance banner — "Using platform defaults" (read-only) with an "Override" button, or "Custom override" with a "Use platform defaults" button to revert. The all-or-nothing model keeps the mental model simple: each assignment is either fully inherited or fully overridden.
  - **New service-level RPCs** on the incident plugin (`createAutoIncident`, `resolveAutoIncident`) let other plugins open/close incidents without a user context. Reused by the healthcheck auto-incident flow.
  - **Health-state notification CTA** now deep-links to `?filter=failing` on the system detail page for non-recovery transitions (label changes to "View failing checks"). The system overview gains an `All / Failing / Healthy` segmented filter wired to the same `?filter=…` param.
  - **Notification bell badge** now counts collapse groups instead of raw rows, so the number matches what the user sees in the notifications list. Built on `COUNT(DISTINCT COALESCE(collapse_key, id))` — notifications without a collapse key still each count as one.
  - **`statusFilter` on `getHistory` / `getDetailedHistory`** lets the run-history page and the drawer's Recent Runs panel filter to `All / Healthy / Failing` via shared pills, with the page resetting to the first page on filter change.
  - **Pagination defaults aligned with selector options.** Several pages defaulted to a page size (5 or 20) that wasn't in the dropdown's options (`[10, 25, 50, 100]`), so the page-size `<Select>` rendered empty. The drawer's Recent Runs now defaults to 10; the Run History, History List, and Delivery Logs pages now default to 25.

  Includes Drizzle migrations adding the `notification_policy` jsonb column to `system_health_checks`, plus two new tables: `health_check_unhealthy_transitions` (for threshold counting) and `health_check_auto_incidents` (for mapping back to incident ids during auto-close).

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/incident-common@1.3.0
  - @checkstack/backend-api@0.17.1
  - @checkstack/cache-api@0.3.5
  - @checkstack/catalog-backend@1.1.6
  - @checkstack/command-backend@0.1.30
  - @checkstack/integration-backend@0.1.30
  - @checkstack/cache-utils@0.2.10

## 1.1.5

### Patch Changes

- f23f3c9: Phase 12 of the v1 polishing plan: three coordinated cleanup items that
  close out half-finished features ahead of v1.0.

  `@checkstack/incident-backend` adds focused unit-test coverage for
  `IncidentService.hasActiveIncidentWithSuppression` in
  `core/incident-backend/src/service.test.ts`. The new tests exercise the
  real query-builder logic against a programmable mock data source and
  pin down the active-only silencing contract: returns `true` only when
  an unresolved incident with `suppressNotifications=true` is associated
  with the queried `systemId`; returns `false` for resolved incidents,
  incidents with `suppressNotifications=false`, systems with no incident
  associations, and other systems' silenced incidents. No runtime
  changes; the service code was already correct end-to-end (write path
  through `IncidentEditor`, read path through the healthcheck queue
  executor and dependency notifications). A companion docs page,
  `docs/src/content/docs/architecture/alert-silencing.md`, documents the
  contract, the two read sites, and the dispatch paths silencing does
  NOT cover so users aren't surprised when an unaware channel keeps
  firing.

  `@checkstack/auth-frontend` surfaces inline role assignment inside the
  user-creation dialog so admins can pick role(s) atomically with the
  create call. `CreateUserDialog` now renders a checkbox list of
  assignable roles (those with `isAssignable !== false`); on submit,
  `UsersTab` awaits `createCredentialUser`, then immediately calls
  `updateUserRoles` with the selected role IDs. On partial failure
  (user created, role assignment failed) the UI surfaces a warning toast
  naming the recovery path rather than silently misreporting success. No
  new endpoints — reuses the existing `createCredentialUser` +
  `updateUserRoles` contract pair. A companion docs page,
  `docs/src/content/docs/architecture/users-and-teams.md`, documents the
  identity / role / team model, the two S2S endpoints
  (`checkResourceTeamAccess`, `getAccessibleResourceIds`) other plugins
  should call to honour team grants, and explicitly defers audit
  logging, CSV export, team-scoped resource-management UI, and deletion
  side-effect handling to v1.1.

  The third item — deleting the empty `core/status-frontend/` and
  `core/status-page-backend/` shells — is tooling-only and intentionally
  ships without a changeset; neither shell had a `package.json`, source
  file, or downstream importer.

- f23f3c9: Add `correlationMiddleware` to `@checkstack/backend-api` and apply it
  to every plugin/core router so each request carries a stable
  `x-correlation-id` (read from the inbound header, or freshly minted
  via `crypto.randomUUID()` when absent) and an auto-injected child
  logger bound with `{ correlationId, pluginId, userId? }`. The ID is
  echoed back on the response header so the caller can correlate their
  client-side trace to the server logs.

  The `Logger` interface in `@checkstack/backend-api` now formally
  documents the structured-metadata convention (`logger.info("msg",
{ ...meta })`) alongside the long-standing varargs shape. Winston's
  splat handling already routes both shapes through the same vararg
  slot, so existing call sites are unaffected. A new optional
  `Logger.child(meta)` method captures the metadata-binding contract the
  new middleware relies on; production loggers always implement it,
  minimal test mocks may omit it (the middleware falls back gracefully).

  `RpcContext` grew two optional `Headers` bags, `requestHeaders` and
  `responseHeaders`, populated by the outer Hono `/api/*` and `/rest/*`
  handlers in `@checkstack/backend`. They are write-through observation
  points for middleware; an `RpcContext` constructed without them (S2S
  clients, tests) keeps working — the echo is a silent no-op and the ID
  is still bound onto the child logger for server-side correlation.

  The scaffolding template in `@checkstack/scripts` was updated so any
  new plugin generated via `bun run create` wires the middleware in the
  expected `.use(correlationMiddleware).use(autoAuthMiddleware)` order
  out of the box.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/catalog-backend@1.1.5
  - @checkstack/command-backend@0.1.29
  - @checkstack/integration-backend@0.1.29
  - @checkstack/notification-common@1.2.0
  - @checkstack/integration-common@0.5.0
  - @checkstack/auth-common@0.7.1
  - @checkstack/catalog-common@2.2.2
  - @checkstack/incident-common@1.2.2
  - @checkstack/signal-common@0.2.4
  - @checkstack/cache-api@0.3.4
  - @checkstack/cache-utils@0.2.9

## 1.1.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/notification-common@1.1.1
  - @checkstack/cache-api@0.3.3
  - @checkstack/catalog-backend@1.1.4
  - @checkstack/command-backend@0.1.28
  - @checkstack/integration-backend@0.1.28
  - @checkstack/catalog-common@2.2.1
  - @checkstack/incident-common@1.2.1
  - @checkstack/cache-utils@0.2.8

## 1.1.3

### Patch Changes

- b33fb4d: Refresh `bun.lock` to clear MEDIUM-severity Trivy advisories on transitive
  runtime dependencies. No public API change — bumping every workspace
  package that lists `@orpc/server` as a direct dep so consumers re-resolve
  the optional `ws` peer to the patched release on their next install.

  - `ws` `8.20.0` → `8.20.1` (CVE-2026-45736). Pulled into the install tree
    as `@orpc/server`'s optional WebSocket peer; Bun auto-installs it into
    every backend package that depends on `@orpc/server`, so a stale 8.20.0
    ships in the consumer's `node_modules` until the parent package
    re-resolves.
  - `brace-expansion` `5.0.5` → `5.0.6` (CVE-2026-45149). Pulled in only
    through dev tooling (`minimatch@10` via `@typescript-eslint` and
    `storybook`'s `glob@13`), so it does not ship to consumers and no
    workspace `package.json` lists it; the lockfile bump alone clears the
    finding for the Docker image and the local dev tree. No version bump
    is attributed to this advisory.

  The fix lives entirely in `bun.lock` — no `package.json`, `overrides`, or
  `resolutions` change is needed because both parent ranges (`minimatch@10
→ brace-expansion@^5.0.5`, `@orpc/server / storybook / happy-dom →
ws@>=8.18.x`) already accept the patched releases, and `bun install`
  keeps the resolved versions sticky after the initial `bun update`.

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/catalog-backend@1.1.3
  - @checkstack/command-backend@0.1.27
  - @checkstack/integration-backend@0.1.27
  - @checkstack/cache-api@0.3.2
  - @checkstack/cache-utils@0.2.7

## 1.1.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/catalog-backend@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/auth-common@0.7.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/incident-common@1.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/integration-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/catalog-backend@1.1.1
  - @checkstack/command-backend@0.1.26
  - @checkstack/integration-backend@0.1.26
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 1.1.0

### Minor Changes

- 1ef2e79: feat: hotlinks on incidents/maintenances and additional links on systems

  Users with `manage` access on an incident, maintenance, or system can now
  attach free-form URL "hotlinks" — Jira tickets, runbooks, dashboards, ticket
  tools, etc. — alongside the existing fields.

  - **Incidents** & **maintenances**: links live on the entity itself and are
    surfaced both in the editor dialog and on the public detail page. Two new
    RPC procedures per plugin (`addLink`, `removeLink`) gated behind the
    existing `manage` access rule. Links are returned as part of
    `getIncident` / `getMaintenance` and cache-invalidated on every link
    mutation.
  - **Systems**: a parallel `system_links` table with `getSystemLinks`,
    `addSystemLink`, `removeSystemLink` procedures. Surfaced inside the
    system editor (next to contacts) and on the read-only system detail
    sidebar. Cache-scoped per-system so list endpoints remain hot.
  - **Shared UI**: a `LinksEditor` component in `@checkstack/ui` does the
    presentation; the three plugins each own their own RPC wiring.

  Database changes ship as additive migrations (new `incident_links`,
  `maintenance_links`, `system_links` tables, all FK-cascaded on parent
  delete). No existing columns or rows are touched.

  The system incident and maintenance history pages now sort by relevance:
  active entries (non-`resolved` incidents, `scheduled` or `in_progress`
  maintenances) appear at the top, with creation date descending as the
  tiebreaker.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/incident-common@1.1.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/catalog-backend@1.1.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/auth-common@0.6.6
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/integration-backend@0.1.25
  - @checkstack/integration-common@0.3.2
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-common@0.2.2
  - @checkstack/cache-utils@0.2.5

## 1.0.2

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
  (including private GitHub Enterprise instances), or tarball uploads at
  runtime, with multi-package bundles, dependency-derived compatibility checks,
  multi-instance coordination via a Postgres artifact store, and
  single-coordinator destructive cleanup.

  Highlights:

  - New `PluginSource` discriminated union and `PluginInstaller` /
    `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
    GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
    GitHub Enterprise can install from `https://ghe.example.com/api/v3`
    instead of `api.github.com`.
  - New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
    every plugin's `package.json` at install time. Required fields: `name`,
    `version`, `description`, `author`, `license`, `checkstack.type`,
    `checkstack.pluginId`. Optional: `checkstack.bundle`,
    `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
  - New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
    `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
    `events` procedures.
  - New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
    with per-row uninstall (typed-confirmation modal, schema/configs/cascade
    toggles), install page with NPM / Tarball Upload / GitHub Release tabs
    (Catalog tab disabled — coming soon), and an events page surfacing the
    install/uninstall audit log.
  - New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
    per-package mode produces an npm-shaped tarball; `--bundle` mode produces
    an outer tarball containing every sibling declared in
    `package.json#checkstack.bundle`. Published to npm so external authors
    can `bunx` it directly without a workspace checkout.
  - Compatibility derived from `package.json#dependencies` ranges
    (`semver.satisfies` against the platform's loaded `@checkstack/*`
    versions) — no separate `compatibility` field.
  - Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
    install/uninstall; receiving instances do in-process register/unregister
    only. Destructive ops (drop schema, delete plugin_configs, delete
    artifacts, delete `plugins` rows) run exactly once on the originator.
  - Fresh-instance bootstrap: `loadPlugins()` hydrates any
    `is_uninstallable=true` plugin missing from `node_modules` from the
    artifact store before normal Phase 1 register.
  - New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
    (audit/error log). `plugins` extended with `version`, `metadata`,
    `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
    `version` from each plugin's `package.json` so the admin UI shows real
    versions instead of `—`.
  - Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
    the install UI; access-gated by `pluginmanager.plugin.manage`.
  - Plugin Manager menu link added to the user menu (main grid, alongside
    Profile / Notification Settings / etc.).

  Cross-cutting changes:

  - Backend request/response logging now flows through `rootLogger` (winston)
    instead of `hono/logger`. 5xx responses include the response body inline
    so swallowed early-return errors are visible in the log.
  - The `/api/:pluginId/*` dispatcher now logs which core service is missing
    or which `pluginId` had no metadata when it 500s.
  - New `registerCorePluginMetadata` on `PluginManager` for core routers
    (like the plugin manager itself) that need their metadata visible to the
    RPC dispatcher without going through the full plugin lifecycle.
  - ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
    between `null` (writes a real SQL NULL) and `undefined` (skip the column
    on insert), so treating them as interchangeable produced latent bugs at
    the persistence boundary. The bulk of the patch-bumped packages above
    reflect lint-fix touches that landed when this rule was relaxed.
  - Workspace-wide license normalization to `Elastic-2.0` (matches
    `LICENSE.md`). Every `package.json` in the workspace now declares the
    same SPDX identifier; the patch bumps capture this.

  Plugin packages (every `plugins/*`): added a `pack` npm script
  (`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
  `pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
  so install-time validation passes, stubbed any missing required metadata
  fields (`description`, `author`, `license`), and added
  `checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
  jira, queue-bullmq, queue-memory, cache-memory).

  Breaking changes:

  - The legacy single-method `PluginInstaller` interface (`install(packageName)`)
    is removed. Callers must use `coreServices.pluginInstallerRegistry`.
  - The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
    Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
    and `createPluginManagerRouter` in `core/backend`.
  - `@checkstack/test-utils-backend` no longer exports
    `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
    it shimmed is gone).

  Note: bumps are limited to `minor` (for packages with new public API
  surface) and `patch` (for downstream consumers, license normalization,
  and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
  the legacy interface had no third-party consumers in the wild before this
  runtime plugin system landed, and the contract surface is the same shape
  modulo the rename.

- Updated dependencies [50e5f5f]
  - @checkstack/auth-common@0.6.5
  - @checkstack/backend-api@0.15.0
  - @checkstack/catalog-backend@1.0.2
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/integration-common@0.3.1
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/incident-common@1.0.1
  - @checkstack/integration-backend@0.1.24
  - @checkstack/notification-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 1.0.1

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/catalog-backend@1.0.1
  - @checkstack/command-backend@0.1.23
  - @checkstack/integration-backend@0.1.23
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-utils@0.2.3
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/notification-common@1.0.0
  - @checkstack/signal-common@0.2.0

## 1.0.0

### Major Changes

- 32d52c6: feat: notification target pattern + per-spec subscriptions

  Replaces the all-or-nothing catalog system/group notification model with a
  platform-level target pattern. Each notification-emitting plugin declares
  _subscription specs_ against typed _target_ objects exported from the
  target's owning plugin (catalog ships `catalogSystemTarget` and
  `catalogGroupTarget`). Notification-backend handles every per-resource
  group lifecycle, parent-edge inheritance, and legacy-subscription seeding
  — plugins never author groupId helpers, lifecycle hooks, or migration
  code again.

  **Plugin-author surface area is now ~12 lines per emitter:**

  ```ts
  // <plugin>-common
  const { defineSubscription } = createSubscriptionFactory(pluginMetadata);
  export const fooSystemSubscription = defineSubscription({
    localId: "system",
    target: catalogSystemTarget,
    display: { title: "Foo Alerts", description: "...", iconName: "Bell" },
  });

  // <plugin>-backend register()
  env.registerSubscriptionSpecs([fooSystemSubscription]);
  //   ^ feeds the plugin loader's dependency sorter — each spec's
  //     target.ownerPlugin becomes an implicit init-order dep, so this
  //     plugin automatically waits for catalog (the target owner) to
  //     finish init + afterPluginsReady before its own runs.

  // <plugin>-backend afterPluginsReady
  await notificationClient.registerSubscriptionSpec(
    specToRegistration(fooSystemSubscription)
  );
  // dispatch
  await notificationClient.notifyForSubscription({
    specId: fooSystemSubscription.specId,
    resourceKeys: [systemId],
    title,
    body,
    importance,
    action,
    collapseKey,
    subjects,
  });

  // <plugin>-frontend
  createNotificationSubscriptionExtension({ spec: fooSystemSubscription });
  ```

  **Migrated plugins**: anomaly, incident, maintenance, healthcheck,
  dependency. Each lost its bespoke `notification-groups.ts`,
  `bootstrap*NotificationGroups`, `ensure*Group`, and inheritance walk —
  all of that is now centralized in notification-backend's
  `subscription-engine`.

  **Plugin loader change** (`@checkstack/backend-api`,
  `@checkstack/backend`): the register-time API gains
  `env.registerSubscriptionSpecs([...specs])`. The dependency sorter
  walks `spec.target.ownerPlugin` for every declared spec and adds the
  target owner as an init-order dependency of the emitting plugin. This
  guarantees that catalog (the owner of the platform's `system` and
  `group` targets) completes init + afterPluginsReady before any
  emitting plugin tries to register its specs against the notification
  service — no string-prefix heuristics, no manual `dependsOnPlugins`
  list, no stub rows. Plugins that fail to declare their specs at
  register time get a clear `Target type X is not registered. Did the
emitting plugin declare this spec via env.registerSubscriptionSpecs?`
  error from the dispatcher.

  **Removed** (no backwards compat):

  - `catalogClient.notifySystemSubscribers` and
    `catalogClient.notifyManySystemSubscribers`
  - `notificationClient.notifyUsers` and `notificationClient.notifyGroups`
    as direct dispatch primitives — replaced by spec-bound
    `notifyForSubscription`
  - catalog's `bootstrapNotificationGroups` (replaced by
    `bootstrapNotificationTargets`)

  **Enforcement**: the dispatcher rejects calls referencing unregistered
  specIds, specs owned by other plugins, or resourceKeys that haven't been
  pushed via `upsertNotificationResource`. Display metadata for any
  groupId is recoverable via the spec registry, so audit lists render
  correct labels even when an emitter's frontend isn't loaded.

  **Per-field anomaly mute** keeps working — it now lives inside the
  generic SubscriptionRow's optional `SubControls` panel
  (`AnomalyFieldMuteList`), exposed through the catalog system detail
  page's notifications card.

  The catalog system detail page renders a "Notifications" card hosting
  `SystemNotificationSubscriptionsSlot`. The matching group surface is
  not yet rendered — group-level subscriptions are wired end-to-end on
  the backend; a follow-up will add the host UI.

  **Migration of existing subscribers**: target types declare a
  `legacyGroupIdTemplate`; on first registration of each spec,
  notification-backend reads subscribers from the legacy
  `catalog.system.<id>` / `catalog.group.<id>` groups and seeds the new
  spec groups exactly once per (spec × resource) pair, tracked in
  `subscription_migrations`. Anomaly stays opt-in (its target also
  declares the template, but the user-explicit nature of the original
  opt-in flow means the seeding produces the same set of subscribers
  they already had).

### Minor Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/integration-backend@0.1.22
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-backend@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/cache-utils@0.2.2

## 0.6.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/incident-common@0.5.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/integration-backend@0.1.21
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-backend@0.7.1
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/cache-utils@0.2.1

## 0.6.0

### Minor Changes

- 8d1ef12: ## Anomaly Detection & UI Improvements

  ### Anomaly Detection Enhancements (Phase 2)

  - **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
  - **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
  - **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
  - **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
  - **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
  - **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

  ### Notification Identifiers

  - **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
  - **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

  ### UI Experience

  - **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
  - **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
  - **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.

- 8d1ef12: ## Per-entity caching with single-flight + safe invalidation across the dashboard hot paths

  ### `@checkstack/cache-api`

  - **Breaking** for backend implementors: `CacheProvider` now requires `deleteByPrefix(prefix: string): Promise<number>` for family-level invalidation. The in-memory provider implements it; downstream providers (Redis, etc.) must add it before upgrading.
  - `createScopedCache` forwards `deleteByPrefix` and keeps prefixes scoped to the calling plugin.

  ### `@checkstack/cache-utils` (new package)

  High-level read-through caching helpers built on `CacheProvider`:

  - `createCachedScope({ cacheManager, pluginId })` returns a scope with `wrap`, `wrapMany`, `invalidate`, and `invalidatePrefix`.
  - **Single-flight**: concurrent cache misses for the same key share one loader.
  - **Per-entity bulk caching** via `wrapMany` so list/bulk RPCs cache by id rather than by the full input shape — overlapping callers share entries and invalidation stays exact.
  - **Race-safe invalidation** via per-key epoch counters: a loader started before a mutation cannot repopulate the cache with stale data after the mutation invalidates it. The mutation invariant is `db.write → cache.invalidate (await) → signals.emit`.
  - Cache failures fall through to the loader so a cache outage cannot break reads.

  ### `@checkstack/backend`

  - The internal null `CacheProvider` (used when no cache backend is configured) now implements the new `deleteByPrefix` method as a no-op. Patch bump only — no behavior change for existing callers.

  ### `@checkstack/healthcheck-backend`

  - `getSystemHealthStatus` and `getBulkSystemHealthStatus` now read through a per-system cache (`healthcheck:status:<systemId>`), eliminating N database queries per dashboard refresh for unchanged systems.
  - Mutation paths (configuration CRUD, system associations, satellite ingest, queue-driven check runs, system/satellite removal hooks) invalidate affected keys before broadcasting their signals so frontend refetches always observe fresh data.

  ### `@checkstack/incident-backend`

  - `listIncidents`, `getIncident`, `getIncidentsForSystem`, and `getBulkIncidentsForSystems` now read through a scoped cache:
    - per-incident at `incident:<id>`
    - per-system at `system:<systemId>`
    - per-filter-shape at `list:<stable-stringify(filters)>` for the few list shapes the dashboard polls
  - Mutations (`createIncident`, `updateIncident`, `addUpdate`, `resolveIncident`, `deleteIncident`) invalidate the incident, every affected system, and every cached list before broadcasting `INCIDENT_UPDATED`.
  - The catalog `systemDeleted` cleanup hook drops that system's cached entries.

  ### `@checkstack/maintenance-backend`

  - `listMaintenances`, `getMaintenance`, `getMaintenancesForSystem`, and `getBulkMaintenancesForSystems` use the same per-entity / per-system / per-filter-shape pattern as incidents.
  - Mutations (`createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`, `deleteMaintenance`) invalidate before broadcasting `MAINTENANCE_UPDATED`.

  ### `@checkstack/catalog-backend`

  - Topology reads (`getEntities`, `getSystems`, `getSystem`, `getGroups`, `getSystemGroupIds`) cache under the `entity:` family (25s TTL).
  - Views (`getViews`) and per-system contacts (`getSystemContacts`) cache in their own families.
  - System / group / membership mutations drop the entire `entity:` family (every reader joins the same tables); view and contact mutations drop only their respective scopes.

  ### `@checkstack/slo-backend`

  - `listObjectives`, `getObjective`, `getObjectivesForSystem`, and `getBulkObjectivesForSystems` cache results including the expensive `engine.computeStatus` output.
  - Per-entity caching for the bulk handler so dashboards with overlapping system sets share entries.
  - Mutations (`createObjective`, `updateObjective`, `deleteObjective`) invalidate before broadcasting `SLO_STATUS_CHANGED`.

  ### `@checkstack/anomaly-backend`

  - New `router-cache.ts` adds a cache scope distinct from the existing detector baseline cache, keyed by stable filter hash.
  - `getAnomalies` and `getAnomalyBaselines` cache through this scope (15s TTL).
  - The detector invalidates the router cache before broadcasting `ANOMALY_STATE_CHANGED` on every state transition (suspicious/anomaly/recovered).
  - Config mutations also invalidate.

  ### `@checkstack/notification-backend`

  - `getUnreadCount`, `getNotifications`, and `getSubscriptions` cache per-user.
  - `markAsRead`, `deleteNotification`, `notifyUsers`, and `notifyGroups` invalidate every affected user's cache before sending realtime signals to that user.
  - `subscribe` and `unsubscribe` invalidate the user's subscription cache.

  ### `@checkstack/announcement-backend`

  - `getActiveAnnouncements` caches per-user (or anonymous) and per-`includeDismissed` flag (45s TTL — admin-driven, slowly changing).
  - `listAllAnnouncements` caches under a single key.
  - `dismissAnnouncement` only drops that user's cache; `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` drop every user's cache before broadcasting `ANNOUNCEMENT_UPDATED`.
  - The auth `userDeleted` cleanup hook drops that user's cached entries.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/catalog-backend@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/auth-common@0.6.3
  - @checkstack/catalog-common@1.5.2
  - @checkstack/command-backend@0.1.20
  - @checkstack/incident-common@0.4.9
  - @checkstack/integration-backend@0.1.20
  - @checkstack/integration-common@0.2.9
  - @checkstack/signal-common@0.1.10

## 0.5.1

### Patch Changes

- @checkstack/catalog-common@1.5.1
- @checkstack/incident-common@0.4.8
- @checkstack/catalog-backend@0.6.1

## 0.5.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0

## 0.4.25

### Patch Changes

- @checkstack/catalog-backend@0.5.4

## 0.4.24

### Patch Changes

- @checkstack/catalog-backend@0.5.3

## 0.4.23

### Patch Changes

- @checkstack/catalog-backend@0.5.2

## 0.4.22

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-common@0.6.2
  - @checkstack/catalog-backend@0.5.1
  - @checkstack/catalog-common@1.4.1

## 0.4.21

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/catalog-backend@0.5.0

## 0.4.20

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4

## 0.4.19

### Patch Changes

- Updated dependencies [cb65e9d]
  - @checkstack/catalog-backend@0.4.3

## 0.4.18

### Patch Changes

- @checkstack/catalog-backend@0.4.2

## 0.4.17

### Patch Changes

- @checkstack/catalog-backend@0.4.1

## 0.4.16

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0

## 0.4.15

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0

## 0.4.14

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24
  - @checkstack/command-backend@0.1.19
  - @checkstack/integration-backend@0.1.19

## 0.4.13

### Patch Changes

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/catalog-backend@0.2.23
  - @checkstack/integration-backend@0.1.18
  - @checkstack/catalog-common@1.3.1
  - @checkstack/auth-common@0.6.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/incident-common@0.4.7
  - @checkstack/integration-common@0.2.8
  - @checkstack/signal-common@0.1.9

## 0.4.12

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/catalog-backend@0.2.22
  - @checkstack/command-backend@0.1.17
  - @checkstack/integration-backend@0.1.17

## 0.4.11

### Patch Changes

- Updated dependencies [3f36a64]
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/catalog-backend@0.2.21
  - @checkstack/command-backend@0.1.16
  - @checkstack/integration-backend@0.1.16

## 0.4.10

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/catalog-backend@0.2.20
  - @checkstack/command-backend@0.1.15
  - @checkstack/integration-backend@0.1.15

## 0.4.9

### Patch Changes

- @checkstack/catalog-backend@0.2.19

## 0.4.8

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/auth-common@0.6.0
  - @checkstack/catalog-backend@0.2.18
  - @checkstack/command-backend@0.1.14
  - @checkstack/integration-backend@0.1.14
  - @checkstack/catalog-common@1.2.11

## 0.4.7

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/auth-common@0.5.7
  - @checkstack/backend-api@0.8.2
  - @checkstack/catalog-backend@0.2.17
  - @checkstack/catalog-common@1.2.10
  - @checkstack/command-backend@0.1.13
  - @checkstack/common@0.6.4
  - @checkstack/incident-common@0.4.6
  - @checkstack/integration-backend@0.1.13
  - @checkstack/integration-common@0.2.7
  - @checkstack/signal-common@0.1.8

## 0.4.6

### Patch Changes

- @checkstack/catalog-backend@0.2.16

## 0.4.5

### Patch Changes

- @checkstack/catalog-common@1.2.9
- @checkstack/incident-common@0.4.5
- @checkstack/catalog-backend@0.2.15

## 0.4.4

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/auth-common@0.5.6
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/integration-backend@0.1.12
  - @checkstack/catalog-backend@0.2.14
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-backend@0.1.12
  - @checkstack/incident-common@0.4.4
  - @checkstack/integration-common@0.2.6
  - @checkstack/signal-common@0.1.7

## 0.4.3

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/catalog-backend@0.2.13
  - @checkstack/command-backend@0.1.11
  - @checkstack/integration-backend@0.1.11

## 0.4.2

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/catalog-backend@0.2.12
  - @checkstack/command-backend@0.1.10
  - @checkstack/integration-backend@0.1.10

## 0.4.1

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/auth-common@0.5.5
  - @checkstack/catalog-backend@0.2.11
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-backend@0.1.9
  - @checkstack/incident-common@0.4.3
  - @checkstack/integration-backend@0.1.9
  - @checkstack/integration-common@0.2.5
  - @checkstack/signal-common@0.1.6

## 0.4.0

### Minor Changes

- c208a5b: ### @checkstack/incident-backend

  Added notifications for incident status changes via the "Add Update" functionality:

  - Notifications are now sent when an incident is reopened (status changed from resolved)
  - Notifications are now sent when an incident status changes to any new value
  - Notifications are now sent when an incident is resolved via addUpdate
  - Extracted `notifyAffectedSystems` into a reusable module with proper importance logic:
    - Resolved incidents always use "info" importance (good news)
    - Reopened/created/updated incidents derive importance from severity

  ### @checkstack/maintenance-backend

  Fixed missing notification in `closeMaintenance` handler - the "Close" button now sends a "completed" notification to subscribers.

### Patch Changes

- 9551fd7: Fix creator display in incident and maintenance status updates

  - Show the creator's profile name instead of UUID in status updates
  - For maintenances, now properly displays the creator name (was missing)
  - For incidents, replaces UUID with human-readable profile name
  - System-generated updates (automatic maintenance transitions) show no creator

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/incident-common@0.4.2
  - @checkstack/catalog-backend@0.2.10

## 0.3.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/catalog-backend@0.2.9
  - @checkstack/catalog-common@1.2.5
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/incident-common@0.4.1
  - @checkstack/integration-backend@0.1.8
  - @checkstack/integration-common@0.2.4
  - @checkstack/signal-common@0.1.5

## 0.3.0

### Minor Changes

- cce5453: Add notification suppression for incidents

  - Added `suppressNotifications` field to incidents, allowing active incidents to optionally suppress health check notifications
  - When enabled, health status change notifications will not be sent for affected systems while the incident is active (not resolved)
  - Mirrors the existing maintenance notification suppression pattern
  - Added toggle UI in the IncidentEditor dialog
  - Added `hasActiveIncidentWithSuppression` RPC endpoint for service-to-service queries

### Patch Changes

- Updated dependencies [cce5453]
  - @checkstack/incident-common@0.4.0

## 0.2.8

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/catalog-backend@0.2.8
  - @checkstack/catalog-common@1.2.4
  - @checkstack/command-backend@0.1.7
  - @checkstack/incident-common@0.3.4
  - @checkstack/integration-backend@0.1.7
  - @checkstack/integration-common@0.2.3
  - @checkstack/signal-common@0.1.4

## 0.2.7

### Patch Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/catalog-backend@0.2.7
  - @checkstack/integration-backend@0.1.6
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.2.6

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/incident-common@0.3.3
  - @checkstack/catalog-backend@0.2.6
  - @checkstack/command-backend@0.1.5
  - @checkstack/integration-backend@0.1.5
  - @checkstack/integration-common@0.2.2
  - @checkstack/signal-common@0.1.3

## 0.2.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/catalog-backend@0.2.5
  - @checkstack/command-backend@0.1.4
  - @checkstack/integration-backend@0.1.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/incident-common@0.3.2
  - @checkstack/integration-common@0.2.1
  - @checkstack/signal-common@0.1.2

## 0.2.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/catalog-backend@0.2.4
  - @checkstack/command-backend@0.1.3
  - @checkstack/integration-backend@0.1.3

## 0.2.3

### Patch Changes

- @checkstack/catalog-common@1.2.1
- @checkstack/incident-common@0.3.1
- @checkstack/catalog-backend@0.2.3

## 0.2.2

### Patch Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/catalog-common@1.2.0
  - @checkstack/incident-common@0.3.0
  - @checkstack/integration-common@0.2.0
  - @checkstack/integration-backend@0.1.2
  - @checkstack/catalog-backend@0.2.2
  - @checkstack/command-backend@0.1.2
  - @checkstack/signal-common@0.1.1

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/integration-backend@0.1.1
- @checkstack/catalog-backend@0.2.1
- @checkstack/command-backend@0.1.1

## 0.2.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/catalog-backend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/incident-common@0.2.0
  - @checkstack/integration-backend@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-common@0.1.0

## 0.1.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/integration-backend@0.0.4
  - @checkstack/integration-common@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/catalog-backend@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/integration-backend@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/incident-common@0.0.3
  - @checkstack/integration-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/integration-backend@0.0.2
  - @checkstack/integration-common@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.0.4

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-backend@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/incident-common@0.1.2
  - @checkstack/integration-common@0.1.1
  - @checkstack/signal-common@0.1.1

## 0.0.3

### Patch Changes

- @checkstack/catalog-common@0.1.1
- @checkstack/incident-common@0.1.1
- @checkstack/catalog-backend@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/catalog-backend@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/integration-backend@0.0.2
