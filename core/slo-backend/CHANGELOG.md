# @checkstack/slo-backend

## 0.10.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-backend@0.10.0
  - @checkstack/ai-backend@0.9.0
  - @checkstack/catalog-backend@1.5.4
  - @checkstack/healthcheck-backend@1.10.1

## 0.10.0

### Minor Changes

- 8cad340: Fix SLO downtime windows lingering as "ongoing" after a check recovered.

  Closing a downtime window depended entirely on catching the system's transient
  health-recovery edge (`onEntityChanged`). But that edge is only emitted by a
  check RUN: fixing, pausing, deleting, or unassigning the offending check just
  invalidates the read cache and emits no edge, and even a plain edit can lose the
  single recovery delivery. The open window was then orphaned until the once-daily
  reconcile - so the SLO read 100% availability (live health is authoritative for
  the budget) while "Recent Downtime Events" still showed an ongoing window 25+
  days old. The two views disagreed.

  The user-facing SLO reads now reconcile against live health before reporting:
  `getDowntimeEvents` and the status reads reconcile an orphaned open window when
  the system is currently healthy, so the dashboard self-heals the moment it is
  viewed instead of waiting for midnight. The reactive entity `read` /
  `computeStatus` stays side-effect-free; the reconcile is a cheap no-op when there
  are no open events.

  Crucially, reconciling now PRESERVES the genuine downtime instead of erasing it.
  The orphaned window is CLOSED at the system's actual recovery time - the first
  healthy run on/after it opened, resolved from the healthcheck run history
  (`getHistory`) - so a real multi-day outage is counted against the error budget
  and availability instead of reading a false 100%. The window is only DELETED as
  a fallback when the recovery time can't be determined (e.g. run history pruned),
  where the unprovable downtime must not be counted. Note: daily availability
  snapshots already written for the affected days are NOT retroactively corrected
  (the current/forward numbers are; the historical trend chart keeps its recorded
  points).

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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ai-backend@0.8.0
  - @checkstack/automation-backend@0.9.3
  - @checkstack/gitops-backend@0.5.12
  - @checkstack/backend-api@0.25.0
  - @checkstack/healthcheck-backend@1.10.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/catalog-backend@1.5.3
  - @checkstack/catalog-common@2.4.2
  - @checkstack/dependency-common@1.4.2
  - @checkstack/cache-api@0.3.14
  - @checkstack/gitops-common@0.6.5
  - @checkstack/queue-api@0.3.14
  - @checkstack/signal-common@0.2.11
  - @checkstack/slo-common@0.7.2
  - @checkstack/cache-utils@0.2.19

## 0.9.2

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/catalog-backend@1.5.2
  - @checkstack/healthcheck-backend@1.9.2
  - @checkstack/automation-backend@0.9.2
  - @checkstack/ai-backend@0.7.2
  - @checkstack/command-backend@0.2.11
  - @checkstack/gitops-backend@0.5.11

## 0.9.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/ai-backend@0.7.1
  - @checkstack/automation-backend@0.9.1
  - @checkstack/catalog-backend@1.5.1
  - @checkstack/command-backend@0.2.10
  - @checkstack/gitops-backend@0.5.10
  - @checkstack/healthcheck-backend@1.9.1
  - @checkstack/catalog-common@2.4.1
  - @checkstack/dependency-common@1.4.1
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/slo-common@0.7.1

## 0.9.0

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

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [5c6393f]
  - @checkstack/ai-backend@0.7.0
  - @checkstack/healthcheck-backend@1.9.0
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-backend@0.9.0
  - @checkstack/catalog-backend@1.5.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/dependency-common@1.4.0
  - @checkstack/slo-common@0.7.0
  - @checkstack/command-backend@0.2.9
  - @checkstack/gitops-backend@0.5.9
  - @checkstack/cache-api@0.3.13
  - @checkstack/gitops-common@0.6.4
  - @checkstack/queue-api@0.3.13
  - @checkstack/signal-common@0.2.10
  - @checkstack/cache-utils@0.2.18

## 0.8.4

### Patch Changes

