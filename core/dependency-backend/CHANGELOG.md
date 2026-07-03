# @checkstack/dependency-backend

## 1.5.17

### Patch Changes

- Updated dependencies [faf98f5]
- Updated dependencies [faf98f5]
  - @checkstack/ai-backend@0.10.6
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-backend@1.15.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/automation-backend@0.10.8
  - @checkstack/catalog-backend@1.6.6
  - @checkstack/command-backend@0.2.18
  - @checkstack/gitops-backend@0.5.18
  - @checkstack/gitops-common@0.7.1
  - @checkstack/catalog-common@2.6.1
  - @checkstack/dependency-common@1.6.1
  - @checkstack/incident-common@1.7.1
  - @checkstack/maintenance-common@1.8.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/signal-common@0.2.15

## 1.5.16

### Patch Changes

- Updated dependencies [e819276]
- Updated dependencies [e819276]
  - @checkstack/ai-backend@0.10.5
  - @checkstack/healthcheck-backend@1.14.0
  - @checkstack/backend-api@0.28.0
  - @checkstack/automation-backend@0.10.7
  - @checkstack/catalog-backend@1.6.5
  - @checkstack/command-backend@0.2.17
  - @checkstack/gitops-backend@0.5.17

## 1.5.15

### Patch Changes

- Updated dependencies [b4e0832]
  - @checkstack/ai-backend@0.10.4
  - @checkstack/automation-backend@0.10.6
  - @checkstack/catalog-backend@1.6.4
  - @checkstack/healthcheck-backend@1.13.1

## 1.5.14

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/ai-backend@0.10.3
  - @checkstack/dependency-common@1.6.0
  - @checkstack/gitops-common@0.7.0
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/healthcheck-backend@1.13.0
  - @checkstack/automation-backend@0.10.5
  - @checkstack/catalog-backend@1.6.3
  - @checkstack/gitops-backend@0.5.16
  - @checkstack/backend-api@0.27.1
  - @checkstack/command-backend@0.2.16

## 1.5.13

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
  - @checkstack/healthcheck-backend@1.12.0
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/notification-common@1.5.0
  - @checkstack/ai-backend@0.10.2
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/incident-common@1.7.0
  - @checkstack/maintenance-common@1.8.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/dependency-common@1.5.0
  - @checkstack/catalog-backend@1.6.2
  - @checkstack/automation-backend@0.10.4
  - @checkstack/command-backend@0.2.15
  - @checkstack/gitops-backend@0.5.15
  - @checkstack/gitops-common@0.6.8
  - @checkstack/signal-common@0.2.14

## 1.5.12

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ai-backend@0.10.1
  - @checkstack/automation-backend@0.10.3
  - @checkstack/catalog-backend@1.6.1
  - @checkstack/healthcheck-backend@1.11.1

## 1.5.11

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/ai-backend@0.10.0
  - @checkstack/catalog-backend@1.6.0
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/healthcheck-backend@1.11.0
  - @checkstack/automation-backend@0.10.2
  - @checkstack/dependency-common@1.4.4
  - @checkstack/incident-common@1.6.4
  - @checkstack/maintenance-common@1.7.4
  - @checkstack/backend-api@0.26.1
  - @checkstack/command-backend@0.2.14
  - @checkstack/gitops-backend@0.5.14
  - @checkstack/gitops-common@0.6.7
  - @checkstack/notification-common@1.4.2
  - @checkstack/signal-common@0.2.13

## 1.5.10

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/ai-backend@0.9.1
  - @checkstack/backend-api@0.26.0
  - @checkstack/catalog-common@2.4.3
  - @checkstack/dependency-common@1.4.3
  - @checkstack/gitops-common@0.6.6
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/incident-common@1.6.3
  - @checkstack/maintenance-common@1.7.3
  - @checkstack/notification-common@1.4.1
  - @checkstack/signal-common@0.2.12
  - @checkstack/automation-backend@0.10.1
  - @checkstack/catalog-backend@1.5.5
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0
  - @checkstack/gitops-backend@0.5.13
  - @checkstack/healthcheck-backend@1.10.2

