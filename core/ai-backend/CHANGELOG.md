# @checkstack/ai-backend

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
