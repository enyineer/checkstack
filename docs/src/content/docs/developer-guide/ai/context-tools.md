---
title: Context tools
description: Read-only assistant tools that ground answers in Checkstack's own docs and give the model a script's SDK symbols plus sandboxed testing before it proposes a change.
---

The chat assistant can read live platform data, but on its own it cannot ground a how-to answer in Checkstack's own documentation, nor does it know a script's API, so it would otherwise guess. The context tools close that gap. They are all read-only, so they auto-run in chat and never change platform state: documentation grounding (`ai.searchDocs` / `ai.getDoc`) stays in `ai-backend`, while script authoring is split per plugin into `healthcheck.getScriptContext` / `healthcheck.testScript` (in healthcheck-backend) and `automation.getScriptContext` / `automation.testScript` (in automation-backend), each owned and registered by its plugin through `aiToolExtensionPoint`. A third grounding tool, `ai.probeUrl`, lets the assistant inspect what a URL actually returns before drafting a check.

## Probing a URL (`ai.probeUrl`)

When the operator asks for a check against an endpoint the assistant has never seen (e.g. "watch `https://foo.bar/status`"), it should not guess the response shape. `ai.probeUrl` makes ONE outbound HTTP GET or HEAD and returns the status code, content type, a safe subset of response headers, and a capped body sample, so the assistant can assert on the REAL response (the actual status code, a field that genuinely exists). It is `effect: "read"`, gated by the broad `ai.chat.read` surface, and redirects are not followed (a 3xx just reports its `Location`).

Because the request leaves the CORE BACKEND, the tool is SSRF-guarded: only `http`/`https` URLs, never a loopback/internal hostname or a private/reserved IP literal, and the resolved hostname's IPs are re-checked after DNS so a public name that resolves to a private address is refused. The request carries no credentials, times out, and the body is read with a hard size cap. The guards are pure, unit-tested functions in `core/ai-backend/src/tools/ssrf-guard.ts`.

```ts
// ai.probeUrl({ url, method? }) -> { status, statusText, redirected, location?,
//                                   contentType?, headers, bodySample, bodyTruncated }
```

## How grounding works

Three read-only tools ground the assistant in the docs: `ai.listDocs` (the sitemap), `ai.searchDocs` (keyword ranking), and `ai.getDoc` (read one page). The assistant either calls `listDocs` to see every page's title and description and jump straight to the right slug, or `searchDocs` for a targeted keyword lookup, then `getDoc` on a promising slug to read it in full before answering. Because all three are `effect: "read"`, they run inline in the agent loop with no confirm card; the resolver gate (`ai.chat.read`) is the authorization authority. Any chat user may read the platform's own public documentation, which carries no per-tenant data.

### Knowing when to stop

The dominant waste in doc grounding is the model re-running near-identical `searchDocs` queries when nothing relevant exists: a BM25 ranker returns hits for any query that shares a common word ("system", "health"), so "nothing found" never looks like nothing. Two signals fix this. `searchDocs` returns a model-facing `note` alongside the hits: empty results and weak-scoring hits both tell the model to consult `listDocs` or conclude the docs do not cover the topic, rather than reword and retry. And `listDocs` makes coverage explicit - if no page title/description fits, the docs genuinely do not cover it, so the model says so instead of searching again.

## Where the docs come from

The docs the assistant cites are a build-time bundled index, not a runtime fetch. A generator walks the authored Starlight markdown under `docs/src/content/docs/**` and emits a `DOCS_INDEX` constant into `core/ai-backend/src/generated/docs-index.ts`, exactly mirroring how the SDK editor bundle ships `SDK_EDITOR_BUNDLE_DTS` as a generated runtime string.

Bundling, rather than fetching the public docs site at runtime, means:

- The cited docs are versioned with the backend build, so they always match the code the operator is running. No version skew with GitHub Pages.
- No network or egress dependency mid-turn. The tools work offline and on air-gapped installs.
- The index is identical on every pod (it is part of the same build artifact), so a `searchDocs` or `getDoc` read returns the same answer everywhere. No pod-local state.

Each indexed page carries its slug, title, optional description, its `##`/`###` heading texts (used for ranking), and the page body with frontmatter and MDX component tags stripped. Page bodies are capped at a per-page size budget; `getDoc` flags `truncated: true` when a page exceeded it.

### Regenerating the index

The bundled index is generated and committed, with a CI drift guard beside the SDK codegen check. Regenerate it after changing any docs page:

```bash
bun run generate:docs-index
```

The `version-packages` script also regenerates it, and `bun run generate:docs-index:check` (run in CI) fails when a docs change landed without a regenerated index.

> [!NOTE]
> The generator indexes the docs themselves, so this page is searchable by the
> assistant once the index is regenerated.

## Ranking