## 1.5.9

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-backend@0.10.0
  - @checkstack/ai-backend@0.9.0
  - @checkstack/catalog-backend@1.5.4
  - @checkstack/healthcheck-backend@1.10.1

## 1.5.8

### Patch Changes

- 8cad340: Widen Cmd+K command-palette coverage to every top-level sidebar destination.

  The command palette previously only surfaced commands from a handful of plugins,
  so large feature areas were silently unreachable from search. Each of these
  plugins now registers a "navigate to <feature>" command per top-level route via
  `registerSearchProvider`, so every sidebar destination they own is reachable
  from Cmd+K (entity search can come later):

  - dependency: "Dependency Map"
  - status-page: "Status pages"
  - satellite: "Satellites"
  - gitops: "GitOps", "Kind Registry"
  - secrets: "Secrets"
  - notification: "Notification Settings"
  - script-packages: "Script Packages", "Script Sandbox"

  Each command reuses the plugin's own route helper (`resolveRoute`) for its href
  and carries the same access rule that gates its sidebar nav entry, so palette
  visibility matches sidebar visibility. The notification command carries no
  access rule, matching its authenticated-only nav entry.

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
  - @checkstack/automation-backend@0.9.3
  - @checkstack/gitops-backend@0.5.12
  - @checkstack/backend-api@0.25.0
  - @checkstack/healthcheck-backend@1.10.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/catalog-backend@1.5.3
  - @checkstack/catalog-common@2.4.2
  - @checkstack/dependency-common@1.4.2
  - @checkstack/incident-common@1.6.2
  - @checkstack/maintenance-common@1.7.2
  - @checkstack/gitops-common@0.6.5
  - @checkstack/signal-common@0.2.11

## 1.5.7

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/catalog-backend@1.5.2
  - @checkstack/healthcheck-backend@1.9.2
  - @checkstack/automation-backend@0.9.2
  - @checkstack/ai-backend@0.7.2
  - @checkstack/gitops-backend@0.5.11

## 1.5.6

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/ai-backend@0.7.1
  - @checkstack/automation-backend@0.9.1
  - @checkstack/catalog-backend@1.5.1
  - @checkstack/gitops-backend@0.5.10
  - @checkstack/healthcheck-backend@1.9.1
  - @checkstack/catalog-common@2.4.1
  - @checkstack/dependency-common@1.4.1
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/incident-common@1.6.1
  - @checkstack/maintenance-common@1.7.1

## 1.5.5

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
  - @checkstack/incident-common@1.6.0
  - @checkstack/maintenance-common@1.7.0
  - @checkstack/gitops-backend@0.5.9
  - @checkstack/gitops-common@0.6.4
  - @checkstack/notification-common@1.3.4
  - @checkstack/signal-common@0.2.10

## 1.5.4

### Patch Changes

- Updated dependencies [bb6f0fe]
- Updated dependencies [bb6f0fe]
  - @checkstack/maintenance-common@1.6.0
  - @checkstack/ai-backend@0.6.1
  - @checkstack/healthcheck-backend@1.8.1
  - @checkstack/automation-backend@0.8.1
  - @checkstack/catalog-backend@1.4.12

## 1.5.3

### Patch Changes

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
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
- Updated dependencies [079369a]
  - @checkstack/ai-backend@0.6.0
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/healthcheck-backend@1.8.0
  - @checkstack/catalog-backend@1.4.11
  - @checkstack/gitops-backend@0.5.8
  - @checkstack/catalog-common@2.3.6
  - @checkstack/dependency-common@1.3.2
  - @checkstack/healthcheck-common@1.6.2
  - @checkstack/incident-common@1.5.2
  - @checkstack/maintenance-common@1.5.2

## 1.5.2

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
  - @checkstack/incident-common@1.5.1
  - @checkstack/maintenance-common@1.5.1
  - @checkstack/backend-api@0.21.7
  - @checkstack/gitops-backend@0.5.7

## 1.5.1

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

## 1.5.0

### Minor Changes

