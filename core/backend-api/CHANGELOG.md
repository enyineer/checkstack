# @checkstack/backend-api

## 0.17.1

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/cache-api@0.3.5
  - @checkstack/queue-api@0.3.5

## 0.17.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/signal-common@0.2.4
  - @checkstack/cache-api@0.3.4
  - @checkstack/queue-api@0.3.4

## 0.16.0

### Minor Changes

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

- @checkstack/cache-api@0.3.3
- @checkstack/queue-api@0.3.3
- @checkstack/healthcheck-common@1.1.1

## 0.15.3

### Patch Changes

- 1909a61: Address open CodeQL code-scanning findings:

  - **`@checkstack/ui` (`LinksEditor`)**: validate URL scheme on render and on
    add; only `http:` / `https:` URLs are accepted, defeating stored XSS via
    `javascript:` / `data:` schemes in user-supplied hotlinks
    (`js/xss-through-dom`).
  - **`@checkstack/backend-api` (`markdownToPlainText`)**: decode HTML entities
    before stripping tags, then strip tags in a loop until the output
    stabilizes. Decoding `&amp;` last avoids reintroducing tag delimiters
    via `&amp;lt;` round-trips (`js/double-escaping`,
    `js/incomplete-multi-character-sanitization`).
  - **`@checkstack/backend` (`createScopedWsRegistry`)**: drop the
    identity-replacement on the path suffix; the leading-slash invariant
    is documented on `WebSocketRouteRegistry` (`js/identity-replacement`).

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

  - @checkstack/cache-api@0.3.2
  - @checkstack/queue-api@0.3.2

## 0.15.2

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/queue-api@0.3.1

## 0.15.1

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-common@0.2.2

## 0.15.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/common@0.8.0
  - @checkstack/queue-api@0.2.18
  - @checkstack/cache-api@0.2.4
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/signal-common@0.2.1

## 0.14.1

### Patch Changes

- 302cd3f: fix: resilient startup routing + /health and /ready endpoints

  Three fixes that together eliminate startup-race errors during boot and
  hot-reload, plus a new readiness API for plugins.

  1. **TrieRouter swap (root cause).** Hono's default `SmartRouter` freezes
     its matcher on the first request — any later `app.add()` throws
     `MESSAGE_MATCHER_IS_ALREADY_BUILT`. Plugins register routes during
     `init()` (and at runtime via `loadSinglePlugin`), so an early request
     during boot would silently lock the matcher with only the module-load
     routes, and every later route registration would fail. The backend
     now uses `TrieRouter`, which is incremental — routes can be added at
     any time, including after thousands of requests have been served.
     This also future-proofs runtime plugin install.

  2. **Init gating + fail-loud.** Non-bypass requests now `await` an
     `initPromise` (with a 30s timeout that returns 503 + Retry-After) so
     no traffic reaches Hono before plugins finish registering routes.
     Init failures crash the process via `process.exit(1)` so docker/k8s
     restart cleanly instead of silently serving a half-initialized
     backend.

  3. **`/assets/*` fall-through.** The production frontend asset handler
     now calls `next()` instead of `c.notFound()` on miss, so
     plugin-asset routes registered later (`/assets/plugins/:pluginName/*`)
     actually get a chance to match.

  ### New: platform endpoints under `/.checkstack/*`

  - `GET /.checkstack/health` — liveness, always 200 once the process is up.
  - `GET /.checkstack/ready` — readiness, 503 until init completes and all
    critical probes pass; 200 otherwise. Returns `{ ready, checks: [...] }`
    with per-probe status, message/error and duration.

  The leading `.checkstack/` prefix namespaces platform-level endpoints
  away from plugin `/api/*`, runtime frontend assets, and the SPA wildcard,
  leaving room for additional operator endpoints in the future.

  ### New: plugin readiness API

  Plugins can contribute readiness probes via the new
  `coreServices.readinessRegistry` service:

  ```ts
  registerInit({
    deps: { readiness: coreServices.readinessRegistry },
    async init({ readiness }) {
      readiness.register({
        name: "queue.connected",
        critical: true,
        check: async () => ({
          ok: pool.isConnected(),
          message: pool.isConnected() ? undefined : "queue pool not connected",
        }),
      });
    },
  });
  ```

  Probes run in parallel, throwing probes are reported as `ok: false`,
  and non-critical probes don't block readiness.

  - @checkstack/cache-api@0.2.3
  - @checkstack/queue-api@0.2.17
  - @checkstack/common@0.7.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/signal-common@0.2.0