`searchDocs` ranks with a pure, deterministic BM25-ish term-frequency function (`rankDocs` in `core/ai-backend/src/tools/rank-docs.ts`). The query is tokenized, and each page is scored by saturated term frequency across its title (boosted), headings (boosted), description, and content. The top hits are returned, each with a bounded snippet windowed around the best match. Ties break by slug, so the ordering is stable. There is no embedding infrastructure or vector store; semantic search is a possible later enhancement.

## Documentation tool contracts

All three tools register through `aiToolExtensionPoint` as composite read tools and are gated by `ai.chat.read`.

`ai.listDocs` returns the sitemap so the model can see what exists and pick a page directly:

```ts
const ListDocsInputSchema = z.object({
  section: z.string().min(1).optional(), // e.g. "user-guide"; omit for all
});

const ListDocsOutputSchema = z.object({
  pages: z.array(
    z.object({ slug: z.string(), title: z.string(), description: z.string().optional() }),
  ),
  sections: z.array(z.string()), // valid top-level sections to filter by
  note: z.string(), // "if no title fits, the docs don't cover it"
});
```

`ai.searchDocs` returns the ranked hits a model uses to decide what to read, plus a `note` that flags weak/empty results so the model stops re-searching:

```ts
const SearchDocsInputSchema = z.object({
  query: z.string().min(1).max(400),
  limit: z.number().int().min(1).max(10).default(5),
});

const DocHitSchema = z.object({
  slug: z.string(), // "user-guide/concepts/health-checks"
  title: z.string(),
  heading: z.string().optional(), // section the snippet came from
  snippet: z.string(), // bounded, ~500 chars
  score: z.number(), // BM25-ish relevance (opaque ordering hint)
});

const SearchDocsOutputSchema = z.object({
  hits: z.array(DocHitSchema),
  note: z.string(), // next-step guidance derived from hit quality
});
```

`ai.getDoc` returns one page's full content by slug:

```ts
const GetDocInputSchema = z.object({ slug: z.string().min(1) });

const GetDocOutputSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  content: z.string(), // markdown, frontmatter stripped, byte-capped
  truncated: z.boolean(),
});
```

An unknown slug yields a clear error the model can recover from by searching again.

## The script-context taxonomy

Documentation grounding tells the model the conceptual "how"; the script tools give it the exact API. A script's available symbols and its test runner differ by WHERE the script lives, so the taxonomy enum carries all four contexts and the wire contract never has to widen. Each plugin's tool narrows its `context` input to its own two contexts, so the healthcheck tools accept only the healthcheck contexts and the automation tools accept only the automation contexts.

```ts
import { ScriptContextKindSchema } from "@checkstack/ai-common";
// "healthcheck-script"       inline TS health-check collector
// "healthcheck-shell"        shell health-check collector
// "automation-action-script" run_script automation action (TS)
// "automation-action-shell"  run_shell automation action
```

The plugin-agnostic machinery that powers these tools stays in `ai-backend`: `resolveScriptContext` (exported from `@checkstack/ai-backend`) slices the generated SDK editor bundle, builds the per-context descriptors, and assembles the shell-env tables. Each plugin's tool imports `resolveScriptContext` from there, so `ai-backend` keeps NO dependency on the healthcheck or automation commons for these tools, and the per-plugin tools never reimplement bundle extraction.

## healthcheck.getScriptContext and automation.getScriptContext

`healthcheck.getScriptContext({ context })` and `automation.getScriptContext({ context })` return the SDK module, define-helper, type declarations, a starter example, and the managed-package flag for a context. Each tool's `context` enum is narrowed to its own plugin's two contexts. The declarations come from PURE extraction of the generated SDK editor bundle (`SDK_EDITOR_BUNDLE_DTS`) via the shared `resolveScriptContext` helper - the SAME `.d.ts` the in-app Monaco editor mounts - so the symbols the assistant sees can never drift from the editor. For a shell context the tool returns the reserved `CHECKSTACK_*` env vars the runner injects instead of a module block.

```ts
export const GetScriptContextOutputSchema = z.object({
  context: ScriptContextKindSchema,
  language: z.enum(["typescript", "shell"]),
  sdkModule: z.string().optional(), // "@checkstack/sdk/healthcheck"
  helper: z.string().optional(), // "defineHealthCheck"
  declarations: z.string(), // the declare-module block (TS) or env table (shell)
  shellEnv: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .optional(),
  starterExample: z.string(),
  allowsManagedPackages: z.boolean(),
});
```

Because each tool is single-plugin, authorization is a single gate at the resolver. `healthcheck.getScriptContext` is gated by `healthcheck.healthcheck.configuration.manage` and `automation.getScriptContext` by `automation.automation.manage`, both declared in `requiredAccessRules`. There is no longer a broad `ai.chat.read` surface gate plus an in-`execute` cross-context re-check: a single-plugin tool has only one authoring rule, so a healthcheck-only author still sees the healthcheck tool, and the automation tool is simply not offered to a principal who lacks `automation.automation.manage`. The tools are registered by their owning plugins through `aiToolExtensionPoint` - see [Registering tools](/checkstack/developer-guide/ai/registering-tools/).