- 0b6f01b: feat(dependency): contribute dependency warnings to the backend system.issues aggregator

  The dependency plugin now registers a `system.issues` contributor (sourceId
  `dependency`) from its backend `init`, so the AI assistant surfaces upstream
  dependency problems alongside incidents, SLOs, health checks, and anomalies.

  The contributor enforces its own `dependency.read` access gate (returning an
  empty map - never throwing - when the principal lacks access; service users are
  trusted), then evaluates dependency warnings for every system that participates
  in a dependency edge by reading the shared, durable `dependencies` table. The
  answer is therefore identical on every pod. Only systems with an actual warning
  appear in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveDependencySignals` deriver in
  `@checkstack/dependency-common`, shared by both the backend contributor and the
  frontend `DependencySignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

### Patch Changes

- Updated dependencies [dbb76a2]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/ai-backend@0.3.0
  - @checkstack/healthcheck-backend@1.7.0
  - @checkstack/dependency-common@1.3.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/incident-common@1.5.0
  - @checkstack/maintenance-common@1.5.0
  - @checkstack/automation-backend@0.5.8
  - @checkstack/catalog-backend@1.4.8
  - @checkstack/backend-api@0.21.6
  - @checkstack/gitops-backend@0.5.6

## 1.4.7

### Patch Changes

- Updated dependencies [2428bfc]
  - @checkstack/ai-backend@0.2.0
  - @checkstack/automation-backend@0.5.7
  - @checkstack/catalog-backend@1.4.7
  - @checkstack/healthcheck-backend@1.6.7

## 1.4.6

### Patch Changes

- Updated dependencies [f9cfdae]
  - @checkstack/dependency-common@1.2.5
  - @checkstack/ai-backend@0.1.6
  - @checkstack/automation-backend@0.5.6
  - @checkstack/catalog-backend@1.4.6
  - @checkstack/healthcheck-backend@1.6.6

## 1.4.5

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
  - @checkstack/incident-common@1.4.4
  - @checkstack/maintenance-common@1.4.4
  - @checkstack/notification-common@1.3.3
  - @checkstack/automation-backend@0.5.5
  - @checkstack/catalog-backend@1.4.5
  - @checkstack/gitops-backend@0.5.5
  - @checkstack/healthcheck-backend@1.6.5
  - @checkstack/signal-common@0.2.9

## 1.4.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/ai-backend@0.1.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/catalog-backend@1.4.4
  - @checkstack/gitops-backend@0.5.4
  - @checkstack/healthcheck-backend@1.6.4

## 1.4.3

### Patch Changes

- Updated dependencies [00b9367]
  - @checkstack/ai-backend@0.1.3
  - @checkstack/automation-backend@0.5.3
  - @checkstack/catalog-backend@1.4.3
  - @checkstack/healthcheck-backend@1.6.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/dependency-common@1.2.3
  - @checkstack/incident-common@1.4.3
  - @checkstack/maintenance-common@1.4.3
  - @checkstack/backend-api@0.21.3
  - @checkstack/common@0.14.1
  - @checkstack/gitops-backend@0.5.3
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-common@1.5.3
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8

## 1.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-backend@0.1.2
  - @checkstack/automation-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/catalog-backend@1.4.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/dependency-common@1.2.2
  - @checkstack/gitops-backend@0.5.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/healthcheck-backend@1.6.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/incident-common@1.4.2
  - @checkstack/maintenance-common@1.4.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/signal-common@0.2.8

## 1.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/ai-backend@0.1.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/catalog-backend@1.4.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/dependency-common@1.2.1
  - @checkstack/gitops-backend@0.5.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/healthcheck-backend@1.6.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/incident-common@1.4.1
  - @checkstack/maintenance-common@1.4.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/signal-common@0.2.7

## 1.4.0

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
  - @checkstack/notification-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/dependency-common@1.2.0
  - @checkstack/gitops-backend@0.5.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/incident-common@1.4.0
  - @checkstack/maintenance-common@1.4.0
  - @checkstack/signal-common@0.2.6

## 1.3.1

### Patch Changes

- Updated dependencies [a57f7db]
- Updated dependencies [0d9e5d8]
  - @checkstack/backend-api@0.20.0
  - @checkstack/healthcheck-backend@1.5.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/catalog-backend@1.3.1
  - @checkstack/gitops-backend@0.4.1