## 0.14.0

### Minor Changes

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

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

- 32d52c6: Fix and improve password reset flow + email branding:

  - **Fix**: password reset emails were failing with "Malformed password reset URL: missing token parameter". Better-auth puts the reset token in the URL path (`/reset-password/{token}`), not as a `?token=` query param, so the previous URL-parsing logic always failed. Now uses the `token` argument better-auth passes to `sendResetPassword` directly.
  - **UX**: the reset password page now validates the token on load via a new anonymous `validateResetToken` endpoint, so users see "Invalid Link" / "Link Expired" before typing a password rather than after submitting. Tokens are 24-char nanoid-style values (~143 bits of entropy), so exposing validity does not enable enumeration.
  - **Fix**: transactional notifications were hardcoded to `importance: "critical"`, causing password reset emails to display a misleading "CRITICAL" badge. The `sendTransactional` contract now accepts an optional `importance` field that defaults to `"info"`.
  - **Branding**: redesigned the email layout (`wrapInEmailLayout`) with a Checkstack-style engineering aesthetic — dark header with grid pattern, monospace importance badge, hardened CTA button (Outlook VML fallback + explicit text color), and force-light color scheme to prevent client auto-inversion from breaking text legibility.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/cache-api@0.2.2
  - @checkstack/queue-api@0.2.16

## 0.13.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/cache-api@0.2.1
  - @checkstack/queue-api@0.2.15

## 0.13.0

### Minor Changes

- 8d1ef12: ## Infrastructure Configuration Shell & Cache System

  ### New Packages

  - **`@checkstack/cache-api`**: Core cache abstractions — `CacheProvider` interface, `createScopedCache` factory for plugin key isolation, `CachePlugin`/`CacheManager` lifecycle interfaces.
  - **`@checkstack/cache-common`**: Shared cache types, RPC contract (`getPlugins`, `getConfiguration`, `updateConfiguration`), access rules, and plugin metadata.
  - **`@checkstack/cache-backend`**: Cache settings RPC router — exposes plugin discovery, configuration read/write endpoints with access-gated authorization.
  - **`@checkstack/cache-frontend`**: Cache configuration tab component for the Infrastructure Settings page.
  - **`@checkstack/infrastructure-common`**: Infrastructure tab registry, routes, and shared types for the IDE-style configuration shell.
  - **`@checkstack/infrastructure-frontend`**: Infrastructure Settings page with vertical tab bar, per-tab access control, and user menu integration.

  ### Modified Packages

  - **`@checkstack/backend-api`**: Added `cachePluginRegistry` and `cacheManager` to `RpcContext` and `coreServices`.
  - **`@checkstack/backend`**: Registered cache services in boot sequence, added cache config loading, extended dependency sorter for cache plugin ordering.
  - **`@checkstack/queue-frontend`**: Refactored from standalone `/queue/config` route to an infrastructure tab. Queue settings now live inside the Infrastructure Settings page.

  ### Architecture

  The former monolithic Queue Config page is replaced by a pluggable Infrastructure Settings shell (`/infrastructure/config`). Plugins register configuration tabs via `registerInfrastructureTab()` with their own access rules, icons, and components. The shell evaluates per-tab access and only renders tabs the user can see.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.12.0

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

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/queue-api@0.2.13

## 0.11.1

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
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.11.0

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

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/queue-api@0.2.11

## 0.10.1

### Patch Changes

- Updated dependencies [1f191cf]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/queue-api@0.2.10

## 0.10.0

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

### Patch Changes

- @checkstack/queue-api@0.2.9

## 0.9.0

### Minor Changes

- c0c0ed2: Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.

### Patch Changes

- @checkstack/queue-api@0.2.8

## 0.8.2

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/queue-api@0.2.7
  - @checkstack/signal-common@0.1.8

## 0.8.1

### Patch Changes

