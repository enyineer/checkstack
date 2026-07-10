# @checkstack/anomaly-common

## 1.8.0

### Minor Changes

- 1f20b5a: fix(anomaly): clear a suspicious anomaly from the dashboard when it resolves

  A `suspicious` anomaly row that never reached its confirmation threshold is
  DELETED rather than moved to `recovered`. Both delete paths - the inline spike
  detector and the hourly drift evaluator - performed that delete silently: no
  `invalidateAnomalies()` on the router-level cache and no `ANOMALY_STATE_CHANGED`
  broadcast, unlike every other transition around them. Because the frontend drops
  stale dashboard state exclusively via the signal bus (`SignalAutoInvalidator`
  invalidates `[[pluginId]]` on any incoming signal), nothing ever told the
  dashboard to refetch. The "Suspicious behaviour" badge, the system-detail widget
  and the aggregated system signal therefore stayed on screen until an incidental
  refetch (remount or window refocus) happened to fire - the suspicion showed up
  correctly but never went away when it turned out to be nothing.

  Both delete branches now drop the cache and broadcast, so the badge disappears
  as soon as the metric returns to normal.

  The drift evaluator additionally never invalidated the router cache on ANY of
  its writes (create / confirm / self-resolve / recover), so a forced refetch could
  still read a stale anomaly list back out of the 15s server-side cache. It now
  invalidates on every row write, matching the spike detector. To make this
  possible the router cache is constructed before the baseline-analyzer job is
  scheduled and threaded into `evaluateDrift`.

  BREAKING CHANGE: `ANOMALY_STATE_CHANGED`'s `newState` is now typed by the new
  `AnomalyStateChangeSchema` (`suspicious` | `anomaly` | `recovered` | `cleared`)
  rather than the persisted `AnomalyStateSchema`. The added `cleared` value marks
  "an unconfirmed suspicious row was deleted", which has no persisted state to
  report. It is deliberately distinct from `recovered`: a suspicious row never
  produced a "confirmed" notification, so clearing it must not look like a
  recovery to a subscriber that alerts on one. Consumers that exhaustively switch
  on `newState` must handle `cleared`; consumers that only invalidate caches (the
  platform default) need no change.

### Patch Changes

- @checkstack/catalog-common@2.7.2
- @checkstack/healthcheck-common@1.16.2

## 1.7.2

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/notification-common@1.7.0
  - @checkstack/catalog-common@2.7.1
  - @checkstack/healthcheck-common@1.16.1

## 1.7.1

### Patch Changes

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
  - @checkstack/catalog-common@2.7.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/notification-common@1.6.0

## 1.7.0

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

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/catalog-common@2.6.3
  - @checkstack/notification-common@1.5.3
  - @checkstack/signal-common@0.2.17

## 1.6.2

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/catalog-common@2.6.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/signal-common@0.2.16

## 1.6.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/catalog-common@2.6.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/signal-common@0.2.15

## 1.6.0

### Minor Changes