## 1.3.0

### Minor Changes

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

- b995afb: Restore the documented domain payload fields on entity-driven automation triggers.

  Migrated triggers declare domain-named `payloadSchema`s (incident `incidentId`; health `systemId` / `previousStatus`; catalog `systemId` / `changedFields`; dependency `dependencyId`), but Stage-2 dispatch built `trigger.payload` from the generic entity-change shape (`{ kind, id, prev, next, delta, ...next }`). Operator filters and templates reading `trigger.payload.incidentId` / `.systemId` / `.previousStatus` silently resolved to `undefined` — a regression vs the legacy hook payloads.

  Changes:

  - `@checkstack/automation-backend`: `registerChangeDeriver` now accepts an optional per-kind `toPayload(changed) => Record<string, unknown>` mapper (at most one per kind; a second distinct mapper throws). Stage-2's `changedToPayload` uses the registered mapper to build `trigger.payload` so it matches the kind's declared `payloadSchema`, falling back to the generic change shape for kinds without a mapper. New exported type `EntityChangePayloadMapper`.
  - `@checkstack/incident-backend`, `@checkstack/healthcheck-backend`, `@checkstack/catalog-backend`, `@checkstack/dependency-backend`: implement and register a `toPayload` for each entity-driven kind so `trigger.payload` carries the legacy domain keys again.

  Descriptive incident payload fields not derivable from the reactive entity state (`title`, `description`, `createdAt`, `resolvedAt`) are now OPTIONAL on the incident trigger `payloadSchema`s — they were always absent from an entity-driven payload.

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
  - @checkstack/maintenance-common@1.3.0
  - @checkstack/catalog-backend@1.3.0

## 1.2.0

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