- 0ebbe56: Security Vulnerability Remediation completed:
  - Refactored core authorization to Fail-Closed architecture with secure defaults.
  - Implemented `assertTeamManagementAccess` to resolve BOLA in Teams Management.
  - Protected internal S2S capabilities via explicit wildcard `serviceScope` definitions.
  - Disarmed OS Command Injection in DiskCollector via strict regex validation and bash escaping.
  - Re-architected inline script processing executing scripts in sandboxed Web Worker contexts.
  - Isolated subprocess environment scopes in PingStrategy limiting variable leakage.
  - Enforced strict token/API Key parsing with URLSearchParams checking.
  - Explicitly fail-fast on missing DATABASE_URL configuration across independent backend clusters.
  - Activated strict HTTP Security Headers (HSTS, CSP, X-Frame-Options) across the API automatically.
- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3
  - @checkstack/queue-api@0.2.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/signal-common@0.1.7

## 0.8.0

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

### Patch Changes

- @checkstack/queue-api@0.2.5

## 0.7.0

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

### Patch Changes

- @checkstack/queue-api@0.2.4

## 0.6.0

### Minor Changes

- 48c2080: Migrate aggregation from batch to incremental (`mergeResult`)

  ### Breaking Changes (Internal)

  - Replaced `aggregateResult(runs[])` with `mergeResult(existing, run)` interface across all HealthCheckStrategy and CollectorStrategy implementations

  ### New Features

  - Added incremental aggregation utilities in `@checkstack/backend-api`:
    - `mergeCounter()` - track occurrences
    - `mergeAverage()` - track sum/count, compute avg
    - `mergeRate()` - track success/total, compute %
    - `mergeMinMax()` - track min/max values
  - Exported Zod schemas for internal state: `averageStateSchema`, `rateStateSchema`, `minMaxStateSchema`, `counterStateSchema`

  ### Improvements

  - Enables O(1) storage overhead by maintaining incremental aggregation state
  - Prepares for real-time hourly aggregation without batch accumulation

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2
  - @checkstack/signal-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.5.2

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1
  - @checkstack/queue-api@0.2.2
  - @checkstack/signal-common@0.1.5

## 0.5.1

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/signal-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.5.0

### Minor Changes

- 66a3963: Add `SafeDatabase` type to prevent Drizzle relational query API usage at compile-time

  - Added `SafeDatabase<S>` type that omits the `query` field from Drizzle's `NodePgDatabase`
  - Updated `DatabaseDeps` to use `SafeDatabase` for all plugin database injection
  - Updated `RpcContext.db` and `coreServices.database` to use the safe type
  - Updated test utilities to use `SafeDatabase`

  This change prevents accidental usage of the relational query API (`db.query`) which is blocked at runtime by the scoped database proxy.

### Patch Changes

- Updated dependencies [2c0822d]
  - @checkstack/queue-api@0.2.0

## 0.4.1

### Patch Changes

- 8a87cd4: Fixed anonymous user access to public endpoints with instance-level access rules

  The RPC middleware now correctly checks if anonymous users have global access via the anonymous role before denying access to single-resource public endpoints. Also added support for contract-level `instanceAccess` override allowing bulk endpoints to share the same access rule as single endpoints.

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/queue-api@0.1.3
  - @checkstack/signal-common@0.1.3

## 0.4.0

### Minor Changes

- 83557c7: ## Multi-Type Editor Schema Support

  - Added `editorTypes` support to zod-config for multi-type editor fields
  - Extended schema-utils to handle editor type annotations

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0
  - @checkstack/queue-api@0.1.2
  - @checkstack/signal-common@0.1.2

## 0.3.3

### Patch Changes

- d94121b: Add group-to-role mapping for SAML and LDAP authentication

  **Features:**

  - SAML and LDAP users can now be automatically assigned Checkstack roles based on their directory group memberships
  - Configure group mappings in the authentication strategy settings with dynamic role dropdowns
  - Managed role sync: roles configured in mappings are fully synchronized (added when user gains group, removed when user leaves group)
  - Unmanaged roles (manually assigned, not in any mapping) are preserved during sync
  - Optional default role for all users from a directory

  **Bug Fix:**

  - Fixed `x-options-resolver` not working for fields inside arrays with `.default([])` in DynamicForm schemas
  - @checkstack/queue-api@0.1.1

## 0.3.2

### Patch Changes

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

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/signal-common@0.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6

## 0.3.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