- 52c55bf: Anomaly baselines are now per-environment, so the env-scoped
  `HealthCheckDrawer` shows the clicked env's baseline (not a cross-env
  one). Closes the follow-up noted in `healthcheck-per-env-rollup`.

  ## What changed

  - **`anomaly_baselines`** now carries a nullable `environment_id`
    column, and its unique constraint grew to
    `(systemId, configurationId, environmentId, fieldPath)` with
    `NULLS NOT DISTINCT` — so there is exactly one baseline per
    `(system, config, env, path)` tuple, and the env-less slice (`NULL`)
    stays a single row (the pre-feature cross-env baseline, preserved as
    the env-less row until the next analyzer tick rewrites per-env rows).
    Existing rows backfill to `environment_id = NULL` with no data work.
  - **Baseline analyzer** (`jobs/baseline-analyzer.ts`) now fans out per
    environment within each assignment: runs are grouped by
    `environmentId` (null = env-less), stats are computed per env, and
    the upsert targets the 4-tuple. The cache key gained an env segment
    (`baseline:${config}:${system}:${env ?? "<none>"}:${path}`) and the
    `ANOMALY_BASELINE_UPDATED` signal payload now carries `environmentId`.
    Previously the analyzer computed one cross-env batch per assignment.
  - **Inline detector** (`detector.ts`) resolves the per-env baseline:
    the lookup matches `environmentId` when present or `IS NULL` for the
    env-less slice, and the cache key matches the analyzer's env segment.
    `environmentId` is threaded from the `checkCompleted` hook (see
    below); it defaults to `null` (env-less) so a caller that omits it
    resolves the env-less baseline rather than failing.
  - **`getAnomalyBaselines` RPC** now accepts an optional
    `environmentId: string | null` filter and surfaces `environmentId` on
    every `AnomalyBaselineDto`. Tristate semantics, mirroring
    `getHistory`: `undefined` → all envs (no predicate), `null` → env-less
    slice (`IS NULL`), a string → that env. The service predicate is at
    the DB layer.
  - **`HealthCheckDrawer`** threads `item.environmentId` (already on its
    props) into the baselines query, so the drawer's anomaly overlay
    resolves server-side to the clicked env's baseline only — matching the
    env-scoping already applied to its history table and charts. The
    latency chart tolerates the new field (it picks the single
    `"latencyMs"` baseline, which the env filter guarantees is unique).
  - **`getRunsForAnalysis`** (healthcheck) now returns `environmentId`
    on each run so the analyzer can group by env. Additive optional
    field; only the analyzer consumes it.
  - **`checkCompleted` / `checkFailed` hooks** (healthcheck) now carry
    `environmentId: string | null` on their payloads, sourced from the
    per-env execution loop. Only the anomaly detector subscribes to
    `checkCompleted` (it was updated); the failure-path emit (rollup
    error) passes `null`.

  ## Notes

  - Anomaly _rows_ (`anomalies` table) remain cross-env by design in this
    step — only baselines are env-scoped, matching the scoped task. A
    detector run for env A and env B's normal value still share one
    `(system, config, path)` anomaly row; env-scoping the anomalies table
    is tracked as a separate follow-up so this change stays focused on
    the drawer's baseline overlay.
  - The `checkCompleted` / `checkFailed` payload change is technically
    breaking for hook subscribers that destructure the payload, but the
    only in-tree subscriber (the anomaly plugin) was updated in lockstep.
    External webhook subscribers receive an additional field and are not
    affected unless they reject unknown keys (uncommon).
  - Migration `0006_sad_retro_girl.sql` drops + recreates the unique
    constraint with `NULLS NOT DISTINCT` and adds the column. It applies
    cleanly to fresh and already-populated DBs (existing NULL-env rows
    remain unique under the new key).

