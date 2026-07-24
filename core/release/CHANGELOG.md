# @checkstack/release

## 0.136.0

### Minor Changes

- be74b01: Migrate the automation surfaces onto the shared filter bar, and dedupe useDebouncedValue

  Follows the native `DataTable` facet API with the first wave of migrations.

  - `DataTableFacet` gains `kind: "select" | "pills"`. A segmented pill row is the
    right control for two or three short options a reader benefits from seeing at
    a glance, and several surfaces had independently built one - so the shared bar
    renders that variant rather than forcing every list into a dropdown. Both
    variants share one state, sentinel and URL round-trip, and the pills set
    `aria-pressed`, which two of the hand-rolled groups they replace had omitted.
  - `parsedFacetValue` reads a facet's selection back as a domain value by parsing
    it against the schema that defines it. Facet state is stringly-typed because
    it round-trips through the URL, but a server-side filter needs the narrow union
    its query input declares; parsing rather than casting means a stale link
    degrades to unconstrained instead of smuggling an unknown value into a request.
  - The automation list and run-history pages drop their hand-rolled status pill
    rows for the shared bar. Their filters now persist to the URL, so a link to
    "the failed runs of this automation" reopens filtered. The run-history table
    also gains the `surface={false}` it was missing, fixing a panel-in-panel.
  - `useDebouncedValue` had been copied verbatim into six plugin packages, each
    with a comment noting no shared version existed. All six now import the one in
    `@checkstack/ui` and the copies are deleted.

## 0.135.0

### Minor Changes

- 53081bd: Let groups and environments be scoped to multiple teams and un-scoped again. The
  Group and Environment edit dialogs now embed the full `TeamAccessEditor` (the
  same control systems use on their detail page) when editing an existing
  group/environment, so you can add any number of teams, remove a team, toggle a
  team between Manage and Read-only, and flip privacy. Previously the only
  team-scoping surfaces for groups/environments were the create-time single owner
  picker and the additive per-row "Scope to team" action, so a group/environment
  could effectively only be handed to one team and never un-scoped. No backend
  change: the generic relation endpoints already supported this; the editors just
  never exposed it.

## 0.134.0

### Minor Changes