- Updated dependencies [bb6f0fe]
  - @checkstack/ai-backend@0.6.1
  - @checkstack/healthcheck-backend@1.8.1
  - @checkstack/automation-backend@0.8.1
  - @checkstack/catalog-backend@1.4.12

## 0.8.3

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
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/healthcheck-backend@1.8.0
  - @checkstack/catalog-backend@1.4.11
  - @checkstack/command-backend@0.2.8
  - @checkstack/gitops-backend@0.5.8
  - @checkstack/catalog-common@2.3.6
  - @checkstack/dependency-common@1.3.2
  - @checkstack/healthcheck-common@1.6.2
  - @checkstack/slo-common@0.6.2

## 0.8.2

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/automation-backend@0.7.0
  - @checkstack/ai-backend@0.5.0
  - @checkstack/catalog-backend@1.4.10
  - @checkstack/healthcheck-backend@1.7.2
  - @checkstack/catalog-common@2.3.5
  - @checkstack/dependency-common@1.3.1
  - @checkstack/healthcheck-common@1.6.1
  - @checkstack/slo-common@0.6.1
  - @checkstack/backend-api@0.21.7
  - @checkstack/command-backend@0.2.7
  - @checkstack/gitops-backend@0.5.7

## 0.8.1

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [0ffe357]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/ai-backend@0.4.0
  - @checkstack/automation-backend@0.6.0
  - @checkstack/catalog-backend@1.4.9
  - @checkstack/healthcheck-backend@1.7.1

## 0.8.0

### Minor Changes

