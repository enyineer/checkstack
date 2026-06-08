# @checkstack/ai-frontend

## 0.2.0

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

- 4134ed9: Show live thinking progress in the AI chat so a slow turn is distinguishable
  from a stuck one. The streaming indicator now reports a server-driven step
  heartbeat ("Working... (step 3)") that advances each agent round, and tool
  activity lines read as friendly verb phrases ("Searching documentation",
  "Reading health-check history") instead of raw tool ids. Both are derived from
  stream events the SDK already sends, so there is no backend or protocol change.

### Patch Changes

- Updated dependencies [4134ed9]
- Updated dependencies [6005271]
  - @checkstack/ai-common@0.4.0
  - @checkstack/ui@1.16.0
  - @checkstack/catalog-common@2.3.6

## 0.1.8

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/integration-common@0.9.0
  - @checkstack/ai-common@0.3.0

## 0.1.7

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/ai-common@0.2.0
  - @checkstack/integration-common@0.8.0

## 0.1.6

### Patch Changes

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/ai-common@0.1.3
  - @checkstack/integration-common@0.7.3

## 0.1.5

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

## 0.1.4

### Patch Changes

- 9d8961c: Fix the double-scrolling on the AI chat page (`/ai/chat`). The page sized its
  layout with a fixed `calc(100vh - 220px)` height, which overshot the available
  space when the page subtitle wrapped to two lines - so the whole page scrolled
  on top of the message list's own scroll.

  `PageLayout` gains an opt-in `fillHeight` prop that fills the viewport via a
  bounded flex height chain (established in the app shell) instead of viewport
  math; the chat page uses it so only the message list scrolls and the page itself
  never does. Normal document-flow pages are unaffected (they still scroll the
  main area as before).

- fb705df: Upgrade React 18 to React 19 across the platform.

  **BREAKING (runtime frontend plugins):** React is shared as a Module Federation
  singleton, so the host now provides **React 19** to every runtime plugin.
  Frontend plugins built against React 18 must be rebuilt against React 19
  (`react` / `react-dom` `^19`). The scaffold templates and the host/plugin MF
  `requiredVersion` are updated to `^19`. `react` (and now `react-dom`) are pinned
  to a single version across the workspace via syncpack so the singleton can never
  skew (react and react-dom must match exactly).

  The React 19 removed-API surface was audited - the codebase used only no-arg
  `useRef()` (now `useRef<T | undefined>(undefined)`); no `ReactDOM.render`,
  legacy context, string refs, or function-component `defaultProps`. This also
  clears the `IMPORT_IS_UNDEFINED` build warnings for `React.use` /
  `React.useOptimistic` (react-router 7 feature-detection), which React 19 exports.

  The downstream `*-frontend` packages (and `@checkstack/infrastructure-common`)
  receive only the mechanical `react` dependency bump (`patch`); the framework
  packages carrying the shared-singleton change are bumped `minor`.

- Updated dependencies [9d8961c]
- Updated dependencies [fb705df]
  - @checkstack/ui@1.15.0
  - @checkstack/frontend-api@0.8.0
  - @checkstack/ai-common@0.1.2
  - @checkstack/common@0.14.1
  - @checkstack/integration-common@0.7.2

## 0.1.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/ai-common@0.1.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/integration-common@0.7.2

## 0.1.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-common@0.1.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/ui@1.13.2

## 0.1.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/ai-common@0.1.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/integration-common@0.7.1
  - @checkstack/ui@1.13.1

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

### Patch Changes

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

  This is a beta minor.

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
  - @checkstack/ui@1.13.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/integration-common@0.7.0
