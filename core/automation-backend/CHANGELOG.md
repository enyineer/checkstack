# @checkstack/automation-backend

## 0.11.0

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
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/ai-backend@0.10.9
  - @checkstack/backend-api@0.31.0
  - @checkstack/automation-common@0.10.0
  - @checkstack/auth-common@0.13.0
  - @checkstack/script-packages-backend@0.4.0
  - @checkstack/sdk@0.126.1
  - @checkstack/ai-common@0.6.6
  - @checkstack/command-backend@0.2.21
  - @checkstack/gitops-backend@0.5.21
  - @checkstack/gitops-common@0.7.3
  - @checkstack/integration-common@0.9.8
  - @checkstack/notification-common@1.5.3
  - @checkstack/queue-api@0.3.19
  - @checkstack/secrets-common@0.3.2
  - @checkstack/signal-common@0.2.17
  - @checkstack/template-engine@0.4.11

## 0.10.10

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
  - @checkstack/ai-backend@0.10.8
  - @checkstack/backend-api@0.30.0
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/command-backend@0.2.20
  - @checkstack/gitops-backend@0.5.20
  - @checkstack/script-packages-backend@0.3.24
  - @checkstack/sdk@0.125.1

## 0.10.9

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [a83bcc2]
- Updated dependencies [c55d7c6]
  - @checkstack/ai-backend@0.10.7
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/sdk@0.123.1
  - @checkstack/ai-common@0.6.5
  - @checkstack/auth-common@0.12.2
  - @checkstack/automation-common@0.9.2
  - @checkstack/command-backend@0.2.19
  - @checkstack/gitops-backend@0.5.19
  - @checkstack/gitops-common@0.7.2
  - @checkstack/integration-common@0.9.7
  - @checkstack/notification-common@1.5.2
  - @checkstack/queue-api@0.3.18
  - @checkstack/script-packages-backend@0.3.23
  - @checkstack/secrets-common@0.3.1
  - @checkstack/signal-common@0.2.16
  - @checkstack/template-engine@0.4.10

## 0.10.8

### Patch Changes

- Updated dependencies [faf98f5]
- Updated dependencies [faf98f5]
  - @checkstack/ai-backend@0.10.6
  - @checkstack/backend-api@0.29.0
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/command-backend@0.2.18
  - @checkstack/gitops-backend@0.5.18
  - @checkstack/script-packages-backend@0.3.22
  - @checkstack/gitops-common@0.7.1
  - @checkstack/sdk@0.122.1
  - @checkstack/ai-common@0.6.4
  - @checkstack/auth-common@0.12.1
  - @checkstack/automation-common@0.9.1
  - @checkstack/integration-common@0.9.6
  - @checkstack/notification-common@1.5.1
  - @checkstack/queue-api@0.3.17
  - @checkstack/signal-common@0.2.15
  - @checkstack/template-engine@0.4.9

## 0.10.7

### Patch Changes

- Updated dependencies [e819276]
- Updated dependencies [e819276]
  - @checkstack/ai-backend@0.10.5
  - @checkstack/backend-api@0.28.0
  - @checkstack/command-backend@0.2.17
  - @checkstack/gitops-backend@0.5.17
  - @checkstack/script-packages-backend@0.3.21

## 0.10.6

### Patch Changes

- Updated dependencies [b4e0832]
  - @checkstack/ai-backend@0.10.4

## 0.10.5

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/ai-backend@0.10.3
  - @checkstack/gitops-common@0.7.0
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/sdk@0.119.1
  - @checkstack/gitops-backend@0.5.16
  - @checkstack/backend-api@0.27.1
  - @checkstack/script-packages-backend@0.3.20
  - @checkstack/command-backend@0.2.16

## 0.10.4

### Patch Changes

- Updated dependencies [52c55bf]
- Updated dependencies [d1b71b6]
- Updated dependencies [7c18b25]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [53666a7]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/notification-common@1.5.0
  - @checkstack/ai-backend@0.10.2
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/auth-common@0.12.0
  - @checkstack/automation-common@0.9.0
  - @checkstack/sdk@0.118.1
  - @checkstack/script-packages-backend@0.3.19
  - @checkstack/ai-common@0.6.3
  - @checkstack/command-backend@0.2.15
  - @checkstack/gitops-backend@0.5.15
  - @checkstack/gitops-common@0.6.8
  - @checkstack/integration-common@0.9.5
  - @checkstack/queue-api@0.3.16
  - @checkstack/secrets-common@0.2.8
  - @checkstack/signal-common@0.2.14
  - @checkstack/template-engine@0.4.8

## 0.10.3

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ai-backend@0.10.1

## 0.10.2

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/ai-backend@0.10.0
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/sdk@0.116.1
  - @checkstack/ai-common@0.6.2
  - @checkstack/auth-common@0.11.2
  - @checkstack/automation-common@0.8.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/command-backend@0.2.14
  - @checkstack/gitops-backend@0.5.14
  - @checkstack/gitops-common@0.6.7
  - @checkstack/integration-common@0.9.4
  - @checkstack/notification-common@1.4.2
  - @checkstack/queue-api@0.3.15
  - @checkstack/script-packages-backend@0.3.18
  - @checkstack/secrets-common@0.2.7
  - @checkstack/signal-common@0.2.13
  - @checkstack/template-engine@0.4.7

## 0.10.1

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/ai-backend@0.9.1
  - @checkstack/backend-api@0.26.0
  - @checkstack/ai-common@0.6.1
  - @checkstack/auth-common@0.11.1
  - @checkstack/automation-common@0.8.1
  - @checkstack/gitops-common@0.6.6
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/integration-common@0.9.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/secrets-common@0.2.6
  - @checkstack/signal-common@0.2.12
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0
  - @checkstack/gitops-backend@0.5.13
  - @checkstack/queue-api@0.3.14
  - @checkstack/script-packages-backend@0.3.17
  - @checkstack/sdk@0.115.1
  - @checkstack/template-engine@0.4.6

## 0.10.0

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

- Updated dependencies [748dc50]
  - @checkstack/automation-common@0.8.0
  - @checkstack/ai-backend@0.9.0
  - @checkstack/sdk@0.113.1
  - @checkstack/script-packages-backend@0.3.16

## 0.9.3

### Patch Changes

- 8cad340: refactor: use `extractErrorMessage` instead of `(error as Error).message`

  All 24 `(error as Error).message` casts in `automation-backend`'s dispatch and
  entity modules are replaced with the project-wide `extractErrorMessage(error)`
  helper from `@checkstack/common`. This removes the unsafe `error as Error`
  assumption (the same one the lint-banned `instanceof Error` would make) and
  correctly handles non-Error throwables (strings, plain objects) in log output.

- 8cad340: refactor: replace `env as unknown as EnvStash` double casts with module-scoped holders

  The `init()` -> `afterPluginsReady()` bridging that stashed setup closures and
  service handles as ad-hoc mutable properties on the framework `env` object via a
  double cast (`env as unknown as EnvStash`) is replaced with typed module- or
  register-scoped `let` holders, mirroring the existing pattern in
  `healthcheck-backend` (`storedEmitHook`). No behavior or DB change; the holders
  are pod-local setup state (never queryable current state), so they remain
  scale-correct. This removes an unsafe, copy-paste-prone idiom from five core
  plugins.

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
  - @checkstack/gitops-backend@0.5.12
  - @checkstack/script-packages-backend@0.3.15
  - @checkstack/backend-api@0.25.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/auth-common@0.11.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/sdk@0.112.1
  - @checkstack/automation-common@0.7.1
  - @checkstack/gitops-common@0.6.5
  - @checkstack/integration-common@0.9.2
  - @checkstack/queue-api@0.3.14
  - @checkstack/secrets-common@0.2.5
  - @checkstack/signal-common@0.2.11
  - @checkstack/template-engine@0.4.6

## 0.9.2

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/ai-backend@0.7.2
  - @checkstack/command-backend@0.2.11
  - @checkstack/gitops-backend@0.5.11
  - @checkstack/script-packages-backend@0.3.14

## 0.9.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/ai-backend@0.7.1
  - @checkstack/command-backend@0.2.10
  - @checkstack/gitops-backend@0.5.10
  - @checkstack/script-packages-backend@0.3.13
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/sdk@0.109.1

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
  - @checkstack/ai-backend@0.7.0
  - @checkstack/ai-common@0.5.0
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/auth-common@0.10.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-common@0.7.0
  - @checkstack/sdk@0.108.1
  - @checkstack/script-packages-backend@0.3.12
  - @checkstack/command-backend@0.2.9
  - @checkstack/gitops-backend@0.5.9
  - @checkstack/gitops-common@0.6.4
  - @checkstack/integration-common@0.9.1
  - @checkstack/notification-common@1.3.4
  - @checkstack/queue-api@0.3.13
  - @checkstack/secrets-common@0.2.4
  - @checkstack/signal-common@0.2.10
  - @checkstack/template-engine@0.4.5

## 0.8.1

### Patch Changes

- Updated dependencies [bb6f0fe]
  - @checkstack/ai-backend@0.6.1
  - @checkstack/sdk@0.107.1
  - @checkstack/script-packages-backend@0.3.11

## 0.8.0

### Minor Changes

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

- 748268c: Add an example-automation template catalogue. Creating a new automation now
  opens a picker (`/automation/new`) with curated, ready-to-use starting points
  grouped by category, plus a "Blank automation" option. Selecting a template
  seeds the editor (the operator still chooses a service account and saves).

  Templates are an extensible registry: external plugins contribute their own via
  the new `automationTemplateExtensionPoint`, exactly like actions / triggers /
  artifact types. Every registered template is validated against the LIVE
  trigger/action/artifact registries at server startup - a template that
  references a capability that is not installed is withheld with a console
  warning, and one whose definition no longer validates (interface drift) is
  withheld with a console error - so a template can never silently drift when an
  action, trigger, condition, or artifact interface changes.

  Ships five built-in templates spanning incident response and alerting
  (AI-triage-and-file-Jira-bug, close-Jira-on-recovery, AI-summarize-incident,
  page-on-call-on-sustained-degradation, AI-severity-escalation).