- 0b6f01b: feat(slo): contribute SLO signals to the backend system.issues aggregator

  The SLO plugin now registers a `system.issues` contributor (sourceId `slo`) from
  its backend `init`, so the AI assistant surfaces breaching, degraded, and at-risk
  objectives alongside incidents, anomalies, health checks, and dependency
  problems.

  The contributor enforces its own `slo.read` access gate (returning an empty map -
  never throwing - when the principal lacks access; service users are trusted),
  then reads every objective for all systems from the shared, durable
  `slo_objectives` table via the existing global `listObjectives` service method and
  computes each objective's current status with the engine. The answer is therefore
  identical on every pod, and only systems with a current problem appear in the
  result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveSloSignals` deriver in `@checkstack/slo-common`,
  shared by both the backend contributor and the frontend `SloSignalsFiller` so the
  two surfaces stay in lockstep. The frontend filler now delegates to that deriver
  with unchanged behavior.

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

- Updated dependencies [dbb76a2]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/ai-backend@0.3.0
  - @checkstack/healthcheck-backend@1.7.0
  - @checkstack/dependency-common@1.3.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/slo-common@0.6.0
  - @checkstack/automation-backend@0.5.8
  - @checkstack/catalog-backend@1.4.8
  - @checkstack/backend-api@0.21.6
  - @checkstack/command-backend@0.2.6
  - @checkstack/gitops-backend@0.5.6

## 0.7.7

### Patch Changes

- Updated dependencies [2428bfc]
  - @checkstack/ai-backend@0.2.0
  - @checkstack/automation-backend@0.5.7
  - @checkstack/catalog-backend@1.4.7
  - @checkstack/healthcheck-backend@1.6.7

## 0.7.6

### Patch Changes

- Updated dependencies [f9cfdae]
  - @checkstack/dependency-common@1.2.5
  - @checkstack/ai-backend@0.1.6
  - @checkstack/automation-backend@0.5.6
  - @checkstack/catalog-backend@1.4.6
  - @checkstack/healthcheck-backend@1.6.6

## 0.7.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ai-backend@0.1.5
  - @checkstack/common@0.15.0
  - @checkstack/dependency-common@1.2.4
  - @checkstack/gitops-common@0.6.3
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/slo-common@0.5.4
  - @checkstack/automation-backend@0.5.5
  - @checkstack/catalog-backend@1.4.5
  - @checkstack/command-backend@0.2.5
  - @checkstack/gitops-backend@0.5.5
  - @checkstack/healthcheck-backend@1.6.5
  - @checkstack/cache-api@0.3.12
  - @checkstack/queue-api@0.3.12
  - @checkstack/signal-common@0.2.9
  - @checkstack/cache-utils@0.2.17

## 0.7.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/ai-backend@0.1.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/catalog-backend@1.4.4
  - @checkstack/command-backend@0.2.4
  - @checkstack/gitops-backend@0.5.4
  - @checkstack/healthcheck-backend@1.6.4

## 0.7.3

### Patch Changes

- Updated dependencies [00b9367]
  - @checkstack/ai-backend@0.1.3
  - @checkstack/automation-backend@0.5.3
  - @checkstack/catalog-backend@1.4.3
  - @checkstack/healthcheck-backend@1.6.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/dependency-common@1.2.3
  - @checkstack/slo-common@0.5.3
  - @checkstack/backend-api@0.21.3
  - @checkstack/cache-api@0.3.11
  - @checkstack/cache-utils@0.2.16
  - @checkstack/command-backend@0.2.3
  - @checkstack/common@0.14.1
  - @checkstack/gitops-backend@0.5.3
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.3
  - @checkstack/queue-api@0.3.11
  - @checkstack/signal-common@0.2.8

## 0.7.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-backend@0.1.2
  - @checkstack/automation-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/catalog-backend@1.4.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/command-backend@0.2.2
  - @checkstack/dependency-common@1.2.2
  - @checkstack/gitops-backend@0.5.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-backend@1.6.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/signal-common@0.2.8
  - @checkstack/slo-common@0.5.2
  - @checkstack/cache-utils@0.2.16

## 0.7.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/cache-api@0.3.10
  - @checkstack/queue-api@0.3.10
  - @checkstack/ai-backend@0.1.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/catalog-backend@1.4.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/command-backend@0.2.1
  - @checkstack/dependency-common@1.2.1
  - @checkstack/gitops-backend@0.5.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/healthcheck-backend@1.6.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/signal-common@0.2.7
  - @checkstack/slo-common@0.5.1
  - @checkstack/cache-utils@0.2.15

## 0.7.0

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

- 9dcc848: Make SLO downtime robust against a drifted event log (fixes "100% available yet degraded" and "ongoing downtime while every check is healthy").

  SLO downtime was stored as edge-triggered open/close interval rows, so a single missed/out-of-order transition left an event open forever and read as ongoing downtime even when healthy. The fix makes live health authoritative:

  - `computeStatus` is now live-health-authoritative and side-effect-free: a stored open event counts toward availability/error-budget and sets `hasOpenDowntime` only when the system is actually down right now (verified via the health callback, checked only when open events exist). A healthy system can no longer read breaching/degraded from a stale row, and this stays pure so the reactive `slo` entity can keep reading through it.
  - Window accounting is fixed: `getDowntimeForWindow` counts the in-window portion of every overlapping interval (clamped to the window; open events run to "now" only when included), via a pure `downtime-window` helper, so an outage that began before the window is no longer dropped.
  - Missed-recovery orphans are voided: the daily job deletes open events on currently-healthy systems (their true recovery time was never recorded). The edge-triggered close still records real downtime on normal recoveries.

  Regression tests cover the window-overlap math, the live-health authority, the no-open-event fast path, and orphan voiding.

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

- 9dcc848: Input-validation and error-mapping hardening found by a fuzzing pass against the built container.

  - backend: a Postgres driver error caused by bad client input no longer surfaces as a `500`. The `/api` and `/rest` dispatchers now map the relevant SQLSTATE classes to the correct status - `22P02`/`22003`/`22001`/`22007` (malformed/out-of-range/over-long/bad-date value), `23502`/`23503`/`23514` (missing/dangling/check-failed) to `400`, and `23505` (unique violation) to `409` - and log them at `warn` (client mistake), not `error`. The client-facing message is generic so column/constraint names are never leaked; genuine unknown faults still log at `error` and 500. Previously a `where id = $1` with a non-uuid `$1` (or an over-long string, or a foreign-key miss in `addSystemToGroup`) reached the driver and 500'd, making routine probing look like a server outage and burying real 500s.
  - slo-common: **fixes a stored cluster-wide DoS.** `windowDays` was accepted up to `2^53`, but the SLO engine derives window boundaries with `Date(now - windowDays * 86_400_000)` - a large value overflows past the max representable `Date` and yields `Invalid Date`. That objective committed fine, then every subsequent read of the system's objectives threw `RangeError: Invalid time value` during serialization (a 500 readable by anyone with SLO read access, on any pod). `windowDays` is now bounded to 1..3650 days at the contract, the GitOps `kind: SLO` spec, and the update path via a single shared `SloWindowDaysSchema`, so the poison row can never be created.
  - slo-common + healthcheck-common: SLO `getDailySnapshots` and the healthcheck history endpoints (`getHistory`, `getDetailedHistory`, `getAggregatedHistory`, `getDetailedAggregatedHistory`, `getRunsForAnalysis`) declared their `startDate`/`endDate` params as `z.date()`, which a `/rest/...` string param can never satisfy - so those endpoints 400'd on the entire REST surface. They now use `z.coerce.date()`, accepting both the REST string shape and the native RPC `Date`.
  - healthcheck-common: `intervalSeconds` was `z.number().min(1)` with no `.int()` and no upper bound, so a fractional or out-of-range value reached the DB and failed at insert (the column is a 32-bit int). It is now `.int().min(1).max(2_592_000)` (1 second .. 30 days), applied to both create and update (the update schema is the create partial).
  - catalog-common: system/group/environment names were bare `z.string()` (environment was `.min(1)` only), so empty, whitespace-only, and 100KB+ names reached the DB - the huge ones surfaced as 500s when parameter binding blew up. Names are now `trim().min(1).max(200)` via a shared schema.

    **BREAKING:** `getSystemContacts` is now `userType: "authenticated"` (was `"public"`). System contacts carry PII (user id, name, email); the public read leaked them to anonymous status-page visitors. Anonymous callers now receive `401` for this one endpoint; the system detail page already renders "No contacts assigned" for anonymous viewers, so the UI degrades gracefully. All other catalog reads remain public.

  - catalog-frontend: the system detail page skips the `getSystemContacts` request entirely for anonymous viewers (it would now `401`) and falls back to the empty state.

  This is a beta release: the breaking contact-visibility change ships as a minor bump per the beta versioning policy, not a major.

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
  - @checkstack/backend-api@0.21.0
  - @checkstack/healthcheck-backend@1.6.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/automation-backend@0.5.0
  - @checkstack/catalog-backend@1.4.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/slo-common@0.5.0
  - @checkstack/command-backend@0.2.0
  - @checkstack/dependency-common@1.2.0
  - @checkstack/gitops-backend@0.5.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/cache-api@0.3.9
  - @checkstack/queue-api@0.3.9
  - @checkstack/signal-common@0.2.6
  - @checkstack/cache-utils@0.2.14

## 0.6.1

### Patch Changes

- Updated dependencies [a57f7db]
- Updated dependencies [0d9e5d8]
  - @checkstack/backend-api@0.20.0
  - @checkstack/healthcheck-backend@1.5.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/cache-api@0.3.8
  - @checkstack/catalog-backend@1.3.1
  - @checkstack/command-backend@0.1.33
  - @checkstack/gitops-backend@0.4.1
  - @checkstack/queue-api@0.3.8
  - @checkstack/cache-utils@0.2.13

## 0.6.0

### Minor Changes

- b995afb: Make `slo` a plugin-backed, COMPUTED reactive entity via the Model-B entity state machine + rewire its cross-plugin consumers.

  SLO defines a `slo` entity `{ objectiveId, systemId, target, budgetRemainingPercent, currentStreak, bestStreak }` keyed by `objectiveId`. There is no framework `entity_state` row: its current state is assembled on demand by a `read` accessor (`createSloEntityRead` / `computeSloEntityState`). `currentStreak` / `bestStreak` / `systemId` / `target` come from the authoritative `slo_streaks` + `slo_objectives` tables, and `budgetRemainingPercent` (plus `target`) is COMPUTED on the fly via the SLO engine's `computeStatus` (downtime aggregation over the objective's rolling window). The daily snapshot job's streak-persist write drives through the fail-soft `writeSloEntity` (`handle.mutate({ id: objectiveId, apply })`): `apply` persists the streak to `slo_streaks` (its own write) and returns the freshly-computed view; the framework snapshots `prev` via the computed `read` BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED`.

  Compute-on-read (not materialize): the budget is a pure function of the objective's append-only downtime history, so storing a second copy would duplicate the engine's source of truth and risk drift. The `read` recomputes from the same tables the SLO API already reads; it is only exercised on the prev-snapshot of the once-daily streak job and on reactive scope/wake resolution, so the recompute cost is negligible. The append-only `slo_downtime_events` + `slo_daily_snapshots` tables are declared non-reactive (bookkeeping); the live budget/streak is the entity. Operators author budget/streak thresholds as reactive `numeric_state` conditions over `state.slo.<objectiveId>.budgetRemainingPercent` / `currentStreak`.

  The healthcheck + catalog consumers switched from `onHook(<hook>)` to `onEntityChanged({ kind })`, all keeping `work-queue` delivery (each handler performs side-effecting writes that must run once per cluster):

  - `slo-system-down` / `slo-upstream-down`: react to `health` changes filtered to a degraded transition (`classifyHealthChange().degraded`).
  - `slo-system-up`: reacts to `health` changes filtered to a recovered transition (`classifyHealthChange().recovered`).
  - `slo-system-cleanup`: reacts to `catalog-system` tombstones (`change.next === null`).

  BREAKING CHANGES:

  - The `slo.budget.warning` / `slo.budget.critical` / `slo.budget.exhausted` and `slo.streak.broken` automation triggers are removed. These thresholds were never emitted by the engine (the underlying hooks were inert) and are replaced by reactive `numeric_state` conditions over the `slo` entity (`budgetRemainingPercent < 20`, `currentStreak == 0`, etc.). Re-author any automations that referenced these trigger ids as `numeric_state` / `state` conditions. The `slo.achievement.unlocked` and `slo.weekly.digest` triggers are KEPT.