- 6c8b36b: Syslog ingestion becomes the platform's first LISTENER source type
  (`logstream.syslog`): create a syslog source instance with port/TLS
  config and a log-stream binding instead of setting
  `CHECKSTACK_LOGSTREAM_SYSLOG_PORT`. The instance binding is the
  authorization and routing - no in-message `ckls_` tokens. A TLS
  listener validates its cert/key paths at start (a bad path surfaces as
  the instance's lastError instead of a silently-dead intake), and a
  deployment still setting the removed env var gets an explicit startup
  warning pointing at the new source flow.

  BREAKING CHANGES (BETA): the env-var syslog listener and its per-message
  token resolution are REMOVED from the core (the satellite's edge syslog
  receiver keeps the token-prefix protocol unchanged). Recreate any
  env-configured syslog intake as a syslog source instance bound to the
  target stream.

## 0.133.0

### Minor Changes

- 56af572: Hideable log patterns and a severity filter for the Top patterns card.

  - A pattern (mined or user-authored) can now be hidden (`setPatternHidden`,
    manage-gated on the stream). A hidden pattern leaves every default listing
    (Top patterns card, explorer pattern picker, Patterns tab default view) and
    its matched lines are NO LONGER stored as raw log lines - while every
    aggregate keeps counting them (severity totals, pattern/variable buckets,
    spike detection, health checks pinned to the pattern), so hiding noise like
    fully-wildcarded access logs never falsifies stream volume or breaks a
    check. The hide flag propagates to every pod's in-memory Drain engine
    (including worker-hosted trees) via the existing patterns-changed broadcast,
    with hydration as the convergence backstop.
  - The Patterns tab shows a "Show hidden (N)" toggle revealing hidden patterns
    (dimmed, badged) with a per-row hide/unhide action; unhiding resumes raw
    line storage immediately.
  - `listPatterns` accepts `includeHidden` (default false), `bands` (filter by
    the pattern's derived severity band, computed in SQL exactly like the DTO's
    `bandFromSeverityNumber`) and `orderBy: "lastSeenAt" | "totalCount"`.
  - The overview's Top patterns card is now severity-filterable via the same
    band pills the explorer uses (extracted into a shared `SeverityBandPills`
    component) and queries `listPatterns` ordered by volume.

## 0.132.0

### Minor Changes

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

## 0.131.0

### Minor Changes

- 4568dcc: Regenerate the assistant's docs index to cover the new "Realtime signals: scope
  to a resource when a signal is high-frequency" section of the query-invalidation
  developer guide: declaring a signal `resourceKey`, registering resource-scoped
  signals on a frontend plugin, how a query is matched (input-keyed detail queries
  vs the `signalScopeMeta` opt-in for resource-agnostic lists), per-resource
  coalescing, and why foreign signals stay blanket.

## 0.130.0

### Minor Changes

- 5e704cd: chore(ai-backend): regenerate docs index

  Picks up the frontend extension-points and plugins pages, which now document a
  single `UserMenuItemsSlot` ordered by `priority`, in place of the removed
  `UserMenuItemsBottomSlot` and a `group`-based grouping system that was never
  implemented.

## 0.129.0

### Minor Changes

- bd41130: perf(healthcheck): stop recomputing the full system rollup on every check run

  The queue run executor captured the system-wide rollup health
  (`getSystemHealthStatus(systemId)`) at the start of EVERY check tick - a
  worst-wins aggregate that fans out an N+1 of windowed `health_check_runs` reads
  across every check × environment of the system. That value was only ever
  consumed on the rare catastrophic-failure path (a job that throws before running
  any probe); the normal success/failure paths record their transition from the
  per-environment pre-read and never touched it. Under load this was one of the
  heaviest repeated reads on the hot path.

  The rollup pre-status is now computed lazily, only inside the catastrophic-
  failure branch that actually uses it. Behavior is unchanged - the catastrophic
  path reads the same pre-tick rollup (it is reached only when the run threw before
  inserting anything, so nothing changed in between) - but every normal check tick
  no longer pays for a full rollup recompute it discards.

## 0.128.0

### Minor Changes

- 43e4484: Batch hot-path scoped-db reads/writes into single transactions to cut per-query round-trips.

  The scoped-db proxy wraps every standalone query in its own `BEGIN → SET LOCAL search_path → query → COMMIT`, so a path issuing N sequential queries paid N round-trips and checked out a connection N times. These reads/writes now run under one `withScopedTransaction`, collapsing the batch to a single `SET LOCAL` on one connection. Behavior is unchanged:

  - healthcheck: `getSystemHealthOverview`'s `1 + N·(2+E)` read fan-out.
  - incident/maintenance: `getIncident`/`getMaintenance` (4 reads), `getManyEntityStates`, `listOpenIncidentsBySystem` / `getActiveMaintenancesBySystem`, `getMaintenanceWindowsForRange`; the `list*` / `*ForSystem` per-row `N+1` system lookups collapsed to a single set-based `inArray` read; maintenance `transitionStatus` update+insert made atomic; `addUpdate`/`editUpdate`/`addLink` use `.returning()` instead of a follow-up re-select.
  - ai: `appendMessage`, memory `saveOrUpdate`.
  - notification: `resolveInheritedGroups`.
  - status-page: subscriber `verify` (4 reads) and `unsubscribe` (3 reads).
  - announcement: `getActiveAnnouncements` / `dismissAnnouncement` / `createAnnouncement`.
  - gitops: `upsertProvenance`.

## 0.127.0

### Minor Changes

- f93ee7a: Fuse authorization into the RPC call so a frontend gate can't drift from - or be
  forgotten alongside - the procedure it guards. This is the structural endpoint of
  the contract-derived gating work: instead of pairing `client.X.useMutation()` with
  a separate `useProcedureAccess(X)`, the gate is welded to the call.

  - `useGatedMutation` / `useGatedQuery` (`@checkstack/frontend-api`): the plugin
    client's mutation/query hooks now have gate-fused variants that derive the
    authorization verdict from the SAME contract procedure and input the call uses
    and return it as `{ allowed, accessLoading }` on the result. A control cannot
    obtain `mutate` without the verdict, and a gated query stays disabled until the
    caller is authorized (no guaranteed-403 fetch). The id a mutation gates on is
    passed as `gateInput` (e.g. `{ id }`), the same id `mutate` will send.
  - `accessApi.useSurfaceAccess(procedure)` (`@checkstack/auth-frontend`): the
    coarse "can the user reach this management surface" gate, DERIVED from a
    representative procedure of the page (its access rule + object/parent type from
    the contract) instead of hand-passed `objectType`/`parentType` that can drift.
    Generalizes the hand-authored `useCanAccessType` surface gate.
  - Runtime gating-drift detector (`@checkstack/backend-api`): the auth middleware
    logs, in dev/e2e only (no-op in production), when a real user is denied a
    global-only gate - a candidate for the "shown-but-denied" drift class. A
    belt-and-suspenders net for hand-rolled/dynamic call paths the fused hooks
    don't cover.

  The automation editor is the reference surface: its create/update gates are fused
  directly into the create/update mutations, so there is no separate gate hook to
  keep in sync, and its surface gate uses `useSurfaceAccess`. The run-detail page's
  "Cancel run" control is also fused onto
  `cancelRun` - a real drift fix: it previously gated on a bare
  `useAccess(automation.manage)` (the GLOBAL rule), so a team-scoped manager with a
  grant on the automation but no global rule saw no Cancel button even though the
  `parentScope`d backend would authorize them; the fused gate derives the verdict
  from the page's `automationId`, so they now see it. A
  `checkstack/prefer-gated-mutation` lint rule (dev tooling, scoped, `warn`) nudges
  raw `.useMutation()` toward the fused variant so fusion is the default and raw
  mutations become the deliberate, greppable exception (the remaining raw automation
  mutations - per-row toggle/delete gated via `useResourceAccess`, and the
  stateless `renderTemplate` utility - carry a documented suppression).

  No behavior change for existing call sites: `useMutation` / `useQuery` /
  `useCanAccessType` are unchanged and remain for per-row arrays, non-procedure
  gates, and compound controls.

## 0.126.0

### Minor Changes

- fc64fad: Dependency map layout is now dependency-aware, and system detail pages gain a
  read-only up/downstream dependency panel.

  The map's automatic layout replaces the old square grid with a layered
  (Sugiyama-style) arrangement: upstream systems are placed to the right of the
  systems that depend on them, columns are ordered to minimise edge crossings, and
  systems with no dependencies are parked off to the side so they never tangle
  with the wired graph. Saved positions are still honoured verbatim - only
  unplaced boxes are arranged, and when some boxes are already positioned the new
  ones drop into a tidy block in the free space below them rather than overlapping
  your existing layout.

  Two new toolbar controls build on this:

  - **Center on box** - select a system, then rebuild the layout around it, with
    everything it depends on fanning out to one side and everything that depends
    on it to the other. Handy when you only care about one central system.
  - **Reset layout** - re-arrange every box with the automatic layered layout,
    overriding saved positions.

  System detail pages now show a **Dependencies** panel listing what the system
  depends on (upstream) and what depends on it (downstream), each neighbour
  linking to its own detail page with a live health dot and the edge's impact
  severity. The panel is visible to anyone allowed to read the system's
  dependencies: holders of the global dependency-map rule, or users who can manage
  the system via a team grant - mirroring how map edge editing is gated.

## 0.125.0

### Minor Changes

- 67b50f5: Health-check overview and run history: group stale checks, resolve environment
  names for old runs, and show absolute run timestamps.

  - The system overview now detects health-check slices that no longer receive
    runs after an environment change - the env-less leftover of a check that has
    since fanned out to environments, a slice for an environment that was removed,
    and the case where all environments are removed - and tucks them into a
    collapsed "Old checks" group. Their history is preserved; they just stop
    cluttering the live list.
  - Environment pills across the overview and the run-history surfaces now resolve
    names from all environments (not only those still assigned to the system), so
    a run for an environment that was later UNASSIGNED shows the environment's
    name instead of its raw id. An environment that was actually DELETED reads as
    "Removed environment" rather than a UUID.
  - The overview environment pill is now a single shared primitive with
    context-independent sizing, so pills render at the same size inside the "Old
    checks" group as in the live list.
  - The "Recent Runs" table now stacks the absolute datetime over the relative
    "x ago" string instead of hiding the datetime behind a hover tooltip, so the
    exact time is readable at a glance.

## 0.124.0

### Minor Changes

- c55d7c6: Regenerate the docs index for the healthcheck metrics refactor: the rewritten
  health-check charts guide (unified `@checkstack/ui` chart kit, prioritized
  auto-chart tile grid), the new master-detail frontend pattern page
  (`SplitPane` / `VirtualList`), the new chart metadata keys
  (`x-chart-priority`, `x-chart-good-direction`), and the assertion outcomes
  and analytics documentation (per-run outcomes, per-bucket pass/fail counts,
  ingest-time satellite evaluation, rollup survival).

## 0.123.0

### Minor Changes

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

## 0.122.0

### Minor Changes

- e819276: Fix JSONPath collector assertions: the executor previously evaluated every
  assertion with a flat field lookup, so a `Body (JSONPath)` assertion compared
  against `undefined` and the configured path was silently ignored (`Exists`
  always failed, `Not Exists` always passed). The executor now parses the source
  field as JSON and extracts the configured path via `jsonpath-plus` (with
  expression evaluation disabled - filter/script expressions are rejected).
  Fail-closed: a non-JSON body, missing expression, or invalid path fails the
  assertion with a diagnostic, never the collection.

  Also adds `isEmpty` / `isNotEmpty` to the JSONPath operator set (and the
  AssertionBuilder), treating `[]`, `{}`, `""`, and missing values as empty - so
  "no errors reported" is a single `$.errors Is Empty` assertion, and "key exists
  but is empty" is `Exists` + `Is Empty` on the same path.

## 0.121.0

### Minor Changes

- b4e0832: Update the generated docs index to reflect the new HTTP health check
  authentication documentation (the Authentication picker in the first-health-
  check guide).

## 0.120.0

### Minor Changes

- 0cac684: Redirect anonymous visitors from `/auth/profile` to the login page instead of
  rendering the profile skeleton and firing the authenticated-only
  `getCurrentUserProfile` query into a guaranteed 401. The profile query now
  only runs once a signed-in session is resolved.

## 0.119.0

### Minor Changes

- a7f7e98: Announcements now have a stable, operator-controlled display order.

  ## What changed

  - **Stable ordering (bugfix).** `getActiveAnnouncements` had no `ORDER BY`, so
    Postgres returned rows in heap order, which shifts after any `UPDATE` - that
    is why announcements jumped position whenever one was edited. Both
    `getActiveAnnouncements` and `listAllAnnouncements` now order by
    `sort_order`, with `created_at` and `id` as stable tiebreakers, so the
    sequence never changes on its own.
  - **Manual sorting.** `announcements` gained a `sort_order` integer column
    (migration `0001`, back-filled from existing creation order). A new
    `reorderAnnouncements` admin procedure takes the full ordered id list and
    writes each announcement's position in one atomic `UPDATE ... CASE`. Operators
    reorder from the management page with per-row up/down arrows (desktop table
    and mobile cards). New announcements append at the end; editing an
    announcement never moves it.
  - **Pure manual order everywhere.** The public banner no longer force-sorts by
    severity - banner, dashboard, and admin list all render the operator's order.
  - The `announcement.updated` signal payload's `action` gained a `"reordered"`
    value so listeners refetch after a reorder.

  ## Notes

  - `sort_order` is backend-internal; it is not exposed on the public
    `Announcement` schema (the frontend derives order from query order).
  - Migration `0001_typical_omega_red.sql` adds the column (default `0`) and
    back-fills distinct values via `row_number()` over `created_at, id`. It
    applies cleanly to both fresh and already-populated databases.

## 0.118.0

### Minor Changes

- baf9b6e: Script health-check editors now surface the assigned environment.

  Inline TS/JS health checks autocomplete `context.environment` (the optional
  `{ id, name, fields }` the run resolves to), with `fields` typed
  `Record<string, unknown>` so values are narrowed before use (the API/GitOps
  write path allows arbitrary JSON, not just the UI's string key/value pairs).
  Shell health checks now suggest the `CHECKSTACK_ENV_ID` / `CHECKSTACK_ENV_NAME`
  run-context variables (with the per-field `CHECKSTACK_ENV_<FIELD>` naming
  convention documented inline). The runtime already injected these; this only
  adds the editor type definitions and `$`-completion hints, and flows through to
  the regenerated `@checkstack/sdk/healthcheck` types.

## 0.117.0

### Minor Changes

- defb97b: feat(common): add the environments docs slug to APP_DOC_SLUGS

  Expose `APP_DOC_SLUGS.environments` so in-app deep links can point to the
  Environments concept page (used by the onboarding wizard's environments hint).
  Guarded by the existing docs-links contract test.

## 0.116.0

### Minor Changes

- 2e20792: Speed up app loading: inline boot config, load plugins non-blocking, stream the shell

  The SPA used to hold a full-page spinner through a serial boot waterfall before
  first paint: it fetched `/api/config` (twice) and `/api/plugins`, then awaited
  every plugin's registration before rendering anything.

  - **Inlined bootstrap (backend).** The backend now injects a small
    non-user-specific blob (`config` + `enabledPlugins`) into the served HTML, and
    the frontend reads it synchronously via `readBootstrap()`. This removes the
    boot-time `/api/config` and `/api/plugins` round-trips entirely. The per-user
    session is not inlined (it stays a better-auth fetch); the HTML is served
    `no-cache`. The Vite dev server has no blob, so it falls back to the original
    fetches.
  - **Non-blocking plugin load (frontend).** Local (bundled) plugins register
    synchronously and the shell renders immediately; remote (installed) plugins
    load in the background and register reactively, so first paint no longer waits
    on the plugin network phase.
  - **Skeleton-streamed first paint (frontend).** Route pages and the
    pre-providers window now show content/shell skeletons instead of full-page
    spinners, so the chrome stays put and only content streams in.

  `RuntimeConfigProvider` seeds from the inlined config and skips the reachability
  probe for a same-origin `baseUrl`; a misconfigured cross-origin `BASE_URL` still
  surfaces the same loud error.

## 0.115.0

### Minor Changes

- 8654b93: Fix the "Create Jira Issue" field-mapping dropdown showing "No options available" on Jira Server / Data Center, and make Jira option-resolver failures loud instead of silent.

  - `getFields` (which powers the `fieldKey` dropdown) read the createmeta field list only from the `fields` key. Jira Cloud's `PageOfCreateMetaIssueTypeWithField` does use `fields`, but Jira Server / Data Center returns the same granular endpoint's field list under the standard paginated `values` key (verified on 9.12), so DC came back empty. It now reads `fields ?? values` from `GET /issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}` (the replacement for the bulk `/issue/createmeta` that Jira removed in 9.0), mapping each entry's `fieldId`/`key`. If a response carries neither key, it logs a `warn` with the response keys and returns no options rather than failing silently.
  - The Jira option resolver no longer swallows API errors into an empty dropdown: a failing resolver logs the resolver name, connection id, and context keys and rethrows so the integration layer surfaces a clear error. Empty-but-successful field lookups warn with the project/issue type; expected cascade states (a dependency not selected yet) log at `debug`; an unknown resolver name throws.

## 0.114.0

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

## 0.113.0

### Minor Changes

- 8cad340: Add a shared formatting module (`@checkstack/ui` `src/formatting/`) of pure,
  framework-agnostic, locale-aware helpers, re-exported from the package root:

  - `formatDate(date)` / `formatDateTime(date)` - short locale-aware date / date-
    time strings. They pass an `undefined` locale (runtime locale) rather than a
    hardcoded one, accept `Date | string | number`, and return `""` for absent or
    invalid input.
  - `formatRelativeTime(date)` - "5 minutes ago" / "in 2 hours" via `date-fns`'
    `formatDistanceToNow` (the single chosen relative-time engine).
  - `formatNumber(n, opts?)` - locale-aware thousands separators via
    `Intl.NumberFormat` (integer display by default).
  - `formatBytes(bytes, opts?)` - defaults to BINARY units (1024-based,
    KiB/MiB/GiB) to match the cache runtime panel; pass `{ binary: false }` for
    decimal (1000-based) units.
  - `formatPercent(value, opts?)` - input is a 0-1 ratio by default (`0.42` ->
    "42%"); pass `{ alreadyPercent: true }` for a 0-100 input, plus a
    `fractionDigits` option.
  - `formatDuration(ms)` - compact "2h 5m" / "30s" / "500ms" durations.

  This is purely additive; existing inline call sites are not yet migrated.

## 0.112.0

### Minor Changes

- 2ec8f64: Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

  - `hono` 4.12.23 → 4.12.25 (CVE-2026-54286, CVE-2026-54287, CVE-2026-54288, CVE-2026-54289, CVE-2026-54290)
  - `nodemailer` 9.0.0 → 9.0.1 (GHSA-p6gq-j5cr-w38f)
  - `dompurify` 3.4.3 → 3.4.11 (CVE-2026-49458, CVE-2026-49459, CVE-2026-49978, GHSA-76mc-f452-cxcm, GHSA-cmwh-pvxp-8882)
  - `protobufjs` 7.5.8 → 7.6.3 (CVE-2026-48712, CVE-2026-54269)
  - `undici` 7.24.7 → 7.28.0 (CVE-2026-9678, CVE-2026-9697)

## 0.111.0

### Minor Changes

- 1eaa506: Bump `nodemailer` from 8.x to 9.0.0 to remediate a vulnerability flagged in the
  production image scan. The API surface used by this plugin (`createTransport`,
  `Transporter`, `sendMail`) is unchanged, so there is no behavioral difference.

## 0.110.0

### Minor Changes

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

## 0.109.0

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

## 0.108.0

### Minor Changes

- bb6f0fe: Add an `includeCompleted` filter to `listMaintenances`, mirroring the incident
  plugin's `includeResolved`. The maintenance config page gains a "Show completed"
  toggle, and the system maintenance history page opts in so completed windows
  still appear there.

  BREAKING CHANGE: `listMaintenances` now hides `completed` maintenances by
  default (`includeCompleted` defaults to `false`), matching how `listIncidents`
  hides `resolved` incidents. API/SDK consumers that relied on `listMaintenances`
  returning completed windows must now pass `includeCompleted: true` (or an
  explicit `status: "completed"` filter, which still wins regardless of the flag).

## 0.107.0

### Minor Changes

- 079369a: Fix the Jira `search_issues` action failing with HTTP 410 on Jira Cloud. Atlassian
  deprecated the legacy `/rest/api/3/search` endpoint on 2024-05-01 and removed it on
  2025-05-01 (CHANGE-2046), so every Cloud search (and the "create a ticket only if
  none is open" pattern that depends on it) broke. The client now calls
  `/rest/api/3/search/jql` for Cloud connections (deriving result existence from the
  returned issues, since the new endpoint returns no `total`), while Jira Data
  Center / Server (on-prem) connections keep using the legacy `/search`, which they
  still serve and where `/search/jql` does not exist. The endpoint is selected by the
  connection's auth mode (cloud vs datacenter).

## 0.106.0

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

## 0.105.0

### Minor Changes

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

## 0.104.0

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

## 0.103.0

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

## 0.102.0

### Minor Changes

- dbe89ae: fix(slo): stop SLO overview cards stretching to the sidebar height

  On the SLO Dashboard the card grid sits next to a taller sidebar in an
  `items-stretch` layout, so the card grid was stretched to the sidebar's
  height and the default `align-content` then stretched the card rows to fill
  it, leaving large empty space inside each card. The card grid now uses
  `content-start` so rows stay content-sized, while `h-full` on the card/anchor
  still makes cards within the same row match each other.

## 0.101.0

### Minor Changes

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

## 0.100.0

### Minor Changes

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

## 0.99.0

### Minor Changes

- 9d8961c: Fix the double-scrolling on the AI chat page (`/ai/chat`). The page sized its
  layout with a fixed `calc(100vh - 220px)` height, which overshot the available
  space when the page subtitle wrapped to two lines - so the whole page scrolled
  on top of the message list's own scroll.

  `PageLayout` gains an opt-in `fillHeight` prop that fills the viewport via a
  bounded flex height chain (established in the app shell) instead of viewport
  math; the chat page uses it so only the message list scrolls and the page itself
  never does. Normal document-flow pages are unaffected (they still scroll the
  main area as before).

## 0.98.0

### Minor Changes

- 968c12f: Show a loading spinner on initial app load instead of a blank screen. The host
  boots by awaiting plugin registration + Module Federation init before React
  mounts, which left `#root` empty for a few seconds. `index.html` now renders an
  inline, theme-aware boot splash (visible before the JS/CSS bundles load, with a
  no-flash light/dark head start mirroring the saved theme, and reduced-motion
  safe) that `main.tsx` removes once the app has rendered.

## 0.97.0

### Minor Changes

- 1fee9da: Republish the platform with correct internal cross-pins.

  The release pipeline's `version-packages` step ran `changeset version` (bumping every `package.json`) but never refreshed `bun.lock`, so the lockfile kept the pre-bump versions. Because `bun publish` resolves `workspace:*` from the lockfile, every published package pinned the _previous_ version of its `@checkstack/*` siblings (e.g. `@checkstack/backend-api@0.21.1` shipped depending on `@checkstack/cache-api@0.3.9` and `@checkstack/common@0.13.0` instead of `0.3.10` / `0.14.0`). That reintroduced the `backend-api -> cache-api -> backend-api` cycle for registry consumers and pinned `cache-api`/`queue-api` to a `common` version predating the `Logger`/`Migration` types they import.

  `version-packages` now runs `bun install --lockfile-only` after `changeset version`, so the lockfile matches the bumped versions before publish. This patch bump cascades through the dependency graph so every package republishes with its cross-pins resolved against the freshly-bumped versions.

## 0.96.0

### Minor Changes

- 13373ce: Break the publish-time dependency cycle between `@checkstack/backend-api` and `@checkstack/cache-api` / `@checkstack/queue-api`.

  `cache-api` and `queue-api` only ever used `Logger` and `Migration` from `backend-api` as `import type`, yet declared `@checkstack/backend-api` as a runtime dependency. In the monorepo this is harmless (everything resolves via `workspace:*`), but once published, `bun publish` freezes each `workspace:*` into a concrete pin of the _other_ package's then-current version. Because the dependency is mutual, a consumer installing these packages from the registry must resolve `backend-api -> cache-api -> backend-api -> ...` backward through release history until it reaches ancient versions that shipped raw `workspace:*` ranges and a long-removed `@checkstack/cache-api@0.1.0` pin - which fail to resolve. This surfaced as `bun install` errors (and a missing `checkstack-dev` binary) in freshly scaffolded standalone plugins.

  `Logger` and `Migration` now live in `@checkstack/common` (a dependency-free leaf package). `@checkstack/backend-api` re-exports both for backward compatibility, so existing `import type { Logger, Migration } from "@checkstack/backend-api"` call sites are unchanged. `cache-api` and `queue-api` now depend on `@checkstack/common` instead of `@checkstack/backend-api`, removing the cycle.

## 0.95.0

### Minor Changes

- 4c6722c: Fix `Cannot find module '@checkstack/scripts/scaffold'` when running `bun create checkstack-plugin`. The `0.1.0` release pinned `@checkstack/scripts@0.3.4`, which predates the `./scaffold` subpath export (first shipped in `0.4.0`). This release pins a version of `@checkstack/scripts` that exposes `./scaffold`. `0.1.0` has been deprecated on npm.

## 0.94.0

### Minor Changes

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

## 0.93.0

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

## 0.92.0

### Minor Changes

- 79b3487: Relocate plugin objects stranded in `public` into their plugin schema, and run
  migrations under a strict plugin-only `search_path`.

  Some databases predate per-plugin schema isolation and have a plugin's tables
  and enums sitting in `public` while the `__drizzle_migrations` ledger lives in
  the plugin schema. Runtime kept working because the scoped-db `search_path`
  falls back to `public`, but migrations did not: a new migration referencing a
  pre-existing object (e.g. the `health_check_status` enum) failed at startup with
  `type "health_check_status" does not exist`, crash-looping the pod. The previous
  pinned-connection fix made this deterministic by reliably targeting the
  (empty-of-that-object) plugin schema.

  The loader now, before running a plugin's migrations, MOVES any of that plugin's
  objects still in `public` into `plugin_<id>` with fully-qualified
  `ALTER ... SET SCHEMA` statements (by-OID, so columns, foreign keys, enum
  references, and owned sequences keep working). The relocation is idempotent
  (only moves objects that are in `public` and not already in the plugin schema)
  and is driven by the union of every Drizzle snapshot the plugin ships, so a
  table an early migration created and a later one drops is moved first and its
  unqualified `DROP TABLE` still resolves.

  With the stragglers relocated, migrations run under a strict
  `search_path = "plugin_<id>"` (no `public` fallback). Combined with creating the
  schema before the `SET`, unqualified `CREATE TABLE` / `CREATE TYPE` can only ever
  land in the plugin schema, never silently in `public`.

## 0.91.0

### Minor Changes

- af6bda7: Fix plugin migrations failing on upgrade with `type "..." does not exist`.

  Plugin migrations are schema-agnostic and rely on `search_path` to resolve
  unqualified names into the plugin's schema (e.g. `plugin_healthcheck`). The
  loader set `search_path` at the session level on the shared admin pool and
  then called Drizzle's `migrate()`. Because `migrate()` runs all pending
  migrations inside its own transaction, a `pg.Pool` could service that
  transaction on a different physical connection than the one the `SET` ran on,
  so the migration SQL executed against `public` instead.

  This was invisible on a fresh database (every object is created within that
  one transaction, so unqualified references still resolve), but broke upgrades:
  the healthcheck plugin's new `health_check_state_transitions` migration
  references the pre-existing `health_check_status` enum, which an earlier
  migration created in the plugin schema. On a different pooled connection that
  enum is not on the `public` `search_path`, so startup failed with
  `type "health_check_status" does not exist` and the pod crash-looped.

  Migrations now run on a single pinned pool connection: the loader checks out
  one dedicated client, sets `search_path` on it, and binds the migrator to that
  same client, mirroring the connection-affinity pattern already used by the
  advisory-lock service. Every migration statement now runs under the intended
  schema.

  Boot was also restructured into two passes over the topologically-sorted
  plugins: pass 1 runs every plugin's migrations, pass 2 runs every plugin's
  `init()`. Previously the two were interleaved per plugin, so an
  already-initialized plugin's background work (queue consumers, sweepers,
  reactive-entity/event wiring) could compete for pool connections while a later
  plugin was still migrating. Running all migrations first keeps the pool quiet
  during migrations and removes that race entirely. The pinned connection and the
  two-pass ordering are each independently sufficient for the fix above; together
  they make boot robust regardless of what else touches the pool.

## 0.90.0

### Minor Changes

- 270ef29: Harden the script-packages store against three confirmed defects:

  - **Tree GC no longer deletes live trees.** The tree garbage collector keyed
    its grace window on the materialized tree's dir mtime. A tree that had been
    `current` for days carried an ancient mtime, so it became eligible for
    deletion the instant it was superseded by a flip - and the post-flip sweep
    would then delete a tree that an in-flight run (which snapshots its
    resolution root at run start) was still pinned to. The flip now stamps a
    `.retired-at` marker into the superseded tree, and the grace window is
    measured from that retirement timestamp. A non-current tree with no marker
    is retained (and lazily back-filled) so it ages out instead of leaking, and
    is never deleted on a missing signal.

    BREAKING CHANGE: the tree-GC grace window is now measured from a tree's
    retirement time (when it stopped being `current`), not its dir mtime.
    Existing non-current trees with no `.retired-at` marker are retained on the
    first sweep and back-filled, then collected on a later sweep once the grace
    window elapses from the back-filled time.

  - **Installer no longer leaves a plaintext registry token on disk after a
    failed resolve.** The central resolver wrote the auth-token-bearing
    `.npmrc` into its scratch dir but only removed the scratch dir on the
    success path; any failure between `bun install` and packing the cache
    entries left the token on disk. Scratch-dir removal now runs in a `finally`
    so the token is cleaned up on every exit path.

  - **Tar extraction rejects symlink/hardlink entries.** Blob unpacking
    validated entry names against zip-slip but not link targets, so a symlink
    with a safe name but an escaping target (for example `-> /etc` or
    `-> ../../..`) passed; a later regular-file entry could then be written
    through it and escape the target directory. The listing pass now inspects
    entry types (`tar -tzvf`) and rejects any non-regular, non-directory entry.

## 0.89.0

### Minor Changes

- 41c77f4: feat(automation): backend RPC router with the full 15-endpoint contract

  Wires up `core/automation-backend/src/router.ts` covering automation CRUD,
  definition validation, manual runs, run history, registry introspection,
  and a template playground. The contract is refactored to use the
  project's `proc()` pattern so `autoAuthMiddleware` enforces `read` /
  `manage` access automatically, and `AutomationApi` is exported via
  `createClientDefinition` for the frontend client.

## 0.88.0

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

## 0.87.0

### Minor Changes

- f23f3c9: Sweep every paginated `*-common` contract onto the canonical
  `PaginationInput` / `PaginatedResult` from `@checkstack/common` and
  remove the now-unused legacy exports.

  **BREAKING CHANGE** - `@checkstack/common` drops the deprecated
  `PaginationInputSchema`, `paginatedOutput`, and `PaginatedResponse`
  symbols. Callers must consume `PaginationInput` (input) and
  `PaginatedResult(itemSchema)` (output) instead. The canonical input is
  `{ limit (1-100, default 20), offset (>= 0, default 0) }`; the
  canonical output envelope is
  `{ items, total, limit, offset }`.

  **BREAKING CHANGE** - `@checkstack/notification-common` migrates
  `getNotifications` off the legacy `PaginationInputSchema`
  (`{ limit, offset, unreadOnly }` with output `{ notifications, total }`)
  onto `ListNotificationsInputSchema =
PaginationInput.extend({ unreadOnly })` and
  `PaginatedResult(NotificationSchema)`. The output key changes from
  `notifications` to `items`, and `limit` / `offset` are now echoed on
  the response. The `PaginationInput` type alias previously exported
  from `notification-common` is removed - use `ListNotificationsInput`
  or the canonical `PaginationInput` from `@checkstack/common`.

  **BREAKING CHANGE** - `@checkstack/integration-common` migrates
  `listSubscriptions` (inline `{ page, pageSize, ... }` -> output
  `{ subscriptions, total }`) and `getDeliveryLogs` (via
  `DeliveryLogQueryInputSchema` `{ subscriptionId?, eventType?, status?,
page, pageSize }` -> output `{ logs, total }`) onto the canonical
  `PaginationInput.extend({...})` input and
  `PaginatedResult(itemSchema)` output. External callers must switch
  from `{ page, pageSize }` to `{ limit, offset }` and read response
  items from `data.items` (no more `data.subscriptions` / `data.logs`).

  The matching `*-backend` handlers were updated to consume the new
  input shape (`offset` arithmetic in lieu of `(page - 1) * pageSize`)
  and to echo `limit` / `offset` on the response. The `*-frontend` call
  sites in `NotificationsPage`, `NotificationBell`, `IntegrationsPage`,
  and `DeliveryLogsPage` were updated to send the new input shape and
  read `data.items`.

## 0.86.0

### Minor Changes

- a06b899: Dependency security bumps.

  - `samlify` `^2.12.0` → `^2.13.1` (auth-saml-backend) to resolve **CVE-2026-46490** (HIGH): XML injection in `AttributeValue` allowing privilege escalation in signed SAML assertions.
  - `@grpc/grpc-js` `^1.9.0` → `^1.14.4` (healthcheck-grpc-backend) — precautionary bump to latest patch.
  - Transitive `ws` resolution lifted from `8.20.1` → `8.21.0` via lockfile-only update (no `package.json` change required since `ws` is pulled in via `happy-dom`, `storybook`, and the optional `@orpc/server` peer).

  The `samlify` finding was surfaced by `trivy fs` against the workspace `bun.lock`. The `@grpc/grpc-js` and `ws` bumps have no verifiable public CVE today but were aligned to current published versions while we were already in the area.

## 0.85.0

### Minor Changes

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

## 0.84.0

### Minor Changes

- b627562: Bump direct and transitive dependencies to clear MEDIUM-severity advisories
  that Trivy now surfaces alongside CRITICAL/HIGH.

  Direct version bumps in package.json:

  - `@checkstack/catalog-backend`, `@checkstack/gitops-backend`,
    `@checkstack/healthcheck-frontend`: `uuid` `^13.0.0` → `^14.0.0`
    (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6). Also
    dropped the now-redundant `@types/uuid` devDependency — uuid 14 ships
    its own types and the npm `@types/uuid` package is a stub.
  - `@checkstack/gitops-backend`: `yaml` `^2.7.0` → `^2.8.3`
    (GHSA-48c2-rrv3-qjmp, stack overflow on deeply nested collections).
  - `@checkstack/dev-server`: `vite` `^5.4.0` → `^8.0.12`
    (GHSA-4w7w-66w2-5vf9, path traversal in optimized-deps `.map` handling)
    and `@vitejs/plugin-react` `^4.3.4` → `^6.0.1` to stay inside the new
    vite peer range.

  Root `overrides` / `resolutions` to bypass transitive pins that block the
  walk:

  - `dompurify` `^3.4.3` — `monaco-editor@0.55.1` pins `dompurify@3.2.7`
    exactly, so the only way to pick up the eight DOMPurify XSS / prototype
    pollution advisories (GHSA-v2wj-7wpq-c8vv et al.) is an override.
    Affects `@checkstack/ui`, which is the only consumer of monaco.
  - `uuid` `^14.0.0` — also forces `bullmq`'s nested `uuid@11.1.0`
    (vulnerable per GHSA-w5hq-g745-h8pq) to the patched line. Affects
    `@checkstack/queue-bullmq-backend`.
  - `yaml` `^2.9.0` — covers transitive resolutions that would otherwise
    pin pre-2.8.3 yaml.

  The CI image scan (`.github/workflows/pr-checks.yml`) and the local
  `bun run audit:*` helper now include `MEDIUM` alongside `CRITICAL,HIGH`,
  so future MEDIUM regressions fail the pipeline. The production Dockerfile
  also strips vendored `test/`, `tests/`, `__tests__/`, `benchmark/`,
  `benchmarks/`, `example/` and `examples/` folders from `node_modules`
  before the runtime stage — those tarball artefacts ship their own
  nested `package.json` (`benchmark`, `tedious-benchmarks`, etc.) which
  Trivy was scanning as if they were real packages.

## 0.83.0

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

## 0.82.0

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

## 0.81.0

### Minor Changes

- e90aba5: Split the dev server out of `@checkstack/scripts` into a new
  `@checkstack/dev-server` package.

  **Why**: Previously `@checkstack/scripts` declared `@checkstack/backend`,
  `@checkstack/frontend`, `@checkstack/ui`, `vite`, and
  `@vitejs/plugin-react` as runtime dependencies so the bundled `dev`
  command could spawn a local Checkstack. That made `bunx
@checkstack/scripts plugin-pack` (and any other CLI usage) resolve the
  platform's full transitive dep graph from npm — which broke the
  `Version Packages` release run when one of those transitives
  (`@checkstack/cache-api@0.1.0`) hadn't been published yet, blocking
  plugin-pack validation for 40 plugins.

  **What changed**:

  - New package `@checkstack/dev-server` with the bin `checkstack-dev`. It
    owns the dev loop (backend spawn, Vite, file watcher) and is meant to
    be installed as a `devDependency` in plugin repos.
  - `@checkstack/backend` and `@checkstack/frontend` are _optional_ peer
    dependencies of dev-server; plugin authors only declare the one
    matching their plugin type.
  - `@checkstack/scripts` runtime deps slimmed to `@checkstack/common`,
    `tar`, `inquirer`, `handlebars`. The `dev` command was removed from
    the CLI (it had not shipped to users yet).
  - Plugin scaffolding templates now produce `dev` scripts that call
    `checkstack-dev` directly and add `@checkstack/dev-server` plus the
    matching platform package as devDependencies.
  - Documentation updated to reflect the new dev-loop entry point.

  Both bumps are minor since the project is in beta — the removed `dev`
  command and dropped transitive deps would normally be a major bump.

## 0.80.0

### Minor Changes

- 50e5f5f: Add `bunx @checkstack/scripts dev` — a local Checkstack dev server for
  plugin authors that runs from the plugin's own repo without a monorepo
  checkout.

  Mechanics:

  - The dev command spawns `core/backend`'s production entry as a child
    process with three env vars wired in:
    - `CHECKSTACK_DEV_PLUGIN_PATH=<cwd>` — backend skips filesystem
      discovery and imports the plugin at this path as a manual plugin.
    - `CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS=<JSON array>` — additional
      backend plugins co-loaded as manual plugins. The dev command walks
      the plugin under dev's `package.json#dependencies` recursively to
      discover every `@checkstack/*-backend` package and pass their
      module paths through. Auto-includes
      `@checkstack/queue-memory-backend` +
      `@checkstack/cache-memory-backend` when no other queue/cache
      provider is in the dep graph, so `coreServices.queueManager` /
      `coreServices.cacheManager` always have a registered strategy on
      boot. Without this co-loading, plugins that depend on
      `healthcheck-backend`, `notification-backend`, etc. would hit
      unregistered services and the boot would deadlock.
    - `CHECKSTACK_DEV_AUTH=true` — backend registers a synthetic
      `AuthService` that auto-grants every registered access rule.
      Refused when `NODE_ENV=production` so accidental misuse is loud.
  - A file watcher under the plugin's `./src` triggers a full backend
    restart (debounced) on save. Bun's startup is sub-second for a single
    plugin, so the loop stays tight.
  - For frontend plugins (or bundle primaries with a `-frontend`
    sibling), the dev command additionally spawns a Vite dev server on
    port 5173 (configurable via `--frontend-port`). Vite serves
    `core/frontend`'s new `dev-main.tsx` shell — the same App.tsx,
    loadPlugins(), ThemeProvider, etc. that ship in production. The
    plugin module is mounted via a `virtual:checkstack-dev-plugin` alias
    Vite resolves at config time. React Fast Refresh works for component
    edits.
  - On boot, the dev command validates the plugin's `package.json`
    against the same `installPackageMetadataSchema` the runtime install
    pipeline uses, so missing required fields fail fast.

  Reuses 100% of the production boot code path — no parallel dev backend
  to drift from. New code surfaces:

  - `core/backend/src/services/dev-auth.ts` — the synthetic auth service.
    Inert unless `CHECKSTACK_DEV_AUTH=true`.
  - `core/scripts/src/commands/dev-server.ts` — the CLI command.
  - `core/scripts/src/commands/dev-deps-resolver.ts` — pure function that
    walks the plugin's deps and resolves the co-load set; covered by 8
    unit tests.
  - `core/scripts/src/commands/dev-frontend.ts` — Vite spawn helper.
  - `core/frontend/src/dev-main.tsx` — frontend dev-shell entry.

  `@checkstack/scripts` now depends on `@checkstack/backend`,
  `@checkstack/frontend`, `@checkstack/frontend-api`, `@checkstack/ui`,
  `vite`, and `@vitejs/plugin-react` so a `bunx` invocation pulls in
  everything needed for the dev server in one shot.

  Replaces the previous "three patterns" plugin-development guide with a
  single `bun run dev` workflow.

  A new ESLint rule branch in `no-extraneous-runtime-deps` ignores
  `virtual:` module specifiers (resolved by bundler aliases at runtime,
  not installed from npm).

  Scaffold templates updated for one-click compatibility — `bun run create`
  now produces plugin packages that pass the dev-server's
  `installPackageMetadataSchema` gate and ship `dev` / `pack` scripts plus
  `@checkstack/scripts` in devDependencies, so a freshly scaffolded plugin
  runs `bun run dev` without any further file edits. Required metadata
  (`description`, `author`, `license: "Elastic-2.0"`, `checkstack.pluginId`)
  is filled in by the scaffold; `@checkstack/scripts plugin-pack
--validate-only` accepts the rendered package.json directly. Templates
  also reformatted from one-line JSON-in-handlebars to readable
  multi-line.

  New scaffold tests in `core/scripts/src/templates.test.ts` render each
  template type and assert: dev-server validation passes, `dev` script
  present (backend/frontend), `pack` script present, `@checkstack/scripts`
  in devDependencies.

  In addition, the new `dev-internals.ts`, `dev-lifecycle.ts`,
  `dev-deps-resolver.ts`, and refactored `dev-frontend.ts` ship 58
  unit tests covering arg parsing, package.json validation, backend
  entry resolution, frontend-spawn decision, child env construction,
  the debounce watcher, the spawn → restart → shutdown lifecycle (with
  hard-kill SIGKILL fallback), the dev-auth service, and the bundle
  sibling resolver — all driven through injectable seams so no real
  process / Postgres / Vite is needed at test time.

## 0.79.0

### Minor Changes

- e7f346c: fix: suggest a `BASE_URL` value derived from the URL the user actually opened on the misconfiguration error screen, instead of always recommending `http://localhost:3000`. Makes the diagnostic actionable when the app is reached over a LAN IP, custom port, or proxied domain.

## 0.78.0

### Minor Changes

- 2a749d3: fix: run afterPluginsReady in topological order; merge daily rollups on conflict

  Two resilience fixes for the dependency chain:

  1. **Plugin loader**: Phase 3 (`afterPluginsReady`) now iterates plugins
     in the same topologically-sorted order as Phase 2 (`init`). Previously
     it iterated `pendingInits` in registration order, which raced
     subscription-spec dependencies — catalog's afterPluginsReady registers
     `catalog.system` and `catalog.group` notification targets, and emitting
     plugins (incident, maintenance, …) call `registerSubscriptionSpec`
     against those targets in their own afterPluginsReady. With registration
     order, an emitter could run before catalog and hit
     `Target type catalog.group is not registered`. Sorted order encodes
     the dependency via `spec.target.ownerPlugin`, so the emitter now
     always runs after the target owner.

  2. **Healthcheck retention job**: the daily rollup now upserts
     `health_check_aggregates` with `ON CONFLICT DO UPDATE` instead of a
     plain insert. Previously, late-arriving hourly aggregates (e.g. from
     a satellite that was offline when the prior rollup ran) would crash
     the rollup with a unique-constraint violation on
     `(configuration_id, system_id, bucket_start, bucket_size, source_id)`.
     The merge sums counts and folds min/max/p95 into the existing daily
     row.

## 0.77.0

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

## 0.76.0

### Minor Changes

- ac1e5d4: Refactor Status Timeline and Assertion charts to use Recharts with cursor-tracking tooltips, downsampling, and proportional pass/fail stacking.

  - Replaces div-based bar strips with Recharts `BarChart`, so hovering anywhere over the chart resolves the closest bucket.
  - Adds a lightweight time x-axis with smart tick formatting based on the bucket interval.
  - Caps bar count (60 for Status Timeline, 50 for Assertion) by aggregating adjacent buckets, so individual bars stay clickable on dense ranges.
  - Each downsampled Assertion bar is now stacked proportionally — green height shows passed runs and red height shows failed runs across the aggregated window, instead of a worst-case binary color.

## 0.75.0

### Minor Changes

- 42b0832: Refactor auto-chart layout to make collector grouping more dominant. Chart titles now show only the metric label (e.g. "Avg Response Time") instead of the prefixed "{collectorId}: Metric" form. Collector groups display the collector name as a heading with a badge containing the full collector id. Cards now stack at full width and their contents are center-aligned.

## 0.74.0

### Minor Changes

- 8d1ef12: Phase 2 of anomaly detection: trend drift detection.

  The background baseline analyzer now computes a linear regression slope across each field's chronologically-ordered history and runs a `detectDrift` evaluator that catches gradual "creeping degradation" never reaching the 3σ spike threshold. Drifts share the same `anomalies` table as spike anomalies via a new `kind` column (`spike` | `drift`, default `spike`); the existing suspicious → anomaly → recovered lifecycle is reused, ticking at the analyzer's hourly cadence with a default 2-run confirmation window.

  User-facing additions: a Trend Drift toggle and threshold slider on both the template and assignment anomaly settings panels (with per-field overrides), drift rows in the System Anomaly widget, dashed regression-line overlays on the auto-generated line charts, and a new `ANOMALY_TREND_DETECTED` signal for live UI updates. Plugin authors can disable drift per chartable field via `x-anomaly-drift-enabled: false` or tighten/loosen it via `x-anomaly-drift-threshold`.

## 0.73.0

### Minor Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.

## 0.72.0

### Minor Changes

- 35463ef: Improve dependency map directional clarity

  - Redesigned system nodes with a split footer bar showing directional dependency counts (`← N used by | depends N →`), making each node self-documenting
  - Color-coded connection handles: teal for incoming ("used by") and violet for outgoing ("depends on")
  - Fixed invisible edge arrows by implementing custom SVG marker definitions with impact-type-matched colors (sky for informational, amber for degraded, red for critical)
  - Updated the legend panel to explain handle colors alongside the existing impact type guide

## 0.71.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

## 0.70.0

### Minor Changes

- 9a320fe: Fixed an issue where GitOps-provisioned health checks were not added to the background execution queue immediately upon association.

## 0.69.0

### Minor Changes

- adc89a8: Fix GitOps engine skipping retry of failed entities

  - Updated the fast-path condition in the Reconciler engine to only skip reconciliation if the entity is in a `synced` state.
  - Prevents entities from remaining permanently stuck in an error state without being retried if the underlying YAML file is not modified.

## 0.68.0

### Minor Changes

- b53a40e: Fix GitOps entity update failures due to pending error records

  - Ensured the `existingEntityId` parameter in the Reconciler engine is set to `undefined` instead of a `"pending-UUID"` when handling entities that failed to sync initially.
  - Hardened the `Healthcheck` GitOps kind logic to explicitly ignore `"pending-"` IDs, preventing SQL update errors on synthetic provenance IDs.
  - Fixed a bug where resolving YAML syntax errors would cause the subsequent sync to fail with `failed query: update [...]` because it attempted to update the nonexistent `"pending-"` entity instead of creating a new one.

## 0.67.0

### Minor Changes

- 57d54de: Fix GitOps Healthcheck reconciliation engine and Kind Registry UI

  - Mandated fully qualified IDs for all healthcheck strategies and collector definitions.
  - Refactored the Kind Registry UI to display schema documentation in beautifully formatted, interactive YAML examples.
  - Entity Envelope Fields and Base Spec Schema are now displayed in collapsed accordions.
  - Fixed condition logic that broke the collector documentation display.
  - Enhanced UX by dynamically injecting fully-qualified strategy variants directly into the YAML examples.

## 0.66.0

### Minor Changes

- 889dd8c: Fix session loss for LDAP and SAML authentication strategies

  The auth bridge was joining multiple `Set-Cookie` headers into a single comma-separated string, which corrupted cookie attributes. This caused the `session_token` cookie to inherit the 5-minute `maxAge` from the `session_data` cache cookie instead of the intended 7-day expiry. After the cookie expired from the browser, `get-session` returned `null` and all API calls failed with 401.

  Changed the `createSession` RPC contract to return `setCookies: string[]` (array) instead of `setCookie: string`, and updated LDAP/SAML consumers to use `Headers.append("Set-Cookie", ...)` to set each cookie as a separate header.

## 0.65.0

### Minor Changes

- 35a91e5: Fix truncated static file responses in production container

  Hono's `c.body()` wasn't fully consuming Bun's `ReadableStream` from `file.stream()`, causing truncated responses (e.g. 129B instead of 1098B for the favicon). Switched to reading the file as `ArrayBuffer` before passing to `c.body()`, ensuring the full content is delivered.

## 0.64.0

### Minor Changes

- a713e0f: Fix static file Content-Length header stripped by Hono middleware

  Hono's CORS middleware wraps raw `Response` objects and strips Bun's auto-generated headers. Switched to using `c.body()` + `c.header()` so Content-Type and Content-Length survive the middleware pipeline. Extracted a shared `serveFile` helper for all static file routes.

## 0.63.0

### Minor Changes

- fdc9b2d: Fix vendor build output conflicting with Vite's publicDir

  The vendor build was outputting to `public/vendor/` which is inside Vite's `publicDir` (`public/`). This caused Vite to skip copying public directory contents (including `favicon.svg`) to the `dist/` folder during production builds, resulting in missing static assets in the Docker container.

  - Move vendor build output from `public/vendor/` to `dist/vendor/`
  - Set `emptyOutDir: false` on the main build to preserve the pre-built vendor bundles

## 0.62.0

### Minor Changes

- 3da7582: Fix favicon not loading in production container and add NotFound page

  - **Backend**: Fix static file serving so root-level files like `/favicon.svg` are served from the dist directory before the SPA fallback catches them
  - **UI**: Add `NotFound` component with stacked-checkmark logo, physics-inspired falling "4" animation, and low-power device fallback
  - **Frontend**: Add catch-all `*` route to display the NotFound page for unmatched routes, and add the Checkstack logo to the navbar
  - **Favicon**: Redesign with stacked checkmarks in the brand purple/indigo palette

## 0.61.0

### Minor Changes

- f8c8625: Added SVG favicon to frontend application

## 0.60.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

## 0.59.0

### Minor Changes

- bb1fea0: feat: implement active incident and maintenance overview sheets on dashboard

  - Replaces direct routing on status cards with slide-out overview sheets to gracefully degrade for users without manage permissions
  - Refactors dashboard system groups into a clean table-style list layout for better density
  - Makes global status cards more compact

## 0.58.0

### Minor Changes

- cb65e9d: ### Schema-driven secret resolution, rotation invalidation, and security hardening

  **Breaking**: Replaced `{ secretRef: "..." }` object syntax with `${{ secrets.NAME }}` template interpolation. The `secretField()`, `secretRefSchema`, `isSecretRef`, `SecretRef`, and `ResolvedSecretField` exports have been removed from `@checkstack/gitops-common`.

  **Breaking**: `ReconcileContext.resolveSecretsBySchema()` now returns `{ resolved: T; warnings: string[] }` instead of `T` directly. Plugins must destructure the result. Warnings contain messages for `${{ secrets.NAME }}` templates found in non-secret fields (fields without `x-secret` annotation).

  **New features**:

  - Secrets can be referenced in **any string field** using `${{ secrets.NAME }}` syntax
  - Inline interpolation is supported: `"postgres://user:${{ secrets.DB_PASS }}@host/db"`
  - Resolution is **schema-driven** — reuses the existing `configString({ "x-secret": true })` pattern from DynamicForm
  - Secret rotation now automatically invalidates affected entities, triggering re-reconciliation on the next sync cycle
  - New `getSecretUsage` RPC endpoint to look up which entities reference a given secret
  - Secrets UI now shows an expandable usage panel per secret showing referencing entities
  - Reconciliation warnings: templates in non-secret fields are detected and surfaced in the provenance UI
  - New `secretNameSchema` and `SECRET_NAME_REGEX` exports for validating secret names

  **Security**:

  - Secret names are validated at creation: must start with a letter, contain only `[a-zA-Z0-9_-]`, max 63 chars
  - Secrets are validated to exist at sync time but **not pre-resolved** into the spec
  - Templates in `metadata` fields are **rejected** to prevent secret leaks via display fields
  - Only fields with `x-secret` schema annotations get resolved — no escape hatch
  - Templates in non-secret fields emit warnings (stored in provenance, visible in UI) instead of silently passing

  **Migration**: Update YAML descriptors to use `${{ secrets.NAME }}` instead of `secretRef: name`. Remove `secretField()` imports from plugin schemas — use `configString({ "x-secret": true })` to annotate secret fields. Destructure `const { resolved } = await context.resolveSecretsBySchema({ value, schema })` (return type changed from `T` to `{ resolved: T; warnings: string[] }`).

## 0.57.0

### Minor Changes

- 79cf5f8: ### GitOps: Fix sync lifecycle management

  - Schedule recurring sync job immediately when creating a provider (previously required server restart)
  - Reschedule recurring job when provider's sync interval is updated
  - Cancel recurring job when provider is deleted
  - Fix manual sync trigger being silently dropped due to job ID deduplication

## 0.56.0

### Minor Changes

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

## 0.55.0

### Minor Changes

- b01078f: Added GitOps System kind extension for managing system group associations

## 0.54.0

### Minor Changes

- 4b0934d: Refactored UserMenu to use a responsive grid layout, improved menu item alignment, and implemented a full-screen scrollable portal for mobile devices. Fixed an issue where the UserMenu would instantly close and reopen when clicking the trigger while the menu was open.

## 0.53.0

### Minor Changes

- aa2b3aa: fix: remove arbitrary hardcoded assertions in jenkins collectors (queue-info, node-health, job-status) to prevent silent fallback assertion failures, instead properly threading transport execution errors directly to the SingleRunChartGrid UI display widget via a new `_collectorError` result payload property.

## 0.52.0

### Minor Changes

- 286491a: Added automatic FPS detection that enables "Low Power Mode" once for devices running below 50 FPS, ensuring smooth performance even for users unaware of the manual toggle.

## 0.51.0

### Minor Changes

- 692c717: Increased the brightness and color intensity of the AmbientBackground auroras to ensure high visibility through the 1px grid lines.

## 0.50.0

### Minor Changes

- 594eecc: Implemented a manual "Low Power Mode" toggle in the user menu, allowing users to explicitly disable expensive visual effects. This replaces the previous automatic performance diagnostics with a more predictable, user-controlled system that persists to localStorage while still respecting OS-level "Reduced Motion" settings.

## 0.49.0

### Minor Changes

- 0388000: Implemented a global performance-aware UI infrastructure that detects hardware capabilities (using heuristics and frame-budget benchmarks) to automatically disable expensive CSS animations, backdrop-blurs, and glassmorphism effects on low-power or non-hardware-accelerated devices.

## 0.48.0

### Minor Changes

- 765b764: Optimize AmbientBackground performance by replacing thousand-div grid with a single-element CSS mask and hardware-accelerated Aurora Mesh animations.

## 0.47.0

### Minor Changes

- 53a64c1: Fix Docker build by whitelisting LICENSE.md in .dockerignore

## 0.46.0

### Minor Changes

- e111f4a: Update license to Elastic License with revised terms (copyright 2026). The license is now bundled inside both the main and satellite container images.

## 0.45.0

### Minor Changes

- 26d8bae: Distributed satellite health checks and Assignment IDE page

  **Satellite System**

  - New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
  - WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
  - Satellite management UI with create dialog, status badges, and list page

  **Live Configuration Updates**

  - Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
  - `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

  **Assignment IDE Page**

  - Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
  - New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
  - Added unassign capability and sorted assignment lists for stable ordering

  **Shared IDE Primitives**

  - Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
  - Migrated existing health check IDE editor to use shared primitives

  **Infrastructure**

  - Added `Dockerfile.satellite` for containerized satellite deployment
  - WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`

## 0.44.0

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

## 0.43.0

### Minor Changes

- 81f141a: Enable TypeScript incremental compilation for faster typecheck runs

## 0.42.0

### Minor Changes

- 54a5f80: ### Health Check Editor Redesign — IDE-Style Experience

  Replaces the modal-based health check editor with a full-page, IDE-style experience:

  - **Strategy Picker Page**: New `/config/create` page with categorized strategy discovery, search filtering, and grouped card grid layout
  - **IDE Editor Page**: New `/config/:configId/edit` page with a split-view layout — explorer tree on the left, editor panel on the right
  - **Strategy Categories**: Introduces `StrategyCategory` enum with 16 categories (Networking, Database, Infrastructure, etc.) — all 13 strategy plugins now declare their category
  - **New RPC Endpoint**: Added `getConfiguration` (singular by ID) for efficient single-resource fetching on the edit page
  - **Explorer Tree**: Left-hand navigation with General, Check Items (collectors), and Access Control sections, with real-time validation indicators
  - **Validation Status Bar**: Bottom bar showing aggregated validation issues with clickable navigation
  - **Unsaved Changes Guard**: Browser `beforeunload` protection when the form is dirty
  - **Responsive Design**: Split-view on desktop, stacked layout on mobile
  - **Deleted**: Legacy `HealthCheckEditor.tsx` modal component

## 0.41.0

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

## 0.40.0

### Minor Changes

- dee86ec: feat: add portal announcement system

  Introduces a complete announcement system for communicating with portal users:

  - **announcement-common**: Zod schemas for announcements (severity, visibility, display mode), oRPC contract with 6 procedures (public retrieval, user dismissal, admin CRUD), access rules, and `ANNOUNCEMENT_UPDATED` signal definition
  - **announcement-backend**: Drizzle schema with `announcements` and `announcement_dismissals` tables, router with temporal filtering, visibility control, per-user dismissal persistence, user cleanup hook, real-time signal broadcasting on create/update/delete, and command palette registration ("Create Announcement", "Manage Announcements" with `⇧⌘A` shortcut)
  - **announcement-frontend**: Admin management page with create/edit dialog, global banner component above the navbar (severity-colored, expandable markdown), dashboard cards with compact expand/collapse, admin menu link, and real-time WebSocket signal subscription for instant UI updates
  - **frontend**: Integrates AnnouncementBanner into App.tsx for global visibility

## 0.39.0

### Minor Changes

- 23c80bc: ### Jira Data Center Support

  Added support for on-premise Jira Data Center installations alongside existing Jira Cloud support:

  - **Authentication mode switching**: New `authMode` field (`cloud` | `datacenter`) on connection configuration. Cloud uses Basic Auth (email + API token), Data Center uses Bearer Auth (Personal Access Token).
  - **API version routing**: Automatically selects REST API v3 for Cloud and v2 for Data Center.
  - **Description format**: Cloud uses Atlassian Document Format (ADF), Data Center uses plain text.
  - **Connection schema v2**: Backward-compatible — defaults to `cloud` mode for existing connections.

  ### DynamicForm `x-hidden-when` Conditional Visibility

  New generic platform feature for conditionally hiding form fields based on sibling field values:

  - Added `x-hidden-when` metadata extension to `ConfigMeta` and `JsonSchemaProperty`.
  - DynamicForm automatically hides fields and skips their validation when conditions match.
  - Used by Jira integration to hide the email field when `authMode` is `datacenter`.

## 0.38.0

### Minor Changes

- e01945b: Reduce excessive /api/auth/get-session requests

  - Enable better-auth's `cookieCache` on the server (5-minute TTL) so repeated session
    checks verify a signed cookie instead of querying the database. Compatible with
    horizontal scaling since validation uses the shared `BETTER_AUTH_SECRET`.

  - Introduce a `SessionProvider` React context that fetches the session exactly once
    at the top of the component tree. All 7+ components that previously called
    `useSession()` independently now read from this shared context — eliminating
    duplicate HTTP requests on every page load.

  - Remove the `useAuthClient()` hook which created per-component better-auth client
    instances via `useMemo`, causing separate nanostore atoms and independent fetches.
    All imperative usages (signIn, signUp, resetPassword, etc.) now use the singleton
    `getAuthClientLazy()` instead.

## 0.37.0

### Minor Changes

- 95aa716: Fix LDAP CA certificate input: The custom CA certificate field was rendered as a single-line password input, which stripped newlines from PEM certificates and caused TLS connection failures ("Failed to connect"). The field now renders as a multi-line secret textarea that properly preserves PEM format while still encrypting the value in storage.

## 0.36.0

### Minor Changes

- c0c0ed2: Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.

## 0.35.0

### Minor Changes

- 6c743d4: Resolve AJV version mismatch and update to 8.18.0 for security reasons. Also fixed a TypeScript error in the HealthCheck latency chart caused by the Recharts v3 API change.

## 0.34.0

### Minor Changes

- eb353a4: Fix TypeError in better-auth initialization when LDAP or SAML strategies are enabled. Non-social strategies are now correctly filtered out from the socialProviders configuration, and standard social providers (GitHub) are correctly initialized using their respective factory functions.

## 0.33.0

### Minor Changes

- 0603d39: Fix onboarding flow not appearing on fresh Docker deployments (issue #79)

  The `.env.example` had `BASE_URL` defaulting to `http://localhost:5173`
  (the Vite dev server port). Users copying this file verbatim for a Docker
  deployment would get a frontend that silently made all API calls to the
  wrong origin, causing empty state and extreme sluggishness.

  **Changes:**

  - `.env.example`: Adds clear comments explaining the value must match the
    container's exposed port.
  - `frontend-api` (`RuntimeConfigProvider`): Removes the silent fallback when
    `/api/config` returns an unreachable baseUrl — instead propagates the error
    so it can be surfaced.
  - `frontend` (`App.tsx`): Renders an actionable error screen when the backend
    config cannot be loaded, showing the exact `BASE_URL` fix and the
    `docker compose` command to recover.
  - `docs/getting-started/docker.md`: Adds a dedicated troubleshooting section
    for this exact misconfiguration.

## 0.32.0

### Minor Changes

- a340781: Improve accessibility of SubscribeButton component by adding appropriate ARIA labels and attributes.

## 0.31.0

### Minor Changes

- 869b4ab: ## Health Check Execution Improvements

  ### Breaking Changes (backend-api)

  - `HealthCheckStrategy.createClient()` now accepts `unknown` instead of `TConfig` due to TypeScript contravariance constraints. Implementations should use `this.config.validate(config)` to narrow the type.

  ### Features

  - **Platform-level hard timeout**: The executor now wraps the entire health check execution (connection + all collectors) in a single timeout, ensuring checks never hang indefinitely.
  - **Parallel collector execution**: Collectors now run in parallel using `Promise.allSettled()`, improving performance while ensuring all collectors complete regardless of individual failures.
  - **Base strategy config schema**: All strategy configs now extend `baseStrategyConfigSchema` which provides a standardized `timeout` field with sensible defaults (30s, min 100ms).

  ### Fixes

  - Fixed HTTP and Jenkins strategies clearing timeouts before reading the full response body.
  - Simplified registry type signatures by using default type parameters.

## 0.30.0

### Minor Changes

- 3dd1914: Migrate health check strategies to VersionedAggregated with \_type discriminator

  All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

  **Key changes:**

  - **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
  - The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
  - Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
  - `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
  - `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
  - Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

  **Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

## 0.29.0

### Minor Changes

- f676e11: Improve subscription creation UX by requiring event selection before showing provider configuration

  The provider configuration section now waits for an event to be selected before rendering, preventing template validation errors when no payload properties are available yet.

## 0.28.0

### Minor Changes

- f1ebac2: - Fixed raw data visualization being cut off when viewing "Last 24 hours" timeframe. The `useHealthCheckData` hook was incorrectly applying pagination limits to chart data queries, causing only the oldest runs to be displayed when there were more runs than the limit. Charts now fetch all runs within the selected date range.
  - Updated Status Timeline visualization for raw data to show stacked status distribution (green/yellow/red proportions) instead of the previous "worst status wins" approach. This makes the raw data view consistent with the aggregated data view.

## 0.27.0

### Minor Changes

- f8ce585: Improved RPC error logging to include full stack traces for procedure errors. Previously, errors inside RPC handlers (such as database table not found errors) resulted in silent 500 responses. Now these errors are logged with detailed information to the backend console for easier debugging.

## 0.26.0

### Minor Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

## 0.25.0

### Minor Changes

- d6f7449: Add availability statistics display to HealthCheckSystemOverview

  - New `getAvailabilityStats` RPC endpoint that calculates availability percentages for 31-day and 365-day periods
  - Availability is calculated as `(healthyRuns / totalRuns) * 100`
  - Data is sourced from both daily aggregates and recent raw runs to include the most up-to-date information
  - Frontend displays availability stats with color-coded badges (green ≥99.9%, yellow ≥99%, red <99%)
  - Shows total run counts for each period

## 0.24.0

### Minor Changes

- e58e994: Fix runtime error in AutoChartGrid when mapping over values with undefined elements

  The filter functions `getAllBooleanValuesWithTime` and `getAllStringValuesWithTime` incorrectly checked `v !== null` instead of `v !== undefined`, allowing undefined elements to pass through and crash when accessing `.value`.

## 0.23.0

### Minor Changes

- dd16be7: Fix plugin schema isolation: create schema before migrations run

  Previously, schemas were only created when `coreServices.database` was resolved (after migrations), causing tables to be created in the `public` schema instead of plugin-specific schemas. Now schemas are created immediately before migrations run.

  Also removed the `public` fallback from migration search_path to make errors more visible if schema creation fails.

## 0.22.0

### Minor Changes

- deec10c: Fix production crash when opening health check accordion and enable sourcemaps

  - Fixed TypeError in `HealthCheckLatencyChart` where recharts Tooltip content function was returning `undefined` instead of `null`, causing "can't access property 'value', o is undefined" error
  - Enabled production sourcemaps in Vite config for better debugging of production errors

## 0.21.0

### Minor Changes

- 1f81b60: ### Clickable Run History with Deep Linking

  **Backend (`healthcheck-backend`):**

  - Added `getRunById` service method to fetch a single health check run by ID

  **Schema (`healthcheck-common`):**

  - Added `getRunById` RPC procedure for fetching individual runs
  - Added `historyRun` route for deep linking to specific runs (`/history/:systemId/:configurationId/:runId`)

  **Frontend (`healthcheck-frontend`):**

  - Table rows in Recent Runs and Run History now navigate to detailed view instead of expanding inline
  - Added "Selected Run" card that displays when navigating to a specific run
  - Extracted `ExpandedResultView` into reusable component
  - Fixed layout shift during table pagination by preserving previous data while loading
  - Removed accordion expansion in favor of consistent navigation UX

## 0.20.0

### Minor Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

## 0.19.0

### Minor Changes

- db1f56f: Add ephemeral field stripping to reduce database storage for health checks

  - Added `x-ephemeral` metadata flag to `HealthResultMeta` for marking fields that should not be persisted
  - All health result factory functions (`healthResultString`, `healthResultNumber`, `healthResultBoolean`, `healthResultArray`, `healthResultJSONPath`) now accept `x-ephemeral`
  - Added `stripEphemeralFields()` utility to remove ephemeral fields before database storage
  - Integrated ephemeral field stripping into `queue-executor.ts` for all collector results
  - HTTP Request collector now explicitly marks `body` as ephemeral

  This significantly reduces database storage for health checks with large response bodies, while still allowing assertions to run against the full response at execution time.

## 0.18.0

### Minor Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

## 0.17.0

### Minor Changes

- 8a87cd4: Fixed query retry behavior for 401/403 errors

  API calls that return 401 (Unauthorized) or 403 (Forbidden) errors are no longer retried, as these are definitive auth responses that won't succeed on retry. This prevents unnecessary loading states and network requests.

## 0.16.0

### Minor Changes

- 18fa8e3: Add notification suppression toggle for maintenance windows

  **New Feature:** When creating or editing a maintenance window, you can now enable "Suppress health notifications" to prevent health status change notifications from being sent for affected systems while the maintenance is active (in_progress status). This is useful for planned downtime where health alerts are expected and would otherwise create noise.

  **Changes:**

  - Added `suppressNotifications` field to maintenance schema
  - Added new service-to-service API `hasActiveMaintenanceWithSuppression`
  - Healthcheck queue executor now checks for suppression before sending notifications
  - MaintenanceEditor UI includes new toggle checkbox

  **Bug Fix:** Fixed migration system to correctly set PostgreSQL search_path when running plugin migrations. Previously, migrations could fail with "relation does not exist" errors because the schema context wasn't properly set.

## 0.15.0

### Minor Changes

- 83557c7: ## Multi-Type Editor Support for Webhooks

  - Updated webhook provider to use new multi-type editor field for body templates

## 0.14.0

### Minor Changes

- d94121b: Add group-to-role mapping for SAML and LDAP authentication

  **Features:**

  - SAML and LDAP users can now be automatically assigned Checkstack roles based on their directory group memberships
  - Configure group mappings in the authentication strategy settings with dynamic role dropdowns
  - Managed role sync: roles configured in mappings are fully synchronized (added when user gains group, removed when user leaves group)
  - Unmanaged roles (manually assigned, not in any mapping) are preserved during sync
  - Optional default role for all users from a directory

  **Bug Fix:**

  - Fixed `x-options-resolver` not working for fields inside arrays with `.default([])` in DynamicForm schemas

## 0.13.0

### Minor Changes

- cf5f245: Added Gotify notification provider for self-hosted push notifications. Features include priority mapping (info→5, warning→7, critical→10), action URL extras, and configurable server URL.

## 0.12.0

### Minor Changes

- cad3073: Fixed notification group subscription for catalog groups:
  - Fixed group ID format using colon separator instead of dots and missing entity type prefix
  - Fixed subscription button state not updating after subscribe/unsubscribe by using refetch instead of invalidateQueries

## 0.11.0

### Minor Changes

- f6464a2: Fix theme toggle showing incorrect state when system theme is used

  - Added `resolvedTheme` property to `ThemeProvider` that returns the actual computed theme ("light" or "dark"), resolving "system" to the user's OS preference
  - Updated `NavbarThemeToggle` and `ThemeToggleMenuItem` to use `resolvedTheme` instead of `theme` for determining toggle state
  - Changed default theme from "light" to "system" so non-logged-in users respect their OS color scheme preference

## 0.10.0

### Minor Changes

- dd07c14: Fix collector add button failing in HTTP contexts by replacing `crypto.randomUUID()` with the `uuid` package

## 0.9.0

### Minor Changes

- df6ac7b: Added onboarding flow and user profile

## 0.8.0

### Minor Changes

- 4eed42d: Fix "No QueryClient set" error in containerized builds

  **Problem**: The containerized application was throwing "No QueryClient set, use QueryClientProvider to set one" errors during plugin registration. This didn't happen in dev mode.

  **Root Cause**: The `@tanstack/react-query` package was being bundled separately in different workspace packages, causing multiple React Query contexts. The `QueryClientProvider` from the main app wasn't visible to plugin code due to this module duplication.

  **Changes**:

  - `@checkstack/frontend-api`: Export `useQueryClient` from the centralized React Query import, ensuring all packages use the same context
  - `@checkstack/dashboard-frontend`: Import `useQueryClient` from `@checkstack/frontend-api` instead of directly from `@tanstack/react-query`, and remove the direct dependency
  - `@checkstack/frontend`: Add `@tanstack/react-query` to Vite's `resolve.dedupe` as a safety net

## 0.7.0

### Minor Changes

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

## 0.6.0

### Minor Changes

- 9a27800: Changed recurring job scheduling from completion-based to wall-clock scheduling.

  **Breaking Change:** Recurring jobs now run on a fixed interval (like BullMQ) regardless of whether the previous job has completed. If a job takes longer than `intervalSeconds`, multiple jobs may run concurrently.

  **Improvements:**

  - Fixed job ID collision bug when rescheduling within the same millisecond
  - Configuration updates via `scheduleRecurring()` now properly cancel old intervals before starting new ones
  - Added `heartbeatIntervalMs` to config for resilient job recovery after system sleep

## 0.5.0

### Minor Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

## 0.4.0

### Minor Changes

- 97c5a6b: Fixed DOM clobbering issue in DynamicForm by prefixing field IDs with 'field-'. Previously, schema fields with names matching native DOM properties (like 'nodeName', 'tagName', 'innerHTML') could shadow those properties, causing floating-ui and React to crash during DOM traversal.

## 0.3.0

### Minor Changes

- f5b1f49: Updated frontend URL environment variable from `VITE_FRONTEND_URL` to `BASE_URL` for consistency.

## 0.2.0

### Minor Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

## 0.1.0

### Minor Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
