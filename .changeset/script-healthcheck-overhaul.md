---
"@checkstack/healthcheck-script-backend": minor
"@checkstack/healthcheck-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/ui": minor
---

Overhaul shell + inline-script health checks with real shell semantics, real ESM execution, and upstream Node/Bun IntelliSense.

**BREAKING CHANGES**

- **Shell collector** — the `Execute Script` collector now takes a single `script` string instead of `{ command, args }`. Existing configs are auto-migrated to v2: `command` + `args` are joined with POSIX single-quote escaping into the new `script` field, so behaviour is preserved. Custom UIs that hard-coded `command`/`args` field names need to switch to `script`.
- **Inline collector** — scripts are now executed as real ES modules in a Bun subprocess (was: `new Function()` inside a Web Worker). The legacy `return X;` style still works (it's auto-wrapped in an async IIFE), but mixed scripts that `import` _and_ `return` at the top level need to use `export default` for their result.

**FIXES**

- Shell scripts containing pipes, redirects, `awk`, command substitution, conditionals etc. no longer fail with `ENOENT`. The collector now runs through `sh -c <script>` instead of passing the full expression as `Bun.spawn`'s argv[0]. This was the original `awk … failed with ENOENT` regression.
- Inline scripts can now `import { loadavg } from "node:os"` (and any other `node:*` or `bun` import). They could not before, because the executor wrapped user code inside `new Function(...)` and ran it in a Web Worker that had no Node module access; the wrapper also made top-level `import` syntactically invalid (`Unexpected token '{'`).
- Healthcheck editor fields no longer reset while you're editing. The page was re-running its form-state init `useEffect` on every refetch of the configuration query — and that query is invalidated on every realtime `HEALTH_CHECK_RUN_COMPLETED` signal across the platform, so in-progress edits got wiped within seconds. Replaced the naive `useEffect([existingConfig])` with a new `useInitOnceForKey` hook from `@checkstack/ui` that initialises the form only on first load per healthcheck id and ignores background refetches. The hook's decision logic is a pure function (`shouldInitForKey`) and is unit-tested in `useInitOnceForKey.test.ts`.
- Switching between healthcheck collectors no longer mis-applies the previous collector's tokenizer / language service to the new editor. `MultiTypeEditorField` was reusing the same React instance across collector switches (same `key="script"` in both `DynamicForm` renders) and `selectedType` was initialised from `useState` only once on first mount. After a shell→typescript switch the new collector's TS content rendered through the shell branch (no TS highlighting, no IntelliSense); the reverse direction tokenised shell content through TS and surfaced nonsense errors like `2304 "Cannot find name 'and'"` on shell comments. Now a `useEffect` re-derives `selectedType` whenever `editorTypes` changes to a set that doesn't contain the current selection.
- Monaco workers are now bundled locally via Vite `?worker` imports and wired up through `MonacoEnvironment.getWorker` in a new `monacoWorkers.ts` module. The default `@monaco-editor/loader` CDN path silently failed CORS on worker scripts in some browsers, leaving Monaco's TS service with only the generic `editorWorkerService` — which is enough for tokenizer-only languages like shell but breaks TypeScript's semantic features entirely. Same module configures the TS service singleton (compiler options, eager-model-sync, diagnostics-options-ignore-1108) at module load instead of inside per-editor `onMount`, so the service starts pre-configured regardless of which language opens first. Migrated from the deprecated `monaco.languages.typescript.*` path to `monaco.typescript.*` (the old path is marked `{ deprecated: true }` in monaco-editor 0.55).
- `defineIntegration` / `defineHealthCheck` callback parameters are now typed against the schema. Previously the virtual module declared them as `(ctx: unknown) => …`, so writing `defineIntegration(async (context) => { console.log(context.event.eventId) })` produced `'context' is of type 'unknown'. (18046)`. The result type and the shared `IntegrationScriptContext` / `HealthCheckScriptContext` interfaces are now generated together in `scriptContext.ts`, so both the function-arg form and the ambient `declare const context` reference the same schema-typed shape.
- The shell starter template no longer uses Linux-only `/proc/loadavg` (which fails on macOS satellites with `awk: can't open file /proc/loadavg`). It now reads the 1-minute load average via `uptime` and parses both the Linux (`load average: 0.00, 0.01, 0.05`) and macOS (`load averages: 0.45 0.55 0.65`) output formats with a portable `sed`/`awk`/`tr` pipeline.
- Starter-template seeding is now self-healing. `DynamicForm`'s schema-defaults `useEffect` fires AFTER child seed effects in React's child-before-parent order, so the previous one-shot seed got clobbered back to `""` by the defaults call on first mount and never re-fired. Replaced the `[]`-deps effect with a two-effect pattern: an observer that latches `hasSeededRef = true` the first time `value` is observed non-empty, and a seed effect that keeps re-installing the starter while the latch is open. Once the seed sticks the latch closes; subsequent edits and realtime refetches don't re-trigger.

**NEW**

- The Monaco editor for inline scripts now mounts the real upstream `@types/node` + `bun-types` declarations as a virtual filesystem (lazy-loaded as its own JS chunk), so IntelliSense covers the full Node/Bun stdlib, the `Bun` global, `process.env`, `Buffer`, etc. DOM types are deliberately excluded so suggestions stay focused on the backend surface. `context.config` is typed from the collector's own JSON Schema.
- New `healthcheckScriptContext` / `integrationScriptContext` helpers (exported from `@checkstack/ui`) build a complete editor bundle in one call: TS declarations (`context.config` / `context.event.payload` + the virtual `@checkstack/healthcheck` / `@checkstack/integration` result-type modules), starter templates per language, and the shell env-var list (with platform-injected `EVENT_ID` / `DELIVERY_ID` / `PAYLOAD_*` for integrations). Both call sites — `CollectorSection.tsx` and `CreateSubscriptionDialog.tsx` — were rewired to use them, fixing a long-standing wiring gap where IntelliSense for injected values silently never reached the editor.
- Inline scripts can now `import { defineHealthCheck } from "@checkstack/healthcheck"` (or `defineIntegration` for integrations) for a typed return-shape assertion. The editor catches `{ success: "yes" }` as a type error against `HealthCheckScriptResult`. The runtime is just an identity function — the collector rewrites the import to a sibling helper file in the temp dir before executing.
- Shell editors now autocomplete env-vars after `$` and `${`. The completion list is supplied by `healthcheckScriptContext` (safe-vars whitelist) and `integrationScriptContext` (whitelist + `EVENT_ID` etc. + `PAYLOAD_*` flattened from the event's payload schema). The matcher is pure and unit-tested in `shellEnvVarMatcher.test.ts` so regex regressions are caught locally.
- Empty editor fields are now seeded with a working starter template per language (inline TS uses `defineHealthCheck`, inline shell does the `awk` load-average check, integration TS shows `defineIntegration` with `context.event`, integration shell lists the `$EVENT_ID` / `$PAYLOAD_*` env vars). Users see a runnable example instead of a blank canvas; once they edit, we leave their content alone.
- Hardened concurrency + cleanup model documented and tested: each invocation gets its own `mkdtemp` directory + UUID result marker; the `finally` block clears the timeout handle, kills any surviving subprocess (idempotent), and removes the temp directory on success, throw, _and_ timeout. New `concurrency.test.ts` proves 20 parallel inline scripts don't cross wires and that the temp-dir count returns to baseline after throws and timeouts.

**TESTING**

Tight unit tests added so changes to the editor surface don't need smoke testing:

- `scriptContext.test.ts` — 18 tests covering the generated type declarations (including explicit regression guards for `defineIntegration` / `defineHealthCheck` callback params being typed against the shared context interface rather than `unknown`), starter templates (including a guard that the shell starter doesn't depend on Linux-only `/proc/loadavg`), shell env-vars for both healthcheck + integration flavours, plus the schema-flattening utility.
- `shellEnvVarMatcher.test.ts` — 12 tests covering the bare `$` / braced `${` / partial-name / case-insensitive matching logic that powers Monaco's shell completion.
- `inline-script-normaliser.test.ts` — 13 tests covering the legacy `return X;` → IIFE wrap path, the ESM-passthrough path, and the `@checkstack/healthcheck` import rewriter.
- `inline-script-collector.test.ts` — 18 tests including ones that actually execute a script importing `defineHealthCheck` (named-import form) AND using the global `defineHealthCheck` (no import) to prove both code paths resolve at runtime.
- `concurrency.test.ts` — 4 tests proving 20 parallel runs don't collide and that the temp-dir count returns to baseline after success, throw, and timeout.
- `useInitOnceForKey.test.ts` — 10 tests proving the healthcheck-editor form state isn't reset when react-query refetches in the background (the original "fields reset while I'm typing" regression).
- `starterTemplateSelector.test.ts` — 7 tests for the pure decision function powering empty-field seeding.
- `security.test.ts` — added an integration test that actually executes the portable load-average pipeline through `Bun.spawn` on the current OS, catching `/proc/loadavg`-style regressions at CI time on macOS runners.

**SECURITY**

- Same env-var whitelist as before (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`). Backend secrets in the satellite process's environment remain invisible to user scripts.

See `docs/src/content/docs/backend/script-healthchecks.md` for the full user-facing guide.
