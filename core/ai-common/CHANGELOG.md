# @checkstack/ai-common

## 0.6.3

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0

## 0.6.2

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0

## 0.6.1

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

  - @checkstack/common@0.17.0

## 0.6.0

### Minor Changes

- 8cad340: Improve AI chat/agent steering, MCP conformance, doc grounding, and provider seams.

  - Tool feedback self-correction: a validation failure or duplicate tool call now surfaces as a thrown tool error (a distinct AI-SDK `tool-error` result part) instead of an ordinary success value, so the model is told the call failed and retries. Confirm cards remain success results and carry a structured `status: "awaiting_operator"`. The headless agent runner surfaces tool failures the same way instead of returning `{ error }` as data.
  - System prompts are now sectioned (clear `##` headings, blank-line separation) with the safety-critical access-scope and investigation rules near the top. The ~600-token automation-building playbook is no longer always-on: it loads only when an automation tool is in scope (or via the `automation-author` skill). Headless author overrides are wrapped in an `<author_instructions>` delimiter.
  - Model-family seam: connections may declare `modelFamily` (`anthropic` | `openai` | `generic`, default `generic`). The transport stays `@ai-sdk/openai-compatible` for every value; capable families get a lighter-touch prompt-calibration note. Per-turn volatile preambles (memory/skill/summary) now follow the stable base prompt for prompt-cache friendliness on caching-capable gateways.
  - MCP Streamable-HTTP conformance (spec `2025-06-18`): `tools/list` advertises `outputSchema` and `tools/call` returns `structuredContent` for tools that declare an output; `Mcp-Session-Id` is required and validated on post-initialize requests; the negotiated `protocolVersion` is echoed; cross-site `Origin` requests are refused.
  - Doc grounding relevance is now a corpus-size-stable relative signal (top-hit gap to the runner-up) instead of an absolute BM25 threshold. The per-read result clamp budget derives from the connection's `contextWindowTokens` instead of a hardcoded constant.
  - The topical pre-classifier round-trip can be disabled per connection (`disableTopicalClassifier`); the in-prompt off-topic decline then carries it.
  - Steering de-duplication: the "when to call this / pass a UUID, not a name" trigger guidance now lives only in the tool `description` (where it travels with the tool), and the chat system prompt's investigation section keeps only cross-tool strategy and the universal id-discipline rule, so the two can no longer drift.
  - Tool descriptions are now stable across permission modes: the per-mode note ("(auto-applied...)", "(requires human confirmation...)") is no longer appended to a tool's `description` at wire time. The conversation's mode is conveyed once by the system prompt's permission-mode line, keeping tool identity decoupled from conversation state.

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0

## 0.5.0

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

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/common@0.16.0

## 0.4.0

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

## 0.3.0

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

## 0.2.0

### Minor Changes

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

## 0.1.3

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
  - @checkstack/common@0.15.0

## 0.1.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1

## 0.1.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0

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

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/common@0.13.0