- 079369a: The AI assistant can now discover dynamic-option values for config fields nested
  inside an array of rows (e.g. a Jira `create_issue`'s `fieldMappings[].fieldKey`,
  which lists a project + issue type's additional/custom fields). `getResolverField`
  and `listResolverFields` (and thus the `automation.resolveActionOptions` tool) now
  accept a DOTTED field path that steps through object `properties` and array
  `items.properties`, so the model can resolve `fieldMappings.fieldKey` the same way
  it resolves top-level fields like `projectKey`. Previously only top-level resolver
  fields were reachable, so the assistant could not discover (and therefore could
  not populate) additional Jira fields.

### Patch Changes

- 4134ed9: Fix a performance regression in `getBindableApplications`: it resolved every
  application's effective access rules with 3-4 queries per application on every
  call, which the AI propose / service-account flow hits on each chat turn,
  showing up as broad slowness on the shared database. Rule resolution is now
  batched into a fixed number of queries regardless of how many applications
  exist, and an admin (`*`) caller that does not need the rules (the editor's
  "Run as" picker) skips resolution entirely. The query gains an optional
  `includeAccessRules` input (default off); `accessRules` is returned only when
  requested.
- 079369a: Fix producing automation actions that double-prefixed their artifact type. The
  action registry qualifies `produces` with the owning plugin id, but several
  actions set `produces` to an already-qualified id, so it became
  `plugin.plugin.type` (e.g. `automation.automation.analysis`,
  `maintenance.maintenance.window`). This stored artifacts under a type that
  matched no registered artifact type, and — because the run scope exposes a
  produced artifact under its type's local name — broke the documented downstream
  reference `artifacts.<actionId>.<name>.<field>` (a `choose`/condition/template
  referencing the analysis output, a created incident/maintenance/etc. silently
  saw `undefined` and took the wrong branch).

  Fixed in `ai_analyze` (`analysis`), the built-in `notify_user`
  (`notify_user_result`), and the catalog (`system_record`), maintenance
  (`window`), notification (`send_result`), dependency (`edge`), and healthcheck
  (`assignment`) actions — each now uses the unqualified local id matching its
  artifact-type definition.

  BREAKING (beta): any automation that referenced one of these artifacts via the
  old double-prefixed scope key (e.g. `artifacts.x['automation.analysis']`) must
  switch to the documented form (`artifacts.x.analysis.<field>`). The
  double-prefixed key was never the intended/documented path.

- Updated dependencies [079369a]
- Updated dependencies [4134ed9]
- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
  - @checkstack/ai-backend@0.6.0
  - @checkstack/ai-common@0.4.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/automation-common@0.6.0
  - @checkstack/auth-common@0.9.1
  - @checkstack/template-engine@0.4.4
  - @checkstack/command-backend@0.2.8
  - @checkstack/gitops-backend@0.5.8
  - @checkstack/script-packages-backend@0.3.10
  - @checkstack/sdk@0.106.1
  - @checkstack/healthcheck-common@1.6.2

## 0.7.0

### Minor Changes

- ebef442: feat(ai): let the assistant resolve dynamic integration-action field values

  Integration action fields like Jira `create_issue`'s `projectKey`, `issueTypeId`,
  and `priorityId` are not free-form - their valid values come from the connected
  system (the editor renders them as cascading dropdowns via `x-options-resolver`).
  The AI assistant had no way to fetch those values, so it guessed, and propose-time
  validation never checked them - a fabricated `projectKey` only failed at runtime.

  - **New user-callable `integration.resolveConnectionOptions` RPC** (the non-admin
    counterpart of `getConnectionOptions`, mirroring `listConnectionSummaries`), so
    automation authors and the assistant can resolve a field's options without
    `integration.manage`. Returns option labels/values only.
  - **New `automation.resolveActionOptions` AI tool**: resolves a field's valid
    values live from the connection, the same source the editor dropdown uses. It
    is provider-agnostic (reads the field's resolver and `x-depends-on` from the
    action's own schema) and dependency-aware - for a cascade like `issueTypeId`
    (depends on `projectKey`), the model resolves the parent first and passes it in
    `dependencies`.
  - **Propose-time options validation**: `automation.propose` now checks every
    literal dynamic-option value against the live options for its connection
    (sourcing each field's dependency values from the same config so cascades
    resolve), flagging values the connection does not offer with guidance to call
    `automation.resolveActionOptions`. Templated values and fields with
    templated/absent dependencies are skipped; a resolver lookup failure is skipped
    rather than blocking, so transient provider flakiness never gates a proposal.

  - **Automation editor works for non-admins**: the editor's option-resolver
    bridge now calls the user-callable `listConnectionSummaries` /
    `resolveConnectionOptions` instead of the admin-gated `listConnections` /
    `getConnectionOptions`, so an automation author without `integration.manage`
    gets working connection pickers and cascading dropdowns instead of empty/
    forbidden ones.

  The resolver lookup and the dependency handling are factored into reusable
  helpers that work for any provider's `x-options-resolver` fields.

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
  - @checkstack/integration-common@0.9.0
  - @checkstack/automation-common@0.5.0
  - @checkstack/auth-common@0.9.0
  - @checkstack/ai-backend@0.5.0
  - @checkstack/ai-common@0.3.0
  - @checkstack/sdk@0.105.1
  - @checkstack/script-packages-backend@0.3.9
  - @checkstack/healthcheck-common@1.6.1
  - @checkstack/backend-api@0.21.7
  - @checkstack/command-backend@0.2.7
  - @checkstack/gitops-backend@0.5.7

## 0.6.0

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

- c4bebbb: feat(automation): add AI discovery tools for runAs and integration connections

  The automation AI assistant could fabricate values it should source from the
  platform - inventing a `runAs` (e.g. "system") that does not exist, or
  hand-rolling a URL/token instead of referencing a configured integration
  connection - so the proposed automations failed to save or run.

  Two new read-effect AI tools let the model discover real values before
  proposing:

  - `automation.listServiceAccounts` lists the service accounts (applications)
    the calling user may bind as an automation's `runAs`, filtered by the same
    `isApplicationBindable` subset check the create/update handler enforces at
    save time. The model picks one of these ids for `automation.propose` instead
    of inventing one.
  - `automation.listConnections` lists the configured integration connections
    (grouped by provider, optionally filtered by `providerId`) so the model
    references a real `connectionId` in an integration action's config instead of
    hand-rolling credentials.

  Both are gated by the automation read rule and fan out through the user-scoped
  client, so handler-side authorization applies.

  `automation.listConnections` discovers connection-capable providers from the
  action catalog (`automation.listActions`, gated by the same `automation.read`
  rule) via each action's `connectionProviderId`, NOT from the integration
  plugin's admin-only `listProviders`. A caller who can read automations but lacks
  `integration.manage` can therefore use the tool without hitting FORBIDDEN, and
  every read degrades gracefully: a failed catalog fetch yields an empty result
  and a failed per-provider connection listing yields an empty connection list,
  so the model always gets a usable partial result instead of a hard tool error.

- c4bebbb: feat(automation): validate AI-proposed automations at propose time

  `automation.propose`'s dry run now catches the three ways an AI-authored
  automation silently fails before it is applied, surfacing each as a clear,
  actionable error on the review card instead of a runtime failure:

  - A `runAs` that does not exist or that the caller may not bind is rejected
    with guidance to call `automation.listServiceAccounts`, using the same
    bindable-application check the create/update gate enforces at save time.
  - A `connectionId` that does not reference a real connection for the action's
    provider is rejected with guidance to call `automation.listConnections`.
    Templated connection ids are skipped, and a lookup failure degrades to a soft
    "could not verify" note rather than a hard error.
  - An unwired artifact/template reference (`{{ artifacts.<id>... }}` whose
    producer action id does not exist or does not produce an artifact) is flagged
    by the definition validator, which now walks configs, variables blocks,
    `choose` `when` clauses, and conditions. Built-in roots (trigger/vars/now)
    and literal prose are left untouched.
  - A reference whose `<artifactType>` segment does not match the producing
    action's artifact type (e.g. `artifacts.check.found` when the action produces
    `issue_search`, so the correct path is `artifacts.check.issue_search.found`)
    is now flagged too. Dropping that segment otherwise resolves to `undefined` at
    run time and makes a gate built on it silently misfire. A bare whole-object
    `artifacts.<id>` reference is still accepted.

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [0ffe357]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/ai-backend@0.4.0
  - @checkstack/ai-common@0.2.0
  - @checkstack/integration-common@0.8.0
  - @checkstack/sdk@0.104.1
  - @checkstack/script-packages-backend@0.3.8

## 0.5.8

### Patch Changes

- Updated dependencies [dbb76a2]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/ai-backend@0.3.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/sdk@0.103.1
  - @checkstack/backend-api@0.21.6
  - @checkstack/script-packages-backend@0.3.7
  - @checkstack/command-backend@0.2.6
  - @checkstack/gitops-backend@0.5.6

## 0.5.7

### Patch Changes

- Updated dependencies [2428bfc]
  - @checkstack/ai-backend@0.2.0

## 0.5.6

### Patch Changes

- Updated dependencies [f9cfdae]
  - @checkstack/ai-backend@0.1.6
  - @checkstack/sdk@0.101.1
  - @checkstack/script-packages-backend@0.3.6

## 0.5.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/auth-common@0.8.3
  - @checkstack/ai-backend@0.1.5
  - @checkstack/common@0.15.0
  - @checkstack/ai-common@0.1.3
  - @checkstack/automation-common@0.4.3
  - @checkstack/gitops-common@0.6.3
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/integration-common@0.7.3
  - @checkstack/notification-common@1.3.3
  - @checkstack/secrets-common@0.2.3
  - @checkstack/command-backend@0.2.5
  - @checkstack/gitops-backend@0.5.5
  - @checkstack/script-packages-backend@0.3.5
  - @checkstack/sdk@0.100.1
  - @checkstack/queue-api@0.3.12
  - @checkstack/signal-common@0.2.9
  - @checkstack/template-engine@0.4.3

## 0.5.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/ai-backend@0.1.4
  - @checkstack/command-backend@0.2.4
  - @checkstack/gitops-backend@0.5.4
  - @checkstack/script-packages-backend@0.3.4

## 0.5.3

### Patch Changes

- Updated dependencies [00b9367]
  - @checkstack/ai-backend@0.1.3
  - @checkstack/ai-common@0.1.2
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/backend-api@0.21.3
  - @checkstack/command-backend@0.2.3
  - @checkstack/common@0.14.1
  - @checkstack/gitops-backend@0.5.3
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.3
  - @checkstack/integration-common@0.7.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/script-packages-backend@0.3.3
  - @checkstack/sdk@0.98.1
  - @checkstack/secrets-common@0.2.2
  - @checkstack/signal-common@0.2.8
  - @checkstack/template-engine@0.4.2

## 0.5.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-backend@0.1.2
  - @checkstack/ai-common@0.1.2
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-common@0.4.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/command-backend@0.2.2
  - @checkstack/gitops-backend@0.5.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/script-packages-backend@0.3.2
  - @checkstack/sdk@0.96.1
  - @checkstack/secrets-common@0.2.2
  - @checkstack/signal-common@0.2.8
  - @checkstack/template-engine@0.4.2

## 0.5.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/queue-api@0.3.10
  - @checkstack/ai-backend@0.1.1
  - @checkstack/ai-common@0.1.1
  - @checkstack/auth-common@0.8.1
  - @checkstack/automation-common@0.4.1
  - @checkstack/command-backend@0.2.1
  - @checkstack/gitops-backend@0.5.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/integration-common@0.7.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/script-packages-backend@0.3.1
  - @checkstack/sdk@0.95.1
  - @checkstack/secrets-common@0.2.1
  - @checkstack/signal-common@0.2.7
  - @checkstack/template-engine@0.4.1

## 0.5.0

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

- 9dcc848: Automations now run as a configured service account, removing implicit god-mode from the dispatch path.

  BREAKING: every automation must declare a `runAs` application (service account). Previously every automation action ran as the trusted service client, bypassing all access-rule, per-resource, and team-scope checks - so an automation could touch any team's data. Now each automation runs as a bounded `application` principal, and every data-access call an action makes is authorized exactly as that identity. An automation with no `runAs` fails to run with a clear error rather than falling back to the trusted client; legacy automations must be assigned a service account before they run again.

  What changed:

  - New top-level field `runAs` on automations (a `run_as_application_id` column + create/update inputs; `AutomationSchema.runAs`). Required on create; GitOps sets it via the `run-as` metadata label.
  - A new `coreServices.rpcClientAs(applicationId)` mints a short-lived, backend-signed app-principal token; the auth service resolves it LIVE to an `application` principal (reusing `enrichApplicationPrincipal`), so it flows through full `autoAuthMiddleware` enforcement. The dispatch engine threads this client into every action's `execute` as the required `context.rpcClient`.
  - Bind authority (anti-escalation): a user may only bind an application whose access rules are a subset of their own (`isApplicationBindable`); `getBindableApplications` lists only bindable apps, and the create/update handlers enforce the check.
  - `notification.sendTransactional` moves from service-only to access-gated (`notification.send`, a new access rule), so an automation's `runAs` can call the built-in `notify_user` / `notification.send` actions; trusted services still bypass via short-circuit.
  - A "Run as (Service Account)" picker in the automation editor, populated from `getBindableApplications` (server-side filtered to bindable apps), seeding from the loaded `runAs` on edit and passing it into create + update. First-class teaching UX: an inline info banner, a blocked Save with an inline hint until one is chosen, and an empty state linking to the Applications admin + docs when none are bindable.

  State and scale: `runAs` resolution is a pure read over shared tables; the app-principal token is self-contained and verified statelessly, so the per-run client is correct under horizontal scale.

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

- 9dcc848: Layered OS-level script sandbox, secure and fail-closed by default (epic #247).

  Script and shell health checks and the `run_shell` / `run_script` automation actions now run inside a layered OS-level sandbox by default. The sandbox lives in `core/backend-api/src/script-sandbox/` (the single source of truth) and is enforced inside the shared runners, so it applies wherever a job runs.

  Layers:

  - Resource caps (CPU / memory / PID / FD / file-size, via `prlimit` on capable Linux; ESM JS-heap cap via `--max-old-space-size`; portable wall-clock timeout) and an OOM-safe streaming output cap.
  - Privilege drop via a NON-ROOT supervisor model: the shipped images run the supervisor as non-root uid `65532`, so every sandboxed script inherits non-root and can never be host-root; filesystem + network confinement is delivered by ROOTLESS `bwrap`/`nsjail` via unprivileged user namespaces. `enforced.privilege` is truthful (true only when the child cannot run as host-root). Runners no longer pass `uid`/`gid` to `Bun.spawn` (a silent no-op and a forward-compat hazard).
  - Filesystem isolation (`scratch-only` / `scratch-plus-ro`) confining the child to its per-run scratch dir over a read-only base; the interpreter path is RO-bound so the runtime execs, and `TMPDIR` is pinned to the in-namespace tmpfs.
  - Network egress control: `deny` (routeless loopback-only netns), `allowlist` (real plumbed egress via macvlan OR rootless slirp4netns + an in-kernel nftables filter), and an always-on metadata / link-local block (`169.254.0.0/16`, `fe80::/10`, `fc00::/7`). No-blackhole invariant: `enforced.network` is never true when egress is actually severed or unfiltered; unpluggable egress degrades to surfaced host net.
  - Per-run fork-bomb containment via RLIMIT*NPROC inside the fresh per-run user+PID namespace; a centralized forbidden-env denylist (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD*_`, `NODE*OPTIONS`, `BUN*_`, caller `PATH` overrides).
  - A validated tuned seccomp profile (`deploy/seccomp/checkstack-userns.json`) and a live `clone(CLONE_NEWUSER|CLONE_NEWNET)` capability probe (not the static sysctl), shipped by default in both Dockerfiles, `docker-compose.yml`, and `deploy/k8s/checkstack-sandbox.yaml`.

  Global policy and operator surface:

  - The global sandbox policy lives in ONE durable row owned by `script-packages` (its `ConfigService` row in shared `plugin_configs`). A single process-wide provider serves every runner; the two script plugins no longer register competing providers. A dedicated admin-only `script-sandbox.manage` permission gates both reading and writing the policy. New `getSandboxPolicy` / `setSandboxPolicy` endpoints and a Settings -> Script Sandbox admin UI (`enabled`, `onUnavailable`, network/filesystem/privilege modes, allow list, metadata block, resource caps). The startup capability/readiness log is emitted in-process by `script-packages-backend` (no fragile init-order RPC self-loop), and on a host that cannot enforce a layer a one-time startup warning explains the two local-dev paths (Docker, or set the global policy to `degrade`).
  - Satellite relay: the WS protocol carries the resolved policy in the `authenticated` message and a `sandbox_policy` push-on-change; a satellite caches the last relayed policy and resolves every run through it.

  BREAKING CHANGES (platform in BETA, shipped as minor):

  - Scripts run sandboxed by default. The shipped global default is FAIL-CLOSED (`onUnavailable: "fail"`): when a requested layer cannot be enforced the run is REFUSED (clean `exitCode: -1`, never an unsandboxed spawn) rather than silently degrading. Deployments on hosts that cannot enforce a layer (no bubblewrap, user namespaces blocked, no `/proc` unmask) must run the official images with the documented runtime flags (the bundled seccomp profile + `systempaths=unconfined`, or k8s `procMount: Unmasked`), or set the global policy to `degrade`. On macOS / restricted containers the strong layers degrade to the portable subset and are surfaced per run.
  - Default network posture is deny-egress (`allowlist` with an empty allow list, which resolves to the routeless `deny` path). Scripts calling external endpoints fail until those destinations are allowlisted in the global default. The always-on metadata / link-local block applies even under looser modes.
  - The per-action / per-check `sandbox` config override and the transport `ScriptRequest.sandbox` field are removed; policy is global-only, so an automation/check author can no longer weaken the sandbox on their own item. Stored configs carrying a stray `sandbox` key are tolerated (stripped on parse).
  - The shared runners' `run()` no longer accepts a `sandbox` option; callers rely on the global policy provider.
  - A satellite fails closed (most restrictive profile) until it receives the first relayed policy; a relay-read failure or an older core keeps it fail-closed. A relay failure can never loosen a satellite's sandbox.

  State and scale: the global policy is a single durable Postgres row read identically on every pod. Capability detection is per-process, deterministic from the host kernel, and surfaced per run via the `EffectiveSandbox` report (a Linux pod and a macOS satellite may legitimately differ). `CHECKSTACK_SANDBOX_UID/GID` and macvlan addressing are genuinely per-host infrastructure, surfaced per run, not the queryable policy. The satellite's policy cache is satellite-local transport state. No new pod-local current-state.

  This is a beta minor.

- 9dcc848: Add the auto-generated, version-pinned `@checkstack/sdk` package + codegen, and serve its types live to the in-app editor.

  - A new committed workspace package `@checkstack/sdk`, generated from the platform's source of truth by `scripts/generate-sdk.ts` (`generate:sdk` / `generate:sdk:check`): a fully-typed oRPC client (`createCheckstackClient`) over the REST surface with one `InferClient` per plugin contract, real script-authoring helpers (`@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration`) whose runtime body is the same identity function the in-app runner injects, per-subpath `.d.ts` under the package `exports` map, and an editor-only ambient bundle. A `generate:sdk:check` CI guard fails when the committed SDK files drift from a fresh generation. The `@checkstack/sdk` version is stamped from `@checkstack/release` and MUST NOT appear in a changeset (a guard enforces this); the `@checkstack/release` bump here advances the release version so the generated SDK can be published later. The generated client also normalizes its base URL without a backtracking-prone regex, closing a CodeQL `js/polynomial-redos` finding.
  - Live editor type injection: a new version-keyed route `GET /api/script-packages/sdk-types/:releaseVersion` (raw handler in `@checkstack/script-packages-backend`) serves the generated SDK editor bundle with `Cache-Control: private, max-age=1y, immutable`; the pure path-build/parse module lives in `@checkstack/script-packages-common`, shared by backend and frontend. A mismatched version returns `409` so the editor refetches and never serves stale types after an upgrade. The frontend `useSdkTypeInjection` hook fetches the bundle once per session and mounts it into Monaco via `addExtraLib`. Schema-narrowed `context.config` / `context.event.payload` editor types stay local; the package-resolving module declarations come from the one published `@checkstack/sdk` source.

  BREAKING CHANGES: the script-authoring import surface moves from the bare `@checkstack/healthcheck` / `@checkstack/integration` virtual modules to the `@checkstack/sdk/healthcheck` / `@checkstack/sdk/integration` subpaths of the published `@checkstack/sdk` package. The old bare-name imports no longer resolve (an old import now errors in the editor, surfacing the migration). Existing scripts must update the module specifier:

      - import { defineHealthCheck } from "@checkstack/healthcheck";
      + import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

      - import { defineIntegration } from "@checkstack/integration";
      + import { defineIntegration } from "@checkstack/sdk/integration";

  The helper names and their runtime behaviour are unchanged - only the module specifier moves. The global (no-import) helper form continues to work unchanged.

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
  - @checkstack/ai-backend@0.1.0
  - @checkstack/ai-common@0.1.0
  - @checkstack/auth-common@0.8.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/automation-common@0.4.0
  - @checkstack/common@0.13.0
  - @checkstack/template-engine@0.4.0
  - @checkstack/script-packages-backend@0.3.0
  - @checkstack/command-backend@0.2.0
  - @checkstack/gitops-backend@0.5.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/integration-common@0.7.0
  - @checkstack/secrets-common@0.2.0
  - @checkstack/sdk@0.93.1
  - @checkstack/queue-api@0.3.9
  - @checkstack/signal-common@0.2.6

## 0.4.0

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
  - @checkstack/command-backend@0.1.33
  - @checkstack/gitops-backend@0.4.1
  - @checkstack/queue-api@0.3.8
  - @checkstack/script-packages-backend@0.2.1

## 0.3.0

### Minor Changes

- 270ef29: Fix automation provider actions and `secretEnv` script actions throwing in production.

  The automation dispatch engine resolved provider-action dependencies (the integration connection store, the secret resolver) through a `getService` that was a throwing stub, so Jira / Teams / Webex actions and `secretEnv` script actions threw at execute time in production. The whole dispatch test suite stubbed `getService`, so the break was invisible.

  Root cause: the plugin `env` exposed `registerService` but no resolver, so the dispatch path (the only context that resolves arbitrary cross-plugin refs outside an RPC handler) had nothing real to call.

  Changes:

  - `@checkstack/backend-api`: add `getService<S>(ref: ServiceRef<S>): Promise<S>` to the plugin `env` (`BackendPluginRegistry`). It resolves a service registered by any plugin through the real `ServiceRegistry` using the calling plugin's identity, and throws a clear error if the ref is not registered (never silently `undefined`). **NEW PLUGIN-AUTHOR CONTRACT**: `env.getService` is now available to resolve arbitrary cross-plugin service refs at init / afterPluginsReady time.
  - `@checkstack/backend`: implement `env.getService` in both the plugin loader and the runtime single-plugin registration path, backed by `ServiceRegistry.get(ref, { pluginId })`.
  - `@checkstack/automation-backend`: wire the dispatch `getService` to `env.getService` (was a throwing stub). This also activates run-wide provider-credential masking, because resolving the connection store / secret resolver now flows through the run's masking interceptor.

  Also fixes a test-only seam where the `core/backend` test preload registered a no-op `registerRouter`, silently disabling oRPC router registration across the suite.

- b995afb: Show auto-generated trigger ids in the automation editor without clicking the field.

  Previously, loading a stored definition (a seeded default, a GitOps-managed automation, or hand-written YAML) whose triggers carried no `id` left the Id field blank until the operator focused and blurred it. The editor now materializes the derived id eagerly on load - the same way the starter automation and "Add step" path already do - so the id is shown (and referenceable as `trigger.id`) immediately. The runtime already derived these ids, so saved definitions are unchanged.

  The auto-incident migration also now writes explicit trigger ids (matching `deriveTriggerId(event)`) into the seeded sustained and flapping automations, so newly seeded defaults carry the same id the editor shows.

- b995afb: Surface per-variant config documentation for the `Automation` GitOps kind.

  The GitOps editor and Kind Registry Browser now show the right config schema
  for each automation trigger and provider action when authoring an
  `Automation` YAML, mirroring how the `Healthcheck` kind documents its
  strategy/collector configs:

  - `triggers[].config` — one entry per registered trigger that declares a
    `configSchema`, conditioned on the chosen `triggers[].event`.
  - `actions[].config` — one entry per registered provider action,
    conditioned on the chosen `actions[].action`.

  New plugin-author contract on the entity kind registry:

  - `@checkstack/gitops-common` / `@checkstack/gitops-backend`: add
    `EntityKindRegistry.registerSpecSchemaDocumentationProvider(provider)`. The
    provider is a thunk invoked on every `describeKinds()` (i.e. each time the
    kind-browser RPC is queried), so the docs it returns reflect the current
    state of whatever it reads — order-independent.

  Why a lazy provider (and not the existing eager
  `registerSpecSchemaDocumentation`): unlike Healthcheck, whose
  strategy/collector registries are core services fully populated before any
  plugin's `afterPluginsReady`, the automation trigger/action registries are
  filled by other plugins across their `init` / `afterPluginsReady` phases with
  no guaranteed ordering. Several plugins (catalog/maintenance/notification)
  register their provider actions in their own `afterPluginsReady`, so the
  previous one-shot eager registration snapshotted a half-populated (often
  empty) registry and the Automation kind's "Additional Schemas" came up empty.
  automation-backend now registers a provider instead, so trigger/action config
  docs always reflect the fully-populated registries.

  Documentation-only surface; no runtime reconcile behaviour changes.

- b995afb: Add grouping to automations so they are easier to find.

  Each automation now carries an optional single free-text `group` label (HA-style "category"), stored as its own column on the `automations` row alongside `name` / `description` / `status` - it is NOT part of the definition / YAML. The automations list renders one collapsible section per group (sorted alphabetically, with an implicit "Ungrouped" bucket last), and the edit page gains a type-new-or-pick-existing group picker fed by the new `listAutomationGroups` query. `listAutomations` accepts an optional `group` filter.

  Declaratively managed automations express their group via GitOps `metadata.labels.group`; the reconciler threads it onto the row (blank clears it).

  A Drizzle migration adds the nullable `"group"` column and an index. Existing automations default to no group (Ungrouped) and behave exactly as before.

- 270ef29: Add live state in scope plus duration helpers to the automation sensing layer (Wave 2 Phase 14).

  - `@checkstack/template-engine` ships four pure, synchronous duration filters: `minutes` and `hours` (number to milliseconds), `duration_since` (ms elapsed since an ISO timestamp), and `older_than(thresholdMs)` (boolean dwell check). They compute against real time at call time, so "now" is fresh per evaluation. Fail-safe on null/unparseable input.
  - The dispatch engine pre-resolves live health state into scope before any condition or template evaluation (the engine is synchronous, so inline state queries are impossible). State is folded under a `health` namespace - `health.system.*` for the trigger's context system and `health.systems[<id>]` for ids listed in the automation's new `uses_state` field. One batched `getBulkHealthState` query per evaluation, wired at the fresh-run, resume, and trigger-gate sites. Fail-open: a missing client or provider error yields an empty namespace and a warning, never wedging unrelated automations.
  - New `automationFilterExtensionPoint` lets plugins contribute pure template filters without forking the engine's default registry. Name collisions with built-ins are skipped with a warning.
  - The editor variable-scope resolver and autocomplete catalogue now surface the `health.*` namespace and the new duration filters.

  With this phase alone, an operator can build "notify me when a system has been unhealthy for 30 minutes" using an interval trigger plus a single `health.*` condition - no dwell timer required (the precise event-driven path lands in Phase 15).

- 270ef29: Add the `for:` dwell on triggers (Wave 2 Phase 15) - precise, event-driven, restart-safe "fire only if the matched state still holds after Y".

  - New first-class `TriggerSchema.for` (decision D1): a single-unit duration (`{ seconds | minutes | hours }`) or `{ template }` rendering to seconds. A `durationToMs` helper resolves it. Not buried in `config`.
  - New pre-run `automation_dwell_timers` table (decision D5): a dwell arms before any run exists, so it cannot reuse the run-scoped wait locks. Unique on `(automationId, triggerId, contextKey)` so a re-fire re-arms (pushes `fireAt`) rather than stacking timers.
  - Arm / re-arm / fire / cancel wired into the trigger fan-in. When a `for:` trigger fires and its filter passes, the engine snapshots the current status, upserts the dwell row, and enqueues an `automation-dwell` wake job with the matching `startDelay` - no run starts yet.
  - At expiry the dwell re-confirms (via the Phase 13 health-state provider) that the system is still in the armed status, then re-checks the automation's pre-run conditions, then starts the run honouring the concurrency mode. A recovery within the window cancels the pending fire even without an explicit inverse event.
  - Cancellation is DB-side (delete the row; the queue job no-ops when it pops, since queue jobs are not cancellable). A contradicting state-change event eagerly deletes a stale dwell. Deleted automations drop their dwells via FK cascade; disabled automations drop them at fire time.
  - Durability: the dwell row is the source of truth. A new `automation-dwell` queue consumer fires dwells, and the stalled sweeper catches expired rows whose job was lost. Both paths are idempotent via delete-on-fire, so a dwell fires at most once and survives restart.

  Example:

  ```yaml
  triggers:
    - event: healthcheck.system.degraded
      for: { minutes: 30 }
  actions:
    - action: incident.create
      config:
        title: "{{ trigger.payload.systemName }} is critical"
        severity: critical
        systemIds: ["{{ trigger.payload.systemId }}"]
  ```

- 270ef29: Add the `numeric_state` trigger and three structured condition variants (Wave 2 Phase 16, backend-only).

  - New built-in `numeric_state` trigger: hook-backed on `healthcheck.check.completed`, fires when a numeric field (`latencyMs` top-level, or a `collectors.<id>.<field>` path) crosses an `above` / `below` threshold. The per-automation threshold is enforced by a new structured config gate (`TriggerDefinition.evaluateConfig`) that runs before the operator's template filter. Pairs with a trigger-level `for:` (Phase 15) for sustained thresholds. v1 is level-triggered; edge de-duplication is deferred. (Per-check `p95LatencyMs` is not in the hook payload; read windowed p95 via a `numeric_state` _condition_ against `health.system.p95_latency_ms` instead.)
  - Corrected the Phase 15 dwell `arm` semantics to be insert-if-absent: a re-fire while a dwell is still armed PRESERVES the original `fireAt` instead of pushing it. Required for the level-triggered `numeric_state` trigger above - otherwise a trigger firing on every check completion (e.g. every 60s) with `for: 10m` would re-arm and push the deadline forward indefinitely, never elapsing. A genuine recover-then-recur still deletes the row (re-confirm / inverse-cancel) so a fresh window starts.
  - Extended the condition grammar (`ConditionInput`) beyond `string | and | or | not` with three typed variants evaluated over the pre-resolved `health.*` scope plus a FRESH `now` per evaluation:
    - `numeric_state`: `{ value, above?, below? }` (value is a literal number or a template/path string).
    - `time`: `{ after?, before?, weekday?[], timezone? }` for on-call / quiet-hours gating, including overnight windows wrapping midnight, weekday filtering, and IANA timezone resolution via `Intl`.
    - `state`: `{ entity, status, for? }` - a condition-side dwell read from `health.systems[entity].in_status_for_ms` (no new timer; it reads, it doesn't time).
  - The raw template string stays the escape hatch. Everything round-trips through zod and YAML.

  Editor widgets (ConditionEditor branches, duration/time-of-day inputs, operator selects) are intentionally deferred to Phase 19; the YAML editor already round-trips the new schema, so the feature is fully usable and testable via YAML today.

- 270ef29: Add the `wait_until` action primitive (Wave 2 Phase 17) - suspend a running automation until a condition becomes true, with an optional timeout (HA's `wait_template`).

  - New `wait_until: { condition, timeout_seconds?, continue_on_timeout? }` primitive. `continue_on_timeout` defaults to true (HA semantics). Added to the schema, the action union, and `detectActionKind`. (The wait is fully reactive - see the reactive-dispatch-pipeline changeset; there is no `poll_seconds`.)
  - `condition` accepts any condition shape - a template string or the Phase 16 structured `numeric_state` / `time` / `state` variants.
  - Reactive resume: if the condition is already true it continues inline; otherwise it persists a `kind: "until"` wait lock (carrying the condition + timeout policy in a new `wait_config` jsonb column). The reactive-dispatch-pipeline changeset replaces the original poll-based re-check with a wake-index + a single timeout timer, so the wait is woken by a relevant entity change rather than ticked on an interval. Resumes take the per-run advisory lock so a wake and a sweep can't double-resume.
  - Survives restart: the wait lock is the source of truth, and the stalled sweeper applies the timeout policy as a backstop if the wake/timer signal is lost.
  - Works nested inside `choose` / `parallel` / `repeat` via the existing resume-remainder mechanism.
  - Editor: a `wait_until` action card (frontend) mirroring `wait_for_trigger` - a `ConditionEditor` plus timeout and continue-on-timeout inputs. The structured numeric/time/state ConditionEditor branches land with the rest of the sensing-layer editor work; the card uses the expression-based editor for now.

- 270ef29: Add a windowed transition count to the health provider - the building block for custom flapping rules (Wave 2 Phase 18).

  Flapping is already buildable today via the built-in `healthcheck.flapping_detected` trigger; this phase ships the GENERALIZATION for arbitrary "N status changes in M minutes" rules.

  - `countStateTransitionsInWindow` counts aggregate status transitions for a system over a trailing window (from the Phase 13 `health_check_state_transitions` table - all statuses, generalizing the unhealthy-only flapping detector). Fail-safe to 0.
  - `getHealthState` / `getBulkHealthState` now return `transitionsInWindow` + `transitionWindowMinutes`, and accept an optional `transitionWindowMinutes` input (default 60).
  - The automation definition gains an optional top-level `state_window_minutes` (default 60), threaded through `enrichScopeWithState` so `health.system.transitions_in_window` / `health.system.transition_window_minutes` are folded into scope per evaluation.
  - Operators author custom flapping as a `numeric_state` condition over `health.system.transitions_in_window` - no new condition variant, no editor change. The variable-scope resolver surfaces the new fields for autocomplete.

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

- 270ef29: Add the GitOps `Automation` entity kind (Wave 2 Phase 21).

  - `automation-backend` registers an `Automation` kind with the GitOps entity-kind registry (`specSchema: AutomationDefinitionSchema`). Reconcile upserts by name (identity tracked via the returned entity id + provenance); reconciled rows are tagged `managed_by = "gitops"`. Delete is guarded to GitOps-managed rows. An automation's full definition - triggers (with `for:` dwells), structured conditions, the action catalog, mode, `concurrency_scope`, `uses_state`, `state_window_minutes` - can now be declared in Git.
  - `automation-frontend`: the editor reads the GitOps provenance lock (`useProvenanceLock({ kind: "Automation", entityId })`) and, when locked, disables Save / Run-now / Delete and the form fields and shows a `GitOpsLockBanner`.
  - Documented the `Automation` YAML format under the GitOps kinds reference, plus new automation platform overview + plugin-author ("extending") developer-guide pages.

- 270ef29: Add per-context-key concurrency scope to automations (Phase 20 prerequisite).

  A new optional `concurrency_scope: "automation" | "context_key"` field on the automation definition controls the bucket the concurrency `mode` is evaluated over:

  - `automation` (default, backward-compatible): one bucket for the whole automation - `single` allows one in-flight run total, `restart` cancels every active run. Existing automations are unchanged.
  - `context_key`: an independent bucket per `contextKey` (typically per system / incident) - `single` allows one in-flight run _per context key_ (system A and system B run concurrently, but a second run for system A is deduped), and `restart` cancels only the active runs sharing the incoming context key.

  `RunStore.hasActiveRun` / `countActiveRuns` / `cancelActiveRuns` gain an optional `contextKey` filter (the `automation_runs.context_key` column already exists, so no migration). `respectConcurrencyMode` threads the scope through. This is the primitive the default auto-incident automations need for faithful per-system deduplication.

- b995afb: Reactive two-stage dispatch pipeline + wake-index (reactive automation engine Phase 5).

  The automation engine now reacts to entity-state changes through a two-stage work-queue pipeline instead of polling. State changes flow `ENTITY_CHANGED` → Stage-1 route (one instance claims) → Stage-2 dispatch fan-out (any instance runs one run).

  - **Wake-index** (`automation_wake_index` child table of `automation_wait_locks`): a suspended `wait_until` records the `state.*` refs its condition reads (`${kind}:${id}`, or the kind-level wildcard `${kind}:*` when an id is dynamic), and a relevant change wakes it via an indexed intersection lookup. Reference extraction (`wake-refs.ts`) covers structured `state` / `numeric_state` conditions and template member-expressions rooted at `state.<kind>.<id>` or back-compat `health.*`; an indeterminate extraction logs at `warn` and falls back to the timeout timer only (never silent).
  - **Reactive `wait_until`**: on suspend the engine inserts the wait lock + wake-index rows in a transaction and arms a single durable timeout timer at the deadline (queue `automation-wait-timeout`). A wake re-enriches scope **kind-agnostically** — health via the RPC client (`scope.health.*`, back-compat) AND every other `state.<kind>.<id>` ref the wait depends on (plus the changed ref) resolved through each kind's `read` accessor into `scope.state.<kind>.<id>.<field>` — then synchronously re-evaluates the full condition and resumes only if it now holds. This makes waits on non-health entities (incident, slo, …) resolve correctly when that kind changes, not just health. The stalled sweeper applies the timeout policy as a backstop if the timer job is lost.
  - **Two-stage queues**: Stage 1 subscribes to `ENTITY_CHANGED` in work-queue mode (`workerGroup: "automation-entity-route"`) and does only indexed routing (wake-index intersection + trigger-event derivation), enqueuing per-run Stage-2 jobs onto `automation-dispatch` (`consumerGroup: "automation-dispatch-run"`, `maxRetries: 3`), which routes on `reason` to `dispatchTrigger` (trigger) or `resumeRun` (wake).
  - **Entity-change → trigger-event derivation registry** (`registerChangeDeriver` on the `automation.entity` extension point): domains register a per-kind deriver mapping a change to the qualified trigger event id(s) Stage-1 routing fans out. No real domains are migrated in this phase, so production routing is a no-op until Phase 4 supplies the derivers.
  - **Public `onEntityChanged({ kind, handler, delivery? })`** on the entity extension point: other plugins react to another domain's entity changes without touching the internal (unexported) `ENTITY_CHANGED` hook. Default delivery is `broadcast` (every instance); opt into `work-queue` (with a `workerGroup`) for exactly-once-per-cluster work.

  BREAKING CHANGES:

  - The polling `template` built-in trigger is removed. Its real cases are covered reactively by the `numeric_state` / `state` triggers + conditions. Re-author any `template` triggers as `numeric_state` / `state`.
  - `wait_until` changed from interval polling to reactive wake-on-change. Semantics are preserved (wakes when the condition becomes true; times out at the deadline) but the `poll_seconds` field is now inert — a wait no longer re-checks on a timer, it is woken by a relevant `ENTITY_CHANGED` (with the durable timeout timer + sweeper as the deadline backstop).
  - The `automation-wait-until` re-check queue and its consumer are removed (`wait-until-queue.ts`), along with the stalled sweeper's periodic `until`-lock re-tick. Reactive `wait_until` uses the wake-index + a single `automation-wait-timeout` timer instead.

- b995afb: fix(automation): preserve `${{ secrets.NAME }}` references in secret config fields during dispatch

  The dispatch engine renders an action's `config` through the `{{ }}` template
  engine before validating it. The secret-reference syntax `${{ secrets.NAME }}`
  embeds `{{ secrets.NAME }}`, so the engine evaluated that inner expression
  against a scope with no `secrets`, collapsing the value to `$` and failing
  config validation (`invalid_union` on the secret field) for any real run that
  used a `secretEnv` mapping or an `x-secret` field. The in-UI "Test Script"
  path was unaffected because it never renders config.

  `renderConfig` now passes fields annotated `x-secret` or `x-secret-env` through
  verbatim (the same treatment as native-code `x-editor-types` fields), so the
  secret reference reaches the secret resolver intact. Resolution and output
  masking are unchanged.

- 270ef29: Fix cross-pod secret leak when a suspended automation run resumes on a different instance (security).

  The run-wide output-masking registry is in-memory and per-process: it only holds the secret values a run resolved on the pod that originally ran it. When a run suspended (`wait_for_trigger` / `delay` / `wait_until`) on pod A and later resumed — via the wake path (`resumeRun`) or the stalled-run sweeper (`recoverStalledRun`) — on pod B with a fresh, empty registry, every masking choke point on pod B (step output, run error, scope snapshot, artifact data) ran against an EMPTY mask set. Any value still carrying pod A's resolved credential (a carried-over scope variable, an artifact echoing it, a provider error string) was therefore persisted UNMASKED, where `getRunScopeForReplay` and the run-detail UI could read it. This was the deferred "L2 cross-pod masking" gap.

  Fix: on `resumeRun` / `recoverStalledRun`, RE-SEED the resuming pod's mask registry BEFORE walking or persisting. The engine re-resolves the automation's declared secret refs — the `secretEnv` mappings and `connectionId` references its action configs use, collected by walking the full nested action tree — through the run's already-wrapped `getService`, which auto-registers each resolved value. This re-populates exactly the least-privilege, by-value mask set the run is allowed to see (re-resolving is the same set the run resolves during normal execution, so it grants no extra access). Re-seeding is best-effort: a rotated/deleted secret simply isn't added to the mask set (the action's own re-run would surface a genuinely-missing secret), and a resolution failure never aborts the resume. No-op when masking isn't wired (tests / minimal installs).

- b995afb: Make `dependency-edge` a plugin-backed reactive entity via the Model-B entity state machine + rewire cross-plugin consumers.

  Dependency defines a `dependency-edge` entity `{ sourceSystemId, targetSystemId, impactType, transitive }` keyed by dependency id. The `dependencies` table is BOTH authoritative AND the entity's current-state storage - there is no framework `entity_state` row for a dependency edge. `defineEntity` is given a plugin `read` accessor (`DependencyService.getManyEntityStates`) that projects the reactive subset straight off that table, and every reactive-state write goes through `handle.mutate` / `handle.remove`: `apply` performs the REAL `dependencies` write (the plugin's own db/tx, including the cycle/duplicate validation that may throw) and returns the new state; the framework snapshots `prev` via `read` BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED` AFTER the write commits. Covered sites: create, update, delete (tombstone), plus the `dependency.create` / `dependency.remove` automation actions. Create sites pre-generate the id so the create's `prev` snapshot reads the not-yet-existing row as absent; `createDependency` accepts an optional pre-generated `id` (server-owned either way). The `dependency_derived_states` propagation cursor is declared non-reactive (bookkeeping).

  A change -> trigger-event deriver reproduces the existing `dependency.created` / `.updated` / `.deleted` qualified events so automations keep firing. The old `dependency.created` / `.updated` / `.deleted` change hooks are removed; the catalog + healthcheck consumers switched from `onHook(<hook>)` to `onEntityChanged({ kind })`, all keeping `work-queue` delivery (cleanup + downstream-propagation are side-effecting writes that must run once per cluster):

  - `dependency-system-cleanup`: reacts to `catalog-system` tombstones (`change.next === null`).
  - `dependency-notification-evaluator` / `-recovery`: react to `health` changes filtered to a degraded / recovered transition via `classifyHealthChange`, reproducing the old `systemDegraded` / `systemHealthy` predicates.

  `@checkstack/automation-backend` adds `makeEntityDrivenTriggerSetup()` - a no-op `setup` factory so a migrated domain's lifecycle triggers stay in the editor's trigger catalog (and register cleanly) while being fired by the entity change deriver via Stage-1 routing rather than a hook.

  BREAKING CHANGES:

  - The `dependency.created` / `dependency.updated` / `dependency.deleted` cross-plugin hooks (the `createHook` descriptors) are removed. Dependency lifecycle is now the reactive `dependency-edge` entity; the matching trigger events still fire (via the entity change deriver), so existing automations on `dependency.created/.updated/.deleted` keep working. The `dependency.impact_propagated` hook is KEPT (a derived fan-out signal, not a single mutable field). No in-repo plugin subscribed to the removed hooks.
  - On the RPC create path, the `dependency.created` entity emit (via `mutate`) now precedes the `DEPENDENCY_CHANGED` realtime signal broadcast (previously the signal fired first, then the mirror); both still fire on a successful create.
  - NARROWING: `dependency.updated` now fires only on a change to the REACTIVE state (`impactType`, `source`, `target`, or `transitive`). A label-only edit no longer fires `dependency.updated` (the label is not reactive entity state). Re-author any automation that needed to react to a label-only dependency edit against a different signal.

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

- b995afb: Add the entity state machine core (`defineEntity`) - the foundational primitive of the reactive automation engine - as a Model-B plugin-backed reactive WRAPPER with NO framework-owned current-state storage.

  `defineEntity` owns NO current-state storage of its own. Each kind declares a required plugin `read` accessor pointing at wherever its state lives (its own durable table, or a value computed on read from its own durable tables), and `defineEntity` makes that state reactive. There is no framework current-state store and no "homeless" fallback: every kind is plugin-backed. This makes a non-reactive write structurally impossible and guarantees every transition is durably logged without duplicating the plugin's state.

  - `@checkstack/automation-backend`:

    - New `automation.entity` extension point exposing `defineEntity(input)`, `declareNonReactiveState(input)`, `onEntityChanged(...)`, and `registerChangeDeriver(...)`. automation-backend registers the impl in `register`, so other plugins can resolve it and declare entities during their own `register`/`init` (Proxy-buffered until the impl registers).
    - **Driven single mutation entry point.** All reactive-state writes go through `handle.mutate({ id, opts?, apply: () => Promise<TState> })`. The handle snapshots `prev` via `read` BEFORE the write, runs the plugin's `apply` (the actual write, committed in the PLUGIN's own transaction, returning the resulting state), validates `next` (zod), masks run-originated writes through the run-secret registry, diffs prev to next, and on a real diff appends the field-level transition rows to `entity_transitions` and emits `ENTITY_CHANGED` - both AFTER the plugin write commits (never on a rolled-back / throwing write). A structurally-unchanged write is a no-op. `handle.remove({ id, opts?, apply: () => Promise<void> })` is the tombstone counterpart (records the tombstone transition, emits next = null).
    - **Cross-plugin transaction boundary.** `apply` takes NO framework tx: a plugin-backed kind lives behind a DIFFERENT drizzle client than `entity_transitions`, and two clients cannot share one transaction. The plugin write is authoritative; the transition-log append runs in the framework's own transaction AFTER the plugin write commits. A failure between them leaves correct plugin state with a missing history row (a gap, never a corruption).
    - **`get` / `getMany`** route to the kind's `read`; **`inStateSince` / `inStateForMs` / `transitionCount`** read the per-field `entity_transitions` log (generalizing Phase-13 health transitions to any entity).
    - **No framework keyed store.** There is no generic `entity_state` table, no `createKeyedStore`, and no `entityKeyedStoreServiceRef`: kinds whose state has no domain table of their own (the `health` aggregate, the `slo` budget/streak view) compute their `read` on demand from their own durable data instead of materializing a framework copy. `entity_transitions` (the change-history log) is the framework's ONLY persistent table and is written for EVERY kind regardless of where current state lives.
    - **`entityResolverFor(kind)`** routes scope enrichment + the reactive `wait_until` wake re-eval to each kind's `read` accessor. Generalized scope enrichment (`enrichScopeWithEntities`) folds any `state.<kind>.<id>` ref into `scope.state.<kind>.<id>.<field>`. The rich `scope.health.*` condition snapshot (status, latency, success rate, in-maintenance, transitions-in-window, ...) is resolved EXCLUSIVELY through the healthcheck RPC path (the health aggregate is computed on read, not stored as a framework row) and the generic entity pass never writes `scope.health`; `state.health.*` remains the minimal reactive entity view. These are two complementary projections by design, not a migration shim.
    - **Horizontal-scale read-consistency guard.** A reactive entity's current state MUST be globally readable from shared/durable storage, never process-local memory (`.agent/rules/state-and-scale.md`). Enforced by the `checkstack/no-pod-local-entity-state` ESLint tripwire at the `defineEntity({ read })` boundary (wired at `warn`) and the deterministic `cross-pod-read-consistency.it.test.ts` integration test.
    - Load-time validation hard-fails a malformed registration (non-`z.object` state, missing/duplicate `kind`, or a missing / non-function `read`).
    - The `ENTITY_CHANGED` hook is internal (not exported); the change emitter buffers events produced during the init window and flushes them in order once the hook wiring is available in `afterPluginsReady`.

  - `@checkstack/automation-common`:

    - New `EntityChangedSchema` (the `ENTITY_CHANGED` payload - `kind`, `id`, `prev`, `next`, `delta`, `changedFields`, `actor`, `occurredAt`) and `DispatchJobSchema` (the Stage-2 `trigger` / `wake` dispatch job).

  - `@checkstack/automation-frontend`: the `wait_until` editor no longer offers the inert `poll_seconds` field (reactive waits don't poll).

  This phase adds the primitive only: domains are migrated in their own changesets. No external behavior changes for existing automations.

  BREAKING CHANGES: There is no framework current-state store. Any out-of-tree plugin must own its entity state in its own durable storage (its own table, or a compute-on-read over it) and pass a `read` accessor to `defineEntity`. `createKeyedStore` / `KeyedStore` / `entityKeyedStoreServiceRef` / `EntityKeyedStoreService` do not exist, and there is no `entity_state` table. `handle.set` / `handle.patch` and the `indexes` option do not exist; all writes go through `handle.mutate` / `handle.remove`.

- b995afb: Extract a shared `withEntityWrite` / `withEntityRemove` guard for PLUGIN-BACKED (Model B) reactive entities and refactor the per-domain copies onto it.

  Every plugin-backed domain (incident, catalog, dependency, maintenance, slo, satellite) reimplemented the same "no handle wired → run the plugin write directly; handle wired → route through `handle.mutate` / `handle.remove`" guard, varying only in the id-key name. `@checkstack/automation-backend` now exports `withEntityWrite` / `withEntityRemove` (from the entity barrel) and each domain's thin, well-named wrappers (`writeIncidentEntity`, `writeMaintenanceEntity`, satellite's `mirror`, …) delegate to it, so the branch lives in exactly one place. Behavior is unchanged.

  `writeHealthEntity` (healthcheck-backend) is intentionally NOT migrated onto the helper — it is genuinely bespoke (closure-captured durable state, distinct rethrow-vs-fail-soft branches, a per-system serializer, and it returns the computed state). SLO keeps its fail-soft `onError` wrapper around the shared guard.

- 270ef29: Fix several correctness defects around distributed coordination and stored-data handling.

  - Dwell `for:` timers now fire via an atomic `DELETE ... RETURNING` claim, so two pods (or the stalled sweeper vs the queue consumer) can no longer both fire the same dwell.
  - Postgres session-level advisory locks now keep connection affinity. A shared `AdvisoryLockService` (backed by a dedicated pooled client) replaces the previous acquire/release-on-different-connection pattern that leaked locks. Used by the script-packages installer election, the automation run resume + stalled sweeper, and (via a new transaction-scoped `withXactLock`) incident dedup.
  - A storage migration that crashed mid-flight is now resumed on startup under the installer-election lock, instead of permanently wedging installs.
  - Distributed script-package blobs carry a `blobSha256` and are verified before extraction (the SRI `integrity` hashes the npm tarball, not the transported archive). Backward-safe: entries without the field skip verification until a re-install regenerates the manifest.
  - Archive extraction rejects zip-slip paths (absolute or `..` entries) before writing anything.
  - `incident.create` with `dedupe_open_for_system` serializes its check-then-create per system, so concurrent triggers for the same system can't both open a duplicate incident.
  - Seeded auto-incident filter expressions JSON-encode interpolated ids so a quote/backslash can't corrupt the expression.
  - Stored jsonb snapshots (dwell `actorSnapshot`, wait-lock `waitConfig`) are validated with zod on load and degrade safely instead of flowing through as the wrong type.

- b995afb: Fix the `Automation` kind showing an empty "Additional Schemas" section in the GitOps Entity Kind Registry. The spec-schema documentation for `triggers[].config` and `actions[].config` was registered with `conditions` pointing at the `triggers[].event` / `actions[].action` discriminators. Those discriminators have no variant-selector group of their own in the kind browser, so the conditions could never be satisfied and every entry was filtered out (the section rendered empty even though the docs were registered).

  The trigger/action config docs are now emitted as standalone variants (no `conditions`), mirroring how Healthcheck surfaces its primary `config` (strategy) field. Each field now renders its own variant dropdown so operators can browse every trigger and provider-action config schema directly.

- b995afb: Move health-check flapping configuration from the per-assignment notification policy onto the `healthcheck.flapping_detected` automation trigger.

  Flapping thresholds (`transitions`, `windowMinutes`) are now configured on the trigger itself, next to the automation that reacts to them, instead of on each check assignment. The health-check executor still owns the windowed transition counting (it writes `health_check_unhealthy_transitions` and runs the window query), but it now SOURCES the thresholds from the subscribed automations' trigger config:

  - On a transition-to-unhealthy it records the transition unconditionally (keeping history warm), then looks up the enabled automations subscribed to `healthcheck.flapping_detected`, collects the distinct set of configured windows, counts transitions once per distinct window, and emits one `healthcheck.flapping_detected` per window. The trigger's exact-window `evaluateConfig` gate then fires each automation only for its own window and transition threshold.
  - A missing or partial flapping trigger config defaults to `{ transitions: 3, windowMinutes: 60 }`, so automations created before the trigger carried config keep working unchanged.
  - `automation-backend` exposes a new backend-only, read-only `automationSubscriptionsRef` service ref (`findEnabledByTriggerEvent`) so a plugin that owns a trigger's underlying event can discover its subscribers' trigger config. It is never browser-exposed.

  **BREAKING CHANGES**

  - The per-assignment `notificationPolicy.flappingTrigger` field is removed. `NotificationPolicy` is now `{ suppressDeEscalations }` only. Stored rows that still carry a `flappingTrigger` key parse cleanly - the key is stripped on read - so no data migration is required, but the per-check flapping toggle/threshold in the assignment Notifications tab is gone; configure flapping on the trigger instead.
  - The GitOps `System.healthcheck[].notificationPolicy.flappingTrigger` field is removed. A `flappingTrigger` block in a manifest is ignored. Move the thresholds to the `transitions` / `windowMinutes` config of your `healthcheck.flapping_detected` automation trigger.
  - The standalone `enabled` flag for flapping is gone: flapping is "enabled" precisely when at least one enabled automation subscribes to `healthcheck.flapping_detected`. With no subscriber, the transition is still recorded but nothing is counted or emitted.

- b995afb: Fix four reactive-automation-engine defects in the `wait_until` / entity-change dispatch path.

  - **Lost-wakeup re-evaluate-on-registration guard (HIGH, data-loss race).** `executeWaitUntil` evaluated its condition, then committed the wait lock + wake-index rows with NO re-evaluation after arming. An `ENTITY_CHANGED` for a relevant ref landing in that arm window was routed by Stage-1 against a not-yet-visible lock, enqueued no wake job, and — for a no-timeout wait (`timeoutAt` null, skipped by the sweeper) — the run stalled permanently (silent run leak). After arming the lock the engine now re-evaluates ONCE against freshly re-enriched scope; if the condition already holds it deletes the lock (its wake-index rows cascade) and continues the run inline. Idempotent via the lock delete + the per-run advisory lock.

  - **Wildcard health wake drops the changed system (MEDIUM, correctness).** `reEnrichWaitScope` resolved health only for the trigger `contextKey` + `uses_state` ids and excluded the changed ref from health resolution. A wildcard health wait (`health:*`) woken by `health:sysX` — where `sysX` was neither the contextKey nor in `uses_state` — never had `scope.health.systems[sysX]` populated, so the condition read stale/empty state and failed to resume. The changed system's concrete id is now injected into health resolution during a wildcard wake.

  - **`changeId` for dispatch dedup (LOW, correctness).** The Stage-2 trigger `jobId` embedded `changed.occurredAt` (millisecond granularity), so two DISTINCT changes to the same entity within one millisecond collapsed onto one job (the second run silently dropped). `EntityChangedSchema` gains an additive, back-compatible `changeId` (generated ONCE at emit time so it travels with redeliveries of the same change); the Stage-2 jobId now uses `changed.changeId` (falling back to `occurredAt` for legacy payloads). Redeliveries of one change still dedup; two real changes stay distinct.

  - **Run-originated `mutate` returns the unmasked next state (LOW, correctness).** `handle.mutate` returned the `maskForRun`-masked next state, contradicting its "returns the resulting state" contract. Masking is now confined to the emitted `ENTITY_CHANGED` payload and the `entity_transitions` rows only; `mutate` returns the unmasked, zod-validated resulting state.

  BREAKING CHANGES: none. The `changeId` field is additive and optional; all changes are behavior-preserving except where they fix the defects above.

- b995afb: Restore the documented domain payload fields on entity-driven automation triggers.

  Migrated triggers declare domain-named `payloadSchema`s (incident `incidentId`; health `systemId` / `previousStatus`; catalog `systemId` / `changedFields`; dependency `dependencyId`), but Stage-2 dispatch built `trigger.payload` from the generic entity-change shape (`{ kind, id, prev, next, delta, ...next }`). Operator filters and templates reading `trigger.payload.incidentId` / `.systemId` / `.previousStatus` silently resolved to `undefined` — a regression vs the legacy hook payloads.

  Changes:

  - `@checkstack/automation-backend`: `registerChangeDeriver` now accepts an optional per-kind `toPayload(changed) => Record<string, unknown>` mapper (at most one per kind; a second distinct mapper throws). Stage-2's `changedToPayload` uses the registered mapper to build `trigger.payload` so it matches the kind's declared `payloadSchema`, falling back to the generic change shape for kinds without a mapper. New exported type `EntityChangePayloadMapper`.
  - `@checkstack/incident-backend`, `@checkstack/healthcheck-backend`, `@checkstack/catalog-backend`, `@checkstack/dependency-backend`: implement and register a `toPayload` for each entity-driven kind so `trigger.payload` carries the legacy domain keys again.

  Descriptive incident payload fields not derivable from the reactive entity state (`title`, `description`, `createdAt`, `resolvedAt`) are now OPTIONAL on the incident trigger `payloadSchema`s — they were always absent from an entity-driven payload.

- b995afb: Remove the legacy per-assignment auto-incident system. Auto-incidents are now built entirely by user-authored automations; nothing is seeded or hardcoded.

  What was removed:

  - The one-time migration that auto-seeded "sustained unhealthy" and "flapping" default automations from each assignment's notification policy, plus the `listAutoIncidentPolicies` RPC it consumed.
  - The seeder-only notification-policy settings and their UI: `autoOpenIncidentOnUnhealthy`, `useNotificationSuppression`, `skipDuringMaintenance`, `sustainedUnhealthyTrigger`, and `autoCloseAfterMinutes`. The assignment **Notifications** tab now exposes only the two live settings: **Suppress de-escalation notifications** and the **flapping-detection** thresholds.
  - The dead `health_check_auto_incidents` table (no longer written or read; dropped via migration).

  What is preserved: flapping detection (`healthcheck.flapping_detected`) and de-escalation suppression are unchanged. The `flappingTrigger` and `suppressDeEscalations` policy fields stay exactly as before.

  > [!NOTE]
  > One-time cleanup: an automation-backend migration deletes the historically auto-seeded incident automations (`managed_by LIKE 'auto-incident:%'`) from existing databases. This is intentional and destructive - those automations were no longer managed by anything. If you had edited a seeded automation and want to keep it, re-create it as a normal automation before upgrading. See the "Build auto-incident automations" guide for templates.

  > [!IMPORTANT]
  > NARROWING: `NotificationPolicySchema` is narrowed to `{ suppressDeEscalations, flappingTrigger }`. Stored rows that still carry the removed legacy keys parse cleanly - zod strips the unknown keys on read - so no data migration is required for the `system_health_checks.notification_policy` column. GitOps `notificationPolicy` specs that set the removed fields are no longer accepted for those keys.

- 270ef29: Add in-UI script testing for automation `run_script` / `run_shell` actions.

  A new `testScript` RPC runs a TypeScript or shell script against an
  editable, auto-seeded sample context using the same sandboxed runner the
  real action uses, so operators can test scripts directly in the editor
  without dispatching a whole automation. Surfaces beneath any script field
  flagged `x-script-testable` via the new `ScriptTestPanel` /
  `ContextSampleEditor` components in `@checkstack/ui` and the
  `scriptTestRenderer` prop threaded through `DynamicForm`.

  - `@checkstack/automation-common`: adds the `testScript` contract +
    `ScriptTest*` schemas (gated by `automation.manage`).
  - `@checkstack/automation-backend`: implements `testScript` reusing the
    shared ESM / shell runners; central-only, time-bounded.
  - `@checkstack/backend-api`: new `x-script-testable` config-schema
    metadata propagated to the frontend JSON Schema.
  - `@checkstack/ui`: new `ScriptTestPanel` + `ContextSampleEditor`
    components and a `scriptTestRenderer` prop on `DynamicForm`.
  - `@checkstack/automation-frontend`: wires the test panel into the action
    editor.
  - `@checkstack/integration-script-backend`: marks the `run_script` /
    `run_shell` script fields as testable.

- 270ef29: Extend in-UI script testing to health-check collectors, and add
  load-from-run replay for automation script tests.

  - Health-check collectors: a new `testCollectorScript` RPC runs the
    inline-script (TypeScript) collector and the shell `script` collector
    against an editable, auto-seeded sample context using the same
    sandboxed runner the real collector uses. Surfaces beneath the
    collector script fields in the collector editor (both marked
    `x-script-testable`). Gated by `healthcheck.configuration.manage`.
  - Automation replay: a new `getRunScopeForReplay` RPC reconstructs an
    editable test context from a real run (trigger + persisted artifacts,
    plus the durable scope snapshot when the run is still in-flight), and
    the script-test panel gains a "Load from run" picker that seeds the
    sample context from a past run.

  Note: health-check executions do not persist the script / config /
  check / system that produced a result, so there is no health-check
  replay - auto-seed is the only context source for collector tests. This
  is by design; see the feature plan.

- 270ef29: Activate npm packages in script execution: thread the managed
  `resolutionRoot` into every user-script call site so an allowlisted package
  can actually be `import`ed.

  - `@checkstack/backend-api`: the ESM runner now always writes a per-run
    `bunfig.toml` with `[install] auto = "disable"` and runs with that dir as
    CWD. Without this Bun silently auto-installs any imported package from the
    registry (verified), defeating the allowlist; with it, imports resolve
    only against the reconciled `current/node_modules` (when a `resolutionRoot`
    is set) and otherwise fail fast.
  - `@checkstack/script-packages-backend`: `resolveResolutionRoot` /
    `resolveResolutionRootFromStore` / `resolveResolutionRootForHost` decide a
    host's resolution-root status (`none` / `ready` / `notReady`) from the
    local `<store>/current`.
  - `run_script` (integration-script-backend), the inline-script collector
    (healthcheck-script-backend, core + satellite), and the in-UI `testScript`
    / `testCollectorScript` endpoints all resolve the root per run and pass it
    to the runner; `run_script` surfaces a clear "npm packages not ready"
    error when configured-but-unsynced. Shell paths are unaffected (no module
    resolution).

  An opt-in end-to-end test (`CHECKSTACK_E2E_NETWORK=1`) proves an allowlisted
  package imports successfully through the real `run_script` action execute
  path, with non-network degradation tests running always.

  BREAKING CHANGES: `@checkstack/backend-api`'s `defaultEsmScriptRunner` now
  always disables Bun auto-install for the user subprocess. A script that
  previously relied on Bun silently fetching an un-vendored package from the
  registry at import time will now fail to resolve it. This is intentional -
  package availability is governed by the admin allowlist - but any caller
  depending on the old implicit auto-install behavior must add the package to
  the allowlist instead. The new `EsmScriptRunOptions.resolutionRoot` field is
  optional and additive (defaults to today's `os.tmpdir()` behavior when
  unset), so the runner API itself is source-compatible.

- 270ef29: Add the Secrets platform (Phase 1): a central, plugin-agnostic secret manager with a pluggable backend extension point, a cross-plugin resolver service, and a universal Jenkins-style masking layer.

  - New packages: `secrets-common` (schemas, contract, `secrets.read`/`secrets.manage`, masking utils), `secrets-backend` (`SecretBackend` extension point, `secretResolverRef`/`secretAdminRef` services, run-scoped masking context, RPC router), `secrets-backend-local` (default AES-256-GCM backend, owns the `secrets` table promoted from gitops), `secrets-frontend` (admin Settings page).
  - Resolution machinery (`resolveSecretsBySchema`, `SecretStore`, `${{ secrets.NAME }}` / `x-secret`) is promoted out of `gitops-backend` into `secrets-backend`. GitOps now resolves and manages secrets through the platform's service refs (single source of truth); its secret table is migrated without loss.
  - Universal masking seam wired at the central script-output boundaries: automation `run_script` / `run_shell` artifacts and the in-UI test panel redact run-scoped secret values from `result`/`stdout`/`stderr`/`error` before persist/return. Phase 1 resolves no run-scoped secrets yet, so masking is a no-op until Phase 2; the seam guarantees the boundary exists.
  - No endpoint returns a secret value to a browser: DTOs expose only name/metadata/`hasValue`.

  BREAKING CHANGES: `gitops-backend` now depends on `secrets-backend` and resolves/manages secrets through it. The `secrets` table is owned by `secrets-backend-local`; the gitops `secrets` table is retained as a migration source but is no longer the source of truth.

- 270ef29: Secrets platform Phase 2: secret -> env-var mapping with central resolve, inject, and mask.

  - Script consumers declare a least-privilege `secretEnv` allowlist
    (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The automation `run_script` /
    `run_shell` actions resolve ONLY the declared secrets via
    `secretResolverRef.resolveForRun`, inject them into the runner env for
    that run (memory-only; the ESM runner gained a per-run `env` option), and
    mask their values out of stdout/stderr/result/error via the run-scoped
    masking context. A missing required secret fails the run clearly. No
    ambient secret access.
  - Test panel: `testScript` / `testCollectorScript` inject named
    `__SECRET_<NAME>__` placeholders by default, or user-supplied per-secret
    overrides; real production values are never resolved in the test path,
    and overrides are masked out of the result.
  - Healthcheck collectors carry the `secretEnv` field for authoring +
    the test panel; runtime injection on satellites lands in Phase 3.
  - Editor UX: a new `@checkstack/ui` `SecretEnvEditor` renders `x-secret-env`
    record fields with `${{ secrets.* }}` name autocomplete (from
    `listSecretNames`), wired into the automation action editor and the
    healthcheck collector editor. New `withConfigMeta` helper +
    `x-secret-env` config-meta key in `@checkstack/backend-api`.

- 270ef29: Secrets platform Phase 5c: run-wide secret masking at the automation persistence choke point.

  Every step writes `result_payload` / `error_message` (and the run writes a
  run-level `error_message`) to `automation_run_steps` / `automation_runs`.
  Previously only the script-action and satellite-collector output paths were
  masked, so a provider HTTP error that embedded a resolved connection
  credential could reach the run-detail UI unmasked.

  Now the dispatch run accumulates every secret value it resolves
  (`RunSecretRegistry`) by wrapping each run's `getService` so the secret
  resolver (`resolveSecret` / `resolveForRun` / `resolveBySchema`) and the
  connection store (`getConnectionWithCredentials`) register their resolved
  values — least-privilege (only what this run resolved), in memory only,
  dropped when the run goes terminal. The run-state store masks step + run
  output with these values BEFORE persistence, so every downstream read / DTO
  / run-detail page is masked by construction across ALL actions. The
  existing script / satellite-collector source-side masking is kept as
  defense in depth.

- b995afb: Add an optional `partitionBy` override to the windowed-count trigger gate.

  A trigger's `window` block now accepts `partitionBy`, a bare expression (same flavour as `filter`, no `{{ }}`) that controls the key the occurrence count is bucketed by. When omitted, the gate keys by the trigger's built-in context key exactly as before (per system for health triggers), so existing automations are unchanged. When set, the expression is evaluated against the same trigger scope `filter` uses and coerced to a string - e.g. `trigger.payload.severity` for a per-severity rate, or `trigger.payload.systemId + ":" + trigger.payload.checkId` for a composite key. If the expression evaluates to null/undefined/empty or fails to evaluate, the gate falls back to the built-in context key (never global counting); eval errors are logged, matching the gate's fail-open posture.

  Triggers can now declare `contextKeyLabel` (a UI hint, e.g. `"system"`) describing their built-in context dimension. It is surfaced through `TriggerInfo` so the editor's window "Partition by" field shows the default partition ("Leave blank to count per system" / "per automation" when a trigger has no context key). The healthcheck system triggers (`system_health_changed`, `system_degraded`, `system_healthy`, `check_failed`) and the built-in `numeric_state` trigger set it to `"system"`. This is a pure UI hint with no runtime behaviour.

  The automation editor's window block gains a "Partition by" expression input (reusing the trigger filter's `trigger.payload.*` autocomplete), and the collapsed trigger card summary shows the partition when set.

- b995afb: Add a generic windowed-count / rate trigger gate, and express flapping detection on it.

  Any trigger can now carry a `window: { count, minutes, refire }` block: the automation engine records each qualifying occurrence (after the structured config gate and the operator's `filter`) in a durable append log and counts rows within the trailing sliding window, scoped per context key (e.g. per system). `refire: "every"` (default) fires on every occurrence at/over the threshold; `refire: "once"` fires only on the crossing edge and re-arms as old occurrences age out. The gate runs in `maybeStartRun` after `filter` and before the `for:` dwell, so it composes with both.

  Flapping is now an instance of this mechanism rather than a bespoke detector. The healthcheck `system_health_changed` raw change event plus a `filter` (`trigger.payload.newStatus != "healthy"`) plus `window: { count: 3, minutes: 60, refire: "once" }` reproduces flapping in the engine.

  State-and-scale: window state lives in the new `automation_window_events` Postgres table (FK-cascade on the automation, the same delete-lifecycle as `automation_dwell_timers`). The count is read with pure SQL so every pod computes the same answer; the work-queue claim gives exactly one INSERT per emission, so there is no double-count. Rows older than the 24h schema cap are pruned by the existing stalled-sweeper. The `once` policy is best-effort under at-least-once redelivery (a redelivered emission can skip the exact crossing edge; `every` is redelivery-tolerant).

  **BREAKING CHANGES:**

  - The `healthcheck.flapping_detected` automation trigger and the `healthcheck.flapping_detected` hook are REMOVED. Flapping is now detected by the windowed-count gate on the `healthcheck.system_health_changed` trigger (`window` block, `refire: "once"`).
  - Flapping is now PER-SYSTEM (the aggregated `health` entity), not per-`(system, configuration)`. Subscribe to `check_failed` with a `window` instead if you need per-check rate detection.
  - The healthcheck `health_check_unhealthy_transitions` table is DROPPED (the per-check flapping audit log is no longer kept; counting moved into the engine).
  - The backend-only `automation.subscriptions` service ref (`automationSubscriptionsRef` / `AutomationSubscriptions`) is REMOVED. The engine enumerates subscribers internally and the window gate runs per-automation inside `maybeStartRun`, so the external read-ref is no longer needed.
  - Existing user-created flapping automations are AUTO-MIGRATED on boot: any trigger on `healthcheck.flapping_detected` is rewritten to `healthcheck.system_health_changed` + the canonical unhealthy-transition filter + `window: { count: transitions ?? 3, minutes: windowMinutes ?? 60, refire: "once" }`, dropping the old `config`. A pre-existing trigger filter is replaced with the canonical one (logged per row). An enabled automation that still references the removed event after migration logs a warning.

### Patch Changes

- Updated dependencies [270ef29]
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
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/gitops-common@0.5.0
  - @checkstack/gitops-backend@0.4.0
  - @checkstack/automation-common@0.3.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/template-engine@0.3.0
  - @checkstack/script-packages-backend@0.2.0
  - @checkstack/secrets-common@0.1.0
  - @checkstack/command-backend@0.1.32
  - @checkstack/queue-api@0.3.7

## 0.2.0

### Minor Changes

- e2d6f25: feat(automation): connection picker for integration actions + restore Integrations menu

  Connection-backed automation actions (Jira, Teams, Webex) now render a
  working connection picker plus cascading provider dropdowns in the
  visual editor, and the Integrations entry is back in the user menu.

  **Contract.** `ActionDefinition` gained an optional
  `connectionProviderId` (and it is surfaced on `ActionInfoSchema` and
  mapped in the `listActions` router). It carries the integration
  provider's fully-qualified id, derived from the provider plugin's own
  `pluginMetadata.pluginId` (never a hardcoded string), so the editor
  knows which provider backs an action's dropdowns and it matches the
  `qualifiedId` the integration provider registry assigns.

  **Providers.** Jira, Teams and Webex each export
  `*_PROVIDER_LOCAL_ID` / `*_PROVIDER_QUALIFIED_ID`, register their
  provider with the local id, and add a `CONNECTION_OPTIONS`
  (`"connectionOptions"`) resolver name. Their `post_message` /
  issue actions set `connectionProviderId` and expose `connectionId`
  as an `x-options-resolver` dropdown instead of a hidden field.

  **Frontend bridge.** A new `useConnectionOptionResolvers` hook
  (`@checkstack/automation-frontend`, which now depends on
  `@checkstack/integration-common`) turns an action's
  `x-options-resolver` schema fields into live data: the
  `connectionOptions` resolver lists the provider's connections via
  `listConnections`, and every other resolver name is forwarded to
  `getConnectionOptions` for the selected `connectionId`, passing the
  live form values as `context` for dependent fields. `ProviderActionBody`
  now passes this map to `DynamicForm` (it was previously missing
  entirely, so connection-backed actions had no working dropdowns).

  **frontend-api.** `usePluginClient` procedures now also expose a typed
  imperative `.call(input)` alongside `.useQuery` / `.useMutation`, for
  async callbacks that cannot host a hook (such as a `DynamicForm`
  options resolver). Additive, non-breaking.

  **Integrations menu.** Re-added `IntegrationMenuItem` and a new
  `IntegrationsLandingPage`, wired into `integration-frontend` as a list
  route and a `UserMenuItemsSlot` entry under the "Configuration" group.

  **Action card polish.** The action editor's secondary metadata (id,
  description, failure behaviour) is now grouped into one quiet settings
  panel with consistent small uppercase "eyebrow" labels, so the action's
  own configuration stays the focal point. The raw failure checkbox was
  replaced with the standard `Checkbox` control, and the provider action
  picker / configuration sections gained consistent section headers and a
  divider. The per-step "type" dropdown was removed: an action's kind is
  fixed at creation, so changing it now means adding a new step and
  deleting the old one (avoids the surprising full-config reset that
  switching kinds used to trigger).

  **Add-step picker.** Adding a step now opens a Home-Assistant-style
  dialog where the operator decides the step type up front: an "Actions"
  tab lists the registered provider actions grouped by category
  (searchable; picking one presets the step's `action`), and a "Blocks"
  tab lists the structural building blocks (choose / parallel / repeat /
  etc.). Because the concrete action is chosen here, the in-card action
  switcher was removed - a step's action is fixed once created. Composite
  blocks now start with an empty child list (filled via the nested
  add-step picker) instead of seeding an unconfigurable empty action.

- 41c77f4: feat(automation): deep + live definition validation surfaces invalid values, keys and ids — marked inline

  Previously `validateDefinition` only checked the structural shape via
  `AutomationDefinitionSchema`, where an action's `config` is typed as
  `z.record(z.unknown())`. So a bad config value (e.g. `level:
debugthisiswrong` on `automation.log`) passed validation, and switching
  to the visual editor just showed an empty dropdown with no explanation.

  **Backend — deep validation.** New `collectDefinitionIssues` walker
  validates the whole definition semantically, not just structurally:

  - unknown trigger `event` / action `action` ids,
  - each provider action's `config` against the registered action's own
    schema (wrong enum value, missing required field, wrong type),
  - each trigger's `config` against the trigger's `configSchema`,
  - **unknown / typo'd config keys** — object configs are validated in
    strict mode, so `levle: "info"` is reported rather than silently
    stripped,
  - recurses through `choose` / `parallel` / `repeat` / `sequence` so
    nested action configs are covered too.

  Issues come back with a dot-joinable `path` (e.g.
  `actions.0.config.level`, `triggers.1.event`). The `validateDefinition`
  RPC now returns these.

  **Frontend — live + inline.** The automation editor re-validates on
  every edit (debounced ~400ms) in BOTH tabs, and marks the offending
  content in place rather than in a separate alert panel:

  - **YAML tab** — issues (and YAML syntax errors) are squiggled at the
    exact node. `@checkstack/ui`'s `CodeEditor` gained a `markers` prop;
    the editor maps each issue's `path` onto the YAML document's node
    range via a new `computeYamlMarkers` helper (walking up to the
    nearest existing ancestor when a key is absent, e.g. a missing
    required field).
  - **Visual tab** — the specific card carrying an issue is marked: a
    destructive border + warning icon + the field-level messages. A
    `ValidationProvider` context partitions issues by owner (action card
    / trigger card / condition / top-level) using the action-node path
    grammar, so a nested action's config error attaches to the nested
    card, and a `choose`'s own `when` error attaches to the choose card.
    `ActionCard` gained an `errors` prop. So importing YAML with a bad
    value (the empty-dropdown case) now visibly flags the card instead of
    being silent.

  The big error alert is gone; the only residual panel is a slim fallback
  for the rare top-level issue that can't attach to any card.

  Note: strict config validation means an action whose config schema
  intentionally allowed extra keys would now flag them; action configs
  across the platform declare all their fields, so this only catches
  genuine typos.

- e1a2077: feat(automation): reference artifacts by explicit action id (`artifacts.<id>.<name>`)

  Multiple actions of the same type (e.g. two "create Jira issue" steps) used
  to collide: both produced the artifact type `integration-jira.issue`, so a
  template could only ever reach "the most recent one of that type". Artifacts
  are now addressed by the producing action's instance `id` instead.

  - Templates reference a produced artifact solely as
    `{{ artifacts.<actionId>.<localArtifactName>.<field> }}`, e.g.
    `{{ artifacts.open_jira.issue.issueKey }}`. The local artifact name is the
    producing action's `produces` id with the owning plugin prefix stripped
    (`integration-jira.issue` -> `issue`).
  - `@checkstack/automation-backend`: the dispatch engine nests each produced
    artifact under `artifacts[actionId][localName]` in the template scope and
    records the `actionId` on the artifact row. `validate-definition` now
    enforces that action ids are unique within an automation and that every
    artifact-producing action carries an id.
  - `@checkstack/automation-common`: action `id` is constrained to an
    identifier (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) so it is always usable as a
    plain template segment. The variable-scope resolver surfaces
    `artifacts.<id>.<name>` (with full field completion) in the editor.
  - `@checkstack/automation-frontend`: the action editor now has editable `Id`
    and `Description` inputs (previously settable only via the YAML view), and
    new steps get an auto-assigned, unique, log-friendly default id that the
    operator can rename. Action ids are recorded on every run step, so run
    logs are parseable by id regardless of kind.

  **BREAKING (beta):** the previous flat, type-keyed scope form
  `{{ artifacts["integration-jira.issue"] }}` is removed. Reference artifacts
  by the producing action's id instead. Action ids may no longer contain
  hyphens or dots (identifier characters only). Artifacts are per-run and
  ephemeral, so no stored-data migration is needed.

- 41c77f4: feat(automation): native per-editor context for script actions (typed `context` for TS, `$ENV` for shell)

  Script action editors had a confusing dual system: the TypeScript editor
  type-checked `{{ }}` template text as code (so `{{ artifact.x }}` errored
  with "Cannot find name"), and the runtime never actually populated the
  `context` object. This standardises on a single, native context-access
  mechanism per editor kind.

  **Run scope reaches actions.** `ActionExecutionContext` gains a `scope`
  (`{ trigger, artifacts, vars, repeat? }`), populated by the dispatch
  engine from the same scope it already uses for `{{ }}` rendering. Actions
  that need broad context (the script actions) read from it instead of
  having to declare every artifact type in `consumes`. Additive and
  optional, so existing actions are unaffected.

  **TypeScript / JavaScript → typed `context`.** `run_script` now builds
  `context` from the run scope, so `context.trigger.payload`,
  `context.artifacts`, `context.var`, `context.repeat`, and
  `context.automation` are populated at run time (previously
  `context.trigger` was always empty). The editor types match via
  `generateAutomationContextTypes`.

  **Shell → `$CHECKSTACK_*` env vars.** `run_shell` flattens the run scope
  into environment variables (e.g. `$CHECKSTACK_TRIGGER_PAYLOAD_TITLE`,
  `$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Arrays become a
  single newline-separated var (iterate with `while IFS= read -r x; do …;
done <<< "$VAR"`). Every value is a plain string — no JSON blob, since
  the container has no `jq` to parse one. A shared `toShellEnvKey`
  helper (in `@checkstack/automation-common`) derives the names so the
  shell editor's `$` autocomplete lists exactly what the runtime injects.

  **One syntax per field kind (editor + runtime).** `MultiTypeEditorField`
  no longer offers `{{ }}` autocomplete in `typescript` / `javascript` /
  `shell` editors, and the dispatch engine no longer template-renders
  native-code config fields (those whose `x-editor-types` is a code type) —
  so `{{ }}` can't be used in a script by accident. Text / markup editors
  (`raw`, `json`, `yaml`, `xml`, `markdown`, `formdata`) and plain string
  fields keep `{{ }}` as before. Because both the automation and
  health-check editors share `MultiTypeEditorField`, they behave
  identically.

  **Script-editor IntelliSense polish.** The code editors got a few
  ergonomic fixes so the typed context is actually usable: the suggestion
  **details panel auto-opens** (so long completion names are legible
  on-focus, not hidden behind the chevron); word-based keyword noise is
  disabled in favour of language-service + provider completions; and a
  TS/JS completion provider makes `context.artifacts.` list the in-scope
  artifact ids and **auto-convert the dot to bracket notation** —
  `context.artifacts["integration-jira.issue"]` — since those ids aren't
  valid identifiers. (Driven by a new opt-in `dottedKeyCompletions` prop on
  the editor / `DynamicForm`.)

  **BREAKING (beta):** `{{ }}` interpolation inside a script action's
  `script` field (shell or TypeScript) is no longer expanded at run time —
  read run data via the typed `context` object (TS) or `$CHECKSTACK_*` env
  vars (shell) instead. Non-script config fields are unchanged.

  Also fixes: switching a provider action in the visual editor now resets
  its config, so the validator no longer reports the previous action's keys
  as unrecognised.

- 41c77f4: feat(automation): Phase 10 — built-in triggers + actions

  Ships the core automation catalog every install has out of the box:

  **Triggers** (setup-backed via the shared
  `automation-builtin-triggers` queue):

  - `automation.cron` — recurring queue job on a cron pattern. Config:
    `{ cronPattern }`. Payload: `{ firedAt }`.
  - `automation.interval` — recurring queue job on a fixed interval.
    Config: `{ intervalSeconds }`. `startDelay = intervalSeconds` so an
    operator doesn't see a tick the instant they save the automation.
  - `automation.template` — polls a boolean template at `intervalSeconds`
    cadence and fires on the false → true edge. Uses
    `template-engine.evaluateBoolean` with `{ now }` in scope; invalid
    templates throw at setup so the operator sees the error in the
    editor rather than as silently-never-firing.

  All three share a single consumer + module-scoped `tickHandlers` map
  keyed by jobId. Restart semantics work the same way regardless of the
  queue backend: `setupTriggerSubscriptions` re-runs every enabled
  automation's `setup()` in `afterPluginsReady` on every boot, and
  `setup()` calls `scheduleRecurring(...)` with a deterministic jobId.
  On a persistent queue (BullMQ/Redis), the second call is an in-place
  update of the surviving recurring job. On the in-memory queue — whose
  recurring-schedule map is wiped at shutdown — it re-creates the
  schedule from scratch. Either way the schedule is back in place
  before the consumer would dispatch.

  **Actions**:

  - `automation.log` — write a single line to the run logger at the
    requested level (debug/info/warn/error). No artifact, no external
    delivery — the cheapest "I want to see something happened here"
    primitive, useful inside `choose` / `parallel` branches as a no-op
    placeholder until the operator wires the real action.
  - `automation.notify_user` — thin wrapper over
    `NotificationApi.sendTransactional` so the core install has a
    "notify a user" action without depending on the integration-
    notification plugin. Produces `automation.notify_user_result`
    (per-strategy outcome).

  The built-in catalog is registered directly via the trigger/action
  registries in `init()` — no extension-point round-trip needed, since
  automation-backend owns the registry. Pulls in
  `@checkstack/notification-common` as a runtime dep for the
  service-mode RPC call.

- 41c77f4: feat(automation): backend RPC router with the full 15-endpoint contract

  Wires up `core/automation-backend/src/router.ts` covering automation CRUD,
  definition validation, manual runs, run history, registry introspection,
  and a template playground. The contract is refactored to use the
  project's `proc()` pattern so `autoAuthMiddleware` enforces `read` /
  `manage` access automatically, and `AutomationApi` is exported via
  `createClientDefinition` for the frontend client.

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

- 41c77f4: fix(automation): qualify action `produces` / `consumes` with the owning plugin id

  `context.artifacts` showed up untyped (no fields) in the script editor
  because action `produces` / `consumes` were hand-written full strings
  (`"jira.issue"`) that did not match the artifact-type registry's
  qualified id. The registry derives `${pluginId}.${id}`, and the plugin's
  id is the package name `integration-jira`, so the artifact type actually
  registers as `integration-jira.issue` — the editor's schema lookup
  (`produces` vs registered `qualifiedId`) missed, leaving the artifact's
  fields unknown. (Runtime store/consume happened to agree with each other
  on the short string, so it "worked" but typed nothing.)

  The action registry now qualifies `produces` with the owning plugin id,
  exactly as it already qualifies the action's own `id` and as the
  artifact-type registry qualifies the artifact type id — so the three can
  never drift. Actions declare the **local** artifact id:

  - `produces: "issue"` → registered as `integration-jira.issue`,
  - `consumes: ["issue"]` → resolved against the owning plugin's namespace
    at run time; `consumedArtifacts` is keyed by the local id, so an
    action's `execute` reads `consumedArtifacts["issue"]`.

  All five artifact-producing integration plugins (jira / teams / webex /
  webhook / script) now declare local ids. With `produces` matching the
  registered artifact type, the editor types `context.artifacts[...]` with
  the real schema (e.g. `issueKey`, `projectKey`, `issueUrl`).

  **BREAKING (beta):** the fully-qualified artifact type ids change from
  the short form to the plugin-prefixed form, e.g. `jira.issue` →
  `integration-jira.issue`. This affects how artifacts are referenced in
  templates (`{{ artifact.integration-jira.issue.issueKey }}`), the TS
  script `context.artifacts["integration-jira.issue"]`, and shell env names
  (`$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Artifacts are
  per-run and ephemeral, so no stored-data migration is needed.

  Note: this keeps the same-plugin produce→consume handoff (the current
  pattern). Cross-plugin artifact consumption would need a follow-up to
  allow a fully-qualified `consumes` ref.

- 6d52276: feat(automation): expose `trigger.actor` so automations can filter on who/what caused an event

  Every platform event now carries an **actor** - the user, application (API
  client), service (backend-to-backend), or `system` (background /
  unauthenticated) that caused it - and the automation engine surfaces it to
  automations as `trigger.actor`. This lets a trigger filter gate on the
  origin of the event it reacts to:

  ```text
  {{ trigger.actor.type == "system" }}      # auto-created by the platform
  {{ trigger.actor.type == "user" }}         # a human
  {{ trigger.actor.id == "app-deploybot" }}  # a specific application
  ```

  `trigger.actor` is available on **every** trigger - it is injected by the
  platform, not declared per trigger - and editor autocomplete + Run Script
  context types include `trigger.actor.{type,id,name}`.

  How it works:

  - **`@checkstack/common`** adds the canonical `Actor` type / `ActorSchema`
    and `SYSTEM_ACTOR`.
  - **`@checkstack/backend-api`** adds `resolveActor(user)` and a
    `HookEventMeta` envelope. The hook listener / `onHook` signature gains an
    optional second `meta` argument (additive, backward compatible).
  - **`@checkstack/backend`** wraps emitted hooks in an envelope so the actor
    travels with the payload through the distributed queue, unwrapping it
    before delivery. The RPC emit path captures the authenticated caller;
    background emits default to the system actor. Raw/legacy queue data is
    treated as a system-actor payload, so delivery stays backward compatible.
  - **`@checkstack/automation-backend`** threads the actor into the dispatch
    scope (`trigger.actor`), available to trigger filters, top-level
    conditions, and all run templates, and persisted in the run's scope
    snapshot. Manual runs are attributed to the invoking user.
  - **`@checkstack/automation-common`** / **`@checkstack/automation-frontend`**
    expose `trigger.actor` in the editor variable scope and the generated
    Run Script `context.trigger.actor` types.

  No database migration and no per-trigger schema changes: the actor rides as
  event-envelope metadata and in the run scope snapshot.

- 6d52276: feat(automation): expose `trigger.id` and reconcile the trigger scope so multiple triggers are distinguishable

  Automations with more than one trigger could not tell which trigger fired:
  the trigger id wasn't queryable, and scripts only received `trigger.event`
  (so two triggers on the same event were indistinguishable). This exposes a
  consistent trigger contract everywhere - `trigger.id`, `trigger.event`,
  `trigger.actor`, `trigger.payload` - in templates, shell, and TypeScript
  scripts.

  - **`trigger.id` is now available** in templates (`{{ trigger.id }}`) and in
    the script context (`context.trigger.id`). It is typed as the **literal
    union** of the automation's trigger ids, so it discriminates triggers -
    including two subscribed to the same `event`.
  - **Auto-generated trigger ids.** The editor now assigns a unique, log-
    friendly id to every trigger (derived from its event, e.g.
    `incident_created`, deduped as `incident_created_2`), mirroring action ids:
    seeded on the starter automation, assigned on add, and re-filled on blur.
  - **Scripts now receive `trigger.id` and `trigger.actor`.** The
    `ActionRunScope` projection previously dropped both (it only forwarded
    `event` + `payload`), so `context.trigger.actor` was typed but never
    populated - that gap is fixed.
  - **Scope key reconciled.** The internal dispatch scope now exposes
    `trigger.event` as the canonical key (matching the editor and script
    contract) instead of leaking `trigger.eventId`; `trigger.eventId` is kept
    as a back-compat alias, so `{{ trigger.event }}` now resolves in template
    fields where it previously returned `undefined`.

  No database migration: the actor and id ride in the run scope snapshot. A
  shared `deriveTriggerId` is exported from `@checkstack/automation-common` so
  the editor, generated script types, and the runtime all agree on derived ids.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-common@0.2.0
  - @checkstack/template-engine@0.2.0
  - @checkstack/integration-common@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/command-backend@0.1.31
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5
  - @checkstack/queue-api@0.3.6