- 827b286: Add array assertion operators for string array fields

  New operators for asserting on array fields (e.g., playerNames in RCON collectors):

  - **includes** - Check if array contains a specific value
  - **notIncludes** - Check if array does NOT contain a specific value
  - **lengthEquals** - Check if array length equals a value
  - **lengthGreaterThan** - Check if array length is greater than a value
  - **lengthLessThan** - Check if array length is less than a value
  - **isEmpty** - Check if array is empty
  - **isNotEmpty** - Check if array has at least one element

  Also exports a new `arrayField()` schema factory for creating array assertion schemas.

### Patch Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

- aa4a8ab: Fix anonymous users not seeing public list endpoints

  Anonymous users with global access rules (e.g., `catalog.system.read` assigned to the "anonymous" role) were incorrectly getting empty results from list endpoints with `instanceAccess.listKey`. The middleware now properly checks if anonymous users have global access before filtering.

  Added comprehensive test suite for `autoAuthMiddleware` covering:

  - Anonymous endpoints (userType: "anonymous")
  - Public endpoints with global and instance-level access rules
  - Authenticated, user-only, and service-only endpoints
  - Single resource access with team-based filtering

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/queue-api@0.0.5

## 0.2.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

### Patch Changes

- 97c5a6b: Fix collector lookup when health check is assigned to a system

  Collectors are now stored in the registry with their fully-qualified ID format (ownerPluginId.collectorId) to match how they are referenced in health check configurations. Added `qualifiedId` field to `RegisteredCollector` interface to avoid re-constructing the ID at query time. This fixes the "Collector not found" warning that occurred when executing health checks with assigned systems.

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.1.0

### Minor Changes

- f5b1f49: Added collector registry lifecycle cleanup during plugin unloading.

  - Added `unregisterByOwner(pluginId)` to remove collectors owned by unloading plugins
  - Added `unregisterByMissingStrategies(loadedPluginIds)` for dependency-based pruning
  - Integrated registry cleanup into `PluginManager.deregisterPlugin()`
  - Updated `registerCoreServices` to return global registries for lifecycle management

### Patch Changes

- f5b1f49: Added JSONPath assertions for response body validation and fully qualified strategy IDs.

  **JSONPath Assertions:**

  - Added `healthResultJSONPath()` factory in healthcheck-common for fields supporting JSONPath queries
  - Extended AssertionBuilder with jsonpath field type showing path input (e.g., `$.data.status`)
  - Added `jsonPath` field to `CollectorAssertionSchema` for persistence
  - HTTP Request collector body field now supports JSONPath assertions

  **Fully Qualified Strategy IDs:**

  - HealthCheckRegistry now uses scoped factories like CollectorRegistry
  - Strategies are stored with `pluginId.strategyId` format
  - Added `getStrategiesWithMeta()` method to HealthCheckRegistry interface
  - Router returns qualified IDs so frontend can correctly fetch collectors

  **UI Improvements:**

  - Save button disabled when collector configs have invalid required fields
  - Fixed nested button warning in CollectorList accordion

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/signal-common@0.0.2

## 1.1.0

### Minor Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

### Patch Changes

- b4eb432: Fixed TypeScript generic contravariance issue in notification strategy registration.

  The `register` and `addStrategy` methods now use generic type parameters instead of `unknown`, allowing notification strategy plugins with typed OAuth configurations to be registered without compiler errors. This fixes contravariance issues where function parameters in `StrategyOAuthConfig<TConfig>` could not be assigned when `TConfig` was a specific type.

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/signal-common@0.1.1

## 1.0.0

### Major Changes

