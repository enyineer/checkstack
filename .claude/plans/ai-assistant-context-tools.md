# AI assistant — context-retrieval & test tools, documentation grounding, and an approve/auto permission mode

> **Status:** planned (design locked 2026-06-03, not started)
> **Branch:** TBD (off the integration/all-features worktree, HEAD `eccdc335`)
> **Original ask:** the chat assistant (`core/ai-backend`) today has only
> projected read-only tools + the curated `automation.propose` composite tool.
> It cannot (1) retrieve a script's available SDK symbols/imports, (2) test a
> drafted script, (3) enumerate the triggers/actions/kinds/strategies for a
> target context, or (4) ground a how-to/conceptual answer in the platform's own
> documentation. So when a user asks "create a script health check that probes
> `https://foo.bar/status`", the model guesses the API, can't validate it, and
> can't cite the real docs. This plan adds the four context tools + a
> Claude-Code-style approve/auto permission mode.

Self-contained handoff. Pick up from this document alone. Every current-state
claim carries a `file:line` anchor against the integration worktree (HEAD
`eccdc335`). The rigor exemplars this plan matches are
[`.claude/plans/ai-platform.md`](./ai-platform.md),
[`.claude/plans/reactive-automation-engine.md`](./reactive-automation-engine.md),
and [`.claude/plans/automation-platform.md`](./automation-platform.md).

---

## 1. Context, goals, and the gap

### 1.1 What exists today (verified)

The AI platform from [`ai-platform.md`](./ai-platform.md) is **already built and
landed** in this worktree. The relevant surface:

- **One tool registry, two transports.** `AiToolRegistry`
  ([core/ai-backend/src/tool-registry.ts:21](../../core/ai-backend/src/tool-registry.ts#L21))
  holds `RegisteredAiTool` descriptors. Tools enter through exactly two extension
  points ([core/ai-backend/src/extension-points.ts:20](../../core/ai-backend/src/extension-points.ts#L20),
  [:38](../../core/ai-backend/src/extension-points.ts#L38)):
  - `aiToolExtensionPoint` — hand-authored composite tools
    (`registerTool(tool, pluginMetadata)`), name auto-qualified at
    [registry-wiring.ts:31](../../core/ai-backend/src/registry-wiring.ts#L31).
  - `aiToolProjectionExtensionPoint` — opt-in projection of an oRPC procedure
    (`expose(ProjectToolInput)`), built by `buildProjectedTool`
    ([registry-wiring.ts:40](../../core/ai-backend/src/registry-wiring.ts#L40)).
- **The tool descriptor** `AiTool<TInput, TOutput, TPrincipal>`
  ([core/ai-common/src/tool.ts:43](../../core/ai-common/src/tool.ts#L43)) declares
  `effect: "read" | "mutate" | "destructive"`
  ([:14](../../core/ai-common/src/tool.ts#L14)), `requiredAccessRules: string[]`,
  an optional `dryRun`, and `execute`. The serialized wire view is
  `AiToolDescriptorSchema` ([:85](../../core/ai-common/src/tool.ts#L85)).
- **Read-only projected tools** today: exactly three, built by
  `buildReadOnlyProjections()`
  ([core/ai-backend/src/tools/read-only-tools.ts:46](../../core/ai-backend/src/tools/read-only-tools.ts#L46)):
  `incident.list`, `healthcheck.status`, `anomaly.explain`.
- **The flagship composite tool** `automation.propose`
  ([core/ai-backend/src/tools/automation-propose.ts:62](../../core/ai-backend/src/tools/automation-propose.ts#L62)):
  `effect: "mutate"`, `requiredAccessRules: [automation.automation.manage]`, a
  `dryRun` that calls `validateDefinition` then renders YAML, and an `execute`
  that creates the automation. It routes through the propose/apply gate.
- **Resolver** `createAiToolResolver`
  ([core/ai-backend/src/resolver.ts:65](../../core/ai-backend/src/resolver.ts#L65)):
  `resolveTools(principal)` filters by `requiredAccessRules` with the `"*"` admin
  escape; `isAllowed` is the same predicate ([:50](../../core/ai-backend/src/resolver.ts#L50)).
- **Chat agent loop** `createChatService`
  ([core/ai-backend/src/chat/chat-service.ts:289](../../core/ai-backend/src/chat/chat-service.ts#L289)),
  Vercel AI SDK `streamText`, `MAX_STEPS = 8` ([:197](../../core/ai-backend/src/chat/chat-service.ts#L197)).
  Tool dispositions are baked per effect by `buildAgentSdkTools`
  ([core/ai-backend/src/chat/sdk-tools.ts:52](../../core/ai-backend/src/chat/sdk-tools.ts#L52)):
  **read** tools auto-run via `runRead`; **mutate/destructive** tools call
  `propose` and return a `ConfirmCardResult`
  ([sdk-tools.ts:10](../../core/ai-backend/src/chat/sdk-tools.ts#L10)) — they never
  commit inline. The tool callbacks (budget + audit + propose) are built by the
  pure `buildChatToolCallbacks`
  ([chat-service.ts:210](../../core/ai-backend/src/chat/chat-service.ts#L210)).
- **Propose/apply** `createProposeApplyService`
  ([core/ai-backend/src/propose-apply/service.ts:110](../../core/ai-backend/src/propose-apply/service.ts#L110)):
  two-step token flow. `propose` re-checks `isAllowed`, runs `dryRun`, persists a
  `proposed` row, returns `propose:<rowId>.<nonce>`. `apply` re-checks `isAllowed`
  ([:245](../../core/ai-backend/src/propose-apply/service.ts#L245)), atomically
  consumes ([:253](../../core/ai-backend/src/propose-apply/service.ts#L253)), and
  executes the **server-stored** payload. RPC surface `proposeTool`/`applyTool`
  ([core/ai-common/src/rpc-contract.ts:82](../../core/ai-common/src/rpc-contract.ts#L82),
  [:99](../../core/ai-common/src/rpc-contract.ts#L99)), wired in the router at
  [core/ai-backend/src/router.ts:140](../../core/ai-backend/src/router.ts#L140).
- **Frontend** `ChatPage`
  ([core/ai-frontend/src/pages/ChatPage.tsx:72](../../core/ai-frontend/src/pages/ChatPage.tsx#L72))
  and the `ConfirmCardView` Apply/Decline card
  ([core/ai-frontend/src/components/ConfirmCardView.tsx:21](../../core/ai-frontend/src/components/ConfirmCardView.tsx#L21))
  that consumes `applyTool` ([:28](../../core/ai-frontend/src/components/ConfirmCardView.tsx#L28)).
- **System prompt** ([chat-service.ts:185](../../core/ai-backend/src/chat/chat-service.ts#L185))
  tells the model to only operate Checkstack and to use a confirm-card tool for
  any change. The model has no way to ground how-to answers — it can only read
  live data, which is why it answers "how do I create a health check?" with
  plausible-but-wrong guesses and admits "I can only read existing configs".

### 1.2 The gap

| Ask | Today | Gap |
| --- | --- | --- |
| SDK symbols for a script | none | model guesses `defineHealthCheck` / context shape |
| Test a drafted script | none in chat | sandbox runners + test RPCs exist but are not tools |
| Enumerate triggers/actions/strategies/collectors | none in chat | registries exist + power UI pickers, but not surfaced |
| Ground how-to answers in docs | none | authored Starlight markdown is not reachable at runtime |
| Approve vs Auto permission mode | implicit-always-confirm for mutate | no first-class mode; reads always auto-run |

### 1.3 The reusable substrate (the point of this plan)

Every capability we need already has a backend home; this plan **surfaces** them
as tools and **does not** re-implement them:

- **SDK symbols per context** = the generated editor bundle
  `SDK_EDITOR_BUNDLE_DTS`
  ([core/sdk/src/editor-bundle.ts:11](../../core/sdk/src/editor-bundle.ts#L11)),
  served to Monaco by `createSdkTypesHttpHandler`
  ([core/script-packages-backend/src/sdk-types-route.ts:73](../../core/script-packages-backend/src/sdk-types-route.ts#L73)).
- **Test a script** = `runCollectorScriptTest`
  ([core/healthcheck-backend/src/collector-script-test.ts:175](../../core/healthcheck-backend/src/collector-script-test.ts#L175))
  and automation's `runScriptTest` (RPC `testScript`,
  [core/automation-backend/src/router.ts:536](../../core/automation-backend/src/router.ts#L536)),
  both driving the fail-closed global sandbox runners
  (`defaultEsmScriptRunner` / `defaultShellScriptRunner`,
  [core/backend-api/src/esm-script-runner.ts:150](../../core/backend-api/src/esm-script-runner.ts#L150)).
- **Capability catalogs** = the registry-introspection RPCs:
  `healthCheckContract.getStrategies` / `getCollectors`
  ([core/healthcheck-common/src/rpc-contract.ts:125](../../core/healthcheck-common/src/rpc-contract.ts#L125),
  [:131](../../core/healthcheck-common/src/rpc-contract.ts#L131)) and
  `automationContract.listTriggers` / `listActions` / `listArtifactTypes`
  ([core/automation-common/src/rpc-contract.ts:167](../../core/automation-common/src/rpc-contract.ts#L167)).
- **Docs** = the authored Starlight markdown under
  [docs/src/content/docs/](../../docs/src/content/docs/) (124 `.md/.mdx` files,
  including a `developer-guide/ai/` section).

---

## 2. Tool contracts

> **New package boundary.** All new zod schemas + the context taxonomy enum live
> in `core/ai-common` (a new `src/context-tools.ts` + `src/permission.ts`,
> re-exported from `index.ts`). The tool builders + RPC handlers live in
> `core/ai-backend`. The docs index source lives generated under `core/ai-backend`
> (§3.4). New `@checkstack/*` dep edges (ai-backend → script-packages-backend,
> healthcheck-common, automation-common, sdk) require
> `bun run typecheck:references:generate` + committed tsconfig changes
> ([.claude/rules/typecheck.md](../rules/typecheck.md)).

### 2.1 The context taxonomy enum

The script-context taxonomy distinguishes WHERE a script lives, because the
available SDK symbols differ per context. Verified contexts:

- `healthcheck-script`: an inline TypeScript health-check collector. Helper
  module `@checkstack/sdk/healthcheck`, helper `defineHealthCheck`, runtime
  context `HealthCheckScriptContext` (`{ config, check, system }`). Confirmed at
  [collector-script-test.ts:248](../../core/healthcheck-backend/src/collector-script-test.ts#L248)
  and in the bundle DTS ([editor-bundle.ts:11](../../core/sdk/src/editor-bundle.ts#L11)).
- `automation-action-script`: a `run_script` automation action. Helper module
  `@checkstack/sdk/integration`, helper `defineIntegration`, runtime context
  `IntegrationScriptContext` (`{ event, subscription }`). Confirmed at
  [core/automation-backend/src/script-test.ts:233](../../core/automation-backend/src/script-test.ts#L233).
- `automation-action-shell` / `healthcheck-shell`: shell collectors/actions. No
  SDK module (no `defineX`); the "symbols" are the `CHECKSTACK_*` env vars the
  runner injects (`buildShellRunContextEnv`,
  [collector-script-test.ts:124](../../core/healthcheck-backend/src/collector-script-test.ts#L124),
  and automation's `script-test-shell-env.ts`).

> **Recommendation (RESOLVED, §8 OQ-1):** ship the two TypeScript contexts
> (`healthcheck-script`, `automation-action-script`) in Phase 1/2 and the two
> shell contexts as a thin follow-on within the same phases (they reuse the same
> tools with `language: "shell"`). The enum carries all four from day one so the
> wire contract never has to widen.

```ts
// core/ai-common/src/context-tools.ts (NEW)
import { z } from "zod";

/** WHERE a script lives. Available SDK symbols + test runner differ per value. */
export const ScriptContextKindSchema = z.enum([
  "healthcheck-script",      // inline TS health-check collector
  "healthcheck-shell",       // shell health-check collector
  "automation-action-script",// run_script automation action (TS)
  "automation-action-shell", // run_shell automation action
]);
export type ScriptContextKind = z.infer<typeof ScriptContextKindSchema>;

/** WHICH catalog the model wants. */
export const CapabilityContextKindSchema = z.enum([
  "healthcheck",  // strategies + collectors
  "automation",   // triggers + actions + artifact types
]);
export type CapabilityContextKind = z.infer<typeof CapabilityContextKindSchema>;
```

### 2.2 `ai.getScriptContext` — SDK symbols / imports / type signatures

Registered via **`aiToolExtensionPoint`** (a hand-authored composite tool, NOT a
projection — it has no single source procedure). `effect: "read"`.

```ts
export const GetScriptContextInputSchema = z.object({
  context: ScriptContextKindSchema,
});

export const GetScriptContextOutputSchema = z.object({
  context: ScriptContextKindSchema,
  /** Editor language for this context: "typescript" | "shell". */
  language: z.enum(["typescript", "shell"]),
  /** The SDK module the script imports from (TS contexts only). */
  sdkModule: z.string().optional(),          // "@checkstack/sdk/healthcheck"
  /** The define-helper name (TS contexts only). */
  helper: z.string().optional(),             // "defineHealthCheck"
  /**
   * The relevant `.d.ts` declarations for THIS context, extracted from the
   * generated SDK editor bundle — the SAME types Monaco mounts. For a TS
   * context this is the context's `declare module` block plus the result/
   * context interfaces; for a shell context it is the list of injected
   * CHECKSTACK_* env vars with descriptions.
   */
  declarations: z.string(),
  /** Injected shell env vars (shell contexts only). */
  shellEnv: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .optional(),
  /** A minimal runnable starter the model can adapt. */
  starterExample: z.string(),
  /** Whether managed npm packages are importable in this context. */
  allowsManagedPackages: z.boolean(),
});
```

Source for `declarations`: §3.1. The tool's `requiredAccessRules` mirror the
matching authoring rule so it surfaces only to a principal who could author such
a script — `healthcheck.configuration.manage`
([core/healthcheck-common/src/access.ts:24](../../core/healthcheck-common/src/access.ts#L24))
for the healthcheck contexts, `automation.automation.manage` for the automation
contexts. (A reader who cannot author the script has no use for its symbols, and
the matching `testScript`/`propose` calls would be refused anyway — keeping the
gate aligned avoids a surface/execute mismatch.)

### 2.3 `ai.testScript` — execute a drafted script in the secure sandbox

Registered via **`aiToolExtensionPoint`**. **`effect: "read"`** — it runs a draft
in the fail-closed global sandbox and persists **nothing** about platform config
(no health check, no automation, no row in any plugin table). It is therefore
non-destructive and inherits the permission mode (§4). It still **counts toward
the per-principal tool budget and the spend ledger is unaffected** (it's a
sandbox run, not a model call).

```ts
export const TestScriptInputSchema = z.object({
  context: ScriptContextKindSchema,
  source: z.string().min(1).max(100_000),
  /** Collector/action config the script reads via context.config / fields. */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Sample runtime context (check/system/environment, or event/subscription). */
  sampleContext: z.record(z.string(), z.unknown()).optional(),
  /** Shell-only: extra env. Never carries real secrets (placeholders only). */
  env: z.record(z.string(), z.string()).optional(),
  /** Bounded; defaults to a short ceiling well under the runner's max. */
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
});

export const TestScriptOutputSchema = z.object({
  /** The default-export / return value the script produced (masked). */
  result: z.unknown().optional(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  error: z.string().optional(),
  /** What the sandbox actually enforced/degraded (surfaced, never silent). */
  sandboxDowngraded: z.boolean(),
});
```

Execution path: §5. `requiredAccessRules` are identical to `getScriptContext`
for the same context (authoring-a-script is the same privilege as running a test
of one — already how `testCollectorScript` / `testScript` are gated, both at
`*.manage`, [healthcheck-common/src/rpc-contract.ts:149](../../core/healthcheck-common/src/rpc-contract.ts#L149),
[automation-common/src/rpc-contract.ts:235](../../core/automation-common/src/rpc-contract.ts#L235)).

### 2.4 `ai.listCapabilities` — the kind catalog for a target context

Registered via **`aiToolExtensionPoint`**. `effect: "read"`. Parameterized by
`CapabilityContextKind`.

```ts
export const ListCapabilitiesInputSchema = z.object({
  context: CapabilityContextKindSchema,
});

/** A catalog entry, normalized across both registries. */
export const CapabilityEntrySchema = z.object({
  /** Fully-qualified id (e.g. "healthcheck-http.http", "incident.created"). */
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  /** "strategy" | "collector" | "trigger" | "action" | "artifact-type". */
  role: z.enum(["strategy", "collector", "trigger", "action", "artifact-type"]),
  category: z.string().optional(),
  /** JSON Schema for this entry's config (omitted when large; see truncation). */
  configSchema: z.record(z.string(), z.unknown()).optional(),
});

export const ListCapabilitiesOutputSchema = z.object({
  context: CapabilityContextKindSchema,
  entries: z.array(CapabilityEntrySchema),
  /** True when entries were dropped to fit the context budget (§ truncation). */
  truncated: z.boolean(),
});
```

Source per context: §3.2.

### 2.5 `ai.searchDocs` + `ai.getDoc` — documentation grounding

Registered via **`aiToolExtensionPoint`**. Both `effect: "read"`. Gated by
`ai.chat.read` ([core/ai-common/src/access.ts:17](../../core/ai-common/src/access.ts#L17))
— any chat user may read the platform's own public documentation; the docs carry
no per-tenant data.

```ts
export const SearchDocsInputSchema = z.object({
  query: z.string().min(1).max(400),
  /** Max ranked hits to return (capped server-side; see size budget §3.4). */
  limit: z.number().int().min(1).max(10).default(5),
});

/** One ranked doc hit: enough for the model to decide whether to getDoc it. */
export const DocHitSchema = z.object({
  /** Slug-based address, e.g. "user-guide/concepts/health-checks". */
  slug: z.string(),
  title: z.string(),
  /** Section heading the snippet came from (when the hit is a sub-section). */
  heading: z.string().optional(),
  /** The matching snippet (bounded length), highlighting why it matched. */
  snippet: z.string(),
  /** BM25-ish relevance score (opaque ordering hint). */
  score: z.number(),
});

export const SearchDocsOutputSchema = z.object({
  hits: z.array(DocHitSchema),
});

export const GetDocInputSchema = z.object({
  slug: z.string().min(1),
});

export const GetDocOutputSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  /** Full page content (markdown, frontmatter stripped), bounded; see §3.4. */
  content: z.string(),
  /** True when content was truncated to the size budget. */
  truncated: z.boolean(),
});
```

### 2.6 Where each tool registers — summary

| Tool | Extension point | effect | requiredAccessRules |
| --- | --- | --- | --- |
| `ai.getScriptContext` | `aiToolExtensionPoint` | read | context-matched `*.manage` |
| `ai.testScript` | `aiToolExtensionPoint` | read | context-matched `*.manage` |
| `ai.listCapabilities` | `aiToolExtensionPoint` | read | `healthcheck.configuration.read` or `automation.automation.read` (matched) |
| `ai.searchDocs` | `aiToolExtensionPoint` | read | `ai.chat.read` |
| `ai.getDoc` | `aiToolExtensionPoint` | read | `ai.chat.read` |

> All five are **composite** tools (not projections): each composes a static
> resource (the SDK bundle / docs index) or fans out across multiple source
> procedures, so none maps to a single oRPC procedure that `expose` could
> project. They register through the same `aiToolExtensionPoint` the existing
> `automation.propose` uses ([index.ts:151](../../core/ai-backend/src/index.ts#L151)).

> **Naming note.** `ai.getScriptContext` would collide-protect fine
> (`registry.register` throws on dup, [tool-registry.ts:33](../../core/ai-backend/src/tool-registry.ts#L33)),
> but because these tools are registered by the ai-backend plugin itself their
> names are auto-qualified to `ai.<name>` by `registerTool`
> ([registry-wiring.ts:31](../../core/ai-backend/src/registry-wiring.ts#L31)) — pass
> the bare local name (`getScriptContext`) and let qualification produce
> `ai.getScriptContext`.

---

## 3. Per-context sources

### 3.1 `getScriptContext` declarations — from the generated SDK editor bundle

The single source of truth for script SDK symbols is the **generated** editor
bundle, exported as a runtime string `SDK_EDITOR_BUNDLE_DTS`
([core/sdk/src/editor-bundle.ts:11](../../core/sdk/src/editor-bundle.ts#L11)) — the
SAME text the Monaco editor mounts (served by `createSdkTypesHttpHandler`,
[sdk-types-route.ts:122](../../core/script-packages-backend/src/sdk-types-route.ts#L122)).

The bundle declares one `declare module` per context:
`@checkstack/sdk/healthcheck` (`defineHealthCheck`, `HealthCheckScriptContext`,
`HealthCheckScriptResult`) and `@checkstack/sdk/integration`
(`defineIntegration`, `IntegrationScriptContext`, `IntegrationScriptResult`).

**Per-context extraction (a pure, tested function in `core/ai-backend`):** take
`SDK_EDITOR_BUNDLE_DTS`, parse it into its `declare module "<name>" { ... }`
blocks, and return the block whose name matches the context's `sdkModule`. For
shell contexts, return the env-var list instead (see below). This is a pure
string/region extraction — **no TypeScript compiler dependency** — keyed by the
known module name, so it stays trivially testable and cannot drift from the
editor (both derive from the one generated bundle).

- `ai-backend` adds a workspace dep on `@checkstack/sdk` to import
  `SDK_EDITOR_BUNDLE_DTS` (backend-only; the string is already backend-only by
  design — the frontend fetches it live,
  [editor-bundle.ts:7](../../core/sdk/src/editor-bundle.ts#L7)). Run the references
  generator after adding the dep.

**Shell-context env vars:** the canonical list is built by
`buildShellRunContextEnv`
([collector-script-test.ts:124](../../core/healthcheck-backend/src/collector-script-test.ts#L124))
for healthcheck and the automation `script-test-shell-env.ts` for automation.
These are backend-internal; rather than import across plugins (the codebase
deliberately re-implements `toEnvFieldShellKey` locally,
[collector-script-test.ts:97](../../core/healthcheck-backend/src/collector-script-test.ts#L97)),
ship a **small static descriptor table** in `core/ai-backend` listing the
reserved `CHECKSTACK_*` vars per shell context, with a unit test that asserts it
matches the producer's output for a representative sample context. (Flag as
OQ-2: a generated table would be sturdier; recommendation there.)

### 3.2 `listCapabilities` catalogs — from the registry-introspection RPCs

The catalogs are exactly what the UI pickers read. The tool fans out via the
**trusted service client** (`rpcClient`, already injected into the ai-backend
plugin init, [index.ts:151](../../core/ai-backend/src/index.ts#L151)) — but the
**resolver gate** (`requiredAccessRules`) is the authorization authority, exactly
as for `automation.propose` ([automation-propose.ts:58](../../core/ai-backend/src/tools/automation-propose.ts#L58)).
The underlying read procedures are gated at `*.read`, which the tool's
`requiredAccessRules` mirror, so a principal who reaches the tool could read the
same data in the UI.

- `context: "healthcheck"` → `healthCheckContract.getStrategies`
  (`HealthCheckStrategyDtoSchema`,
  [healthcheck-common/src/schemas.ts:6](../../core/healthcheck-common/src/schemas.ts#L6))
  + `getCollectors` per strategy (`CollectorDtoSchema`,
  [schemas.ts:26](../../core/healthcheck-common/src/schemas.ts#L26)). Map to
  `role: "strategy" | "collector"`.
- `context: "automation"` → `automationContract.listTriggers`
  (`TriggerInfoSchema`, [automation-common/src/schemas.ts:945](../../core/automation-common/src/schemas.ts#L945)),
  `listActions` (`ActionInfoSchema`, [:970](../../core/automation-common/src/schemas.ts#L970)),
  `listArtifactTypes` (`ArtifactTypeInfoSchema`, [:992](../../core/automation-common/src/schemas.ts#L992)).
  Map to `role: "trigger" | "action" | "artifact-type"`.

> **Kind registry note.** The "kind registry" the ask mentions is GitOps-facing
> (`catalog-backend`, `gitops-backend`, `dependency-backend` register GitOps
> kinds) and is NOT the picker substrate for health checks/automations. The
> queryable catalogs that power the editors are the registry-introspection RPCs
> above. The plan deliberately scopes `listCapabilities` to those two contexts;
> a GitOps-kind catalog is a future extension (OQ-5).

**Config-schema size:** strategy/collector/trigger/action `configSchema`s are
full JSON Schemas and can be large. To fit the model context, `listCapabilities`
returns `configSchema` **only when the catalog has ≤ N entries** (recommend
N=12); above that it omits schemas and sets `truncated: true`, and the model
pulls a specific entry's schema via a follow-up (Phase 2 adds an optional
`entryId` filter to `listCapabilities` for the deep read; v1 returns the
trimmed list). The model combines this with `getScriptContext` for script-backed
collectors/actions.

### 3.3 Cross-tool composition (the design intent)

`searchDocs`/`getDoc` give the **conceptual/how-to grounding** ("to add a script
health check, create a configuration with the `script` collector and write a
`defineHealthCheck` module"). `getScriptContext` gives the **exact symbols**
(`defineHealthCheck`, the `HealthCheckScriptContext.config` shape).
`listCapabilities` gives the **available kinds** (which collectors/strategies
exist). `testScript` lets the model **validate its draft** before proposing.
Then `automation.propose` (or a future health-check propose tool, OQ-6) routes
creation through the existing confirm card. The model pulls these on demand,
drafts, tests, then proposes.

### 3.4 Docs index — build-time bundled (the crux, RESOLVED)

> **DECISION (RESOLVED, OQ-3): a build-time generated, bundled docs index.** The
> ai-backend ships a generated `docs-index.ts` exporting a `DOCS_INDEX` constant
> — exactly mirroring how the SDK editor bundle ships `SDK_EDITOR_BUNDLE_DTS` as
> a generated runtime string ([editor-bundle.ts:11](../../core/sdk/src/editor-bundle.ts#L11)).
> Self-contained, versioned with the build, **no network/egress dependency**.

**Rejected alternative — runtime fetch from the public docs site.** The docs are
served at `https://enyineer.github.io/checkstack/`
([.claude/rules/architecture.md](../rules/architecture.md)). Fetching them at
runtime would (a) add a hard network/egress dependency to a tool the model calls
mid-turn — fragile, latency-prone, and offline-broken for air-gapped installs;
(b) couple answer correctness to whatever version is deployed to GitHub Pages,
which can lag or lead the running backend; (c) require the backend to make an
outbound HTTP call, which conflicts with the platform's locked-down egress
posture (the script sandbox defaults to `network: deny`,
[global-default.ts](../../core/backend-api/src/script-sandbox/global-default.ts), and
operators may run the backend with no general egress at all). **Recommend
against it.** The bundled index is versioned with the backend build, so the docs
the assistant cites always match the code the operator is running.

**Index shape (generated `core/ai-backend/src/generated/docs-index.ts`):**

```ts
// AUTO-GENERATED by scripts/generate-docs-index.ts - DO NOT EDIT BY HAND.
export interface DocsIndexEntry {
  slug: string;                 // "user-guide/concepts/health-checks"
  title: string;                // from frontmatter `title:`
  description?: string;         // from frontmatter `description:`
  headings: string[];           // all `##`/`###` heading texts (for ranking)
  /** Full page body, frontmatter + MDX component imports stripped. */
  content: string;
}
export const DOCS_INDEX: DocsIndexEntry[];
/** A content hash of the source tree, so a CI check can detect drift. */
export const DOCS_INDEX_HASH: string;
```

**Generation step (`scripts/generate-docs-index.ts`, modeled on
[scripts/generate-sdk.ts](../../scripts/generate-sdk.ts)):**
1. Walk `docs/src/content/docs/**/*.{md,mdx}` (124 files today).
2. For each: parse frontmatter (`title`, `description`); strip frontmatter, MDX
   `import`/component lines, and code fences-to-plaintext for indexing; derive
   the `slug` from the file path relative to `docs/src/content/docs/` (drop the
   extension; `index.md(x)` → the directory slug) — matching Starlight's
   slug-based routing.
3. Emit `core/ai-backend/src/generated/docs-index.ts` (byte-deterministic,
   sorted by slug) + `DOCS_INDEX_HASH` (sha-256 of the concatenated normalized
   sources). Cap each `content` field at a size budget (recommend 24 KB; longer
   pages are truncated with `truncated` flagged by `getDoc`).
4. **Build wiring:** add `"generate:docs-index"` and `"generate:docs-index:check"`
   scripts to the root `package.json` (next to `generate:sdk` /
   `generate:sdk:check`, [package.json:18](../../package.json#L18)). Run the
   non-check variant from `version-packages` like `generate:sdk` is
   ([package.json:30](../../package.json#L30)).
5. **CI check:** add `bun run generate:docs-index:check` to
   [.github/workflows/pr-checks.yml](../../.github/workflows/pr-checks.yml) right
   beside the existing `generate:sdk:check`
   ([pr-checks.yml:51](../../.github/workflows/pr-checks.yml#L51)). A docs change
   without a regenerated index then fails CI — the same drift guard the SDK
   bundle has. This closes the loop with the architecture rule that docs must be
   updated in the same PR as the change ([.claude/rules/architecture.md](../rules/architecture.md)).

**Retrieval approach (RESOLVED, OQ-7): keyword / section full-text search over
the bundled index for the first cut.** A pure, tested ranking function
(`rankDocs({ index, query, limit })`) tokenizes the query, scores entries with a
BM25-ish term-frequency over `title` (boosted) + `headings` (boosted) + `content`,
and returns the top-`limit` hits with a bounded snippet around the best match.
No embedding infrastructure, no vector store, tractable, deterministic, and
unit-testable. **Semantic/embedding search is a later enhancement** (OQ-8): the
embeddings would be generated at the same build step into a sidecar
`docs-embeddings.ts` (or a small on-disk store), queried with the chat
integration's embeddings endpoint if the provider exposes one; deferred because
it adds infra and a model dependency for marginal first-cut benefit.

**Size budget:** `searchDocs` caps `limit ≤ 10` and each `snippet` to ~500
chars; `getDoc` caps `content` to the 24 KB build-time budget. These keep a
`searchDocs` + a couple of `getDoc` calls comfortably within a single model
turn's context.

---

## 4. Permission mode — approve / auto

### 4.1 The model

A per-conversation **permission mode**, Claude-Code-style:

```ts
// core/ai-common/src/permission.ts (NEW)
import { z } from "zod";
export const AiPermissionModeSchema = z.enum(["approve", "auto"]);
export type AiPermissionMode = z.infer<typeof AiPermissionModeSchema>;
export const DEFAULT_PERMISSION_MODE: AiPermissionMode = "approve";
```

**CORRECTED gating (maintainer decision — supersedes the read-confirm design in
§4.4/§4.5).** Three tiers, by tool `effect`:

- **`read` → ALWAYS auto-runs, in BOTH modes.** Reads are NEVER gated (no
  read-confirm card); the mode does not affect reads. (`getScriptContext`,
  `testScript`, `listCapabilities`, `searchDocs`/`getDoc` are all `read`, so they
  always just run.)
- **`mutate` (a non-destructive edit) → inherits the mode.** In **AUTO** it
  auto-applies server-side (no human click); in **APPROVE** it surfaces a confirm
  card the operator must approve.
- **`destructive` → ALWAYS requires explicit human approval, in BOTH modes.** The
  mode is never consulted for destructive tools — the security invariant (§4.4):
  destructive can never auto-apply.

### 4.2 Destructive classification (the mechanism)

The existing `AiToolEffect` enum already distinguishes
`read | mutate | destructive` ([tool.ts:14](../../core/ai-common/src/tool.ts#L14)).
We reuse it as the classification, with one sharpened rule:

The mode logic keys on ALL THREE tiers (corrected):

- `read` → **ungated**; always runs via `runRead`. The mode never gates reads.
- `mutate` → **mode-governed.** AUTO: auto-applies via a NEW server-side
  auto-apply path (the model's `propose` for a `mutate` tool is applied
  immediately, server-re-checked via `isAllowed` and audited — no human
  `applyTool` click). APPROVE: the normal `propose` → confirm card → human
  `applyTool`.
- `destructive` → **always** `propose` → human `applyTool`; the mode is never
  consulted, so there is no code path where AUTO reaches `apply` for a
  destructive tool.

This SHARPENS the current `buildAgentSdkTools` split
([sdk-tools.ts:64](../../core/ai-backend/src/chat/sdk-tools.ts#L64)) — today
`read`→`runRead`, else→`propose`. The `else` branch now sub-divides: `mutate`
auto-applies in AUTO (else confirm), `destructive` always confirms. The new
mutate-in-AUTO auto-apply path runs `propose` + immediate `apply` under the SAME
`isAllowed` re-check + audit; `destructive`'s apply stays human-only. (§4.4's
read-confirm card is DROPPED — reads are never gated.)

> **Default-destructive on the projection path (RESOLVED, OQ-4):** `effect` is
> already REQUIRED and never inferred ([tool.ts:56](../../core/ai-common/src/tool.ts#L56),
> `expose` throws if omitted, [ai-platform.md §5.1](./ai-platform.md)). No
> default needed — a projected tool cannot reach the registry without an explicit
> effect. We KEEP this: there is no "default destructive" because there is no
> way to register an effect-less tool. The five new tools are all explicitly
> `read`. For belt-and-suspenders, add a registry-time assertion test that every
> registered tool has a valid `effect` (already guaranteed by the type, but the
> test documents the invariant).

### 4.3 Where the mode lives (state-and-scale)

Apply [.claude/rules/state-and-scale.md](../rules/state-and-scale.md):

1. **Where it lives:** a new nullable `permission_mode` column on the existing
   `ai_conversations` table
   ([core/ai-backend/src/schema.ts:72](../../core/ai-backend/src/schema.ts#L72)),
   defaulting to `approve`. Shared Postgres — durable, not pod-local.
2. **Same answer on every pod:** the mode is read from the conversation row at
   the start of each turn ([chat-service.ts:344](../../core/ai-backend/src/chat/chat-service.ts#L344)
   already loads the owned conversation). Any pod handling the next turn reads the
   same row → same answer. No in-memory mode anywhere.
3. **Not duplicated:** the conversation row is the single writer. The frontend
   toggle is a view of it, persisted via `updateConversation`.

> **Per-conversation, not per-user (RESOLVED):** Claude Code's mode is
> per-session; the chat conversation is the session analog and is already the
> durable, owner-scoped unit ([conversation-store.ts:24](../../core/ai-backend/src/chat/conversation-store.ts#L24)).
> A per-user global default could be a later add (a user-settings row); v1 is
> per-conversation so a user can run one chat in AUTO and another in APPROVE.
> The DEFAULT for a new conversation is `approve` (safe-by-default).

Schema + contract additions:
- `aiConversations.permissionMode: aiPermissionModeEnum("permission_mode").notNull().default("approve")`
  (a new `pgEnum`, mirroring the existing `aiTransportEnum` pattern in
  [schema.ts](../../core/ai-backend/src/schema.ts)).
- `AiConversationSchema` gains `permissionMode: AiPermissionModeSchema`
  ([rpc-contract.ts:49](../../core/ai-common/src/rpc-contract.ts#L49)).
- `createConversation` / `updateConversation` inputs gain an optional
  `permissionMode` ([rpc-contract.ts:129](../../core/ai-common/src/rpc-contract.ts#L129),
  [:156](../../core/ai-common/src/rpc-contract.ts#L156)); the store + router
  read/write it (owner-scoped, same pattern as `model`).

### 4.4 Integration with the agent loop + propose/apply (the invariant)

The mode is threaded into the read branch only. In
`buildChatToolCallbacks`/`buildAgentSdkTools`:

- **`read` tool, mode `auto`:** unchanged from today — auto-run via `runRead`
  ([sdk-tools.ts:69](../../core/ai-backend/src/chat/sdk-tools.ts#L69)). No confirm.
- **`read` tool, mode `approve`:** instead of executing inline, the read tool's
  executor returns a **read-confirm card** (a new `ConfirmCardResult`-shaped
  payload with `effect: "read"`, no propose token — see below) so the operator
  approves before the read runs. On approval the frontend calls a new
  `confirmRead` RPC that re-checks `isAllowed`, runs the read via the same
  loopback invoker, and audit-records it. (Reads have no side effects, so there
  is no two-step token to protect; the "confirm" is purely a UX gate, and the
  re-check on the server keeps it from being bypassed.)
- **`mutate` / `destructive` tool, ANY mode:** unchanged — `propose` →
  `ConfirmCardResult` → human `applyTool`. **The mode is never consulted on this
  branch.** There is no code path where `mode === "auto"` reaches `apply`. This
  is the structural guarantee that the mode can never auto-apply a destructive
  action.

> **Security posture (LOCKED):** the propose/apply service
> ([service.ts:110](../../core/ai-backend/src/propose-apply/service.ts#L110)) is
> the ONLY way a mutate/destructive tool commits, and it requires a token that
> only the human-driven `applyTool` RPC produces a call for. The permission mode
> lives entirely on the read branch and the frontend; it has no parameter into
> `propose`/`apply`. A test (§6) asserts that no mode value changes the set of
> tools that require `applyTool`.

> **Simpler v1 alternative for the read branch (RECOMMENDED to ship first):**
> rather than a full read-confirm round-trip, APPROVE mode in v1 can **batch-gate
> at the turn boundary**: when mode is `approve`, the loop still auto-runs reads
> but the UI surfaces a per-turn "tools used" banner — no behavioral change to
> reads, only mutate/destructive confirm. **Rejected** because it doesn't deliver
> the Claude-Code semantics the maintainer asked for (read approval in APPROVE
> mode). Ship the read-confirm card. Keep the read-confirm token-less and
> server-re-checked.

### 4.5 The UI toggle (ChatPage)

Add a mode switch to the chat panel header
([ChatPage.tsx:283](../../core/ai-frontend/src/pages/ChatPage.tsx#L283), beside the
integration/model `Select`s). A small two-state control (`Approve` / `Auto`),
defaulting to the loaded conversation's `permissionMode` and persisting changes
via `updateConversation` (same mutation pattern as `model`). Auto-invalidation:
`updateConversation` is an oRPC mutation so it auto-invalidates this plugin's
queries ([.claude/rules/code-style-guide.md](../rules/code-style-guide.md)).
Match the existing look: reuse the `Select` or a `ToggleGroup` from
`@checkstack/ui`, with a `ShieldAlert`/`Sparkles` icon consistent with the
confirm card ([ConfirmCardView.tsx:13](../../core/ai-frontend/src/components/ConfirmCardView.tsx#L13)).
Mobile: the header already wraps; the toggle is small. Respect `usePerformance`
only if any animation is added ([.claude/rules/performance.md](../rules/performance.md)).

The read-confirm card reuses `ConfirmCardView` with an `effect: "read"` variant
(neutral styling, "Run" instead of "Apply"). The stream-parser's `asConfirmCard`
([core/ai-frontend/src/lib/stream-parser.ts:36](../../core/ai-frontend/src/lib/stream-parser.ts#L36))
widens its `effect` union to include `"read"`.

---

## 5. `testScript` safety + cost

### 5.1 Sandbox path

`testScript`'s `execute` dispatches by `context`:
- `healthcheck-script` / `healthcheck-shell` → `runCollectorScriptTest`
  ([collector-script-test.ts:175](../../core/healthcheck-backend/src/collector-script-test.ts#L175)),
  which calls `defaultEsmScriptRunner` / `defaultShellScriptRunner` with
  `helperModuleName: "@checkstack/sdk/healthcheck"`
  ([:248](../../core/healthcheck-backend/src/collector-script-test.ts#L248)).
- `automation-action-script` / `automation-action-shell` → automation's
  `runScriptTest` (`helperModuleName: "@checkstack/sdk/integration"`,
  [script-test.ts:233](../../core/automation-backend/src/script-test.ts#L233)).

> **Wiring decision (RESOLVED):** rather than `ai-backend` importing two backend
> plugins' internal functions, expose the run via the **existing RPCs** through
> the trusted service client (the tool fans out to
> `healthCheckContract.testCollectorScript` /
> `automationContract.testScript`), with the **resolver gate** as the
> authorization authority (identical to how `automation.propose` and
> `listCapabilities` work). This keeps ai-backend free of cross-plugin runner
> imports and reuses the exact sandboxed path the editors use. The tool maps the
> tool input → the RPC input schema (`CollectorScriptTestInputSchema`
> [healthcheck-common/src/rpc-contract.ts:84](../../core/healthcheck-common/src/rpc-contract.ts#L84)
> / `ScriptTestInputSchema`
> [automation-common/src/script-test-schemas.ts:32](../../core/automation-common/src/script-test-schemas.ts#L32)).

### 5.2 Security properties inherited for free

- **Fail-closed global sandbox:** every run resolves the active GLOBAL policy via
  `resolveActiveSandboxPolicy`
  ([provider.ts:122](../../core/backend-api/src/script-sandbox/provider.ts#L122));
  with no provider it falls to `FAIL_CLOSED_SANDBOX_PROFILE`
  ([global-default-via provider.ts:49](../../core/backend-api/src/script-sandbox/provider.ts#L49)):
  no egress, scratch FS, privilege drop. Surface `failedClosed` →
  `sandboxDowngraded` in the tool output so the model/operator never gets a
  silent downgrade.
- **No real secrets:** the test path injects `__SECRET_<NAME>__` placeholders and
  masks overrides out of the result
  ([collector-script-test.ts:185](../../core/healthcheck-backend/src/collector-script-test.ts#L185),
  `buildTestSecretEnv` / `maskScriptRunOutput`). The AI tool passes NO
  `secretOverrides` (the model never supplies secret values), so only
  placeholders are ever present.
- **Time/output bounds:** `timeoutMs` capped at 30 s in the tool input (the RPC
  caps at 300 s; the tool is stricter, recommend 10 s default). Output is capped
  by the runner's `maxOutputBytes` and surfaced via `outputTruncated`.

### 5.3 Cost accounting + mode interaction

- **Tool budget:** `testScript` is a tool call, so it passes through
  `enforceToolBudget`
  ([chat-service.ts:230](../../core/ai-backend/src/chat/chat-service.ts#L230),
  the shared-Postgres rolling counter over `ai_tool_calls`) like every other tool
  — a runaway "test 200 scripts" loop is throttled cluster-wide. It is audit-
  recorded with `transport: "chat"` via `recordExecuted`
  ([chat-service.ts:252](../../core/ai-backend/src/chat/chat-service.ts#L252)).
- **Spend ledger:** `testScript` makes NO model call, so it does NOT touch the
  per-integration spend cap (`recordSpend` is for `LanguageModelUsage`,
  [chat-service.ts:429](../../core/ai-backend/src/chat/chat-service.ts#L429)). Its
  cost is purely sandbox CPU/time, bounded by the sandbox resource caps.
- **Mode interaction:** `effect: "read"` ⇒ inherits the permission mode. In
  AUTO it runs immediately (subject to the budget); in APPROVE the operator
  approves the read-confirm card first (§4.4). It is **never** routed through
  propose/apply because it persists nothing.

---

## 6. Phased breakdown

> Sequence rationale: docs grounding is independent of the script/automation
> machinery and broadly useful, so it lands first. Script context + test come
> next (they unblock the flagship "create a script health check" flow).
> Capabilities catalog follows. The permission-mode system is last because it
> touches the agent loop + frontend + schema and is orthogonal to the tools'
> existence — the tools are useful in today's always-confirm behavior before the
> mode ships.

### Phase 1 — Documentation grounding (`searchDocs` / `getDoc`)

Scope: the docs-index generator + CI check, the bundled `DOCS_INDEX`, the pure
`rankDocs` function, and the two read tools registered via `aiToolExtensionPoint`.

Test matrix:
- **`scripts/generate-docs-index.test.ts`** (pure): given a fixture docs tree,
  asserts deterministic output, correct slug derivation (incl. `index.md` →
  directory slug), frontmatter parse, MDX-import stripping, size-cap truncation,
  and a stable `DOCS_INDEX_HASH`. A `--check` mode test asserting drift detection
  (mirrors `generate-sdk.test.ts`).
- **`rank-docs.test.ts`** (pure, DOM-free): ranking matrix — title-boost,
  heading-boost, snippet windowing, `limit` cap, empty-query and no-match cases,
  ordering stability.
- **`docs-tools.test.ts`** (backend): `searchDocs` returns `DocHit[]` within the
  size budget; `getDoc` returns a known slug's content + `truncated` flag;
  unknown slug → empty/clear error; both registered with `effect: "read"` and
  gated by `ai.chat.read`; resolver surfaces them to a chat user.

Docs deliverables: a new page under
[docs/src/content/docs/developer-guide/ai/](../../docs/src/content/docs/developer-guide/ai/)
(e.g. `context-tools.md`) introducing the assistant's grounding tools; update
`developer-guide/ai/index.mdx`. (And — because the generator indexes the docs —
regenerate the index so the new page is itself searchable.)

### Phase 2 — Script context + test (`getScriptContext`, `testScript`)

Scope: the context taxonomy enum; the pure SDK-bundle extraction + shell-env
table; the two composite tools (fanning out to the test RPCs via the service
client); resolver gating per context.

Test matrix:
- **`script-context-extract.test.ts`** (pure): given `SDK_EDITOR_BUNDLE_DTS`,
  extracts the correct `declare module` block per context; shell contexts return
  the env table; unknown context → clear error.
- **`shell-env-table.test.ts`** (pure): asserts the static `CHECKSTACK_*` table
  matches `buildShellRunContextEnv`'s output for a representative sample (the
  drift guard, since the table is hand-maintained — OQ-2).
- **`get-script-context-tool.test.ts`** (backend): output schema validates per
  context; `requiredAccessRules` match the authoring rule; not proposable
  (effect read).
- **`test-script-tool.test.ts`** (backend, injected fake runner/RPC): maps tool
  input → the right RPC per context; surfaces `sandboxDowngraded`; never passes
  `secretOverrides`; ordinary script failure lands in `error`, not a throw;
  budget enforced; audit-recorded `transport: "chat"`. Real sandbox execution is
  covered by the existing runner tests — do NOT duplicate the subprocess tests
  here; inject a fake runner/RPC.

Docs deliverables: extend `developer-guide/ai/context-tools.md` with the script
contexts + the test tool; if the taxonomy is referenced as a contract, add a
reference snippet. (Architecture rule: same-PR doc update for a new platform
contract, [.claude/rules/architecture.md](../rules/architecture.md).)

### Phase 3 — Capability catalog (`listCapabilities`)

Scope: the `CapabilityContextKind` enum value usage; the normalized
`CapabilityEntry` mapping from both registries' DTOs; config-schema size gating.

Test matrix:
- **`capability-map.test.ts`** (pure): maps `HealthCheckStrategyDto`/`CollectorDto`
  and `TriggerInfo`/`ActionInfo`/`ArtifactTypeInfo` → `CapabilityEntry`; `role`
  assignment; `truncated` when over the entry cap; config-schema omission rule.
- **`list-capabilities-tool.test.ts`** (backend, injected service client):
  fan-out per context; resolver gating; output schema validates.

Docs deliverables: extend the AI docs page with the capabilities tool + the two
contexts and the role taxonomy.

### Phase 4 — Permission mode (approve / auto)

Scope: `AiPermissionMode` enum; `permission_mode` column + enum + the
conversation contract/store/router wiring; the read-confirm card path
(`confirmRead` RPC + token-less server re-check); the agent-loop read-branch mode
threading; the ChatPage toggle + read-confirm `ConfirmCardView` variant; the
stream-parser `effect` widening.

Test matrix (backend):
- **`permission-mode.logic.test.ts`** (pure): the read-branch decision —
  `(effect, mode)` → `auto-run | read-confirm | propose`; assert
  `mutate`/`destructive` → `propose` for BOTH modes (the invariant).
- **`confirm-read.test.ts`**: `confirmRead` re-checks `isAllowed`, runs the read,
  audit-records it, refuses an unauthorized principal; no token is involved.
- **`mode-never-auto-applies.test.ts`** (the security guard): for every
  registered tool and both modes, assert that a `mutate`/`destructive` tool's
  disposition is `propose` and is unreachable by `apply` without a human
  `applyTool` call. Assert `auto` mode does not alter the propose/apply path.
- **store/router tests:** `permissionMode` round-trips on create/update,
  owner-scoped, defaults to `approve`.

Test matrix (frontend, DOM-free logic-split per
[.claude/rules/code-style-guide.md](../rules/code-style-guide.md) — pure helpers
tested, not DOM):
- **`mode-toggle.logic.test.ts`**: toggle state derivation from the loaded
  conversation; default `approve`; the update payload shape.

Docs deliverables: a new `developer-guide/ai/permission-mode.md` documenting the
approve/auto model and the always-approved-destructive invariant; cross-link from
`propose-apply.md` ([docs/.../ai/propose-apply.md](../../docs/src/content/docs/developer-guide/ai/propose-apply.md)).

### Phase 5 — Wiring, end-to-end, polish

Scope: register all five tools in
[index.ts](../../core/ai-backend/src/index.ts) init (next to the
`automation.propose` registration, [:151](../../core/ai-backend/src/index.ts#L151));
update the system prompt ([chat-service.ts:185](../../core/ai-backend/src/chat/chat-service.ts#L185))
to tell the model it can pull docs/symbols/capabilities and test drafts before
proposing; run `typecheck:references:generate`; add a changeset
([.claude/rules/changesets.md](../rules/changesets.md), minor bump, BETA — no
major).

Test matrix: a registry-wiring test asserting all five tools register, qualify to
`ai.*`, carry valid effects, and resolve for an admin principal; an integration
test that a chat turn can call `searchDocs` then `getScriptContext` then
`testScript` (with fakes) within `MAX_STEPS`.

Docs deliverables: ensure every new contract page exists; regenerate the docs
index so the AI docs themselves are searchable.

---

## 7. State-and-scale notes

Per [.claude/rules/state-and-scale.md](../rules/state-and-scale.md), for every new
piece of state:

1. **Permission mode** — lives in the `ai_conversations.permission_mode` column
   (shared Postgres, [schema.ts:72](../../core/ai-backend/src/schema.ts#L72)). Read
   per turn from the owned conversation row → **same answer on every pod**. No
   in-memory mode. Single writer (the conversation row); the UI toggle is a view.
2. **Docs index** — `DOCS_INDEX` is a generated, build-time constant compiled
   into the ai-backend bundle (like `SDK_EDITOR_BUNDLE_DTS`). It is **identical on
   every pod** because it's part of the same build artifact; it is not state, not
   mutable at runtime, and never read from a per-pod source. No drift across pods
   by construction.
3. **SDK bundle extraction / shell-env table / capability map** — all pure,
   deterministic functions over a build-time constant or a service-client read.
   No state introduced; every pod computes the same result.
4. **Tool registry additions** — the five tools enter the in-memory registry from
   buffered extension-point registrations at boot, rebuilt identically on every
   pod (exactly as the existing tools, [index.ts:47-61](../../core/ai-backend/src/index.ts#L47)).
   Derived, deterministic, not a queryable source of truth.
5. **`testScript` / `confirmRead` reads** — audit-recorded into the shared
   `ai_tool_calls` table and counted against the shared-Postgres tool budget
   ([chat-service.ts:230](../../core/ai-backend/src/chat/chat-service.ts#L230)), so
   the budget holds cluster-wide. No pod-local counters.

No reactive-entity state is introduced, so `defineEntity` rules do not apply.

---

## 8. Open questions, each with a recommended resolution

- **OQ-1 — Which script contexts in v1?** *Recommend:* ship the two TS contexts
  (`healthcheck-script`, `automation-action-script`) fully, plus the two shell
  contexts (reuse the same tools with shell mapping). The enum carries all four
  from day one so the contract never widens. **Resolved: all four, TS first.**
- **OQ-2 — Shell-env table drift.** The `CHECKSTACK_*` var list for shell
  contexts is hand-maintained in ai-backend (cross-plugin import is avoided per
  codebase convention). *Recommend:* guard it with a unit test asserting it
  matches `buildShellRunContextEnv`'s output for a representative sample; revisit
  generating it (e.g. exporting a shared descriptor from a `-common` package)
  if it proves brittle. **Resolved: test-guarded static table for v1.**
- **OQ-3 — Docs runtime access (bundle vs fetch).** *Recommend:* build-time
  bundled index, mirroring `SDK_EDITOR_BUNDLE_DTS`. Reject runtime fetch
  (network/egress dependency, version skew, offline breakage). **Resolved:
  bundled (§3.4).**
- **OQ-4 — Default-destructive on the projection path.** *Recommend:* none needed
  — `effect` is already REQUIRED and `expose` throws without it; there is no way
  to register an effect-less tool. Add an assertion test documenting the
  invariant. **Resolved.**
- **OQ-5 — GitOps "kind registry" in `listCapabilities`.** The picker substrate
  is the registry-introspection RPCs, not the GitOps kind registry. *Recommend:*
  scope `listCapabilities` to `healthcheck` + `automation`; a GitOps-kind catalog
  is a future extension. **Resolved: out of v1 scope.**
- **OQ-6 — A `healthcheck.propose` composite tool.** The flagship today is
  `automation.propose`; "create a script health check" has no propose tool yet,
  so after `testScript` the model can only describe the config, not propose its
  creation. *Recommend:* add a `healthcheck.propose` composite tool (mutate,
  dry-run via the health-check validation path) as a fast-follow once the context
  tools land — out of THIS plan's scope but explicitly called out as the natural
  next step that makes the end-to-end "create a script health check" flow
  complete. **Recommended as fast-follow.**
- **OQ-7 — Keyword vs semantic doc search.** *Recommend:* keyword/BM25-ish over
  the bundled index for v1 (tractable, deterministic, no infra). **Resolved.**
- **OQ-8 — Semantic search later.** *Recommend:* generate embeddings at the same
  build step into a sidecar constant/store; query via the chat integration's
  embeddings endpoint when available. Deferred. **Resolved as future.**
- **OQ-9 — Permission mode scope (conversation vs user).** *Recommend:*
  per-conversation (the session analog), default `approve`. A per-user default is
  a later add. **Resolved: per-conversation.**
- **OQ-10 — Read-confirm UX vs batch-gate.** *Recommend:* ship the per-read
  confirm card (token-less, server-re-checked) to match Claude-Code semantics;
  reject the turn-boundary batch-gate as not delivering read approval.
  **Resolved: read-confirm card.**
- **OQ-11 — Docs index size budget.** *Recommend:* 24 KB per page content, ≤10
  search hits, ~500-char snippets. Revisit if real pages overflow or the model's
  context proves tight. **Resolved with a stated default.**