- 5236e41: Scope anomaly rows by (check, environment), completing the deferred follow-up
  from the per-environment work in #375 (which env-scoped only baselines).

  Previously the `anomalies` table was cross-environment: the inline spike
  detector and the drift evaluator located and created the open row by
  `(systemId, configurationId, fieldPath, kind)` with no environment predicate.
  When a `(system, configuration)` assignment fanned out to multiple environments,
  a healthy value in environment A shared one row with an anomaly in environment B,
  so one env could mask (or merge with) another.

  - **Schema.** New nullable `anomalies.environment_id` column (migration
    `0007_uneven_trauma.sql`, a single `ADD COLUMN`). No unique constraint is
    added: the table intentionally allows multiple rows per identity tuple (a
    `recovered` historical row plus a fresh active row), so uniqueness would break
    the state machine.
  - **Detection.** The spike detector (from the `checkCompleted` hook) and the
    drift evaluator (from the analyzer's per-environment loop) now locate/create
    the open row by `(systemId, configurationId, environmentId, fieldPath, kind)`,
    matching `environment_id = <id>` when present or `IS NULL` for the env-less
    slice - mirroring the per-environment baseline lookup.
  - **Reads.** `getAnomalies` gains an optional `environmentId` tristate filter
    (`undefined` = all envs, `null` = env-less slice, string = that env), and both
    `AnomalyDto` and `getActiveSignalAnomalies` surface `environmentId`. The
    system-detail widget renders an environment pill on env-scoped anomaly rows.
  - **Notifications.** An env-scoped anomaly appends its environment id to the
    collapse key, so two failing environments render as two independent cards
    instead of collapsing into one. The env-less slice keeps the pre-feature
    two-segment key. Mutes stay env-agnostic (per system / per field).

  BREAKING (semantics, not types; BETA so minor only):

  - **Anomaly row identity now includes `environmentId`.** For a fanned-out check,
    an anomaly in one environment is a distinct row from another environment. Any
    code that assumed a single anomaly row per `(system, config, field, kind)`
    must account for the environment dimension.
  - **`AnomalyDto` and `getActiveSignalAnomalies` rows carry a new
    `environmentId: string | null` field**, and `getAnomalies` accepts a new
    optional `environmentId` filter. Additive on the wire; consumers that reject
    unknown fields should be updated.
  - **Upgrade behaviour.** Existing rows backfill to `null` (the env-less slice)
    and stay until they recover; the next detection tick opens fresh
    per-environment rows for fanned-out checks. This mirrors how #375 handled
    baselines.

  State and scale: the anomaly state lives entirely in the shared `anomalies`
  Postgres table. `environmentId` is just another column on the row, so every pod
  reads the same per-`(system, config, env, field, kind)` state - no pod-local
  state, and reads return the same answer on every pod. The baseline cache key
  already carries the env segment (#375), so there is no cross-env cache shadowing.

### Patch Changes

- Updated dependencies [d1b71b6]
- Updated dependencies [e430fbe]
- Updated dependencies [53666a7]
- Updated dependencies [0d912a3]
  - @checkstack/notification-common@1.5.0
  - @checkstack/common@0.19.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/signal-common@0.2.14

## 1.5.4

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/notification-common@1.4.2
  - @checkstack/signal-common@0.2.13

## 1.5.3

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
  - @checkstack/catalog-common@2.4.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/signal-common@0.2.12
  - @checkstack/common@0.17.0

## 1.5.2

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/notification-common@1.4.0
  - @checkstack/common@0.17.0
  - @checkstack/catalog-common@2.4.2
  - @checkstack/signal-common@0.2.11

## 1.5.1

### Patch Changes

- @checkstack/catalog-common@2.4.1

## 1.5.0

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

### Patch Changes

- Updated dependencies [d2077bd]
- Updated dependencies [5c6393f]
  - @checkstack/common@0.16.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-common@0.2.10

## 1.4.2

### Patch Changes

- @checkstack/catalog-common@2.3.6

## 1.4.1

### Patch Changes

- @checkstack/catalog-common@2.3.5

## 1.4.0

### Minor Changes

- 0b6f01b: feat(anomaly): contribute anomaly signals to the backend system.issues aggregator

  The anomaly plugin now registers a `system.issues` contributor (sourceId
  `anomaly`) from its backend `init`, so the AI assistant surfaces confirmed
  anomalies and suspicious states alongside incidents, SLOs, health checks, and
  dependency problems.

  The contributor enforces its own `anomaly_feed.read` access gate (returning an
  empty map - never throwing - when the principal lacks access; service users are
  trusted), then reads the current problem rows for every system from the shared,
  durable `anomalies` table via a new global `getActiveSignalAnomalies` service
  method (state = anomaly | suspicious, suppressed rows excluded). The answer is
  therefore identical on every pod, and only systems with a current problem appear
  in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveAnomalySignals` deriver in
  `@checkstack/anomaly-common`, shared by both the backend contributor and the
  frontend `AnomalySignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

## 1.3.4

### Patch Changes

- 56e7c75: Fix frontend access checks to use FULLY-QUALIFIED access-rule ids, and resolve
  the anonymous role on the frontend.

  Granted access-rule ids are stored fully-qualified as `{pluginId}.{ruleId}` (e.g.
  `incident.incident.read`) so two plugins defining the same short rule id never
  collide. The frontend, however, was checking the UNqualified id (`incident.read`)
  via `isAccessRuleSatisfied`, so every check failed for any user without the `*`
  (admin) grant - masked in development because dev-auth grants `*`. This silently
  broke ALL non-admin frontend gating (route guards, sidebar entries, and
  `useAccess`-based button/link gating).

  - **`@checkstack/common`**: `AccessRule` now carries a REQUIRED owning `pluginId`;
    `access()` / `accessPair()` require and stamp it; `isAccessRuleSatisfied`
    qualifies the rule (`{pluginId}.{id}`, plus the manage->read escalation) and
    matches ONLY the qualified form. There is intentionally NO unqualified fallback
    - matching a bare id would let one plugin's grant satisfy another plugin's
      identically-named rule (a cross-plugin privilege-escalation flaw). Every plugin
      that defines access rules now passes its own `pluginId`.
  - **`@checkstack/backend`**: `pluginManager.getAllAccessRules()` no longer strips
    the `pluginId` field (the rule `id` is already fully-qualified for the DB sync).
  - **Route guard** (`@checkstack/frontend` / `@checkstack/frontend-api`) now
    checks the FULL rule object (so it qualifies and escalates), not a bare id.
  - **Anonymous role on the frontend**: the `accessRules` procedure is now
    `public`, returning the configurable anonymous role's grants to unauthenticated
    callers; `useAccessRules` fetches them for guests instead of returning an empty
    set. So anonymous UI now reflects exactly what the anonymous role is allowed -
    which an admin can change (`isPublic` is only the seeded default).
  - Incident / maintenance / SLO detail routes are now read-gated (their read rule
    is an `isPublic` default, so the anonymous role holds it unless an admin
    revokes it); their dashboard status signals carry that rule and render as a
    link only when the viewer may open it.

  **BREAKING (`@checkstack/common`):** `AccessRule.pluginId` is now REQUIRED, and
  `access()` / `accessPair()` require a `pluginId` option. `isAccessRuleSatisfied`
  matches ONLY the fully-qualified `{pluginId}.{ruleId}` form - the previous
  unqualified fallback is removed, because it was a cross-plugin
  privilege-escalation flaw. Any code constructing an `AccessRule` or calling
  `access()`/`accessPair()` must supply the owning `pluginId`.

  Verified live against an anonymous caller: read pages resolve (qualified match),
  manage actions are denied, manage->read escalation and `*` still work.

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/catalog-common@2.3.4
  - @checkstack/common@0.15.0
  - @checkstack/notification-common@1.3.3
  - @checkstack/signal-common@0.2.9

## 1.3.3

### Patch Changes

- @checkstack/catalog-common@2.3.3
- @checkstack/common@0.14.1
- @checkstack/notification-common@1.3.2
- @checkstack/signal-common@0.2.8

## 1.3.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/catalog-common@2.3.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8

## 1.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/catalog-common@2.3.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/signal-common@0.2.7

## 1.3.0

### Minor Changes

- 9dcc848: Auto-resolve anomalies that settle at a new normal, and add global suppression.

  Part A (bug fix): a confirmed anomaly used to stay stuck in `anomaly` indefinitely when the metric settled at a new stable level. Both detectors now carry a baseline-independent self-resolution path - spike: after `STABLE_RESOLUTION_RUN_COUNT` (5) consecutive healthy samples within `STABLE_RESOLUTION_RELATIVE_BAND` (10%) the row self-resolves to `recovered`; drift: when the projected change goes flat relative to the new mean for `STABLE_DRIFT_RESOLUTION_RUN_COUNT` (2) analyzer runs. The original baseline-relative recovery path is unchanged.

  Part B (feature): global (per-row) suppression. New `suppressedAt` / `suppressedValue` / `suppressedBaseline` columns (Drizzle migration `0005`), `suppressAnomaly` / `unsuppressAnomaly` RPCs gated by `anomaly_feed.manage`, and a `suppression` filter on `getAnomalies` (default `active` hides suppressed rows). Suppressed rows drop out of the dashboard badge/widget active count; the widget exposes an eye-off suppress affordance. Suppression auto-clears once the observed value moves more than `SUPPRESSION_REACTIVATION_DELTA` (25%) from the value it was suppressed at. All suppression state lives on the shared `anomalies` row, so every pod reads the same active/suppressed set. Distinct from the existing per-user notification mute.

  This is a beta minor.

- 9dcc848: Harden config-versioning so stored configs always migrate-then-validate and broken migration chains fail fast at boot.

  - `@checkstack/backend-api` `Versioned<T>` gains `parseAssumingV1` (migrate-from-v1 then validate leniently, runtime path), `parseStrictAssumingV1` (migrate then validate strictly, editor path), and `validateMigrationChainFromV1()`. A standalone pure helper `assertMigrationChainFromV1({ version, migrations })` is the single shared implementation behind the constructor guard and `validateMigrationChainFromV1`.
  - `Versioned` now validates its own v1 -> `version` chain in the constructor, which runs at module import / plugin registration. A new `no-restricted-syntax` ESLint rule bans calling `parse` / `safeParse` / `parseAsync` / `strict` directly on a `Versioned`'s `.schema` member.
  - Auth strategy migration chains are validated at the `betterAuthExtensionPoint.addStrategy` chokepoint (`@checkstack/auth-backend`).
  - Automation action AND trigger configs migrate-then-validate (lenient at dispatch, strict in the editor validator, recursing into `choose`/`parallel`/`repeat`/`sequence` blocks). The `run_script` / `run_shell` action configs bump to `version: 2` dropping the removed `sandbox` key, fixing the editor's `Unrecognized key: sandbox` error.
  - Anomaly read path now validates: `getAnomalyConfig` / `getAnomalyAssignmentConfig` run stored records through `Versioned.parseRecord`; `PartialAnomalySettingsSchema` moved to `@checkstack/anomaly-common`. Notification ConfigService reads thread the migrations argument, and per-strategy `userConfig` is migrate-then-validated before `send()`.
  - gitops-apply migrate-then-validates authored health-check config; integration connection validation routes through `safeValidate`. The latent HTTP health-check `result` schema (at `version: 3` with no migrations) now ships a pass-through v1 -> v2 -> v3 chain.

  BREAKING CHANGES (fail-fast at boot, intended):

  - Any `Versioned` config with `version > 1` and an incomplete or non-contiguous migration chain now throws at construction (boot) instead of failing lazily on first read. This covers every `Versioned` instance repo-wide, including future plugin types. Out-of-tree plugins shipping such a config must add the missing migration step(s); all in-repo strategies already have complete chains.
  - An auth strategy declaring `configVersion > 1` without a complete chain throws at registration.
  - A trigger's per-automation config is now a versioned `config: Versioned<TConfig>` instead of a bare `configSchema?`. Plugins registering triggers with `configSchema:` must wrap it: `config: new Versioned({ version: 1, schema })`. The underlying schema stays reachable via `config.schema`; triggers without per-automation config are unaffected.

  State and scale: all affected reads resolve from shared Postgres / in-process registries, so every pod sees the same migrated answer. No new framework-owned current-state store.

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
  - @checkstack/notification-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/signal-common@0.2.6

## 1.2.3

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5

## 1.2.2

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/notification-common@1.2.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/signal-common@0.2.4

## 1.2.1

### Patch Changes

- Updated dependencies [a06b899]
  - @checkstack/notification-common@1.1.1
  - @checkstack/catalog-common@2.2.1

## 1.2.0

### Minor Changes

- 9016526: Add a `/rest/:pluginId/*` HTTP mount that serves every plugin's oRPC contract
  through the REST/OpenAPI shape described by `/api/openapi.json`. Queries are
  `GET` with query parameters, mutations are `POST` with the input as the raw
  JSON body. The existing `/api/:pluginId/*` mount continues to serve oRPC's
  native wire protocol unchanged, so existing clients are not affected.

  The OpenAPI spec at `/api/openapi.json` now reflects the real mount: every
  `paths` entry is prefixed with `/rest` instead of `/api`.

  Also fixes a SPA-fallback bug: the backend's `/api-docs` route previously
  returned 404 on production deployments because the static-file middleware
  skipped any path starting with `/api`, capturing `/api-docs` along with real
  API routes. The skip now requires a trailing slash (`/api/`, `/rest/`).

  Required access rules are now visible in the API Docs UI. The OpenAPI spec
  generator was reading a non-existent `accessRules` field on procedure
  metadata; the real field is `access: AccessRule[]`. Each procedure's access
  rules are now flattened to fully-qualified IDs (e.g. `catalog.system.read`)
  and emitted under `x-orpc-meta.accessRules`, which the existing
  `Required Access Rules` section in the docs UI already knew how to render.

  The API Docs schema renderer now handles record types (zod `z.record`),
  `$ref`s into `components.schemas`, `oneOf`/`anyOf`/`allOf`, nullable union
  types (`type: ["string", "null"]`), and `format` qualifiers. Previously
  record outputs like `{ statuses: object }` masked the actual value type;
  they now render as `{ [key]: <ResolvedType> { ... } }` with the inner
  schema expanded, capped at 12 levels with cycle detection.

  **REST method conventions.** `proc()` now defaults to `GET` for queries and
  `POST` for mutations on the `/rest` mount, using bracket-notation query
  params (`?filter[status]=active&ids[0]=a`) for GET inputs. Existing
  procedures were updated to follow REST semantics:

  - `update*` mutations → `PATCH`
  - `delete*` / `remove*` mutations → `DELETE`
  - `getBulk*` queries and any query taking a large array input → `POST`
    (because `@orpc/openapi@1.13.x` has no GET→POST URL-length fallback)

  GET endpoints require an `object` input — bare scalars like
  `.input(z.string())` are not valid on GET. `getSystemConfigurations` was
  refactored from `.input(z.string())` to `.input(z.object({ systemId: ... }))`
  to fit the GET shape; the only call-site update was the in-process router
  unpacking `input.systemId` instead of passing `input` directly.

  The API Docs UI now renders query parameters (path/query/header/cookie) in a
  dedicated table for GET endpoints, and the fetch example shows them in the
  URL with `<required>` / `<optional>` placeholders.

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/signal-common@0.2.3

## 1.1.0

### Minor Changes

- 42abfff: Remove global anomaly settings — configuration is now field-only.

  `AnomalySettings` (template- and assignment-level) no longer carries
  `sensitivity`, `confirmationWindow`, `driftEnabled`, or `driftThreshold`.
  These were duplicating the per-field configuration path with awkward
  cascade semantics, and a single global multiplier was meaningless across
  fields with different units (ms, %, counts).

  The schema retains only the truly global concerns:

  - `enabled` — master kill switch for the assignment
  - `baselineWindow` — there is one history per system, not per field
  - `notify` — one notification preference per assignment
  - `fieldOverrides` — per-field configuration (where everything else now lives)

  `resolveEffectiveConfig` collapses to two layers: field override → schema
  default → engine fallback constant. The plugin-author defaults set via
  `x-anomaly-*` annotations now drive sensitivity/window/drift across the
  detector and drift evaluator (previously only floors were threaded
  through the schema layer).

  **Breaking changes:**

  - Any global `sensitivity`/`confirmationWindow`/`driftEnabled`/
    `driftThreshold` values previously stored in `anomaly_configurations`
    or `anomaly_assignments` are silently stripped on parse. Users who
    customized these globals will revert to the plugin's tuned per-field
    defaults; if they want to keep those values they must re-apply them
    per field in the new UI.
  - `AnomalySettingsForm` no longer renders the global sliders. The form
    now shows: enable toggle, baseline window selector, notify toggle,
    field overrides editor.
  - `AnomalyFieldOverridesEditor` props `defaultSensitivity`,
    `defaultConfirmationWindow`, `defaultDriftEnabled`, `defaultDriftThreshold`
    are removed. Engine fallbacks (1.0, 3, true, 2) are now hard-coded
    internal constants used only when neither field override nor schema
    default is set.
  - The GitOps `System.anomaly` entry schema (in `anomaly-gitops-kinds`)
    drops `sensitivity`, `confirmationWindow`, `driftEnabled`, and
    `driftThreshold` to match the new `AnomalySettings` shape. YAML files
    declaring those fields will be rejected at parse time — operators
    must move per-field tuning into `fieldOverrides`.

  This change makes the override model trivial to explain ("plugin defaults,
  overridden per field") and removes a class of confusing "where did this
  threshold come from?" questions.

- 42abfff: Add practical-significance floors to anomaly detection.

  Two new schema annotations — `x-anomaly-min-absolute-delta` and `x-anomaly-min-relative-delta` — let plugin authors and operators suppress alerts whose statistical deviation is large but practical impact is negligible. Both floors must clear in addition to the existing μ ± Nσ trigger; defaults are 0 (disabled) so existing behaviour is unchanged.

  This is the fix for cases like a 6 ms latency baseline whose σ ≈ 1 ms causes routine 20 ms blips to fire as anomalies despite Δ=14 ms being operationally irrelevant. With `min-absolute-delta: 50` and `min-relative-delta: 0.5`, those blips stay silent while a 6 ms → 200 ms spike still fires.

  Built-in plugins ship with sensible defaults applied to every per-run field: 50 ms + 50 % for ms-unit fields, 5 percentage points for `%`-unit fields, 1 + 25 % for counter fields, 1 GB + 5 % for disk fields, 50 MB + 10 % for memory fields, 1 day for TLS expiry, 0.5 + 25 % for load average, 1 + 5 % for Minecraft TPS. Operators can override per-system or per-field via the assignment UI.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [1ef2e79]
  - @checkstack/common@0.9.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 1.0.1

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/notification-common@1.0.1
  - @checkstack/signal-common@0.2.1

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

- 32d52c6: feat(anomaly): per-system and per-field notification mute

  Anomaly notifications now flow through their own subscription group
  (`anomaly.system.<systemId>`) instead of the shared catalog system group, so
  users can opt out of anomaly noise without losing incident or healthcheck
  alerts for the same system. On first deploy, existing subscribers of each
  `catalog.system.<id>` group are seeded onto the new anomaly group so no one
  silently stops getting alerts.

  A new mute table (`anomaly_notification_mutes`) backs two granularities:

  - **Per-field**: silence a single noisy metric on one system.
  - **Per-system**: silence every anomaly for one system in one click.

  The system anomaly widget now exposes a bell icon on each anomaly row plus a
  `Mute all` toggle in the card header. Mutes are user-scoped and persist
  across sessions.

  Catalog gains a `systemCreated` hook so anomaly (and any future plugin) can
  provision per-system state on creation rather than waiting for a restart.
  The notification service gains a `bulkSubscribe` service-RPC used by the
  one-time migration described above.

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
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-common@2.0.0

## 0.3.0

### Minor Changes

- 208ad71: Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

  **Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

  ```ts
  // Before
  export const ANOMALY_STATE_CHANGED = createSignal(
    "anomaly.state_changed",
    z.object({ ... }),
  );

  // After
  export const ANOMALY_STATE_CHANGED = createSignal({
    pluginMetadata,
    event: "state_changed",
    payloadSchema: z.object({ ... }),
  });
  ```

  **New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

  **Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

  **User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

  UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0

## 0.2.0

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

- 8d1ef12: Phase 2 of anomaly detection: trend drift detection.

  The background baseline analyzer now computes a linear regression slope across each field's chronologically-ordered history and runs a `detectDrift` evaluator that catches gradual "creeping degradation" never reaching the 3σ spike threshold. Drifts share the same `anomalies` table as spike anomalies via a new `kind` column (`spike` | `drift`, default `spike`); the existing suspicious → anomaly → recovered lifecycle is reused, ticking at the analyzer's hourly cadence with a default 2-run confirmation window.

  User-facing additions: a Trend Drift toggle and threshold slider on both the template and assignment anomaly settings panels (with per-field overrides), drift rows in the System Anomaly widget, dashed regression-line overlays on the auto-generated line charts, and a new `ANOMALY_TREND_DETECTED` signal for live UI updates. Plugin authors can disable drift per chartable field via `x-anomaly-drift-enabled: false` or tighten/loosen it via `x-anomaly-drift-threshold`.

- 8d1ef12: Added Categorical Anomaly Detection (Dominance Drift) support for non-numeric healthcheck values, and introduced Slider UI components for sensitivity and confirmation window anomaly settings.

### Patch Changes

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/signal-common@0.1.10