- 41c77f4: feat(dependency): Phase 9 — triggers + create/remove actions for the Automation Platform

  - Triggers `dependency.created`, `dependency.updated`, `dependency.deleted`,
    each carrying `contextKey: (p) => p.dependencyId` so `wait_for_trigger`
    resumes on the same edge.
  - New hook `dependencyHooks.impactPropagated` + matching trigger
    `dependency.impact_propagated` — fires once per upstream event from
    `evaluateAndNotifyDownstream` with the list of downstream systems
    whose derived state actually moved. Carries previous/new state for
    each affected system so subscribers don't have to re-query the
    graph. Fires regardless of notification suppression, so an
    automation can react even when the user-facing notification is
    skipped. `contextKey: (p) => p.sourceSystemId`.
  - Actions `dependency.create` (with cycle + duplicate-edge detection
    surfaced via the action's `error`) and `dependency.remove`. Both emit
    the matching `dependencyHooks.*` so downstream automations and caches
    react identically to RPC-driven changes.
  - Artifact type `dependency.edge` for source/target/impact pass-through
    between steps.

### Patch Changes

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
  - @checkstack/incident-common@1.3.1
  - @checkstack/maintenance-common@1.2.3
  - @checkstack/gitops-backend@0.3.7
  - @checkstack/gitops-common@0.4.2
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5

## 1.1.6

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/healthcheck-backend@1.2.0
  - @checkstack/incident-common@1.3.0
  - @checkstack/backend-api@0.17.1
  - @checkstack/catalog-backend@1.1.6
  - @checkstack/gitops-backend@0.3.6

## 1.1.5

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
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/catalog-backend@1.1.5
  - @checkstack/gitops-backend@0.3.5
  - @checkstack/healthcheck-backend@1.1.4
  - @checkstack/notification-common@1.2.0
  - @checkstack/catalog-common@2.2.2
  - @checkstack/dependency-common@1.1.2
  - @checkstack/gitops-common@0.4.1
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/incident-common@1.2.2
  - @checkstack/maintenance-common@1.2.2
  - @checkstack/signal-common@0.2.4

## 1.1.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/notification-common@1.1.1
  - @checkstack/catalog-backend@1.1.4
  - @checkstack/gitops-backend@0.3.4
  - @checkstack/healthcheck-backend@1.1.3
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dependency-common@1.1.1
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/incident-common@1.2.1
  - @checkstack/maintenance-common@1.2.1

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
  - @checkstack/gitops-backend@0.3.3
  - @checkstack/healthcheck-backend@1.1.2

## 1.1.2

### Patch Changes

- Updated dependencies [b627562]
  - @checkstack/catalog-backend@1.1.2
  - @checkstack/gitops-backend@0.3.2
  - @checkstack/healthcheck-backend@1.1.1

## 1.1.1

### Patch Changes

- Updated dependencies [7c97b43]
- Updated dependencies [9016526]
  - @checkstack/healthcheck-backend@1.1.0
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/incident-common@1.2.0
  - @checkstack/maintenance-common@1.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/dependency-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/catalog-backend@1.1.1
  - @checkstack/gitops-backend@0.3.1
  - @checkstack/signal-common@0.2.3

## 1.1.0

### Minor Changes

- f6f9a5c: Add a GitOps `System.dependencies` extension and lock the matching UI.

  Each entry references an upstream system by ref and tunes the impact:

  ```yaml
  apiVersion: checkstack.io/v1alpha1
  kind: System
  metadata: { name: payments-api }
  spec:
    dependencies:
      - targetRef: { kind: System, name: payments-db }
        impactType: critical
        transitive: false
        label: "primary store"
  ```

  The reconciler diffs the YAML-declared edges against the persisted ones
  where this system is the source and converges via
  create / update / delete. GitOps is the source of truth, so any edges
  no longer listed are removed. Refs that resolve to the source system
  itself are rejected; refs that fail to resolve abort the diff before
  any mutation.

  UI gates:

  - The `DependencyEditor` (system editor drawer) hides Add and disables
    Edit/Delete on upstream rows when the source system is GitOps-managed.
    Downstream rows are gated per-row by the _other_ system's lock.
  - The `DependencyMap` blocks `onConnect` when the source is locked,
    surfaces a "Managed by GitOps" notice in the edge editor panel, and
    disables Save/Delete there.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
  - @checkstack/common@0.9.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-backend@0.3.0
  - @checkstack/incident-common@1.1.0
  - @checkstack/maintenance-common@1.1.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/catalog-backend@1.1.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/dependency-common@1.0.2
  - @checkstack/healthcheck-backend@1.0.4
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/notification-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 1.0.3

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
  - @checkstack/maintenance-common@1.0.1
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/incident-common@1.0.1
  - @checkstack/notification-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 1.0.2

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/catalog-backend@1.0.1
  - @checkstack/healthcheck-backend@1.0.2
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/notification-common@1.0.0
  - @checkstack/signal-common@0.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [2a749d3]
  - @checkstack/healthcheck-backend@1.0.1

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

### Patch Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-backend@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/incident-common@1.0.0
  - @checkstack/maintenance-common@1.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/healthcheck-backend@1.0.0
  - @checkstack/dependency-common@1.0.0
  - @checkstack/backend-api@0.14.0

## 0.3.3

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/dependency-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/incident-common@0.5.0
  - @checkstack/maintenance-common@0.5.0
  - @checkstack/notification-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/healthcheck-backend@0.18.1
  - @checkstack/catalog-common@1.5.3
  - @checkstack/catalog-backend@0.7.1

## 0.3.2

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/healthcheck-backend@0.18.0
  - @checkstack/common@0.7.0
  - @checkstack/catalog-backend@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/catalog-common@1.5.2
  - @checkstack/dependency-common@0.2.3
  - @checkstack/incident-common@0.4.9
  - @checkstack/maintenance-common@0.4.11
  - @checkstack/notification-common@0.2.9
  - @checkstack/signal-common@0.1.10

## 0.3.1

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/healthcheck-backend@0.17.1
  - @checkstack/catalog-common@1.5.1
  - @checkstack/dependency-common@0.2.2
  - @checkstack/incident-common@0.4.8
  - @checkstack/maintenance-common@0.4.10
  - @checkstack/catalog-backend@0.6.1

## 0.3.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/healthcheck-backend@0.17.0
  - @checkstack/catalog-common@1.5.0
  - @checkstack/catalog-backend@0.6.0

## 0.2.16

### Patch Changes

- Updated dependencies [9a320fe]
  - @checkstack/healthcheck-backend@0.16.5

## 0.2.15

### Patch Changes

- @checkstack/catalog-backend@0.5.4
- @checkstack/healthcheck-backend@0.16.4

## 0.2.14

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/healthcheck-backend@0.16.3
  - @checkstack/catalog-backend@0.5.3

## 0.2.13

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/healthcheck-backend@0.16.2
  - @checkstack/catalog-backend@0.5.2

## 0.2.12

### Patch Changes

- @checkstack/catalog-backend@0.5.1
- @checkstack/catalog-common@1.4.1
- @checkstack/healthcheck-backend@0.16.1

## 0.2.11

### Patch Changes

- Updated dependencies [80cbc51]
  - @checkstack/healthcheck-backend@0.16.0
  - @checkstack/catalog-backend@0.5.0

## 0.2.10

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0
  - @checkstack/catalog-backend@0.4.4
  - @checkstack/healthcheck-backend@0.15.1

## 0.2.9

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/healthcheck-backend@0.15.0
  - @checkstack/catalog-backend@0.4.3

## 0.2.8

### Patch Changes

- @checkstack/catalog-backend@0.4.2
- @checkstack/healthcheck-backend@0.14.3

## 0.2.7

### Patch Changes

- @checkstack/catalog-backend@0.4.1
- @checkstack/healthcheck-backend@0.14.2

## 0.2.6

### Patch Changes

- Updated dependencies [b01078f]
  - @checkstack/catalog-backend@0.4.0
  - @checkstack/healthcheck-backend@0.14.1

## 0.2.5

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/catalog-backend@0.3.0
  - @checkstack/healthcheck-backend@0.14.0

## 0.2.4

### Patch Changes

- Updated dependencies [aa2b3aa]
  - @checkstack/healthcheck-backend@0.13.1

## 0.2.3

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/healthcheck-backend@0.13.0
  - @checkstack/backend-api@0.12.0
  - @checkstack/catalog-backend@0.2.24

## 0.2.2

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/catalog-backend@0.2.23
  - @checkstack/healthcheck-backend@0.12.1
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/dependency-common@0.2.1
  - @checkstack/incident-common@0.4.7
  - @checkstack/maintenance-common@0.4.9
  - @checkstack/signal-common@0.1.9

## 0.2.1

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/healthcheck-backend@0.12.0
  - @checkstack/backend-api@0.11.0
  - @checkstack/catalog-backend@0.2.22

## 0.2.0

### Minor Changes

- 3f36a64: Add System Dependencies plugin

  Introduces the system dependencies feature with three new core plugins and
  extends the catalog with a new SystemEditorSlot extension point.

  **New plugins:**

  - **dependency-common**: Shared Zod schemas, RPC contract with resource-level access control, signal definitions, and routes
  - **dependency-backend**: Drizzle schema, DependencyService with cycle detection, WarningEvaluationService with transitive impact matrix, RPC router with signal broadcasting, and per-user canvas node position persistence
  - **dependency-frontend**: DependencyBadge (dashboard), DependencyAlert (system details), DependencyEditor (system editor dialog), and interactive DependencyMapPage (React Flow canvas)

  **Catalog extensions:**

  - **catalog-common**: New `SystemEditorSlot` for plugin-injected sections in the system editor dialog
  - **catalog-frontend**: `SystemEditor` renders the slot after TeamAccessEditor for existing systems

  **Key capabilities:**

  - Directional dependency edges between systems (source depends on target)
  - Three impact types: informational, degraded, critical
  - Transitive multi-hop warning propagation with toggle switch
  - Cycle detection at creation time with graphical chain visualization
  - Health check-level dependency rules
  - Interactive dependency map with drag-to-connect, edge click editor, and auto-saving node positions
  - Inline editing of dependencies in both the system editor and the map canvas
  - Team-based resource-level access control on all mutation endpoints
  - Realtime signal-driven UI updates

### Patch Changes

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/healthcheck-backend@0.11.0
  - @checkstack/dependency-common@0.2.0
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/catalog-backend@0.2.21