- 81f3f85: ## Breaking: Unified Versioned<T> Architecture

  Refactored the versioning system to use a unified `Versioned<T>` class instead of separate `VersionedSchema`, `VersionedData`, and `VersionedConfig` types.

  ### Breaking Changes

  - **`VersionedSchema<T>`** is replaced by `Versioned<T>` class
  - **`VersionedData<T>`** is replaced by `VersionedRecord<T>` interface
  - **`VersionedConfig<T>`** is replaced by `VersionedPluginRecord<T>` interface
  - **`ConfigMigration<F, T>`** is replaced by `Migration<F, T>` interface
  - **`MigrationChain<T>`** is removed (use `Migration<unknown, unknown>[]`)
  - **`migrateVersionedData()`** is removed (use `versioned.parse()`)
  - **`ConfigMigrationRunner`** is removed (migrations are internal to Versioned)

  ### Migration Guide

  Before:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: {
      version: 1,
      schema: mySchema,
      migrations: [],
    },
  };
  const data = await migrateVersionedData(stored, 1, migrations);
  ```

  After:

  ```typescript
  const strategy: HealthCheckStrategy = {
    config: new Versioned({
      version: 1,
      schema: mySchema,
      migrations: [],
    }),
  };
  const data = await strategy.config.parse(stored);
  ```

### Minor Changes

- ffc28f6: ### Anonymous Role and Public Access

  Introduces a configurable "anonymous" role for managing permissions available to unauthenticated users.

  **Core Changes:**

  - Added `userType: "public"` - endpoints accessible by both authenticated users (with their permissions) and anonymous users (with anonymous role permissions)
  - Renamed `userType: "both"` to `"authenticated"` for clarity
  - Renamed `isDefault` to `isAuthenticatedDefault` on Permission interface
  - Added `isPublicDefault` flag for permissions that should be granted to the anonymous role by default

  **Backend Infrastructure:**

  - New `anonymous` system role created during auth-backend initialization
  - New `disabled_public_default_permission` table tracks admin-disabled public defaults
  - `autoAuthMiddleware` now checks anonymous role permissions for unauthenticated public endpoint access
  - `AuthService.getAnonymousPermissions()` with 1-minute caching for performance
  - Anonymous role filtered from `getRoles` endpoint (not assignable to users)
  - Validation prevents assigning anonymous role to users

  **Catalog Integration:**

  - `catalog.read` permission now has both `isAuthenticatedDefault` and `isPublicDefault`
  - Read endpoints (`getSystems`, `getGroups`, `getEntities`) now use `userType: "public"`

  **UI:**

  - New `PermissionGate` component for conditionally rendering content based on permissions

- 71275dd: fix: Anonymous and non-admin user authorization

  - Fixed permission metadata preservation in `plugin-manager.ts` - changed from outdated `isDefault` field to `isAuthenticatedDefault` and `isPublicDefault`
  - Added `pluginId` to `RpcContext` to enable proper permission ID matching
  - Updated `autoAuthMiddleware` to prefix contract permission IDs with the pluginId from context, ensuring that contract permissions (e.g., `catalog.read`) correctly match database permissions (e.g., `catalog-backend.catalog.read`)
  - Route now uses `/api/:pluginId/*` pattern with Hono path parameters for clean pluginId extraction

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkstack/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkstack/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkstack/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkstack/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkstack/healthcheck-frontend:**

  - Updated `SystemHealthBadge` to use new backend endpoint

- b55fae6: Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

  ## New Packages

  - **@checkstack/signal-common**: Shared types including `Signal`, `SignalService`, `createSignal()`, and WebSocket protocol messages
  - **@checkstack/signal-backend**: `SignalServiceImpl` with EventBus integration and Bun WebSocket handler using native pub/sub
  - **@checkstack/signal-frontend**: React `SignalProvider` and `useSignal()` hook for consuming typed signals

  ## Changes

  - **@checkstack/backend-api**: Added `coreServices.signalService` reference for plugins to emit signals
  - **@checkstack/backend**: Integrated WebSocket server at `/api/signals/ws` with session-based authentication

  ## Usage

  Backend plugins can emit signals:

  ```typescript
  import { coreServices } from "@checkstack/backend-api";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  const signalService = context.signalService;
  await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { ... });
  ```

  Frontend components subscribe to signals:

  ```tsx
  import { useSignal } from "@checkstack/signal-frontend";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  useSignal(NOTIFICATION_RECEIVED, (payload) => {
    // Handle realtime notification
  });
  ```

- b354ab3: # Strategy Instructions Support & Telegram Notification Plugin

  ## Strategy Instructions Interface

  Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

  - **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
  - **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

  ### Updated Components

  - `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
  - `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
  - `UserChannelCard` renders `userInstructions` when users need to connect

  ## New Telegram Notification Plugin

  Added `@checkstack/notification-telegram-backend` plugin for sending notifications via Telegram:

  - Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
  - Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
  - Includes comprehensive admin instructions for bot setup via @BotFather
  - Includes user instructions for account linking

  ### Configuration

  Admins need to configure a Telegram Bot Token obtained from @BotFather.

  ### User Linking

  The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [b55fae6]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/signal-common@0.1.0
