# @checkstack/integration-script-backend

## 0.3.0

### Minor Changes

- a06b899: Extract shared `EsmScriptRunner` + `ShellScriptRunner` utilities, fix HIGH-severity privilege amplification in the integration TS provider, and harden the integration shell setupGuide example.

  **SECURITY FIX (HIGH)**

  The integration TS provider (`@checkstack/integration-script-backend` → `scriptProvider`) previously executed user scripts via `new Function(script)` in the satellite's main V8 isolate. A user with `integrationAccess.manage` could read `globalThis.process.env` directly (`DATABASE_URL`, `JWT_SECRET`, queue credentials, signing keys, …) and exfiltrate them through `result.id` — which round-trips into `delivery_logs.externalId` and is readable via the `getDeliveryLog` ORPC procedure. The same permission grants no legitimate API to those secrets; this was a privilege amplification.

  The provider now runs user scripts in a fresh Bun subprocess (matching the healthcheck inline-script collector model). The subprocess receives only a curated `SAFE_ENV_VARS` whitelist (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`) — backend secrets are no longer visible to user code. Filesystem reads, network calls (`fetch`), and the rest of the Node/Bun standard library continue to work, just in an isolated process.

  **BREAKING CHANGE (`@checkstack/integration-script-backend`)**

  User scripts can no longer read the satellite process's environment variables (`process.env.DATABASE_URL` etc. return `undefined`). Scripts that legitimately need configuration should accept it via the provider's `script` field input, not by introspecting the host environment. The full Node/Bun stdlib remains available; only the env scrub is new.

  **REFACTOR — new shared utilities in `@checkstack/backend-api`**

  Both the healthcheck and integration plugins had near-identical inline implementations of "run a user script in a subprocess sandbox" (ESM path) and "run a user shell script through `sh -c`" (shell path). These are now canonical, single-source-of-truth utilities:

  - **`defaultEsmScriptRunner.run({ script, context, timeoutMs, helperModuleName?, helperFunctionName? })`** — writes the user module to a fresh `mkdtemp` directory along with a generated runner module, spawns a Bun subprocess with `pickSafeEnv()`, parses the result back through a UUID-tagged stderr marker, and tears everything down in `finally` (`clearTimeout` + `proc.kill()` + recursive `rm`). The optional `helperModuleName` / `helperFunctionName` pair drops a sibling `_helpers.mjs` file and rewrites `import { <fn> } from "<module>"` to point at it (this is the trick that makes `@checkstack/healthcheck` / `@checkstack/integration` resolve at runtime even though they're not real npm packages).
  - **`defaultShellScriptRunner.run({ script, timeoutMs, cwd?, env? })`** — invokes `sh -c <script>` via `Bun.spawn` with `SAFE_ENV_VARS` (user-supplied `env` merged on top), `Promise.race` timeout with `proc.kill()` on expiry, and the same `clearTimeout` + `proc.kill()` cleanup in `finally`.

  Both runners expose `EsmScriptRunner` / `ShellScriptRunner` interfaces so tests can inject mocks without touching the spawn path. The four call sites (`plugins/healthcheck-script-backend/src/inline-script-collector.ts`, `strategy.ts` and `plugins/integration-script-backend/src/provider.ts`, `shell-provider.ts`) collapse from full inline implementations to ~8-line adapters.

  **FIXES**

  - Integration shell provider's `setupGuide` example replaced the unsafe `curl -d "{\"title\": \"$PAYLOAD_TITLE\"}"` JSON interpolation with a `jq -n --arg title "$PAYLOAD_TITLE" '{title: $title}'` pattern. The previous example demonstrated a shell-injection vulnerability whenever event payload values contained shell-special or JSON-special characters (which they can, since payloads come from other plugins / events / GitOps reconciles).
  - The shared shell runner adds `clearTimeout` + idempotent `proc?.kill()` in `finally`, fixing a leaked event-loop timer in the integration shell provider's previous inline implementation.

  **TESTS**

  - New `core/backend-api/src/esm-script-runner.test.ts` covering `normaliseUserScript` + `rewriteHelperImports` across both healthcheck and integration helper-module names, including regex-metacharacter escape coverage.
  - The plugin-local `inline-script-normaliser.test.ts` was deleted; the same coverage (plus more) lives at the canonical location with the utility.
  - Integration TS provider console-logging tests updated: in the subprocess model, `console.warn` and `console.error` both write to stderr (Bun matches Node), so the provider forwards every stderr line to `logger.error`. `console.log({…})` uses Bun's native `util.inspect` format rather than `JSON.stringify`, so the JSON-logging test now asserts on substring presence instead of strict serialisation.

  2047 tests pass, lint + typecheck clean.

### Patch Changes

- a06b899: Dead-code audit cleanup and a small platform of shared notification helpers.

  **Removed (dead code)**

  - `core/backend/src/plugin-manager/deregistration-guard.ts` deleted. The exported `assertCanDeregister()` was never called and was a less-complete version of the dependents+isUninstallable checks already done inline by `previewUninstallOriginator` / `uninstallOriginator` in `plugin-manager-orchestrator.ts`.
  - `createMockQueueFactory` deprecated alias removed from `@checkstack/test-utils-backend`. Use `createMockQueueManager` directly.

  **New shared helpers**

  - `@checkstack/backend-api` now exports `requestTimeoutMs()` — a Zod field builder for outbound HTTP request timeouts (1s..60s, default 10s). Replaces hand-rolled `configNumber({}).min(1000).max(60_000).default(10_000)` in `integration-webhook-backend`, `integration-script-backend`, and `healthcheck-script-backend`'s inline collector.
  - `@checkstack/notification-common` now exports `SubjectStatusSchema` / `SubjectStatus`, mirroring the existing `ImportanceSchema`.
  - `@checkstack/notification-backend` now exports:
    - `SUBJECT_STATUS_EMOJI` / `IMPORTANCE_EMOJI` — the shared status / importance emoji maps that Discord, Slack, Teams, Webex and Telegram previously each redefined inline.
    - `postJson(opts)` — a timeout-bounded `fetch` wrapper that handles non-2xx logging and error mapping for webhook-style POSTs. Returns `{ ok: true, response } | { ok: false, error }`.

  **Migrated to shared helpers**

  - Discord, Slack, Gotify, Pushover notification backends now use `postJson`. Outer try/catch + per-plugin error mapping deleted (~140 LOC).
  - Discord, Slack, Teams, Telegram, Webex notification backends now use `IMPORTANCE_EMOJI`. Discord, Slack, Teams use `SUBJECT_STATUS_EMOJI`.
  - Teams, Webex, Backstage, Telegram kept their inline fetch/Bot logic: their error strings surface server response bodies to operators, or the transport isn't raw `fetch` (Telegram uses `grammy`'s `Bot`).

  **API surface tightening**

  - Per-plugin test-only re-exports in 6 notification backends (Pushover, Gotify, Backstage, Slack, Discord, Teams) and the `CertificateInfo` interface in `healthcheck-tls-backend/strategy.ts` are now JSDoc-tagged `@internal`. No behaviour change; signals that downstream consumers must not depend on them.

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/integration-backend@0.1.28

## 0.2.18

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/integration-backend@0.1.27

## 0.2.17

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/integration-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/integration-backend@0.1.26

## 0.2.16

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/integration-backend@0.1.25
  - @checkstack/integration-common@0.3.2

## 0.2.15

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/integration-common@0.3.1
  - @checkstack/integration-backend@0.1.24

## 0.2.14

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/integration-backend@0.1.23
  - @checkstack/common@0.7.0
  - @checkstack/integration-common@0.3.0

## 0.2.13

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/integration-backend@0.1.22
  - @checkstack/backend-api@0.14.0

## 0.2.12

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/integration-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/integration-backend@0.1.21

## 0.2.11

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/integration-backend@0.1.20
  - @checkstack/integration-common@0.2.9

## 0.2.10

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/integration-backend@0.1.19

## 0.2.9

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/integration-backend@0.1.18
  - @checkstack/integration-common@0.2.8

## 0.2.8

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/integration-backend@0.1.17

## 0.2.7

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/integration-backend@0.1.16

## 0.2.6

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/integration-backend@0.1.15

## 0.2.5

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/integration-backend@0.1.14

## 0.2.4

### Patch Changes

- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/integration-backend@0.1.13
  - @checkstack/integration-common@0.2.7

## 0.2.3

### Patch Changes

- d73e33e: Security fix: Prevent environment variable leakage to child processes.
- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/integration-backend@0.1.12
  - @checkstack/integration-common@0.2.6

## 0.2.2

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/integration-backend@0.1.11

## 0.2.1

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/integration-backend@0.1.10

## 0.2.0

### Minor Changes

- f676e11: Add script execution support and migrate CodeEditor to Monaco

  **Integration providers** (`@checkstack/integration-script-backend`):

  - **Script** - Execute TypeScript/JavaScript with context object
  - **Bash** - Execute shell scripts with environment variables ($EVENT*ID, $PAYLOAD*\*)

  **Health check collectors** (`@checkstack/healthcheck-script-backend`):

  - **InlineScriptCollector** - Run TypeScript directly for health checks
  - **ExecuteCollector** - Bash syntax highlighting for command field

  **CodeEditor migration to Monaco** (`@checkstack/ui`):

  - Replaced CodeMirror with Monaco Editor (VS Code's editor)
  - Full TypeScript/JavaScript IntelliSense with custom type definitions
  - Added `generateTypeDefinitions()` for JSON Schema → TypeScript conversion
  - Removed all CodeMirror dependencies

  **Type updates** (`@checkstack/common`):

  - Added `javascript`, `typescript`, and `bash` to `EditorType` union

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/integration-backend@0.1.9
  - @checkstack/integration-common@0.2.5