## healthcheck.testScript and automation.testScript

`healthcheck.testScript({ context, source, ... })` and `automation.testScript({ context, source, ... })` run a drafted script in the fail-closed global sandbox and return its result, output, and any error WITHOUT creating any health check or automation. Each tool's `context` enum is narrowed to its own plugin's two contexts, and each calls only its own plugin's test RPC through the per-call user-scoped client:

- `healthcheck.testScript` (`healthcheck-script` / `healthcheck-shell`) calls `healthCheckContract.testCollectorScript`.
- `automation.testScript` (`automation-action-script` / `automation-action-shell`) calls `automationContract.testScript`.

Authorization is the same single resolver gate as the matching `getScriptContext` tool: `healthcheck.testScript` requires `healthcheck.healthcheck.configuration.manage` and `automation.testScript` requires `automation.automation.manage`. The resolver gate decides what is offered, and because `execute` calls the test RPC through the user-scoped `rpcClient` (re-entering the router as the originating user), the handler re-enforces that same rule - so the tool can never run as anyone but the human who asked.

```ts
export const TestScriptInputSchema = z.object({
  context: ScriptContextKindSchema,
  source: z.string().min(1).max(100_000),
  config: z.record(z.string(), z.unknown()).optional(),
  sampleContext: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
});
```

Because it reuses the editor's sandboxed path, it inherits that path's safety for free.

> [!IMPORTANT]
> The tool passes NO secret overrides and NO declared secret env. The model never supplies secret values, so only `__SECRET_<NAME>__` placeholders are ever present in a run, and any override value is masked out of the result by the underlying test path.

The output adds one field over the RPC result: `sandboxDowngraded`. It is the resolved active global sandbox policy's fail-closed flag, surfaced so the model and operator never get a silent downgrade. When no global sandbox policy provider is registered (or it fails), the run falls back to the most restrictive fail-closed profile and `sandboxDowngraded` is `true`.

```ts
export const TestScriptOutputSchema = z.object({
  result: z.unknown().optional(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  error: z.string().optional(),
  sandboxDowngraded: z.boolean(),
});
```

These test tools make no model call, so they do not touch the per-integration spend cap. They still count toward the per-principal tool budget (a shared-Postgres rolling counter), so a runaway "test 200 scripts" loop is throttled cluster-wide.

## How the assistant composes these

The assistant pulls these on demand, drafts, tests, then proposes: `searchDocs`/`getDoc` ground the conceptual "how"; the owning plugin's `getScriptContext` (`healthcheck.getScriptContext` or `automation.getScriptContext`) gives the exact symbols to import; the model writes a draft; that plugin's `testScript` (`healthcheck.testScript` or `automation.testScript`) validates the draft against the real sandbox; and a propose tool (`automation.propose` for automations, `healthcheck.propose` for health checks) routes the actual creation through the human-approved confirm card. See [Propose and apply](/checkstack/developer-guide/ai/propose-apply/).

## End-to-end: create a script health check

This is the flow the whole context-tool set exists to enable. A user asks "create a script health check that probes `https://foo.bar/status`", and the model grounds, learns the real symbols, discovers the available kinds, tests its draft, and proposes the creation - never guessing an API and never silently creating anything.

The model's tool sequence:

1. `searchDocs({ query: "script health check" })` then `getDoc({ slug: ... })` - ground the conceptual "how" in the platform's own documentation (what a script collector is, that a health check carries a strategy plus collectors).
2. `healthcheck.getScriptContext({ context: "healthcheck-script" })` - learn the exact SDK symbols: the `@checkstack/sdk/healthcheck` module, the `defineHealthCheck` helper, and the `HealthCheckScriptContext` shape. The model now writes correct code instead of guessing.
3. `listCapabilities({ context: "healthcheck" })` then `getCapabilitySchema({ context: "healthcheck", kind: "<strategy-or-collector-id>" })` - discover which strategies and collectors exist and the exact config schema for the chosen kinds.
4. `healthcheck.testScript({ context: "healthcheck-script", source, config })` - run the drafted script in the fail-closed sandbox and validate it produces a result, WITHOUT creating anything. The model iterates on failures here.
5. `healthcheck.propose({ name, strategyId, config, intervalSeconds, collectors })` - deep-validate the finished draft via the health-check plugin's `validateConfiguration` RPC (the same strategy/collector resolution and migrate-then-validate-strict logic the create/GitOps-apply path uses, so propose-time errors match apply-time errors) and surface a confirm card describing the strategy, collectors, interval, and script source. A human approves it (or it auto-applies in `auto` mode), and only then is the health check created.

Steps 1-4 are all `effect: "read"` and auto-run. Only step 5 is a `mutate` tool, so it is the only step gated by the [permission mode](/checkstack/developer-guide/ai/permission-mode/) and the [propose/apply](/checkstack/developer-guide/ai/propose-apply/) confirm card. See `healthcheck.propose` in [Propose and apply](/checkstack/developer-guide/ai/propose-apply/) for its contract.