- b995afb: Remove the dead `slo.budget.warning` / `slo.budget.critical` / `slo.budget.exhausted` / `slo.streak.broken` hook descriptors from `sloHooks`.

  These four `createHook` descriptors had no emitter and no trigger registration left: per the reactive automation engine (§9.2) the SLO budget IS the reactive entity, and the old threshold/streak triggers became `numeric_state` / `state` conditions over `state.slo.<objectiveId>.budgetRemainingPercent` + `currentStreak`. Nothing in the repo emitted or subscribed to the four hooks, so they were unreachable surface. `sloAchievementUnlocked` and `sloWeeklyDigest` are unaffected and stay.

  BREAKING CHANGES:

  - Removed `sloHooks.sloBudgetWarning`, `sloHooks.sloBudgetCritical`, `sloHooks.sloBudgetExhausted`, and `sloHooks.sloStreakBroken`. Author SLO budget / streak threshold automations as reactive `numeric_state` / `state` conditions over the `slo` entity state instead.

### Patch Changes

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
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/automation-backend@0.3.0
  - @checkstack/gitops-common@0.5.0
  - @checkstack/gitops-backend@0.4.0
  - @checkstack/healthcheck-backend@1.4.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/catalog-backend@1.3.0
  - @checkstack/cache-api@0.3.7
  - @checkstack/command-backend@0.1.32
  - @checkstack/queue-api@0.3.7
  - @checkstack/cache-utils@0.2.12

