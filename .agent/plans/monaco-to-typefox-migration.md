# Plan: migrate the code editor from `monaco-editor` to `@typefox/monaco-editor-react`

Status: **proposed / not started.** Self-contained so it survives a context compaction.

## Why

We use Monaco via `monaco-editor` (ESM) + `@monaco-editor/react`. To make it
behave we've accreted a pile of workarounds, and each new requirement adds
another. Symptoms that triggered the decision:

- Artifact types in the TS script editor "randomly work" — a timing race
  between our `addExtraLib(context.d.ts)` effect and the TS worker picking it
  up.
- Monaco's bundled TS worker calls the language service with **no options**
  (`getCompletionsAtPosition(fileName, position, void 0)`), so it never emits
  bracket-conversion / insert-text completions. We hand-rolled a
  `dottedKeyCompletions` prop + provider just to get
  `context.artifacts["integration-jira.issue"]`.
- The "show suggestion details" panel has no public option, so we flip it open
  via the internal `editor.contrib.suggestController`.
- We maintain custom workers, a `json-template` Monarch tokenizer, three custom
  completion providers, and a ~3 MB lazy stdlib bundle.

`@typefox/monaco-editor-react` is built on `@codingame/monaco-vscode-api` ("real
VS Code services in the browser"). With the VS Code TypeScript language
features, completions/diagnostics/bracket-conversion come from the **actual** VS
Code TS service — no worker hacks, no extra-lib race. It's ESM-native and
actively maintained.

## Hard constraint: I (the agent) cannot run the editor

There is no dev server / browser in this environment, and the `@codingame`
stack is finicky to wire under Vite (service init/overrides, CSS imports, worker
config, version coupling). **A blind big-bang migration cannot be honestly
called "done."** So we work in **stages**, each with a "you code, I test"
checkpoint:

- **I do, per stage:** write the code, run `bun run typecheck`, `bun run lint`,
  and the unit tests that don't need a browser.
- **You do, per stage:** run the dev editor and confirm the stage's behavior
  ("renders? completions? diagnostics? no console errors?").
- **Rollback:** every stage keeps the existing `CodeEditor` public API
  (`CodeEditorProps`) stable and lands behind it (or a temporary flag), so a
  broken stage is revertable without touching consumers.

Do **not** advance to the next stage until you've confirmed the current one.

## Package facts (from the npm registry)

- `@typefox/monaco-editor-react@7.7.0`
  - deps: `@codingame/monaco-vscode-editor-api ^25.1.2`,
    `@codingame/monaco-vscode-extension-api ^25.1.2`, `react >=18`,
    `vscode: npm:@codingame/monaco-vscode-extension-api@^25.1.2`
- Likely also needed (CONFIRM exact names/versions at install time):
  - `@codingame/monaco-vscode-typescript-language-features` (the real TS
    language service — this is what makes completions/diagnostics correct)
  - `monaco-editor-wrapper` (the non-React core; `@typefox/...-react` wraps it)
  - possibly `@codingame/monaco-vscode-theme-defaults-default-extension`,
    `@codingame/monaco-vscode-json-language-features`,
    `...-standalone-typescript-language-features`, etc.
  - All `@codingame/*` packages must share the **same major** (25.x) as the
    `editor-api`. Version skew across `@codingame` packages is the #1 footgun.

> NOTE: `@codingame/monaco-vscode-editor-api` REPLACES `monaco-editor` (it's an
> API-compatible drop-in). Our direct `monaco-editor` imports (markers,
> `monaco.languages.*`, Monarch, `editor.*` types) must be re-pointed at the
> wrapper's monaco instance.

## Current integration surface (what must be ported or dropped)

All under `core/ui/src/components/CodeEditor/`:

- `MonacoEditor.tsx` — defines the `CodeEditor` component + `CodeEditorProps`
  (id, value, onChange, language, minHeight, readOnly, placeholder,
  `typeDefinitions`, `templateProperties`, `shellEnvVars`,
  `dottedKeyCompletions`, `markers`). Contains:
  - `<Editor>` from `@monaco-editor/react`, options block (incl.
    `wordBasedSuggestions:"off"`, `automaticLayout`, theme `vs-dark`).
  - The suggest-details auto-open hack (`editor.contrib.suggestController`).
  - Three `registerCompletionItemProvider`s: template `{{ }}` (driven by
    `templateProperties`, for raw/json/yaml/xml/markdown), `$env` shell (driven
    by `shellEnvVars`), dot→bracket TS/JS (driven by `dottedKeyCompletions`).
  - `addExtraLib(typeDefinitions, file:///context-<modelId>.d.ts)` effect (the
    flaky context-types injection) + `DEFAULT_BACKEND_TYPE_DEFINITIONS`.
  - `json-template` Monarch tokenizer + custom JSON-template validation.
  - External markers via `setModelMarkers(model, "external-validation", …)`.
- `CodeEditor.tsx` — re-exports the component + types from MonacoEditor.
- `index.ts` — barrel.
- `monacoWorkers.ts` — Vite `?worker` bootstrap, `MonacoEnvironment.getWorker`,
  global TS-service config (compilerOptions: ESNext/strict/types node+bun-types;
  diagnosticsOptions: ignore **1108** for top-level `return`; eager model sync),
  `loader.config({ monaco })`.
- `monacoStdlib.ts` — lazy ~3 MB stdlib bundle for TS editors.
- `generateTypeDefinitions.ts` — `jsonSchemaToTypeScript` + `generateTypeDefinitions`
  (used by `automation-frontend/script-context.ts` and healthchecks).
- `scriptContext.ts` — `healthcheckScriptContext` / `integrationScriptContext` /
  `ScriptEditorContext`.
- `templateUtils.ts`, `shellEnvVarMatcher.ts` — provider helpers (unit-tested;
  keep, they're pure).

### Consumers (keep the `CodeEditor` API stable so these don't change)

- `@checkstack/ui` `DynamicForm` → `FormField` → `MultiTypeEditorField` →
  `CodeEditor`. Threads `typeDefinitions` / `shellEnvVars` /
  `dottedKeyCompletions` to ts/js/shell editors; `templateProperties` to
  text/markup editors.
- `automation-frontend`: script actions (TS via `run_script`, shell via
  `run_shell`) — `useVariableScope` builds `typeDefinitions`
  (`generateAutomationContextTypes`), `shellEnvVars` (`fieldsToShellEnvVars`),
  `dottedKeyCompletions` (artifact ids), threaded ActionEditor →
  ProviderActionBody → DynamicForm. Also the YAML editor in `AutomationEditPage`
  (uses `markers` from `computeYamlMarkers`).
- `healthcheck-frontend`: script healthcheck config (TS inline-script, shell
  execute) via `DynamicForm` — same `MultiTypeEditorField` path.

## What the migration should let us DELETE afterward

- `dottedKeyCompletions` prop + provider + the whole threading chain
  (`MonacoEditor`/`CodeEditor`/`MultiTypeEditorField`/`FormField`/`DynamicForm`
  types + `registry-context`/`ActionEditor`/`ProviderActionBody`) — VS Code's TS
  service does bracket-conversion natively.
- The suggest-details auto-open hack (verify VS Code default behavior first).
- The `addExtraLib` race workaround (use the wrapper's extra-libs API properly).
- `monacoWorkers.ts` `?worker` bootstrap + `@monaco-editor/react` +
  `monaco-editor` direct deps (replaced by `@codingame/...-editor-api`).
- Possibly `monacoStdlib.ts` (the VS Code TS features bundle their own libs).

## Stages

### Stage 0 — decisions (no code; resolve before Stage 1)

The Vite **config** itself is NOT the hard part — it's copyable. From
TypeFox's repo `vite.config.ts` the consumer-relevant bits are small:
`worker: { format: 'es' }` (we already do ESM workers); `optimizeDeps.include`
for the `@codingame/monaco-vscode-standalone-*-language-features` we use; and a
COOP/COEP headers middleware. The hard/risky parts are below.

- **COOP/COEP / cross-origin isolation (THE big one).** TypeFox's config sets
  `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` (and `credentialless` via
  middleware) because *"the `*-language-features` extensions use
  `SharedArrayBuffer`"*. `SharedArrayBuffer` needs cross-origin isolation,
  which is **app-wide**: in production the server serving Checkstack must send
  these headers, and then every cross-origin resource (images, scripts, OAuth
  popups, embedded integration UIs, iframes) needs proper CORP/CORS or it
  breaks. For an app with OAuth + integrations this is a real "does it break
  unrelated features?" decision, not config.
  - **DECIDE / verify first:** do the *standalone* TS language features
    (`@codingame/monaco-vscode-standalone-typescript-language-features`)
    actually require SAB/COEP, or only the full extension-host variant
    (`@codingame/monaco-vscode-typescript-language-features`)? If the standalone
    flavor works WITHOUT cross-origin isolation, the whole infra problem
    disappears — pick that. This needs a running build to confirm.
- **Library, not app.** TypeFox's config lives in *their monorepo*. We'd put
  `@codingame` inside `@checkstack/ui`, consumed by a *separate* Vite app
  (the Checkstack frontend) — so the consuming app's Vite config AND its
  production serving infra must adopt worker/optimizeDeps/(maybe headers), not
  just the lib. Confirm where the frontend's `vite.config.ts` lives and that we
  can change it + the prod server headers.
- Confirm bundle-size tolerance (the `@codingame` stack is large).
- Decide: VS Code TS features as a **web worker** (recommended) vs main thread.
- Decide: keep our `json-template` Monarch highlighting, or use VS Code's JSON
  language and drop `{{ }}` highlighting in JSON (templates stay completable via
  our provider regardless).
- Possibly need `@codingame/monaco-vscode-rollup-vsix-plugin` (only if we load
  `.vsix` extensions, e.g. a theme/language extension; their examples use it for
  langium/clangd — likely NOT needed for us).
- **Pull the official `@typefox/monaco-editor-react` README + the React example
  (`packages/examples/react_*`)** to nail the wrapper config + service set.

### Stage 1 — foundation: deps + Vite + a minimal typefox editor
- Install `@typefox/monaco-editor-react` + the matching `@codingame/*` set
  (same 25.x major) + TS language features. Regenerate references if needed.
- Stand up a `TypefoxEditor` component (NOT yet wired into `CodeEditor`) that
  renders a plain TS editor via `<MonacoEditorReactComp wrapperConfig={…}>` with
  the VS Code TS language features enabled.
- Vite config changes as required by `@codingame`.
- **You test:** a throwaway route/story renders the editor; basic TS completion
  + diagnostics work; no console errors; bundle builds.
- Gate: do not proceed until it loads.

### Stage 2 — typed `context` (the original goal)
- Inject our generated `context.d.ts` (`typeDefinitions`) via the wrapper's
  extra-libs / `addExtraLib` equivalent, set up once at editor init (no race).
- **You test:** `context.trigger.payload.*` typed; `context.artifacts["…"]`
  shows real fields (not `unknown`), reliably (not "randomly"); dot→bracket
  conversion works **natively** (no `dottedKeyCompletions` provider).

### Stage 3 — template `{{ }}` completion + text/markup editors
- Re-register the template completion provider against the wrapper's monaco for
  raw/json/yaml/xml/markdown; port the `json-template` highlighting decision
  from Stage 0.
- **You test:** typing `{{` in a text field autocompletes scope fields.

### Stage 4 — shell `$env` editor
- Re-register the `$env` provider for shell; confirm shell language support.
- **You test:** `$` autocompletes the `CHECKSTACK_*` names; full name visible.

### Stage 5 — external markers (validation squiggles)
- Port `setModelMarkers` (YAML validation in `AutomationEditPage`, any others).
- **You test:** invalid definitions squiggle at the right spot.

### Stage 6 — swap `CodeEditor` to typefox behind the stable API
- Make `CodeEditor` delegate to `TypefoxEditor`, keeping `CodeEditorProps`
  identical so DynamicForm/automation/healthcheck consumers are untouched.
- Remove the `dottedKeyCompletions` prop + provider + threading (now native).
- **You test:** automation script editors (TS + shell), healthcheck script
  editors, the automation YAML editor — all end-to-end.

### Stage 7 — cleanup + ship
- Remove `monaco-editor`, `@monaco-editor/react`, `monacoWorkers.ts`, the
  suggest-details hack (if now redundant), `monacoStdlib.ts` (if redundant),
  dead code. Keep pure helpers (`templateUtils`, `shellEnvVarMatcher`,
  `generateTypeDefinitions`, `scriptContext`).
- Bundle-size check vs Stage 0 budget.
- Changeset (minor, beta; note the editor swap) + docs update
  (`docs/.../frontend/config-schemas.md` describes editor behavior).

## Open questions / footguns
- Exact `@codingame/*` package set + versions (must be one cohesive 25.x set).
- Whether the VS Code TS service honors our `compilerOptions` (strict, node +
  bun-types) and the **1108** diagnostic suppression (top-level `return`); if
  not, find the equivalent.
- Reproducing per-editor isolated extra-libs (today keyed by `modelId`) so two
  TS editors with different `context` types don't collide.
- SSR/build: `@codingame` is browser-only; ensure it never loads in any
  non-browser path (tests import `script-context.ts` which deep-imports a pure
  helper to avoid the Monaco barrel — preserve that pattern).
- Theme parity (`vs-dark`) and editor options (`wordBasedSuggestions:"off"`,
  `automaticLayout`, no minimap, etc.).

## Where things stand right now (pre-migration)
The current Monaco editor is fully working with all the workarounds above,
including the just-added `dottedKeyCompletions` dot→bracket provider, the
suggest-details auto-open, `wordBasedSuggestions:"off"`, full-name-in-docs, and
the native-script-context model (typed TS `context`, shell `$CHECKSTACK_*` env
vars, artifact ids qualified to `integration-jira.issue`). All gates green
(typecheck, lint, ~2326 tests). The migration replaces this editor; the
non-editor work (action contract `scope`, `run_script`/`run_shell`, the
`automation-*` changesets) stays.