## 0.5.0

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

### Patch Changes

- 41c77f4: feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

  **BREAKING CHANGES** (platform is in BETA — no major bump):

  - `IntegrationProvider` no longer carries `config` (subscription
    config) or `deliver`. The interface now models a connection provider
    only: connection schema + `getConnectionOptions` + `testConnection`.
  - The legacy subscription / delivery-log / event endpoints
    (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
    `listEventTypes`, …) are removed from `integrationContract`.
  - `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
    `integrationEventExtensionPoint` are deleted. Plugins that
    previously called `integrationEvents.registerEvent(...)` now
    register their hooks as automation triggers via
    `automationTriggerExtensionPoint.registerTrigger(...)`.
  - Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
    the integration plugin's only remaining UI is connection
    management. Subscription management lives under `/automation/...`.
  - `webhook_subscriptions` and `delivery_logs` tables stay in the
    database for one release as a safety net (no code reads or writes
    them), and will be dropped in a follow-up migration.

  **New**:

  - `jira.create_issue`, `teams.post_message`, `webex.post_message`,
    `webhook.send`, `integration-script.run_shell`, and
    `integration-script.run_script` actions registered against the
    Automation Platform with matching `*.message`, `*.delivery`,
    `shell.result`, and `script.result` artifact types. The script
    plugin exposes **two** actions — `run_shell` runs bash via the
    shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
    runs an ESM module in a Bun subprocess via `EsmScriptRunner`
    (Monaco `typescript` editor + `defineIntegration` helper) — to
    preserve the legacy provider split. `jira.create_issue` keeps the
    dynamic field-mapping dropdown (driven by
    `JIRA_RESOLVERS.FIELD_OPTIONS`).
  - One-time data migration runs on boot in
    `automation-backend.afterPluginsReady`. It reads
    `webhook_subscriptions` via a new service RPC
    `IntegrationApi.listLegacySubscriptions`, translates each row into
    a single-trigger / single-action automation (marked with
    `managed_by = "migrated-subscription:<id>"`), and is idempotent
    across restarts.
  - Failed translations are recorded in a new
    `automation_migration_failures` table and surfaced via
    `AutomationApi.listMigrationFailures` /
    `acknowledgeMigrationFailure` so admins can review and re-create
    failed entries by hand.

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-backend@0.2.0
  - @checkstack/healthcheck-backend@1.3.0
  - @checkstack/catalog-backend@1.2.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/dependency-common@1.1.3
  - @checkstack/slo-common@0.4.2
  - @checkstack/command-backend@0.1.31
  - @checkstack/gitops-backend@0.3.7
  - @checkstack/gitops-common@0.4.2
  - @checkstack/signal-common@0.2.5
  - @checkstack/cache-api@0.3.6
  - @checkstack/queue-api@0.3.6
  - @checkstack/cache-utils@0.2.11

## 0.4.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/healthcheck-backend@1.2.0
  - @checkstack/backend-api@0.17.1
  - @checkstack/cache-api@0.3.5
  - @checkstack/catalog-backend@1.1.6
  - @checkstack/command-backend@0.1.30
  - @checkstack/gitops-backend@0.3.6
  - @checkstack/integration-backend@0.1.30
  - @checkstack/queue-api@0.3.5
  - @checkstack/cache-utils@0.2.10

## 0.4.5

### Patch Changes

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
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/catalog-backend@1.1.5
  - @checkstack/command-backend@0.1.29
  - @checkstack/gitops-backend@0.3.5
  - @checkstack/healthcheck-backend@1.1.4
  - @checkstack/integration-backend@0.1.29
  - @checkstack/integration-common@0.5.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/dependency-common@1.1.2
  - @checkstack/gitops-common@0.4.1
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/signal-common@0.2.4
  - @checkstack/slo-common@0.4.1
  - @checkstack/cache-api@0.3.4
  - @checkstack/queue-api@0.3.4
  - @checkstack/cache-utils@0.2.9

## 0.4.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/cache-api@0.3.3
  - @checkstack/catalog-backend@1.1.4
  - @checkstack/command-backend@0.1.28
  - @checkstack/gitops-backend@0.3.4
  - @checkstack/healthcheck-backend@1.1.3
  - @checkstack/integration-backend@0.1.28
  - @checkstack/queue-api@0.3.3
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dependency-common@1.1.1
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/cache-utils@0.2.8

## 0.4.3

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
  - @checkstack/gitops-backend@0.3.3
  - @checkstack/healthcheck-backend@1.1.2
  - @checkstack/integration-backend@0.1.27
  - @checkstack/cache-api@0.3.2
  - @checkstack/queue-api@0.3.2
  - @checkstack/cache-utils@0.2.7

## 0.4.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/catalog-backend@1.1.2
  - @checkstack/gitops-backend@0.3.2
  - @checkstack/healthcheck-backend@1.1.1

## 0.4.1

### Patch Changes

- Updated dependencies [7c97b43]
- Updated dependencies [9016526]
  - @checkstack/healthcheck-backend@1.1.0
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/dependency-common@1.1.0
  - @checkstack/slo-common@0.4.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/integration-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/catalog-backend@1.1.1
  - @checkstack/command-backend@0.1.26
  - @checkstack/gitops-backend@0.3.1
  - @checkstack/integration-backend@0.1.26
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/queue-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 0.4.0

### Minor Changes

- f6f9a5c: Add a GitOps `SLO` kind so reliability targets can be declared in YAML.

  The kind references its target system via `systemRef` and may optionally
  narrow to a single healthcheck via `healthcheckRef`. Excluded
  dependencies are referenced by ref and resolved to system IDs at
  reconcile time.

  ```yaml
  apiVersion: checkstack.io/v1alpha1
  kind: SLO
  metadata:
    name: payments-availability
  spec:
    systemRef: { kind: System, name: payments-api }
    target: 99.9
    windowDays: 30
  ```

  Reconcile maps to `SloService.createObjective` /
  `updateObjective` / `deleteObjective`; the entity ID stored in
  provenance is the SLO objective UUID, so renames in YAML preserve
  identity.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-backend@0.3.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/catalog-backend@1.1.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/dependency-common@1.0.2
  - @checkstack/healthcheck-backend@1.0.4
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/integration-backend@0.1.25
  - @checkstack/integration-common@0.3.2
  - @checkstack/signal-common@0.2.2
  - @checkstack/slo-common@0.3.3
  - @checkstack/cache-utils@0.2.5

## 0.3.5

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
  - @checkstack/backend-api@0.15.0
  - @checkstack/catalog-backend@1.0.2
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/dependency-common@1.0.1
  - @checkstack/healthcheck-backend@1.0.3
  - @checkstack/integration-common@0.3.1
  - @checkstack/queue-api@0.2.18
  - @checkstack/slo-common@0.3.2
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/integration-backend@0.1.24
  - @checkstack/signal-common@0.2.1

## 0.3.4

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/catalog-backend@1.0.1
  - @checkstack/command-backend@0.1.23
  - @checkstack/healthcheck-backend@1.0.2
  - @checkstack/integration-backend@0.1.23
  - @checkstack/queue-api@0.2.17
  - @checkstack/cache-utils@0.2.3
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/signal-common@0.2.0
  - @checkstack/slo-common@0.3.1

## 0.3.3

### Patch Changes

- Updated dependencies [2a749d3]
  - @checkstack/healthcheck-backend@1.0.1

## 0.3.2

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/integration-backend@0.1.22
  - @checkstack/catalog-backend@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/healthcheck-backend@1.0.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/queue-api@0.2.16
  - @checkstack/slo-common@0.3.1
  - @checkstack/cache-utils@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/dependency-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/slo-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/healthcheck-backend@0.18.1
  - @checkstack/integration-backend@0.1.21
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-backend@0.7.1
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/queue-api@0.2.15
  - @checkstack/cache-utils@0.2.1

## 0.3.0

### Minor Changes

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
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/healthcheck-backend@0.18.0
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/catalog-backend@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/catalog-common@1.5.2
  - @checkstack/command-backend@0.1.20
  - @checkstack/dependency-common@0.2.3
  - @checkstack/integration-backend@0.1.20
  - @checkstack/integration-common@0.2.9
  - @checkstack/signal-common@0.1.10
  - @checkstack/slo-common@0.2.2
  - @checkstack/queue-api@0.2.14

## 0.2.16

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/healthcheck-backend@0.17.1
  - @checkstack/catalog-common@1.5.1
  - @checkstack/dependency-common@0.2.2
  - @checkstack/slo-common@0.2.1
  - @checkstack/catalog-backend@0.6.1

## 0.2.15

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/healthcheck-backend@0.17.0
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0

## 0.2.14

### Patch Changes

- Updated dependencies [9a320fe]
  - @checkstack/healthcheck-backend@0.16.5

## 0.2.13

### Patch Changes

- @checkstack/catalog-backend@0.5.4
- @checkstack/healthcheck-backend@0.16.4

## 0.2.12

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/healthcheck-backend@0.16.3
  - @checkstack/catalog-backend@0.5.3

## 0.2.11

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/healthcheck-backend@0.16.2
  - @checkstack/catalog-backend@0.5.2

## 0.2.10

### Patch Changes

- @checkstack/catalog-backend@0.5.1
- @checkstack/catalog-common@1.4.1
- @checkstack/healthcheck-backend@0.16.1

## 0.2.9

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/healthcheck-backend@0.16.0
  - @checkstack/catalog-backend@0.5.0

## 0.2.8

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4
  - @checkstack/healthcheck-backend@0.15.1

## 0.2.7

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/healthcheck-backend@0.15.0
  - @checkstack/catalog-backend@0.4.3

## 0.2.6

### Patch Changes

- @checkstack/catalog-backend@0.4.2
- @checkstack/healthcheck-backend@0.14.3

## 0.2.5

### Patch Changes

- 86bab6a: ### GitOps: Fix authentication token handling

  - Made `authToken` optional in `ReconcileProviderParams` and `ScraperOptions` to support unauthenticated access to public repositories
  - GitHub and GitLab scrapers now conditionally set authentication headers only when a token is provided
  - Sync worker now decrypts the encrypted `authToken` from the database before passing it to scrapers, fixing authentication failures caused by sending encrypted values in HTTP headers

  ### SLO: Fix premature Nines Club achievement unlock

  - The "Nines Club" achievement now requires both ≥99.99% availability **and** a 365-day compliance streak, preventing immediate unlock on newly created SLOs with 100% default availability

  ### SLO: Align frontend achievement descriptions with backend criteria

  - Fixed mismatched descriptions for Iron Uptime (7-day, not 30), Diamond Uptime (30-day, not 90), Clean Sheet (rolling window, not quarter), Full Coverage (3+ SLOs, not all systems in group), and Nines Club (99.99%)

  ### SLO: Enrich milestones with system names

  - The `getRecentMilestones` endpoint now resolves human-readable system names via the Catalog API instead of returning raw system IDs
  - @checkstack/catalog-backend@0.4.1
  - @checkstack/healthcheck-backend@0.14.2

## 0.2.4

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0
  - @checkstack/healthcheck-backend@0.14.1

## 0.2.3

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0
  - @checkstack/healthcheck-backend@0.14.0

## 0.2.2

### Patch Changes

- Updated dependencies [aa2b3aa]
  - @checkstack/healthcheck-backend@0.13.1

## 0.2.1

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/healthcheck-backend@0.13.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24
  - @checkstack/command-backend@0.1.19
  - @checkstack/integration-backend@0.1.19
  - @checkstack/queue-api@0.2.13

## 0.2.0

### Minor Changes

- 3c34b07: Complete SLO Reliability Engine frontend and backend

  **Frontend** — 7 new visualization components:

  - `StreakCounter`: Fire-themed compliance streak counter with color-coded flame and best-streak trophy
  - `AchievementBadge`: Emoji-labeled badges for 9 achievement types with hover tooltip
  - `AttributionChart`: Horizontal stacked bar showing error budget split (self/upstream/remaining)
  - `DowntimeTimeline`: Dot-and-line timeline with attribution badges and timestamps
  - `SloTrendChart`: Pure SVG availability trend line chart from daily snapshots
  - `MilestoneFeed`: Organization-wide milestone feed on the SLO overview sidebar
  - `DependencyExclusionConfig`: Interactive upstream dependency picker for SLO editor

  **Backend** — Weekly digest scheduled integration event:

  - `weekly-digest.ts`: Cron job (Monday 09:00 UTC) emitting SLO performance summary
  - Top/worst performers, breach counts, and streak data delivered via configured notification channels
  - New `sloWeeklyDigest` hook registered as integration event

### Patch Changes

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/catalog-backend@0.2.23
  - @checkstack/healthcheck-backend@0.12.1
  - @checkstack/integration-backend@0.1.18
  - @checkstack/slo-common@0.2.0
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/dependency-common@0.2.1
  - @checkstack/integration-common@0.2.8
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12
