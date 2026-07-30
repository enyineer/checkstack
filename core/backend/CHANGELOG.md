# @checkstack/backend

## 0.26.0

### Minor Changes

- 88f4333: Show the platform release version on the About page

  The About page showed only `@checkstack/backend`'s package version, which cannot
  be matched to a GitHub release, a Docker tag or a changelog entry - those all
  carry `@checkstack/release`'s version, which advances on every release while the
  core package's does not.

  Both are now shown, explicitly labelled, with the release version leading and
  linked to its GitHub tag.

  The release version is baked in at version time by a new
  `generate:release-version` script (checked in CI, mirroring the docs index)
  rather than read at runtime: `@checkstack/release` is private and therefore
  absent from `node_modules` in an npm install, so a relative-path read would work
  in the monorepo and Docker image and silently fail everywhere else.

### Patch Changes

- 1deaac5: Make endpoint authorization self-documenting in the generated API docs

  Every procedure's authorization is now derived from its contract metadata (its
  `access` rules + `instanceAccess` mode) via a shared mode-descriptor registry and
  emitted into the OpenAPI spec - both structurally (`x-orpc-meta.authorization`)
  and as a human `**Authorization.**` sentence folded into the operation
  description. Previously the docs surfaced only a flat list of global rule ids, so
  an integrator (an API-key/application principal that CAN hold team grants) never
  saw the team-grant / per-object dimension, and endpoints gated purely in the
  handler showed no restriction at all.

  For authorization that no declarative mode can express and is therefore enforced
  in the handler (a compound OR, a graded verdict, a DB-derived id set), a new
  optional `accessNote` on the procedure metadata surfaces the real rule in the
  docs as an explicitly handler-enforced addendum. The note is documentation, not a
  guarantee: per `.claude/rules/rlac.md` the drift guard for such authz is
  behavioral tests over an extracted pure decision function, and the note must
  state exactly what those tests pin.

  Every handler-enforced authorization endpoint now carries such a note so the docs
  are complete: the team read/scoping and team-management endpoints
  (`@checkstack/auth-common`), the health-check assignment/history reads
  (`@checkstack/healthcheck-common`), the audience-graded incident/maintenance
  reads (`@checkstack/incident-common`, `@checkstack/maintenance-common`), status
  -page publish's bound-resource check (`@checkstack/status-page-common`), the
  stream `setSystemLinks` readable-additions check
  (`@checkstack/{metricstream,tracestream,logstream}-common`), and the automation
  `runAs` escalation guard (`@checkstack/automation-common`). These are
  metadata-only additions - no runtime behavior changed. The notes describe the
  rule for API-doc readers only; the drift guard is behavioral tests over the
  check's decision function (per `.claude/rules/rlac.md`), so the notes name no
  internal test files.

  The API docs viewer (`@checkstack/api-docs-frontend`) now renders each
  operation's description as Markdown, so the `**Authorization.**` block (and any
  inline `code`) formats correctly instead of showing raw markdown.

- bd60aff: Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

  - `tar` 7.5.20 → 7.5.21 (GHSA-r292-9mhp-454m)
  - `brace-expansion` 5.0.7 → 5.0.8 (CVE-2026-14257)

- 1deaac5: Add the `objectRef` instanceAccess mode and move the relation-write authz onto it

  The relation-tuple writes (`writeRelation` / `removeRelation` / `setObjectPublic`)
  administer team access on ANY resource type, so their authorization could not be
  expressed by the existing `instanceAccess` modes (which all assume a fixed
  resource type) and was enforced by hand in the auth handlers with `access: []` -
  leaving the contract unable to declare the rule and the API docs showing no
  restriction.

  A new `objectRef` mode reads the object's TYPE and id from the request body
  (`typeParam` / `idParam`) and authorizes via the same engine native scoping uses:
  the endpoint's own access rule (`auth.teams.manage`) is the global admin
  OR-override, otherwise the caller must be able to manage the referenced object
  (its own `<type>.manage` rule on a non-private object, or a team editor/owner
  grant on it). `autoAuthMiddleware` enforces it, the boot validator recognises it
  (input paths cross-checked), and the auth handlers drop their hand-rolled checks.
  Behaviour is unchanged; the authorization is now contract-declared and enforced
  by the middleware rather than the handler.

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/auth-common@0.17.0
  - @checkstack/backend-api@0.35.0
  - @checkstack/api-docs-common@0.1.29
  - @checkstack/cache-api@0.3.21
  - @checkstack/pluginmanager-common@0.2.18
  - @checkstack/queue-api@0.4.1
  - @checkstack/signal-backend@0.3.28
  - @checkstack/signal-common@0.3.2

## 0.25.7

### Patch Changes

- be74b01: Stop anonymous page loads from logging authentication errors in the backend

  Opening the app unauthenticated printed an error-level stack trace per stream
  plugin:

  ```
  error: [core] RPC /api/metricstream/listLinkedStreamStatuses failed: Authentication required
  error: [core] Stack trace: Error: Authentication required ...
  ```

  Two independent causes, both fixed:

  - The dashboard is reachable anonymously (the catalog read is public, as are
    the health-check, incident, SLO and anomaly signal sources), but the three
    stream plugins' `listLinkedStreamStatuses` is authenticated-only. Their
    dashboard signal fillers queried it regardless of the caller, so every
    anonymous page load fired three requests that could only ever come back 401.
    The fillers now gate the lookup on the caller being authenticated.
  - A contract-level 4xx (401/403/404/409/...) was logged at error level with a
    full stack trace. That is the authorization layer working as designed, not a
    server fault, and the access-log middleware already reports every 4xx
    response at warn with its method, path and status. Contract 4xx responses now
    log at debug without a stack; a 5xx stays as loud as before.

  The three fillers were byte-for-byte the same component apart from their
  client, source id and deriver, so the fetch/chunk/merge/report machinery moved
  into a shared `useLinkedStreamSignals` hook exported by
  `@checkstack/telemetry-frontend`. As a side effect the tracestream filler's
  query is now namespaced under its plugin id like the other two, so the plugin's
  signal auto-invalidator actually refreshes it.

- ca6c4c7: Refresh `bun.lock` to the newest versions permitted by the existing semver
  ranges (Renovate lock-file maintenance). No `package.json` range changed, so
  this only affects the resolutions baked into the production image.

  Updated dependencies:

  - `@ai-sdk/gateway` 3.0.148 -> 3.0.153
  - `@ai-sdk/openai-compatible` 2.0.59 -> 2.0.62
  - `@ai-sdk/provider-utils` 4.0.38 -> 4.0.40
  - `@changesets/cli` 2.31.0 -> 2.31.1
  - `@grammyjs/types` 3.28.0 -> 4.0.0
  - `@happy-dom/global-registrator` 20.10.6 -> 20.11.0
  - `@nodable/entities` 2.2.0 -> 3.0.0
  - `@storybook/addon-a11y` 10.5.0 -> 10.5.2
  - `@storybook/addon-docs` 10.5.0 -> 10.5.2
  - `@storybook/addon-themes` 10.5.0 -> 10.5.2
  - `@storybook/builder-vite` 10.5.0 -> 10.5.2
  - `@storybook/csf-plugin` 10.5.0 -> 10.5.2
  - `@storybook/react` 10.5.0 -> 10.5.2
  - `@storybook/react-dom-shim` 10.5.0 -> 10.5.2
  - `@storybook/react-vite` 10.5.0 -> 10.5.2
  - `@typescript-eslint/eslint-plugin` 8.63.0 -> 8.64.0
  - `@typescript-eslint/parser` 8.63.0 -> 8.64.0
  - `@typescript-eslint/project-service` 8.63.0 -> 8.64.0
  - `@typescript-eslint/scope-manager` 8.63.0 -> 8.64.0
  - `@typescript-eslint/tsconfig-utils` 8.63.0 -> 8.64.0
  - `@typescript-eslint/type-utils` 8.63.0 -> 8.64.0
  - `@typescript-eslint/types` 8.63.0 -> 8.64.0
  - `@typescript-eslint/typescript-estree` 8.63.0 -> 8.64.0
  - `@typescript-eslint/utils` 8.63.0 -> 8.64.0
  - `@typescript-eslint/visitor-keys` 8.63.0 -> 8.64.0
  - `ai` 6.0.224 -> 6.0.230
  - `autoprefixer` 10.5.2 -> 10.5.4
  - `bullmq` 5.80.2 -> 5.80.9
  - `caniuse-lite` 1.0.30001805 -> 1.0.30001806
  - `electron-to-chromium` 1.5.389 -> 1.5.393
  - `fast-xml-parser` 5.10.0 -> 5.10.1
  - `grammy` 1.44.0 -> 1.45.1
  - `happy-dom` 20.10.6 -> 20.11.0
  - `hono` 4.12.30 -> 4.12.31
  - `immer` 11.1.11 -> 11.1.15
  - `lucide-react` 1.24.0 -> 1.25.0
  - `mysql2` 3.22.6 -> 3.23.0
  - `obug` 2.1.3 -> 2.1.4
  - `storybook` 10.5.0 -> 10.5.2
  - `typescript-eslint` 8.63.0 -> 8.64.0
  - `vite` 8.1.4 -> 8.1.5
  - `ws` 8.21.0 -> 8.21.1

- be74b01: Render the announcement block on public status pages (serve core plugins as Module Federation remotes)

  Thanks to @stuajnht for reporting: the Announcements block never rendered on a
  public status page - the lean public bundle (used for both a custom domain and
  the same-origin `/statuspage/view/:slug` path) loads NO plugins, and the
  announcement renderer lives in a core frontend plugin that was only ever bundled
  into the admin app. Declaring the widget's `rendererRemote` was necessary but not
  sufficient: core plugins were never built or served as remotes, so the public
  bundle's `loadRemote` 404'd and the block stayed blank.

  BREAKING CHANGE (mechanism, not API): core frontend plugins can now ship a public
  Module Federation remote so the lean public bundle can load their status-page
  widget renderers on demand - the same mechanism third-party plugins use.

  - `@checkstack/announcement-frontend` gains a federation `vite.config.ts` and a
    `build` script that emit a remote (`mf-manifest.json` + `remoteEntry.js`),
    exposing a LEAN public entry (`public-plugin.tsx`) that contributes ONLY the
    status-widget renderer - not the admin routes/manage page - so the remote stays
    small and avoids the heavy `@checkstack/ui` surface. It shares only `react`,
    `@checkstack/frontend-api`, and (consume-only) `@checkstack/ui/code-editor` with
    the host; react-dom / react-query are left unshared so their dead transitive
    code bundles and tree-shakes rather than breaking the federated consume shim.
  - Opt in with `checkstack.publicRemote: true` in the plugin's package.json. The
    backend plugin discovery now syncs such core frontend plugins into the
    `plugins` table so `/assets/plugins/<name>/*` serves their `dist/` (ordinary
    core frontend plugins, bundled into the admin app, are unaffected and excluded
    from the admin remote list).
  - Build wiring: a new `bun run build:public-remotes` builds every
    `publicRemote` plugin (single source of truth: the same marker discovery uses),
    wired into the `Dockerfile` builder stage and the e2e `pretest:e2e`; the
    runtime image copies each remote's `dist/`.

  Verified end to end in a real browser: the public page fetches the remote's
  `mf-manifest.json` / `remoteEntry.js` (200), Module Federation loads it against
  the host's shared React/frontend-api, and the announcement renders (with its
  markdown) - no console errors.

- be74b01: Fix custom-domain status pages serving the admin app (or 404) instead of the status page

  Thanks to @stuajnht for reporting: a verified, published custom domain loaded the
  admin SPA rather than its status page when the deployment sat behind a reverse
  proxy or ingress that rewrites the `Host` header to an internal service name and
  forwards the original public host as `X-Forwarded-Host`.

  The public-host routing match and the `/api/config` origin read the raw `Host`
  header, so behind such a proxy they saw the internal service name, never matched
  a configured page, and fell through to the admin bundle. The request-origin
  derivation already honored `X-Forwarded-Host`, so routing and origin disagreed.

  Both now resolve the request host through a single `resolveRequestHost` helper
  that reads `X-Forwarded-Host` (first hop) and falls back to `Host`, matching the
  request-origin precedence. The routing e2e test previously mirrored the bug (it
  read the raw `Host` header too), so it passed while the real path was broken; it
  now exercises the `X-Forwarded-Host` case and locks the behaviour in.

  Second, the frontend build never emitted the `public.html` the backend serves to
  a custom-domain host - so even once routing resolved the host correctly, the SPA
  fallback 404'd (`public.html` missing => fail-safe 404). The custom-domain public
  bundle has therefore never actually served since it was introduced in #341; it
  was only ever exercised via the same-origin `/statuspage/view/:slug` path, which
  serves `index.html`. Because `main.tsx` is a single entry that branches to the
  lean `PublicApp` at runtime from the `publicHost` the backend inlines, the build
  now emits `public.html` as a copy of the built `index.html`, so the custom-domain
  navigational route serves the public bundle instead of 404ing. Verified end to
  end over real HTTP: a request with `Host: <internal>` + `X-Forwarded-Host:
<custom-domain>` returns 200 with the lean public bootstrap (`publicHost` set,
  `enabledPlugins: []`), while the primary host still serves the admin bundle.

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/auth-common@0.16.0
  - @checkstack/backend-api@0.34.1
  - @checkstack/signal-backend@0.3.27

## 0.25.6

### Patch Changes

- d18adf2: Refresh `bun.lock` to the newest versions permitted by the existing semver
  ranges (Renovate lock-file maintenance). No `package.json` range changed, so
  this only affects the resolutions baked into the production image.

  Updated dependencies:

  - `@orpc/client` 1.14.7 -> 1.14.8
  - `@orpc/contract` 1.14.7 -> 1.14.8
  - `@orpc/interop` 1.14.7 -> 1.14.8
  - `@orpc/json-schema` 1.14.7 -> 1.14.8
  - `@orpc/openapi` 1.14.7 -> 1.14.8
  - `@orpc/openapi-client` 1.14.7 -> 1.14.8
  - `@orpc/server` 1.14.7 -> 1.14.8
  - `@orpc/shared` 1.14.7 -> 1.14.8
  - `@orpc/standard-server` 1.14.7 -> 1.14.8
  - `@orpc/standard-server-aws-lambda` 1.14.7 -> 1.14.8
  - `@orpc/standard-server-fastify` 1.14.7 -> 1.14.8
  - `@orpc/standard-server-fetch` 1.14.7 -> 1.14.8
  - `@orpc/standard-server-node` 1.14.7 -> 1.14.8
  - `@orpc/standard-server-peer` 1.14.7 -> 1.14.8
  - `@orpc/tanstack-query` 1.14.7 -> 1.14.8
  - `@orpc/zod` 1.14.7 -> 1.14.8
  - `hono` 4.12.28 -> 4.12.30
  - `postcss` 8.5.18 -> 8.5.19
  - `tsx` 4.23.0 -> 4.23.1

## 0.25.5

### Patch Changes

- 1219242: Refresh `bun.lock` to the newest versions permitted by the existing semver
  ranges (Renovate lock-file maintenance). No `package.json` range changed, so
  this only affects the resolutions baked into the production image.

  Updated dependencies:

  - `@floating-ui/core` 1.7.5 -> 1.8.0
  - `@floating-ui/dom` 1.7.6 -> 1.8.0
  - `@floating-ui/react-dom` 2.1.8 -> 2.1.9
  - `@floating-ui/utils` 0.2.11 -> 0.2.12
  - `@oxc-resolver/binding-android-arm-eabi` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-android-arm64` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-darwin-arm64` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-darwin-x64` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-freebsd-x64` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-arm-gnueabihf` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-arm-musleabihf` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-arm64-gnu` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-arm64-musl` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-ppc64-gnu` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-riscv64-gnu` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-riscv64-musl` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-s390x-gnu` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-x64-gnu` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-linux-x64-musl` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-openharmony-arm64` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-wasm32-wasi` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-win32-arm64-msvc` 11.23.0 -> 11.24.2
  - `@oxc-resolver/binding-win32-x64-msvc` 11.23.0 -> 11.24.2
  - `@tanstack/react-virtual` 3.14.5 -> 3.14.6
  - `@tanstack/virtual-core` 3.17.3 -> 3.17.4
  - `baseline-browser-mapping` 2.10.42 -> 2.10.43
  - `browserslist` 4.28.5 -> 4.28.6
  - `bullmq` 5.80.1 -> 5.80.2
  - `caniuse-lite` 1.0.30001803 -> 1.0.30001805
  - `dompurify` 3.4.11 -> 3.4.12
  - `es-module-lexer` 2.3.0 -> 2.3.1
  - `fast-xml-builder` 1.2.1 -> 1.3.0
  - `fast-xml-parser` 5.9.3 -> 5.10.0
  - `is-unsafe` 1.0.1 -> 2.0.0
  - `ldapts` 8.1.8 -> 8.2.0
  - `nanoid` 3.3.15 -> 3.3.16
  - `oxc-resolver` 11.23.0 -> 11.24.2
  - `postcss` 8.5.16 -> 8.5.18
  - `sql-escaper` 1.4.0 -> 1.5.1
  - `svgo` 4.0.1 -> 4.0.2
  - `tar` 7.5.19 -> 7.5.20
  - `xml-naming` 0.1.0 -> 0.3.0

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/auth-common@0.15.0
  - @checkstack/backend-api@0.34.0
  - @checkstack/queue-api@0.4.0
  - @checkstack/common@0.23.0
  - @checkstack/signal-backend@0.3.26
  - @checkstack/api-docs-common@0.1.28
  - @checkstack/cache-api@0.3.20
  - @checkstack/pluginmanager-common@0.2.17
  - @checkstack/signal-common@0.3.1

## 0.25.4

### Patch Changes

- 229bdad: Refresh `bun.lock` to the newest versions permitted by the existing semver
  ranges (Renovate lock-file maintenance). No `package.json` range changed, so
  this only affects the resolutions baked into the production image.

  Updated dependencies:

  - `@ai-sdk/gateway` 3.0.146 -> 3.0.148
  - `@eslint/eslintrc` 3.3.5 -> 3.3.6
  - `@eslint/js` 9.39.4 -> 9.39.5
  - `ai` 6.0.222 -> 6.0.224
  - `bullmq` 5.80.0 -> 5.80.1
  - `eslint` 9.39.4 -> 9.39.5
  - `sanitize-html` 2.17.5 -> 2.17.6
  - `shell-quote` 1.9.0 -> 1.10.0
  - @checkstack/api-docs-common@0.1.27
  - @checkstack/auth-common@0.14.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/common@0.22.0
  - @checkstack/pluginmanager-common@0.2.16
  - @checkstack/queue-api@0.3.19
  - @checkstack/signal-backend@0.3.25
  - @checkstack/signal-common@0.3.0

## 0.25.3

### Patch Changes

- fa873e3: Refresh `bun.lock` to the newest versions permitted by the existing semver
  ranges (Renovate lock-file maintenance). No `package.json` range changed, so
  this only affects the resolutions baked into the production image.

  Updated dependencies:

  - `@module-federation/vite` 1.16.14 -> 1.16.15
  - `@ungap/structured-clone` 1.3.2 -> 1.3.3
  - `ignore` 7.0.5 -> 7.0.6

## 0.25.2

### Patch Changes

- 6d8bf23: Refresh `bun.lock` to the newest versions permitted by the existing semver
  ranges (Renovate lock-file maintenance). No `package.json` range changed, so
  this only affects the resolutions baked into the production image.

  Updated dependencies:

  - `@adobe/css-tools` 4.4.4 -> 4.5.0
  - `@ai-sdk/gateway` 3.0.122 -> 3.0.146
  - `@ai-sdk/openai-compatible` 2.0.48 -> 2.0.59
  - `@ai-sdk/provider` 3.0.10 -> 3.0.14
  - `@ai-sdk/provider-utils` 4.0.27 -> 4.0.38
  - `@astrojs/language-server` 2.16.7 -> 2.16.11
  - `@astrojs/markdown-remark` 7.2.0 -> 7.2.1
  - `@astrojs/mdx` 5.0.4 -> 5.0.6
  - `@astrojs/sitemap` 3.7.2 -> 3.7.3
  - `@astrojs/starlight` 0.38.4 -> 0.38.5
  - `@astrojs/yaml2ts` 0.2.3 -> 0.2.4
  - `@babel/code-frame` 7.29.0 -> 7.29.7
  - `@babel/compat-data` 7.29.0 -> 7.29.7
  - `@babel/core` 7.29.0 -> 7.29.7
  - `@babel/generator` 7.29.1 -> 7.29.7
  - `@babel/helper-compilation-targets` 7.28.6 -> 7.29.7
  - `@babel/helper-globals` 7.28.0 -> 7.29.7
  - `@babel/helper-module-imports` 7.28.6 -> 7.29.7
  - `@babel/helper-module-transforms` 7.28.6 -> 7.29.7
  - `@babel/helper-string-parser` 7.27.1 -> 7.29.7
  - `@babel/helper-validator-identifier` 7.28.5 -> 7.29.7
  - `@babel/helper-validator-option` 7.27.1 -> 7.29.7
  - `@babel/helpers` 7.29.2 -> 7.29.7
  - `@babel/parser` 7.29.2 -> 7.29.7
  - `@babel/runtime` 7.29.2 -> 7.29.7
  - `@babel/template` 7.28.6 -> 7.29.7
  - `@babel/traverse` 7.29.0 -> 7.29.7
  - `@babel/types` 7.29.0 -> 7.29.7
  - `@better-auth/core` 1.6.13 -> 1.6.23
  - `@better-auth/drizzle-adapter` 1.6.13 -> 1.6.23
  - `@better-auth/kysely-adapter` 1.6.13 -> 1.6.23
  - `@better-auth/memory-adapter` 1.6.13 -> 1.6.23
  - `@better-auth/mongo-adapter` 1.6.13 -> 1.6.23
  - `@better-auth/prisma-adapter` 1.6.13 -> 1.6.23
  - `@better-auth/telemetry` 1.6.13 -> 1.6.23
  - `@better-auth/utils` 0.4.1 -> 0.4.2
  - `@better-fetch/fetch` 1.1.21 -> 1.3.1
  - `@capsizecss/unpack` 4.0.0 -> 4.0.1
  - `@clack/core` 1.3.0 -> 1.4.3
  - `@clack/prompts` 1.3.0 -> 1.7.0
  - `@date-fns/tz` 1.4.1 -> 1.5.0
  - `@emnapi/core` 1.10.0 -> 1.11.1
  - `@emnapi/runtime` 1.9.2 -> 1.11.2
  - `@emnapi/wasi-threads` 1.2.1 -> 1.2.2
  - `@expressive-code/core` 0.41.7 -> 0.42.0
  - `@expressive-code/plugin-frames` 0.41.7 -> 0.42.0
  - `@expressive-code/plugin-shiki` 0.41.7 -> 0.42.0
  - `@expressive-code/plugin-text-markers` 0.41.7 -> 0.42.0
  - `@grammyjs/types` 3.26.0 -> 3.28.0
  - `@grpc/proto-loader` 0.8.0 -> 0.8.1
  - `@happy-dom/global-registrator` 20.9.0 -> 20.10.6
  - `@humanfs/core` 0.19.1 -> 0.19.2
  - `@humanfs/node` 0.16.7 -> 0.16.8
  - `@iconify/utils` 3.1.3 -> 3.1.4
  - `@inquirer/ansi` 2.0.5 -> 2.0.7
  - `@inquirer/checkbox` 5.1.3 -> 5.2.1
  - `@inquirer/confirm` 6.0.11 -> 6.1.1
  - `@inquirer/core` 11.1.8 -> 11.2.1
  - `@inquirer/editor` 5.1.0 -> 5.2.2
  - `@inquirer/expand` 5.0.12 -> 5.1.1
  - `@inquirer/figures` 2.0.5 -> 2.0.7
  - `@inquirer/input` 5.0.11 -> 5.1.2
  - `@inquirer/number` 4.0.11 -> 4.1.1
  - `@inquirer/password` 5.0.11 -> 5.1.1
  - `@inquirer/prompts` 8.4.1 -> 8.5.2
  - `@inquirer/rawlist` 5.2.7 -> 5.3.1
  - `@inquirer/search` 4.1.7 -> 4.2.1
  - `@inquirer/select` 5.1.3 -> 5.2.1
  - `@inquirer/type` 4.0.5 -> 4.0.7
  - `@ioredis/commands` 1.5.1 -> 1.10.0
  - `@module-federation/dts-plugin` 2.5.1 -> 2.7.0
  - `@module-federation/error-codes` 2.5.1 -> 2.7.0
  - `@module-federation/managers` 2.5.1 -> 2.7.0
  - `@module-federation/runtime` 2.5.1 -> 2.7.0
  - `@module-federation/runtime-core` 2.5.1 -> 2.7.0
  - `@module-federation/sdk` 2.5.1 -> 2.7.0
  - `@module-federation/third-party-dts-extractor` 2.5.1 -> 2.7.0
  - `@module-federation/vite` 1.16.4 -> 1.16.14
  - `@msgpackr-extract/msgpackr-extract-darwin-arm64` 3.0.3 -> 3.0.4
  - `@msgpackr-extract/msgpackr-extract-darwin-x64` 3.0.3 -> 3.0.4
  - `@msgpackr-extract/msgpackr-extract-linux-arm` 3.0.3 -> 3.0.4
  - `@msgpackr-extract/msgpackr-extract-linux-arm64` 3.0.3 -> 3.0.4
  - `@msgpackr-extract/msgpackr-extract-linux-x64` 3.0.3 -> 3.0.4
  - `@msgpackr-extract/msgpackr-extract-win32-x64` 3.0.3 -> 3.0.4
  - `@napi-rs/wasm-runtime` 1.1.4 -> 1.1.6
  - `@nodable/entities` 2.1.1 -> 2.2.0
  - `@opentelemetry/semantic-conventions` 1.40.0 -> 1.43.0
  - `@orpc/client` 1.14.4 -> 1.14.7
  - `@orpc/contract` 1.14.4 -> 1.14.7
  - `@orpc/interop` 1.14.4 -> 1.14.7
  - `@orpc/json-schema` 1.14.4 -> 1.14.7
  - `@orpc/openapi` 1.14.4 -> 1.14.7
  - `@orpc/openapi-client` 1.14.4 -> 1.14.7
  - `@orpc/server` 1.14.4 -> 1.14.7
  - `@orpc/shared` 1.14.4 -> 1.14.7
  - `@orpc/standard-server` 1.14.4 -> 1.14.7
  - `@orpc/standard-server-aws-lambda` 1.14.4 -> 1.14.7
  - `@orpc/standard-server-fastify` 1.14.4 -> 1.14.7
  - `@orpc/standard-server-fetch` 1.14.4 -> 1.14.7
  - `@orpc/standard-server-node` 1.14.4 -> 1.14.7
  - `@orpc/standard-server-peer` 1.14.4 -> 1.14.7
  - `@orpc/tanstack-query` 1.14.4 -> 1.14.7
  - `@orpc/zod` 1.14.4 -> 1.14.7
  - `@oxc-project/types` 0.133.0 -> 0.139.0
  - `@oxc-resolver/binding-android-arm-eabi` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-android-arm64` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-darwin-arm64` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-darwin-x64` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-freebsd-x64` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-arm-gnueabihf` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-arm-musleabihf` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-arm64-gnu` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-arm64-musl` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-ppc64-gnu` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-riscv64-gnu` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-riscv64-musl` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-s390x-gnu` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-x64-gnu` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-linux-x64-musl` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-openharmony-arm64` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-wasm32-wasi` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-win32-arm64-msvc` 11.20.0 -> 11.23.0
  - `@oxc-resolver/binding-win32-x64-msvc` 11.20.0 -> 11.23.0
  - `@playwright/test` 1.60.0 -> 1.61.1
  - `@protobufjs/utf8` 1.1.1 -> 1.1.2
  - `@radix-ui/number` 1.1.1 -> 1.1.2
  - `@radix-ui/primitive` 1.1.3 -> 1.1.5
  - `@radix-ui/react-accordion` 1.2.12 -> 1.2.16
  - `@radix-ui/react-arrow` 1.1.7 -> 1.1.11
  - `@radix-ui/react-collapsible` 1.1.12 -> 1.1.16
  - `@radix-ui/react-collection` 1.1.7 -> 1.1.12
  - `@radix-ui/react-compose-refs` 1.1.2 -> 1.1.3
  - `@radix-ui/react-context` 1.1.2 -> 1.2.0
  - `@radix-ui/react-dialog` 1.1.15 -> 1.1.19
  - `@radix-ui/react-direction` 1.1.1 -> 1.1.2
  - `@radix-ui/react-dismissable-layer` 1.1.11 -> 1.1.15
  - `@radix-ui/react-focus-guards` 1.1.3 -> 1.1.4
  - `@radix-ui/react-focus-scope` 1.1.7 -> 1.1.12
  - `@radix-ui/react-id` 1.1.1 -> 1.1.2
  - `@radix-ui/react-popover` 1.1.15 -> 1.1.19
  - `@radix-ui/react-popper` 1.2.8 -> 1.3.3
  - `@radix-ui/react-portal` 1.1.9 -> 1.1.13
  - `@radix-ui/react-presence` 1.1.5 -> 1.1.7
  - `@radix-ui/react-primitive` 2.1.3 -> 2.1.7
  - `@radix-ui/react-select` 2.2.6 -> 2.3.3
  - `@radix-ui/react-slider` 1.3.6 -> 1.4.3
  - `@radix-ui/react-tooltip` 1.2.10 -> 1.2.12
  - `@radix-ui/react-use-callback-ref` 1.1.1 -> 1.1.2
  - `@radix-ui/react-use-controllable-state` 1.2.2 -> 1.2.3
  - `@radix-ui/react-use-effect-event` 0.0.2 -> 0.0.3
  - `@radix-ui/react-use-layout-effect` 1.1.1 -> 1.1.2
  - `@radix-ui/react-use-previous` 1.1.1 -> 1.1.2
  - `@radix-ui/react-use-rect` 1.1.1 -> 1.1.2
  - `@radix-ui/react-use-size` 1.1.1 -> 1.1.2
  - `@radix-ui/react-visually-hidden` 1.2.3 -> 1.2.7
  - `@radix-ui/rect` 1.1.1 -> 1.1.2
  - `@reduxjs/toolkit` 2.11.2 -> 2.12.0
  - `@rolldown/binding-android-arm64` 1.0.3 -> 1.1.5
  - `@rolldown/binding-darwin-arm64` 1.0.3 -> 1.1.5
  - `@rolldown/binding-darwin-x64` 1.0.3 -> 1.1.5
  - `@rolldown/binding-freebsd-x64` 1.0.3 -> 1.1.5
  - `@rolldown/binding-linux-arm-gnueabihf` 1.0.3 -> 1.1.5
  - `@rolldown/binding-linux-arm64-gnu` 1.0.3 -> 1.1.5
  - `@rolldown/binding-linux-arm64-musl` 1.0.3 -> 1.1.5
  - `@rolldown/binding-linux-ppc64-gnu` 1.0.3 -> 1.1.5
  - `@rolldown/binding-linux-s390x-gnu` 1.0.3 -> 1.1.5
  - `@rolldown/binding-linux-x64-gnu` 1.0.3 -> 1.1.5
  - `@rolldown/binding-linux-x64-musl` 1.0.3 -> 1.1.5
  - `@rolldown/binding-openharmony-arm64` 1.0.3 -> 1.1.5
  - `@rolldown/binding-wasm32-wasi` 1.0.3 -> 1.1.5
  - `@rolldown/binding-win32-arm64-msvc` 1.0.3 -> 1.1.5
  - `@rolldown/binding-win32-x64-msvc` 1.0.3 -> 1.1.5
  - `@rolldown/pluginutils` 1.0.0 -> 1.0.1
  - `@rollup/pluginutils` 5.3.0 -> 5.4.0
  - `@rollup/rollup-android-arm-eabi` 4.60.2 -> 4.62.2
  - `@rollup/rollup-android-arm64` 4.60.2 -> 4.62.2
  - `@rollup/rollup-darwin-arm64` 4.60.2 -> 4.62.2
  - `@rollup/rollup-darwin-x64` 4.60.2 -> 4.62.2
  - `@rollup/rollup-freebsd-arm64` 4.60.2 -> 4.62.2
  - `@rollup/rollup-freebsd-x64` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-arm-gnueabihf` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-arm-musleabihf` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-arm64-gnu` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-arm64-musl` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-loong64-gnu` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-loong64-musl` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-ppc64-gnu` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-ppc64-musl` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-riscv64-gnu` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-riscv64-musl` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-s390x-gnu` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-x64-gnu` 4.60.2 -> 4.62.2
  - `@rollup/rollup-linux-x64-musl` 4.60.2 -> 4.62.2
  - `@rollup/rollup-openbsd-x64` 4.60.2 -> 4.62.2
  - `@rollup/rollup-openharmony-arm64` 4.60.2 -> 4.62.2
  - `@rollup/rollup-win32-arm64-msvc` 4.60.2 -> 4.62.2
  - `@rollup/rollup-win32-ia32-msvc` 4.60.2 -> 4.62.2
  - `@rollup/rollup-win32-x64-gnu` 4.60.2 -> 4.62.2
  - `@rollup/rollup-win32-x64-msvc` 4.60.2 -> 4.62.2
  - `@shikijs/core` 4.0.2 -> 4.3.1
  - `@shikijs/engine-javascript` 4.0.2 -> 4.3.1
  - `@shikijs/engine-oniguruma` 4.0.2 -> 4.3.1
  - `@shikijs/langs` 4.0.2 -> 4.3.1
  - `@shikijs/primitive` 4.0.2 -> 4.3.1
  - `@shikijs/themes` 4.0.2 -> 4.3.1
  - `@shikijs/types` 4.0.2 -> 4.3.1
  - `@storybook/addon-a11y` 10.4.1 -> 10.5.0
  - `@storybook/addon-docs` 10.4.1 -> 10.5.0
  - `@storybook/addon-themes` 10.4.1 -> 10.5.0
  - `@storybook/builder-vite` 10.4.1 -> 10.5.0
  - `@storybook/csf-plugin` 10.4.1 -> 10.5.0
  - `@storybook/icons` 2.0.2 -> 2.1.0
  - `@storybook/react` 10.4.1 -> 10.5.0
  - `@storybook/react-dom-shim` 10.4.1 -> 10.5.0
  - `@storybook/react-vite` 10.4.1 -> 10.5.0
  - `@tanstack/query-core` 5.100.14 -> 5.101.2
  - `@tanstack/query-devtools` 5.100.14 -> 5.101.2
  - `@tanstack/react-query` 5.100.14 -> 5.101.2
  - `@tanstack/react-query-devtools` 5.100.14 -> 5.101.2
  - `@testcontainers/postgresql` 12.0.3 -> 12.0.4
  - `@tybys/wasm-util` 0.10.1 -> 0.10.3
  - `@types/d3-random` 3.0.3 -> 3.0.4
  - `@types/estree` 1.0.8 -> 1.0.9
  - `@types/hast` 3.0.4 -> 3.0.5
  - `@types/inquirer` 8.2.12 -> 8.2.13
  - `@types/mdx` 2.0.13 -> 2.0.14
  - `@types/node` 20.19.39 -> 20.19.43
  - `@types/nodemailer` 8.0.0 -> 8.0.1
  - `@types/react` 19.2.16 -> 19.2.17
  - `@typescript-eslint/eslint-plugin` 8.59.3 -> 8.63.0
  - `@typescript-eslint/parser` 8.59.3 -> 8.63.0
  - `@typescript-eslint/project-service` 8.59.3 -> 8.63.0
  - `@typescript-eslint/scope-manager` 8.59.3 -> 8.63.0
  - `@typescript-eslint/tsconfig-utils` 8.59.3 -> 8.63.0
  - `@typescript-eslint/type-utils` 8.59.3 -> 8.63.0
  - `@typescript-eslint/types` 8.59.3 -> 8.63.0
  - `@typescript-eslint/typescript-estree` 8.59.3 -> 8.63.0
  - `@typescript-eslint/utils` 8.59.3 -> 8.63.0
  - `@typescript-eslint/visitor-keys` 8.59.3 -> 8.63.0
  - `@typescript/native-preview` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@typescript/native-preview-darwin-arm64` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@typescript/native-preview-darwin-x64` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@typescript/native-preview-linux-arm` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@typescript/native-preview-linux-arm64` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@typescript/native-preview-linux-x64` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@typescript/native-preview-win32-arm64` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@typescript/native-preview-win32-x64` 7.0.0-dev.20260513.1 -> 7.0.0-dev.20260707.2
  - `@ungap/structured-clone` 1.3.0 -> 1.3.2
  - `@vitejs/plugin-react` 6.0.2 -> 6.0.3
  - `@xyflow/react` 12.11.0 -> 12.11.2
  - `@xyflow/system` 0.0.77 -> 0.0.79
  - `acorn` 8.16.0 -> 8.17.0
  - `ai` 6.0.194 -> 6.0.222
  - `ajv` 8.18.0 -> 8.20.0
  - `astro-expressive-code` 0.41.7 -> 0.42.0
  - `autoprefixer` 10.5.0 -> 10.5.2
  - `axe-core` 4.11.4 -> 4.12.1
  - `bare-fs` 4.7.2 -> 4.7.4
  - `bare-path` 3.0.1 -> 3.1.1
  - `baseline-browser-mapping` 2.10.19 -> 2.10.42
  - `bcp-47` 2.1.0 -> 2.1.1
  - `better-auth` 1.6.13 -> 1.6.23
  - `better-call` 1.3.5 -> 1.3.7
  - `brace-expansion` 5.0.6 -> 5.0.7
  - `browserslist` 4.28.2 -> 4.28.5
  - `builtin-modules` 5.1.0 -> 5.3.0
  - `bullmq` 5.74.1 -> 5.80.0
  - `caniuse-lite` 1.0.30001788 -> 1.0.30001803
  - `chardet` 2.1.1 -> 2.2.0
  - `cluster-key-slot` 1.1.2 -> 1.1.1
  - `dockerode` 5.0.0 -> 5.0.1
  - `electron-to-chromium` 1.5.336 -> 1.5.389
  - `empathic` 2.0.0 -> 2.0.1
  - `es-module-lexer` 2.1.0 -> 2.3.0
  - `es-toolkit` 1.45.1 -> 1.49.0
  - `estree-walker` 3.0.3 -> 2.0.2
  - `expressive-code` 0.41.7 -> 0.42.0
  - `fast-uri` 3.1.2 -> 3.1.3
  - `fast-wrap-ansi` 0.2.0 -> 0.2.2
  - `fast-xml-builder` 1.2.0 -> 1.2.1
  - `fast-xml-parser` 5.8.0 -> 5.9.3
  - `get-port` 7.2.0 -> 5.1.1
  - `grammy` 1.42.0 -> 1.44.0
  - `happy-dom` 20.9.0 -> 20.10.6
  - `hasown` 2.0.2 -> 2.0.4
  - `hono` 4.12.26 -> 4.12.28
  - `human-id` 4.1.3 -> 4.2.0
  - `iconv-lite` 0.7.2 -> 0.7.3
  - `immer` 10.2.0 -> 11.1.11
  - `inquirer` 13.4.1 -> 13.4.3
  - `ioredis` 5.10.1 -> 5.11.1
  - `is-core-module` 2.16.1 -> 2.16.2
  - `js-yaml` 4.2.0 -> 4.3.0
  - `ldapts` 8.1.7 -> 8.1.8
  - `lru-cache` 11.3.6 -> 11.5.2
  - `lucide-react` 1.17.0 -> 1.24.0
  - `magicast` 0.5.2 -> 0.5.3
  - `micromark-extension-directive` 3.0.2 -> 4.0.0
  - `msgpackr` 1.11.5 -> 2.0.4
  - `msgpackr-extract` 3.0.3 -> 3.0.4
  - `mysql2` 3.22.0 -> 3.22.6
  - `nan` 2.26.2 -> 2.28.0
  - `nanoid` 3.3.12 -> 3.3.15
  - `nanostores` 1.2.0 -> 1.4.0
  - `node-releases` 2.0.37 -> 2.0.51
  - `nodemailer` 9.0.1 -> 9.0.3
  - `obug` 2.1.1 -> 2.1.3
  - `oxc-resolver` 11.20.0 -> 11.23.0
  - `p-queue` 9.2.0 -> 9.3.1
  - `path-expression-matcher` 1.5.0 -> 1.6.2
  - `pg` 8.21.0 -> 8.22.0
  - `pg-connection-string` 2.13.0 -> 2.14.0
  - `pg-protocol` 1.13.0 -> 1.15.0
  - `picomatch` 4.0.4 -> 4.0.5
  - `playwright` 1.60.0 -> 1.61.1
  - `playwright-core` 1.60.0 -> 1.61.1
  - `postcss` 8.5.15 -> 8.5.16
  - `property-information` 7.1.0 -> 7.2.0
  - `protobufjs` 7.6.4 -> 7.6.5
  - `react-redux` 9.2.0 -> 9.3.0
  - `react-router` 7.16.0 -> 7.18.1
  - `react-router-dom` 7.16.0 -> 7.18.1
  - `recast` 0.23.11 -> 0.23.12
  - `recharts` 3.8.1 -> 3.9.2
  - `regjsparser` 0.13.1 -> 0.13.2
  - `rehype-expressive-code` 0.41.7 -> 0.42.0
  - `remark-directive` 3.0.1 -> 4.0.0
  - `reselect` 5.1.1 -> 5.2.0
  - `rolldown` 1.0.3 -> 1.1.5
  - `rollup` 4.60.2 -> 4.62.2
  - `semver` 7.8.1 -> 7.8.5
  - `shiki` 4.0.2 -> 4.3.1
  - `smol-toml` 1.6.1 -> 1.7.0
  - `sql-escaper` 1.3.3 -> 1.4.0
  - `storybook` 10.4.1 -> 10.5.0
  - `strnum` 2.3.0 -> 2.4.1
  - `syncpack` 15.3.1 -> 15.3.2
  - `syncpack-darwin-arm64` 15.3.1 -> 15.3.2
  - `syncpack-darwin-x64` 15.3.1 -> 15.3.2
  - `syncpack-linux-arm64` 15.3.1 -> 15.3.2
  - `syncpack-linux-arm64-musl` 15.3.1 -> 15.3.2
  - `syncpack-linux-x64` 15.3.1 -> 15.3.2
  - `syncpack-linux-x64-musl` 15.3.1 -> 15.3.2
  - `syncpack-windows-arm64` 15.3.1 -> 15.3.2
  - `syncpack-windows-x64` 15.3.1 -> 15.3.2
  - `tar` 7.5.16 -> 7.5.19
  - `tar-fs` 3.1.2 -> 3.1.3
  - `testcontainers` 12.0.3 -> 12.0.4
  - `tinyclip` 0.1.12 -> 0.1.15
  - `tinyexec` 1.1.2 -> 1.2.4
  - `ts-dedent` 2.2.0 -> 2.3.0
  - `tsx` 4.21.0 -> 4.23.0
  - `type-fest` 5.5.0 -> 5.8.0
  - `typescript-eslint` 8.59.3 -> 8.63.0
  - `ultrahtml` 1.6.0 -> 1.7.0
  - `uuid` 14.0.0 -> 14.0.1
  - `vite` 8.0.16 -> 8.1.4
  - `volar-service-css` 0.0.70 -> 0.0.71
  - `volar-service-emmet` 0.0.70 -> 0.0.71
  - `volar-service-html` 0.0.70 -> 0.0.71
  - `volar-service-prettier` 0.0.70 -> 0.0.71
  - `volar-service-typescript` 0.0.70 -> 0.0.71
  - `volar-service-typescript-twoslash-queries` 0.0.70 -> 0.0.71
  - `volar-service-yaml` 0.0.70 -> 0.0.71
  - `yaml-language-server` 1.20.0 -> 1.23.0
  - `yargs` 17.7.2 -> 17.7.3

- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/signal-common@0.3.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/api-docs-common@0.1.27
  - @checkstack/auth-common@0.14.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/common@0.22.0
  - @checkstack/pluginmanager-common@0.2.16
  - @checkstack/queue-api@0.3.19
  - @checkstack/signal-backend@0.3.25

## 0.25.1

### Patch Changes

- @checkstack/backend-api@0.32.1
- @checkstack/signal-backend@0.3.24

## 0.25.0

### Minor Changes

- bd41130: perf(auth): cache the authenticated read path on the shared distributed cache

  `readEnrichedUser` ran three joins on EVERY authenticated request - user -> roles,
  role -> access rules, and (for guests) the anonymous role's rules - which were
  among the highest-call-count queries in production even though the underlying
  mappings change only on rare admin edits. These are now served read-through from
  the **platform `CacheManager`** (the same shared cache every plugin uses):

  - `user -> role ids` and `role -> access-rule ids` (`auth-backend/src/auth-cache.ts`)
  - anonymous role -> effective rules (read in `core/backend`'s
    `getAnonymousAccessRules`, under auth-backend's cache scope)

  Cross-pod correctness comes from the SHARED backend, not from an application
  broadcast: with a distributed provider (Redis) an invalidation is a `delete`
  every pod sees immediately, so a user load-balanced to any pod always gets an
  up-to-date authorization decision. On the default in-memory backend the caches
  are per-pod and therefore single-instance-only (the Infrastructure Cache UI now
  warns about this). The 60s TTL is only a natural-refresh safety net. User role
  membership itself is still resolved live per request; only the rarely-changing
  derived mappings are cached.

  The reads happen CACHE-FIRST, OUTSIDE any database transaction: `enrichUser` no
  longer wraps its lookups in `withScopedTransaction`, so on a cache hit it issues
  NO query for roles/rules and never holds a pooled DB connection across the cache
  round-trip - only the always-uncached team read touches the DB.

  The invalidation is enforced by design, not by convention: all writes to the
  `role` / `role_access_rule` / `user_role` tables go through a single
  `RoleMembershipStore` that now takes the shared cache as a required constructor
  argument and welds each write to its `delete`, so the two cannot drift. The
  `checkstack/no-direct-role-membership-writes` lint rule (error) still forbids raw
  `insert`/`update`/`delete` on those tables anywhere else in `auth-backend`.

  Invalidation completeness (from an adversarial review):

  - `RoleMembershipStore.removeAccessRuleMappings` (plugin-deregister cleanup) now
    also evicts the anonymous-access-rules entry, since a removed rule may have
    been granted to the anonymous role.
  - `access-rule-sync`'s boot `fullSync` now evicts the affected shared entries
    when a default-rule change actually mutates a non-admin role's grants - a later
    pod's boot / a redeploy runs it against a cache the cluster already warmed, so
    the old "runs against a cold cache" assumption no longer holds under the shared
    cache. An idempotent no-change sync evicts nothing.
  - The batched `role -> access-rule ids` read now runs through
    `CachedScope.wrapManyBatched`, so it carries the same epoch guard as the
    single-key path: a role-rules revoke racing an in-flight load can no longer be
    clobbered by the loader's stale write.

  BREAKING CHANGE: the internal cache-invalidation hooks
  `authHooks.roleAccessRulesInvalidated`, `authHooks.userRolesInvalidated`, and
  `coreHooks.anonymousAccessRulesInvalidated` are removed, along with their
  per-pod broadcast subscribers. They existed only to keep the old per-pod caches
  coherent; the shared cache makes them redundant. These were internal signals,
  never a plugin-facing extension contract. `@checkstack/auth-common` now exports
  `AUTH_CACHE_PLUGIN_ID` and `ANONYMOUS_ACCESS_RULES_CACHE_KEY` so `core/backend`
  and `auth-backend` agree on the shared scope + key for the anonymous entry.

- bd41130: perf(auth): cache JWT keys per-pod, lock rotation, and prune orphaned keys

  The keystore hit the database on every request: `getPublicJWKS()` on every token
  verification and `getSigningKey()` on every service-to-service token mint - the
  two highest-call-count queries in production (~1.6M calls each). It also grew the
  `jwt_keys` table without bound: `revoked_at` was never set, rotation expired only
  the single observed active key, and rotation held no lock - so multi-pod races
  left keys with `expires_at = NULL` that could never be pruned and were returned on
  every JWKS read (hundreds of rows per call, still climbing).

  The keystore now:

  - Caches the JWKS (60 s TTL) and the signing key (5 min TTL) per pod, with
    single-flight refresh so a TTL expiry cannot stampede the DB. `verify` forces a
    one-time JWKS refresh when a token's `kid` is absent from the cached set, so a
    key freshly rotated on another pod is never spuriously rejected.
  - Rotates under a cross-pod advisory lock, double-checked so a pod that lost the
    race adopts the winner's key instead of minting a duplicate.
  - Expires EVERY currently-active key on rotation (not just one), so keys orphaned
    by earlier races get a grace expiry and are reclaimed by cleanup - self-healing
    the accumulated `jwt_keys` growth over the next rotation cycle.

  Behavior is unchanged for callers; the effect is far fewer DB round-trips on the
  hot auth path and a `jwt_keys` table that stops growing.

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/auth-common@0.14.0
  - @checkstack/signal-backend@0.3.23

## 0.24.1

### Patch Changes

- 43e4484: Add a database query profiler to the OpenTelemetry/Prometheus metrics layer.

  Two new scoped-db duration histograms answer "how long do queries take, and how long is a connection held", labelled by BOUNDED attributes only:

  - `checkstack.db.query.duration` (`schema`, `operation`) — wall-clock of a standalone scoped query (`BEGIN` + `SET LOCAL search_path` + query + `COMMIT`), recorded at the scoped-db proxy seam for every `.then`/`.execute`/`$count` path.
  - `checkstack.db.transaction.duration` (`schema`) — connection-hold time of a `withScopedTransaction` batch, the guard against a batch pinning a pooled connection (e.g. slow non-DB work wrapped in a transaction).

  For the per-statement drill-down (which exact SQL is hot, not just which operation kind), the host optionally exports Postgres' `pg_stat_statements` view: `checkstack.db.statements.{calls,exec_time_ms,rows}` counters plus a `mean_exec_time_ms` gauge, bounded to the top-N statements by total execution time (`CHECKSTACK_DB_STATEMENTS_TOP_N`, default 25). It is self-disabling: when metrics are enabled the backend probes the connected database once and, if `pg_stat_statements` is not active (extension absent or the role cannot read the view), registers nothing and logs a single info line — a clean no-op with zero cost. The whole layer remains off unless `CHECKSTACK_METRICS_ENABLED` is set.

  The `@checkstack/ai-backend` bump is the regenerated docs search index reflecting the expanded observability page.

- 43e4484: Status page enhancements:

  - Group-status widget can collapse its member rows while every member is
    operational (auto-expanding on any issue or maintenance).
  - New "Announcements" status-page widget, contributed fully externally by the
    announcement plugin: it surfaces active `visibility: "all"` announcements
    through a public-safe DTO (title/message/severity/timestamps only) and never
    affects the page status rollup.
  - Incident and maintenance widgets can scope by catalog GROUPS with per-system
    exceptions. Scope is resolved at read time (`(systemIds ∪ members(groupIds)) −
excludedSystemIds`), so members added to a group later are reflected
    automatically. The builder gets a nested group/system picker.
  - Incident and maintenance items on a public page link to dedicated public
    detail pages, gated server-side to items the page's published widgets actually
    surface (no enumeration, no internal-field leak). The custom-domain public
    bundle gains a minimal in-memory router for the two detail pages.
  - Fix the custom-domain "Cannot connect to Checkstack backend" screen: a
    configured-but-not-servable custom domain now serves the lean public
    "not available" page instead of the admin shell; the public bundle skips the
    cross-origin `/api/config` probe; CORS admits resolved custom domains; the
    request origin is normalized for proxy scheme/port variance; and re-saving an
    unchanged custom domain no longer clears its verification.
  - Anonymous email subscriptions (double opt-in) for incident updates, opt-in per
    status page (`emailSubscriptionsEnabled`, default off): a new
    `status_page_subscribers` table, public subscribe/verify/unsubscribe
    procedures with constant-time responses that fail closed when the page has not
    enabled subscriptions, and team-scoped admin list/remove + an enable toggle in
    the builder. Emails are delivered through a new `sendRawEmail` primitive in
    notification-backend that sends to an arbitrary external address (no auth
    account) via every enabled email strategy (SMTP), with a mandatory unsubscribe
    link.
  - Incident/maintenance update fan-out to subscribers via a new
    `notificationAudienceExtensionPoint` in notification-backend. Every
    notification funnelled through `notifyForSubscription` (incident, maintenance,
    health - all unchanged) now also invokes each registered audience sink exactly
    once, enriched with the affected systems and their catalog groups (resolved
    from notification-backend's own resource-parent graph, never a domain import).
    status-page-backend contributes a sink that, AT SEND TIME, matches each
    notification's affected systems against the systems each published + public +
    email-enabled page currently surfaces in its incident/maintenance widgets
    (honoring group membership and per-system exclusions) and emails that page's
    verified subscribers. Send-time scoping against the live layout is the privacy
    boundary: a page only ever emails about systems its widgets surface right now.
    Because `notifyForSubscription` is a single-pod point RPC, each notification
    fans out exactly once cluster-wide.
  - Subscriber reconcile on page deletion: the subscriber FK is `ON DELETE
CASCADE` and page deletion also explicitly purges subscribers (invalidating
    pending verify/unsubscribe tokens) - no orphan rows, no post-deletion send.
    Removing all systems from a page or disabling email is intentionally NOT a
    prune: send-time scoping plus the email-enabled gate make those subscribers
    dormant with no data loss, and re-enabling restores the audience without a
    re-subscribe.
  - Send-time scoping is single-source: the fan-out asks each event-feed widget for
    its CURRENT effective system scope (the same live catalog group expansion the
    widget renders from) instead of a parallel copy of group membership, so it can
    never over- or under-deliver relative to what the page shows.
  - `sendRawEmail` in notification-backend is now `userType: "service"` (was an
    authenticated procedure gated on `notification.send`). Sending to an arbitrary
    address is an open-relay / email-bomb primitive, so it is callable only by a
    trusted backend-to-backend caller (the status-page subscriber mailer), never by
    an end user.
  - Incident/maintenance widgets gain an optional per-system PUBLIC label override
    (`systemLabels`), the same override path the system-health widget uses, so the
    public incident/maintenance detail pages present clean labels instead of raw
    catalog names.
  - The anonymous subscribe endpoint adds a coarse per-page quota (max new
    subscribers per rolling hour, counted over durable rows so it holds across
    pods) on top of the per-(page,email) cooldown, capping verification-email
    amplification. The quota is CONFIGURABLE per status page (new nullable
    `email_subscribers_hourly_quota` column; null uses the default of 50, so
    existing pages are unchanged), validated as a positive integer up to 5000,
    editable in the builder next to the email opt-in toggle and gated by the same
    page-manage capability.
  - Email verification is now per-page configurable and backed by a platform-global
    once-per-address registry:
    - New `email_verification_required` column (boolean, default true) on
      `status_pages`, exposed on the admin StatusPage DTO + `updateStatusPage`
      input (same page-manage gate) with a builder toggle. When OFF, a new
      subscriber is created active immediately - no verification email, and the
      address is NOT written to the global registry (the operator's trust choice
      for e.g. an internal page).
    - New `status_page_verified_emails` table: one row per normalized address that
      has completed verification on ANY page. When a verification-required page is
      subscribed by an already-globally-verified address, the row is created active
      immediately and a COURTESY email (with one-click unsubscribe) is sent instead
      of a verification email, so a malicious add is always caught. `verify` upserts
      the address into this registry and activates every other pending row for the
      same address in one update (confirm once, all pages).
    - Fan-out is unchanged: it still gates on the per-row `verified` flag; the
      registry only governs whether a NEW subscribe short-circuits to active.

  BREAKING CHANGE: `sendRawEmail` is now service-only. Any (non-existent in-tree)
  authenticated caller must invoke it through a trusted service client instead.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/backend-api@0.31.1
  - @checkstack/signal-backend@0.3.22

## 0.24.0

### Minor Changes

- d0eddc9: Add opt-in OpenTelemetry metrics with a Prometheus exporter so a performance
  investigation can be grounded in real numbers from a running instance instead of
  guesses.

  The layer is **off by default and free when off**: the instruments are OTel
  no-ops until a `MeterProvider` is registered, so the hot paths pay nothing until
  you opt in.

  - **`@checkstack/backend-api` gains an `instrumentation` module** exporting lazy,
    memoized instrument accessors any plugin can record through:
    `dbTransactionsCounter`, `dbQueriesCounter`, `healthcheckExecutionHistogram`,
    `healthcheckPhaseHistogram`, `queueEnqueuedCounter`, `queueProcessedCounter`.
    Each looks up its instrument once and is a no-op until the host registers a
    provider, so callers can record unconditionally.
  - **`@checkstack/backend` owns the SDK bootstrap.** `startMetrics()` registers a
    global `MeterProvider` + Prometheus exporter when `CHECKSTACK_METRICS_ENABLED`
    is set (host `127.0.0.1`, port `9464` by default, both overridable via
    `CHECKSTACK_METRICS_HOST` / `CHECKSTACK_METRICS_PORT`). The exporter runs its
    OWN HTTP server, NOT a route on the app, so it carries no app-auth surface. It
    also registers host-owned observable instruments:
    `checkstack.db.pool.connections` (admin/lock pool active/idle/waiting) and
    `checkstack.runtime.event_loop_delay` (setInterval-drift histogram = JS-thread
    block time).
  - **The scoped-DB proxy records DB transactions/queries per plugin schema**, so
    `db_transactions_total` minus `db_queries_total` per schema is exactly the
    number of batched transactions - a live check that `withScopedTransaction`
    batching is taking effect.
  - **The health-check executor records execution + per-phase histograms**
    (`connect`, `wait`, ...) so a high `connect` p95 with a low `wait` points at
    connection establishment rather than a slow target or a CPU-bound platform.
  - **The in-memory queue records enqueued/processed counters** per queue and
    status.

  No behaviour changes when disabled. Enable with `CHECKSTACK_METRICS_ENABLED=1`
  and scrape `http://127.0.0.1:9464/metrics`. See the backend observability guide
  for the full metric list and interpretation.

- d0eddc9: Add a queue-backlog metric and fix the in-memory queue's backlog accounting so
  the metric is trustworthy under saturation - the single most important signal
  for whether health-check (or any queue) work is keeping up at scale.

  - **New `checkstack.queue.jobs` observable gauge** (`state="pending"|"processing"`),
    registered by the host once the QueueManager exists. `pending` is the backlog;
    if it climbs without draining, work is arriving faster than the queue
    concurrency can execute it. No-op unless metrics are enabled.
  - **Fix: the in-memory queue undercounted `pending`.** `processNext` removed a
    job from the pending list and only THEN awaited a concurrency slot in
    `processJob`, so jobs blocked waiting for a slot were invisible - not in
    `pending`, not yet in `processing`. Under saturation the reported backlog read
    ~0 while hundreds of jobs were actually queued. Such slot-waiters are now
    counted in `pending`, so `getStats()` (and the gauge, and the runtime panel)
    reflect the true depth. `processing` still counts only executing jobs.

  This surfaced from a scale harness driving the real hot path: 20% unreachable
  checks (which pin a concurrency slot for the full timeout) drove the backlog from
  0 to 700+ in 35s while lock-pool waiting stayed at 0 - i.e. the first scaling
  ceiling is concurrency-slot saturation by slow checks, not the database.

- f93ee7a: Fix a 403 that blocked team-scoped health-check managers from opening the
  health-check editor.

  The editor's utility endpoints (`healthcheck.getStrategies`,
  `healthcheck.getCollectors`, `healthcheck.testCollectorScript`, and the
  script-package SDK/type endpoints) were gated with `instanceAccess: { global:
true }` or a separate global `script-packages.read` rule. A `global: true` gate
  is enforced ONLY against a caller's global access rules - team grants never
  satisfy it - so a user who could manage a health check through a team grant, but
  did not hold the global `healthcheck.configuration.read` rule, got a 403 on the
  metadata endpoints the editor needs and could not open it.

  New `typeScoped` instanceAccess mode. A no-instance utility/catalog endpoint can
  now be gated by ANY team grant of its resource type (or the global rule): a
  `viewer`/`editor`/`owner` grant on any instance, or a `creator`
  (create-capability) grant so a team member who may CREATE the type can open its
  authoring UI before owning an instance. `healthcheck.getStrategies` /
  `getCollectors` use it at read level; `testCollectorScript` at manage level.
  Backed by an `includeCreator` option threaded through `hasAnyTypeGrant`
  (store -> auth S2S contract -> `AuthService`), so the create-capability path is
  counted only where intended (the list/record post-filter keeps its old
  semantics). The boot validator recognises `typeScoped` as one of the mutually
  exclusive modes.

  Script-package authoring endpoints relaxed to authenticated. `getInstallState`
  and the two raw type routes (`/api/script-packages/sdk-types/:version` and
  `/api/script-packages/types/:hash/:spec`) now require only authentication, not
  the global `script-packages.read` grant. They serve IntelliSense metadata
  (installed package inventory, `.d.ts` closures, the `@checkstack/sdk` bundle) -
  no secrets - which any script author, including a team-scoped health-check
  manager, needs. The install/registry MANAGE endpoints stay restricted.

  Why the team-permission guards did not catch this: `check:manage-capabilities`
  only covers management routes/nav, not the procedures a page calls; the boot
  conformance validator treats `global: true` as a deliberate, valid "not
  team-scoped" marker and cannot tell it is actually a dependency of a
  team-scopable editor flow. The RLAC rule now documents `typeScoped` as the
  correct mode and warns against `global: true` for endpoints a team manager
  needs.

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/auth-common@0.13.0
  - @checkstack/api-docs-common@0.1.27
  - @checkstack/cache-api@0.3.19
  - @checkstack/pluginmanager-common@0.2.16
  - @checkstack/queue-api@0.3.19
  - @checkstack/signal-backend@0.3.21
  - @checkstack/signal-common@0.2.17

## 0.23.5

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/signal-backend@0.3.20

## 0.23.4

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/api-docs-common@0.1.26
  - @checkstack/auth-common@0.12.2
  - @checkstack/cache-api@0.3.18
  - @checkstack/pluginmanager-common@0.2.15
  - @checkstack/queue-api@0.3.18
  - @checkstack/signal-backend@0.3.19
  - @checkstack/signal-common@0.2.16

## 0.23.3

### Patch Changes

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

- Updated dependencies [faf98f5]
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/signal-backend@0.3.18
  - @checkstack/api-docs-common@0.1.25
  - @checkstack/auth-common@0.12.1
  - @checkstack/cache-api@0.3.17
  - @checkstack/pluginmanager-common@0.2.14
  - @checkstack/queue-api@0.3.17
  - @checkstack/signal-common@0.2.15

## 0.23.2

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/signal-backend@0.3.17

## 0.23.1

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/signal-backend@0.3.16

## 0.23.0

### Minor Changes

- 935d34e: Fix team-scoped access to health-check management and remove redundant create toggles.

  - **Health Checks page no longer denies team-scoped users.** The management page gated its body on the GLOBAL `configuration.read` rule (`useAccess`), so a user with only a team grant (a create-capability grant, or a per-config team grant) saw "Access Denied" even though the route guard let them in and the "Create Check" button rendered. The page now resolves the same capability the route uses (`useCanAccessType`), so page and route agree.
  - **Health-check history pages reachable by team-scoped managers.** The run-history list and detail/run pages gated their body on the GLOBAL `configuration.manage` rule and their routes carried no `manageCapability`, so a team member who manages a health check via a team grant (no global rule) could not review its run history. The history routes now declare `manageCapability` and the pages resolve the manage capability via `useCanAccessType`.
  - **Parent-gated creates are no longer offered as "Resource creation" toggles.** `getResourceKinds` marked a type create-capable whenever any procedure declared `instanceAccess.create`, including parent-gated creates (incident/maintenance "for a system"). Those are authorized via MANAGE on the parent, so a per-type toggle was redundant and misleading. The derivation now excludes a create that carries a `parent` gate; a type with both a parent-less and a parent-gated create is still enumerated.

  No schema or migration change. Backend create authorization is unchanged - only the Teams UI enumeration and the frontend page gate.

- e430fbe: Add "Mass delete" and "Mass resolve" to the Incidents and Maintenances lists,
  authorized per item (RLAC).

  The incidents and maintenances list pages now support multi-select with a bulk
  action bar. A user may only select and act on entries they are allowed to
  MANAGE: a row's checkbox appears only when the caller can manage it (the same
  `canAccess(id)` gate as the per-row actions), so a team-scoped member sees
  checkboxes only for their team's entries. Mass delete confirms before running;
  mass resolve (incidents) and mass complete (maintenances, the "resolve"
  equivalent = close, status -> completed) skip entries that are already
  resolved/completed. Each action reports a per-id partial-success summary
  (e.g. "3 deleted, 1 skipped").

  New backend procedures: `incident.bulkDeleteIncidents`,
  `incident.bulkResolveIncidents`, `maintenance.bulkDeleteMaintenances`, and
  `maintenance.bulkCloseMaintenances`. Each authorizes EACH id against the
  caller's manage grant and never fails open: unauthorized ids are filtered out
  before the handler runs and returned as `forbidden`; missing ids as `notFound`;
  a per-id failure is isolated as `error` without aborting the batch. Per-id cache
  invalidation, realtime signals, and subscriber notifications run for every
  success so dashboards and status pages stay consistent.

  Platform: a new `instanceAccess` mode `bulkManage: { idsParam }` is the
  enforcement point for bulk writes. Before the handler runs, `autoAuthMiddleware`
  partitions the input id array into the caller's manageable subset and the denied
  remainder and exposes both on `context.bulkAccess` (fail-closed on an S2S
  error). The boot-time contract validator (`validateContractInstanceAccess`)
  accepts `bulkManage` as one of the mutually-exclusive scoping modes, marks its
  type team-scopable, and cross-checks `idsParam` against the input schema.

  State and scale: authorization is derived per request from the shared team-grant
  store via the existing auth S2S path (no process-local state); the read returns
  the same answer on every pod. No database migration.

- eab80e3: Add an instance-namespace runtime mode so a secondary backend instance can run
  alongside the default one on shared external infrastructure without colliding.

  - `@checkstack/backend-api` now exposes `coreServices.instanceRuntime`
    (`InstanceRuntime { namespace, isDefault }`) plus `parseInstanceNamespace` /
    `createInstanceRuntime` / `instanceNamespaceSchema`. The core backend reads
    `CHECKSTACK_INSTANCE_NAMESPACE` at boot (validated, failing fast on a bad
    value), registers the service, and advertises a non-empty namespace on
    `/api/config`.
  - Plugin-author contract: a plugin that keeps state on infrastructure SHARED
    across instances (redis key space, shared cache prefix, consumer group, topic)
    MUST fold `instanceRuntime.namespace` into that key/name. Namespace rather than
    suppress: user-visible behaviour keeps running in a secondary instance, only
    the shared keys change. See the new "Parallel instances and namespacing"
    developer-guide page.
  - `@checkstack/queue-bullmq-backend` is the reference implementation: it folds
    the namespace into the effective redis key prefix (`checkstack:` becomes
    `checkstack:preview:` under the `preview` namespace), isolating queues, jobs,
    schedulers and consumer groups. The default instance's prefix is byte-for-byte
    unchanged.
  - The admin frontend shows a slim "preview instance" banner when the runtime
    config carries a non-empty `instanceNamespace`.

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/auth-common@0.12.0
  - @checkstack/api-docs-common@0.1.24
  - @checkstack/cache-api@0.3.16
  - @checkstack/pluginmanager-common@0.2.13
  - @checkstack/queue-api@0.3.16
  - @checkstack/signal-backend@0.3.15
  - @checkstack/signal-common@0.2.14

## 0.22.1

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/api-docs-common@0.1.23
  - @checkstack/auth-common@0.11.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/cache-api@0.3.15
  - @checkstack/pluginmanager-common@0.2.12
  - @checkstack/queue-api@0.3.15
  - @checkstack/signal-backend@0.3.14
  - @checkstack/signal-common@0.2.13

## 0.22.0

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

- 2e20792: Serve public status pages from the lean bundle, and stop the SPA entry pulling the whole UI kit

  Public status pages used to render inside the full admin app on same-origin
  paths, so opening one booted every plugin (and its eager slot components) and the
  entire `@checkstack/ui` barrel.

  - **Lean public bundle for public paths.** New platform extension point
    `publicPathExtensionPoint` lets a plugin declare same-origin public path
    prefixes; the backend advertises them via `/api/config` and the inlined boot
    blob. The SPA entry now loads the minimal public bundle (no admin app, no
    plugin loader, no eager plugin components) for those paths, driving the slug
    from the URL. A status page no longer loads any admin frontend code.
  - **Entry no longer imports the `@checkstack/ui` barrel.** `ThemeProvider` /
    `DensityProvider` moved from `main.tsx` into each bundle's root (`App` and
    `public-app`), cutting the critical-path preload from ~280 KB to ~0.5 KB gz on
    both bundles (the barrel now loads only inside the bundle that needs it).
  - **public-app provider fix.** Added the missing `ToastProvider` (required by
    `PerformanceProvider`) so the public bundle renders standalone.
  - **Local plugins load as parallel chunks.** The bundled plugins moved from one
    eager `import.meta.glob` chunk to per-plugin lazy chunks downloaded in
    parallel. They are still registered before first render (the shell chrome
    depends on plugin-contributed APIs such as the auth plugin's `auth.api`), and
    remote plugins continue to load after first paint and register reactively.
  - **Tree-shakeable barrels.** `@checkstack/ui`, `auth-frontend`,
    `command-frontend`, `signal-frontend`, and `announcement-frontend` now declare
    `sideEffects` (CSS only), so importing one provider/hook no longer drags a
    whole package's components into the shell. `AnnouncementBanner` also lazy-loads
    its Markdown renderer, keeping ~98 KB of react-markdown out of first paint.

  BREAKING CHANGE: status-page route ids now match the `statuspage` plugin id (the
  frontend route registry requires this). URLs change: the admin builder moves from
  `/status-pages` to `/statuspage` (and `/status-pages/:id` to `/statuspage/:id`),
  and the public page moves from `/status/:slug` to `/statuspage/view/:slug`. Update
  any bookmarks or external links to published status pages.

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/api-docs-common@0.1.22
  - @checkstack/auth-common@0.11.1
  - @checkstack/pluginmanager-common@0.2.11
  - @checkstack/signal-common@0.2.12
  - @checkstack/cache-api@0.3.14
  - @checkstack/common@0.17.0
  - @checkstack/queue-api@0.3.14
  - @checkstack/signal-backend@0.3.13

## 0.21.0

### Minor Changes

- 8cad340: Encryption key rotation support plus fail-loud secret decryption.

  Non-breaking: existing single-key (`ENCRYPTION_MASTER_KEY` only) setups keep
  working unchanged. The ciphertext format (`iv:authTag:ciphertext`, AES-256-GCM)
  is unchanged - no key-id prefix - so old values stay decodable.

  - **Multi-key decryption for rotation.** `decrypt()` now trial-decrypts with the
    primary `ENCRYPTION_MASTER_KEY` first, then each key in the optional
    comma-separated `ENCRYPTION_MASTER_KEY_PREVIOUS` list, in order. Only when ALL
    configured keys fail the GCM tag does it raise the hard error. New encryption
    always uses the primary key. Every key is validated (32-byte hex) with zod;
    key material is never logged.
  - **Fail-loud, fail-closed decrypt in `ConfigService`.** Previously a failed
    decrypt silently substituted the raw CIPHERTEXT in place of the plaintext
    secret, so downstream consumers used ciphertext as the secret and operators
    never learned decryption broke. Now the failure is surfaced via the structured
    `Logger` at error level (with the config key and plugin, never the secret or
    ciphertext) and a typed `DecryptionError` is thrown, failing the whole config
    read so the operator sees it. A new exported `DecryptionError` type lets
    callers detect this.
  - **Re-encryption tooling.** New `bun run --filter @checkstack/backend
reencrypt-secrets` command (and reusable `reencryptAllSecrets` helper) walks
    the local secret backend `secrets` table and config-service `x-secret` fields
    in `plugin_configs`, decrypts each value with whichever configured key
    authenticates, and re-encrypts it onto the current primary key. After running
    it with zero failures, the operator can safely drop the demoted key from
    `ENCRYPTION_MASTER_KEY_PREVIOUS`. External backends (e.g. Vault) are out of
    scope - rotate those through their own mechanism.

  No schema change. State note: all encrypted state lives in shared Postgres
  (`secrets`, `plugin_configs`); reads return the same answer on every pod because
  key resolution and trial-decryption are pure functions of the env-configured
  keys and the stored ciphertext.

- 8cad340: Fail-closed plugin supply-chain integrity pinning.

  Plugin installers now verify downloaded artifacts and pin them so later reloads
  can detect tampering. This closes a gap where tarballs were installed with no
  integrity verification at all.

  - **npm**: the downloaded tarball is verified against the registry's
    `dist.integrity` (SHA-512 SRI) and refused on mismatch. When only the legacy
    `dist.shasum` (SHA-1) is available it is used with a logged warning; when no
    integrity material is present at all the install is refused (fail-closed). The
    registry metadata is now parsed with a zod schema rather than trusted blindly.
  - **GitHub release**: when the asset exposes a `digest` (`sha256:<hex>`) the
    bytes are verified against it (fail-closed on mismatch); the computed SHA-256
    is always recorded. Release metadata is parsed with zod.
  - **All sources**: the canonical SHA-256 of the installed tarball is persisted
    to a new nullable `plugins.installed_digest` column and re-verified whenever a
    pod re-hydrates the plugin from `plugin_artifacts`. A mismatch refuses to load
    that plugin without crashing boot; a missing digest (legacy install) is
    backfilled and the plugin loads.

  This is non-breaking: the `installed_digest` column is nullable, so existing
  installed plugins without a recorded digest keep working and get pinned on their
  next reload. The digest lives in shared Postgres, so it reads the same on every
  pod.

  Note: this is integrity pinning, not author trust. Cryptographic signature
  verification against a trust store is deliberately deferred to a future layer.

### Patch Changes

- 8cad340: fix(backend): quote and validate plugin schema identifiers in SQL

  Plugin schema identifiers are no longer interpolated raw into SQL. `pluginId` is
  now constrained to a safe charset (`pluginIdSchema` in `@checkstack/common`),
  `getPluginSchemaName` asserts that charset before producing a schema name, and
  the `SET LOCAL search_path` and `DROP SCHEMA` statements use `sql.identifier`
  (properly quoted and escaped) instead of string interpolation.

  This is defense in depth within an already-trusted boundary (installing a plugin
  is arbitrary code execution): no behavior changes for valid ids, but a
  malformed or hostile `pluginId` can no longer break out of a quoted identifier.

- 8cad340: refactor: type Drizzle JSON columns at the schema to remove boundary casts

  The catalog `metadata` (systems/groups/environments) and `configuration`
  (views) JSON columns now carry their concrete shape via `.$type<>()`
  (`Record<string, unknown>` and `string[]` respectively), so the column type
  flows naturally into the RPC contract output and the ~14 `as unknown as
Array<... & { metadata: ... }>` and `as Record<string, unknown> | null` reader
  casts in the catalog router are gone. The plugin-system `source` column in
  `@checkstack/backend` is typed as `PluginSource`, removing its read-site cast.

  This is a type-only change: `.$type<>()` does not alter SQL, so no new
  migration is generated and existing migrations are untouched.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/drizzle-helper@0.0.6
  - @checkstack/auth-common@0.11.0
  - @checkstack/signal-backend@0.3.12
  - @checkstack/api-docs-common@0.1.21
  - @checkstack/cache-api@0.3.14
  - @checkstack/pluginmanager-common@0.2.10
  - @checkstack/queue-api@0.3.14
  - @checkstack/signal-common@0.2.11

## 0.20.1

### Patch Changes

- 2ec8f64: Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

  - `hono` 4.12.23 → 4.12.25 (CVE-2026-54286, CVE-2026-54287, CVE-2026-54288, CVE-2026-54289, CVE-2026-54290)
  - `nodemailer` 9.0.0 → 9.0.1 (GHSA-p6gq-j5cr-w38f)
  - `dompurify` 3.4.3 → 3.4.11 (CVE-2026-49458, CVE-2026-49459, CVE-2026-49978, GHSA-76mc-f452-cxcm, GHSA-cmwh-pvxp-8882)
  - `protobufjs` 7.5.8 → 7.6.3 (CVE-2026-48712, CVE-2026-54269)
  - `undici` 7.24.7 → 7.28.0 (CVE-2026-9678, CVE-2026-9697)

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/signal-backend@0.3.11

## 0.20.0

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

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/signal-backend@0.3.10

## 0.19.0

### Minor Changes

- d2077bd: Platform-wide team-scoped access control on a unified relation-tuple store.

  Admins can scope any resource to teams, and the **platform** (not each plugin)
  enforces it. A plugin opts in declaratively by adding `instanceAccess` to a
  procedure's contract; the auth middleware does the rest, so enforcement is
  consistent across catalog, health checks, incidents, maintenances, SLOs,
  automations, and the dependency map, and any third-party plugin gets it for free.

  Core model:

  - **Teams are optional.** A resource with no team grants behaves exactly as
    before.
  - **Team grants are additive and restrict who can CHANGE a resource, not who can
    SEE it.** Granting a team `Manage` lets its members view and change the
    resource; `Read-only` lets them view it. Either level grants access to team
    members **even when they lack the global permission**, and granting never
    removes read from anyone who already had it (e.g. a public status page stays
    readable). Privacy is a separate, explicit opt-in via the **Private** toggle,
    which removes the global read path so only the resource's teams can see it.
  - **Ownership at creation.** Create forms expose an **Owning team** picker. A
    non-admin can create a resource for a team they belong to that holds a
    create-capability grant for that type; the new resource is auto-granted to that
    team. Incidents and maintenances are **parent-gated**: anyone who can manage a
    system may open incidents/maintenances for it, no separate grant needed.
  - **Meaningful authorization errors.** A caller with neither the global rule nor
    any team grant for a resource type gets a `403` with a structured body instead
    of a silently-empty `200`. Anonymous callers on public endpoints are never
    `403`'d, so status pages keep rendering.

  Unified relation-tuple store:

  - The previously separate access primitives (`resource_team_access.canRead` /
    `.canManage`, ownership, `resource_access_settings.teamOnly`, and
    `resource_create_grant`) are collapsed onto ONE
    `relation_tuple(object, relation, subject)` store: "a team has
    `viewer`/`editor`/`owner` on an object, or `creator` on a type". Privacy is an
    explicit **`private` marker** tuple — its **presence** closes the global read
    path (team grants only), its **absence** is the readable-by-default state, so a
    private resource with zero grants is correctly inaccessible to everyone rather
    than silently globalized. The access decision is a pure, unit-tested function.
  - The auth API is generic: `writeRelation` / `removeRelation` / `setObjectPublic`
    / `listObjectRelations` / `listSubjectRelations` / `setCreateGrant` /
    `listTeamCreateGrants` (user-facing) and `check` / `listAccessibleObjectIds` /
    `hasAnyTypeGrant` / `authorizeCreate` / `setOwner` / `deleteObjectRelations`
    (service-to-service). Migration `0008` backfills tuples from the legacy tables
    and drops them.

  Explicit per-procedure scoping:

  - Access rules (`access()` / `accessPair()`) define only the rule (id, level,
    defaults); every procedure declares its own `instanceAccess`. This removes a
    "loaded gun" default that silently applied a shared `idParam` to any procedure
    which forgot its own override.
  - Modes: `idParam` (single-resource pre-check, fails **closed** if the id does
    not resolve), `listKey` / `recordKey` (post-filter a list/record to the
    accessible subset), `create` (authorize creation + write the owning-team
    grant), `parentScope` (scope by read/manage access to a PARENT type,
    cross-plugin single-hop: "you may see incidents/maintenances/SLOs/health for
    system S iff you may see S"), and `global: true` (the honest "intentionally not
    team-scoped" opt-out). A boot-time validator **rejects** any procedure gated on
    a team-scopable resource type that declares no `instanceAccess`, turning the
    previous fail-open into a boot error.

  Teams administration:

  - **Team managers** manage their own team's members and managers without the
    global `auth.teams.manage` rule; creating, deleting, and granting a team access
    remain admin-only.
  - A **standalone Teams page** (gated on `auth.teams.read`) lets managers reach
    team administration without the admin Auth Settings page; members are added via
    a debounced directory picker.
  - A **cross-plugin `ResourceResolverRegistry`** lets owning plugins register a
    name/search resolver for their resource types, so the Teams page lists a team's
    grants **by name** (grouped by type) and offers a resource picker — an admin can
    change a grant's level, revoke it, or add one, without auth depending on every
    plugin. Resolvers shipped for catalog systems, health-check configurations,
    incidents, maintenances, SLO objectives, and automations.

  Frontend:

  - The resource-side editor is **"Who can change this"** (one Manage checkbox per
    team; unticked = read-only), with an always-visible **Private** toggle
    (disabled until a team that can Manage exists, so a resource can't be stranded).
  - `TeamOwnershipPicker` explains _why_ there's nothing to pick (not a member of
    any team, or none of your teams manage the selected parent) instead of a bare
    "global resource" line.
  - Read-only **"who can change this"** indicators on resource detail pages expand
    to the actual people by name; bulk + per-row **Scope to team** actions in the
    catalog systems list; and the team-access copy spells out that grants are
    additive and that Read-only grants view (not change) even without the global
    permission.

  Security hardening:

  - Child deletes in catalog (`removeSystemContact` / `removeSystemLink`) are scoped
    to both the child id and its parent `systemId`, closing a cross-system IDOR for
    team-scoped managers.
  - `searchUsers` is restricted to team administrators, closing a directory/email
    enumeration path opened by the default `auth.teams.read` rule.
  - Grant setters reject unregistered resource types.

  BREAKING CHANGES (beta; shipped as minor bumps):

  - `access()` and `accessPair()` no longer accept `idParam` / `listKey` /
    `recordKey`; move instance config to the procedure's `instanceAccess`.
  - Boot fails if a procedure gated on a team-scopable resource type omits
    `instanceAccess`. Declare a scoping mode or `instanceAccess: { global: true }`.
  - The `AuthService` interface is reshaped: `check`, `listAccessibleObjectIds`,
    `hasAnyTypeGrant`, `authorizeCreate` (returns `isPrivate`), `setOwner`
    (`isPrivate`), and `deleteObjectRelations`. Custom `AuthService` implementations
    and mocks must update.
  - The auth RPC contract's per-concept resource-access endpoints are replaced by
    the generic tuple API above; external callers of the old
    `getResourceTeamAccess` / `setResourceTeamAccess` / `setResourceAccessSettings`
    / `grantResourceCreate` / etc. must move to the new procedures.
  - Several contract inputs changed from a bare `string` to an object so the
    middleware can resolve the resource id: catalog `deleteSystem` (`{ id }`),
    `removeSystemContact` / `removeSystemLink` (`{ id, systemId }`); health-check
    `deleteConfiguration` / `pauseConfiguration` / `resumeConfiguration` (`{ id }`).
    All in-tree callers are updated.
  - List/record endpoints that relied on returning an empty `200` to signal "no
    access" now return a `403` for categorically-unauthorized principals.
  - The mis-keyed bulk endpoints `getBulkIncidentsForSystems`,
    `getBulkMaintenancesForSystems`, and `getBulkObjectivesForSystems` no longer
    post-filter their (systemId-keyed) result; access is already gated by
    `catalog.system` upstream.
  - Team membership/manager mutations (`addUserToTeam`, `removeUserFromTeam`,
    `addTeamManager`, `removeTeamManager`) now require `auth.teams.read` instead of
    `auth.teams.manage` at the contract level (broadened to per-team managers).
  - The `resource_team_access`, `resource_access_settings`, and
    `resource_create_grant` tables are dropped (data backfilled into
    `relation_tuple` by migration `0008`). A previously inconsistent "team-only with
    zero grants" resource is now correctly inaccessible to global-access holders.

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/auth-common@0.10.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/signal-backend@0.3.9
  - @checkstack/api-docs-common@0.1.20
  - @checkstack/cache-api@0.3.13
  - @checkstack/pluginmanager-common@0.2.9
  - @checkstack/queue-api@0.3.13
  - @checkstack/signal-common@0.2.10

## 0.18.4

### Patch Changes

- bb6f0fe: Fix REST query-parameter coercion. Query-string values arrive as strings, but
  contract input schemas declare real types (e.g. `listIncidents`'
  `includeResolved: z.boolean()`), so `/rest/...?includeResolved=true` was
  rejected with "expected boolean, received string". The REST handler now wires
  oRPC's `SmartCoercionPlugin`, which reads each procedure's JSON schema and
  coerces query/path/header strings to the declared type before validation -
  correctly mapping the string `"false"` to the boolean `false` (rather than the
  `Boolean("false") === true` trap). Booleans, numbers, and ISO-8601 dates now
  work as query params across every plugin's REST surface. The native oRPC
  surface is unaffected (it already carries real JSON types).

  Also regenerates the bundled docs index (`@checkstack/ai-backend`) to pick up
  the new "Typed query parameters" section in the public REST API reference.

## 0.18.3

### Patch Changes

- Updated dependencies [6005271]
- Updated dependencies [4134ed9]
  - @checkstack/backend-api@0.22.0
  - @checkstack/auth-common@0.9.1
  - @checkstack/signal-backend@0.3.8

## 0.18.2

### Patch Changes

- Updated dependencies [ebef442]
  - @checkstack/auth-common@0.9.0
  - @checkstack/backend-api@0.21.7
  - @checkstack/signal-backend@0.3.7

## 0.18.1

### Patch Changes

- @checkstack/backend-api@0.21.6
- @checkstack/signal-backend@0.3.6

## 0.18.0

### Minor Changes

- 0626782: Guard the role editor against granting inert (and misleading) permissions to the
  anonymous role.

  RPC procedures carry two independent axes: `userType` (the hard authentication
  gate) and `access` rules (authorization). An admin can grant the anonymous role
  any access rule, but if the procedures needing that rule are `userType:
"authenticated"`/`"user"`, the grant does nothing - the auth middleware rejects
  unauthenticated callers BEFORE access rules are checked (so there is no security
  hole; the grant is simply inert). After anonymous users started seeing
  permission-gated UI, such a grant would surface as visible-but-broken controls.

  - The backend now computes, from contract metadata, the access rules an anonymous
    caller can actually use (a rule is "usable" iff at least one `public` procedure
    requires it) via `pluginManager.getAnonymousUsableAccessRuleIds()`, exposed to
    plugins through the plugin environment.
  - `auth.getAccessRules` annotates each rule with `anonymousUsable`.
  - `auth.updateRole` REFUSES to ADD a non-usable rule to the anonymous role
    (existing grants are untouched, so no configuration can be wedged). This is a
    guardrail, not an enforcement change - RPC authorization is unchanged.
  - The role editor disables non-usable rules (with an explanation) when editing
    the anonymous role.

  Verified live: `getAccessRules` reports 11 anonymous-usable vs 58 not; granting
  `incident.incident.manage` to the anonymous role returns HTTP 400 with a clear
  message.

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

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/auth-common@0.8.3
  - @checkstack/common@0.15.0
  - @checkstack/api-docs-common@0.1.19
  - @checkstack/pluginmanager-common@0.2.8
  - @checkstack/signal-backend@0.3.5
  - @checkstack/cache-api@0.3.12
  - @checkstack/queue-api@0.3.12
  - @checkstack/signal-common@0.2.9

## 0.17.2

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/signal-backend@0.3.4

## 0.17.1

### Patch Changes

- @checkstack/api-docs-common@0.1.18
- @checkstack/auth-common@0.8.2
- @checkstack/backend-api@0.21.3
- @checkstack/cache-api@0.3.11
- @checkstack/common@0.14.1
- @checkstack/pluginmanager-common@0.2.7
- @checkstack/queue-api@0.3.11
- @checkstack/signal-backend@0.3.3
- @checkstack/signal-common@0.2.8

## 0.17.0

### Minor Changes

- 968c12f: Make installed (runtime) frontend plugins actually load, via Module Federation 2.0. Previously a packed external plugin's frontend could not run: the host only shared React/router with runtime plugins, and there was no working way to share the framework/UI singletons (hand-rolled import-map externalisation hit an unsolvable rolldown CJS-interop wall).

  - **Host (`@checkstack/frontend`)** now uses `@module-federation/vite` as an MF host and loads runtime plugins through the MF runtime (`registerRemotes` + `loadRemote`) instead of a raw `import()`. The shared set (react, react-dom, react-router-dom, @tanstack/react-query, @checkstack/frontend-api) is owned by the host; plugins reuse those exact instances via the share scope. The old hand-rolled vendor build + import map are removed.
  - **`@checkstack/ui`** is bundled per consumer (tree-shaken); its Theme / Toast / Performance React contexts are unified across the host and bundled-in-plugin copies via a registered (globalThis-keyed) context, so a plugin's `useTheme`/`useToast`/`usePerformance` resolve to the host's providers. The ONE exception is the Monaco / VS Code **CodeEditor**, now exposed as the `@checkstack/ui/code-editor` subpath and shared as an MF singleton: the host owns the single editor instance (and builds its `?worker&url` workers), and plugins reuse it. A plugin can now render `<CodeEditor>` (directly or via `ScriptTestPanel` / template/JSON fields) without bundling Monaco.
  - **Scaffold + pack (`@checkstack/scripts`)** build frontend plugins as MF remotes (`vite build` with the federation plugin, exposing `./plugin`, manifest enabled, DTS disabled). The CodeEditor is shared with `import: false` so the plugin is a consume-only participant - it never bundles a local fallback of the editor, keeping the heavy `@codingame/*` / `monaco-languageclient` / `vscode` subtree out of the plugin entirely (so no `vscode` alias or ES-worker config is needed in the plugin build). `plugin-pack` builds frontend packages with `NODE_ENV=production` (the MF plugin skips the remote under `NODE_ENV=test`) and ships only `dist/`. The scaffolded route now declares a `nav` entry so it appears in the sidebar.
  - **Backend (`@checkstack/backend`)** serves a plugin's MF assets under its (possibly scoped) package name (`/assets/plugins/@scope/name/*`), with correct content types, and the SPA catch-all defers those paths so the federation manifest/remoteEntry are not shadowed by `index.html`.

  Verified end-to-end by the external-plugin install E2E (scaffold → pack → install via the Plugin Manager UI → frontend + backend + co-loaded core plugins all work).

### Patch Changes

- e434d62: Fix the runtime (installed) plugin path so an external plugin uploaded via the Plugin Manager actually installs and its backend loads. Five distinct defects, surfaced by a new full install E2E:

  - **Plugin Manager access denied for admins.** The Plugin Manager's core access rules were registered _after_ `loadPlugins`, so the auth full-sync never wrote them to the DB; and the hand-rolled `upload-tarball` route checked `accessRules.includes(rule)` without honoring the admin `"*"` wildcard. Rules now register before `loadPlugins`, and the route honors `"*"` (matching `openapi-router.ts`).
  - **Bundle installs 404'd on intra-bundle deps.** A bundle's siblings were installed one tarball at a time, so a sibling that depends on another sibling failed to resolve against the registry. `installBundleFromArtifacts` now installs the whole bundle via a throwaway manifest using `file:` deps + `overrides`, resolving siblings locally and merging the result into the shared runtime dir.
  - **Primary artifact was the outer bundle archive.** The tarball/github installers stored the outer `bundle.json` archive as the primary's artifact instead of the primary's own package tarball; they now store the inner package tarball.
  - **Non-backend siblings loaded as backend plugins.** The install broadcast tried to load `common`/`frontend` siblings as backend plugins ("does not export a valid BackendPlugin"). Only `type: "backend"` packages now register as backend plugins (mirroring fresh-instance bootstrap).
  - **Runtime backend never migrated or got a scoped DB.** `loadSinglePlugin` now runs the plugin's Drizzle migrations into its isolated schema and injects the plugin-scoped `database` into `init`, matching the full-system loader.

  Note: the installed _frontend_ half of a runtime plugin remains a known gap (the host only shares React/router with runtime plugins, and `plugin-pack` does not build frontends); tracked separately for a follow-up.

  - @checkstack/api-docs-common@0.1.18
  - @checkstack/auth-common@0.8.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/common@0.14.1
  - @checkstack/pluginmanager-common@0.2.7
  - @checkstack/queue-api@0.3.11
  - @checkstack/signal-backend@0.3.2
  - @checkstack/signal-common@0.2.8

## 0.16.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/api-docs-common@0.1.18
  - @checkstack/auth-common@0.8.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/pluginmanager-common@0.2.7
  - @checkstack/queue-api@0.3.11
  - @checkstack/signal-backend@0.3.2
  - @checkstack/signal-common@0.2.8

## 0.16.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/cache-api@0.3.10
  - @checkstack/queue-api@0.3.10
  - @checkstack/api-docs-common@0.1.17
  - @checkstack/auth-common@0.8.1
  - @checkstack/pluginmanager-common@0.2.6
  - @checkstack/signal-backend@0.3.1
  - @checkstack/signal-common@0.2.7

## 0.16.0

### Minor Changes

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

- 9dcc848: Automations now run as a configured service account, removing implicit god-mode from the dispatch path.

  BREAKING: every automation must declare a `runAs` application (service account). Previously every automation action ran as the trusted service client, bypassing all access-rule, per-resource, and team-scope checks - so an automation could touch any team's data. Now each automation runs as a bounded `application` principal, and every data-access call an action makes is authorized exactly as that identity. An automation with no `runAs` fails to run with a clear error rather than falling back to the trusted client; legacy automations must be assigned a service account before they run again.

  What changed:

  - New top-level field `runAs` on automations (a `run_as_application_id` column + create/update inputs; `AutomationSchema.runAs`). Required on create; GitOps sets it via the `run-as` metadata label.
  - A new `coreServices.rpcClientAs(applicationId)` mints a short-lived, backend-signed app-principal token; the auth service resolves it LIVE to an `application` principal (reusing `enrichApplicationPrincipal`), so it flows through full `autoAuthMiddleware` enforcement. The dispatch engine threads this client into every action's `execute` as the required `context.rpcClient`.
  - Bind authority (anti-escalation): a user may only bind an application whose access rules are a subset of their own (`isApplicationBindable`); `getBindableApplications` lists only bindable apps, and the create/update handlers enforce the check.
  - `notification.sendTransactional` moves from service-only to access-gated (`notification.send`, a new access rule), so an automation's `runAs` can call the built-in `notify_user` / `notification.send` actions; trusted services still bypass via short-circuit.
  - A "Run as (Service Account)" picker in the automation editor, populated from `getBindableApplications` (server-side filtered to bindable apps), seeding from the loaded `runAs` on edit and passing it into create + update. First-class teaching UX: an inline info banner, a blocked Save with an inline hint until one is chosen, and an empty state linking to the Applications admin + docs when none are bindable.

  State and scale: `runAs` resolution is a pure read over shared tables; the app-principal token is self-contained and verified statelessly, so the per-run client is correct under horizontal scale.

  This is a beta minor.

- 9dcc848: Add environments as a first-class catalog primitive, with per-environment health-check fan-out, config templating, per-environment reactive health, and script run-context exposure.

  - Catalog primitive: an environment is a sibling of groups - a named, instance-global record carrying free-form custom fields (baseUrl, region, tier, ...) that any system can belong to many-to-many. New `environments` + `systems_environments` tables, `EnvironmentSchema` + create/update schemas, `EntityService` environment CRUD and membership joins, RPC endpoints gated by a new `catalogAccess.environment` access rule, a GitOps `Environment` kind + `System.environments` extension, and frontend management (an `EnvironmentEditor`, an Environments management panel, and a per-system environment picker). The Environments card's Add/Edit/Delete affordances are gated on `catalogAccess.environment.manage`.
  - Per-environment fan-out: run identity becomes `(systemId, configurationId, environmentId)`. Runs, aggregates, and state transitions gain a nullable `environmentId`. The health-check assignment gains an `environmentIds` selector with three modes (All / Specific / None; `null` and `[]` are distinct). The queue executor resolves the effective environment set via the catalog `resolveSystemEnvironments` read and executes one isolated run per environment.
  - Config templating: a new `x-templatable` config-field marker renders a string field through the template engine at execute time, against `{ environment, check, system }`. A shared `renderTemplatableConfig` and a `renderTemplatePreview` helper (re-exported from `@checkstack/template-engine`) keep editor previews identical to the run-time render. The HTTP collector's `url`, `headers[].value`, and `body` are templatable, rendered per environment (the strategy client build moves inside the per-env loop); the `url`'s `.url()` validation moves post-render. Secrets resolve before templating; a field marked both secret and `x-templatable` is rejected at plugin load. `DynamicForm` shows a live "Preview" line, and the catalog `EnvironmentPreviewPicker` ("Preview as: <environment>") drives it in the collector editor (only when the schema has a templatable field).
  - Script run-context: `CollectorRunContext` gains an optional `environment` field (`{ id, name, fields }`, metadata only). Shell collectors receive `CHECKSTACK_ENV_ID` / `_NAME` / `CHECKSTACK_ENV_<FIELD>` vars; inline TS collectors read `globalThis.context.environment`; the editor test panel mirrors both. The env-less path is unchanged.
  - Per-environment reactive health (see BREAKING below), env-keyed read/write paths, env-qualified serialization locks, an optional `trigger.payload.environmentId`, per-environment isolation, and an `ENVIRONMENT_RESOLUTION_FAILED` signal when catalog resolution degrades to a single env-less run.

  BREAKING CHANGES: the reactive `health` entity's id-shape and cardinality change. It now encodes two views: per-environment (id `"<systemId>::<environmentId>"`) and a system rollup (id `"<systemId>"`, the worst status across environments + env-less runs). The rollup PRESERVES the pre-existing system-level contract - dashboards, status badges, and automations referencing health by `systemId` keep working without re-authoring - but the entity's contract surface changed (new id-shape, higher cardinality, new payload field), so it is flagged breaking. `getBulkHealthState` parses env-qualified ids and keys results by the original id.

  State and scale: membership and custom fields live only in catalog Postgres and are re-read every tick via the cross-plugin RPC; env-keyed health reads from shared `health_check_runs` / aggregates / transitions (compute-on-read). Every pod resolves the same effective set and the same per-environment health. No pod-local environment state.

  Also: `unwrapSchema` in `zod-config.ts` loops instead of single-pass-stripping so multi-layer wrappers (`.optional().default()`) still resolve `x-templatable` meta. The env-less `{{ environment.* }}` run notice logs at `debug` (a legitimate recurring configuration), while the post-render HTTP `.url()` check still fails a genuinely-broken empty render with a clear "Rendered URL is invalid" error.

  This is a beta minor.

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

  This is a beta minor.

- 9dcc848: Stop the spurious "Plugin unknown is not using new API. Skipping." startup warning.

  `@checkstack/signal-backend` is a host-consumed library (the backend imports `SignalServiceImpl` and `createWebSocketHandler` directly), but its `package.json` declared `checkstack.type: "backend"`, so plugin discovery inserted it as a runtime backend plugin and the loader tried to read a default `register()` export it does not have - logging the offending package as the literal `unknown`.

  - Reclassify `@checkstack/signal-backend` to `checkstack.type: "tooling"` (like `@checkstack/backend-api`), so it is no longer discovered or registered as a backend plugin. No runtime behavior change - the SignalService and WebSocket handler are still instantiated and registered directly by the host backend.
  - Harden the loader's skip diagnostic so it can never render `unknown`: it resolves the offending plugin by its database-row package name (falling back to the on-disk path) and tells operators to set `checkstack.type` to `"tooling"` for host-consumed libraries.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Assorted bug fixes and small hardening across the platform.

  - announcement-backend: `updateAnnouncement` now invalidates the active-announcements and admin-list caches (it was missing the `invalidateAllActive` / `invalidateListAll` calls), so an edited announcement no longer stays stale up to the 45s TTL.
  - anomaly-backend: anomaly/drift state transitions (confirmations, recoveries, self-resolutions) now log at `debug` instead of info/warn - they are already surfaced via the `ANOMALY_STATE_CHANGED` signal, so logging them louder just added noise; genuine failure paths stay `warn`.
  - backend: the `/api/:pluginId/*` dispatcher now populates `requestHeaders` on the per-request RPC context, so a handler that re-enters the router as the originating user (e.g. an AI tool's user-scoped client) can forward the caller's session cookie / bearer - previously the loopback failed with "Authentication required". Guarded by a real end-to-end integration test. The HTTP server idle timeout is also raised (default 255s, configurable via `CHECKSTACK_SERVER_IDLE_TIMEOUT_SECONDS`, clamped 0-255, reset on each streamed chunk) so long AI chat SSE turns are not severed mid-stream.
  - backend: a request for an unknown plugin id (`/api/<unknown>/...`) now returns `404 Not Found` instead of `500` (and logs at warn, not error, since it is a client request) - an unknown _procedure_ on a known plugin already 404'd. The in-app docs namespace `/checkstack/*` now serves Starlight's own `404.html` with a real 404 status for a missing doc, instead of falling through to the SPA catch-all and 200-ing the app shell. Both guarded by tests.
  - automation-common: remove polynomial-time backtracking from `toShellEnvKey`'s underscore-trim (CodeQL `js/polynomial-redos`); a negative look-behind anchors the trailing run, keeping the trim linear.
  - common + script-packages-common: the pure transport-safe sandbox-policy schema (`sandboxPolicySchema` and its sub-schemas + inferred types) moved to `@checkstack/common` (the neutral base), removing two inverted deps that existed only to reach the shape; `@checkstack/backend-api` continues to re-export it. The schema is no longer exported from `@checkstack/script-packages-common`. Pure refactor, no behavior change.
  - catalog-backend: reject duplicate system names (a `CONFLICT` on create/rename, enforced by a pre-write check AND a new DB unique index on `systems.name`, migration 0004 which first resolves pre-existing duplicates by suffixing).
  - catalog-frontend: detail-page cleanups (use `<NotFound />` not `<AccessDenied />` on the not-found branch, a readable key/value metadata list via `normalizeMetadata`, runtime locale via `formatDate`); and stop the browse view re-rendering on every health report (adopt a new statuses report only when a value actually changed, via `healthStatusesEqual`, so rows stay stable and interactive).
  - healthcheck-backend: fix the daily-rollup retention step failing with an `ON CONFLICT` mismatch (SQLSTATE 42P10) after `environmentId` joined the `health_check_aggregates` unique constraint - the rollup now groups by (day, environmentId, sourceId) and uses a single exported conflict-target constant (`DAILY_AGGREGATE_CONFLICT_TARGET`) kept in lock-step with the schema by a unit test.
  - automation-frontend: the service-account picker's "Learn more" links are now absolute URLs to the deployed Astro docs site (they 404ed as in-app relative paths). The Monaco script editor double-init crash is fixed (serialized cold init, a guarded `monacoGuard` accessor, theme/type effects gated on `apiReady`).
  - auth-frontend: bound the desktop user-menu popover height (`max-h-[var(--radix-popover-content-available-height)]` + `overflow-y-auto`) so it no longer clips on short viewports, and fold the standalone `Account > Profile` item into a focusable name/email header (`profileHref` on `UserMenu`); the now-empty `Account` group no longer renders.
  - satellite-frontend: picked up via the sidebar-nav migration (account-only user menu).

  (Related UI fixes - the Monaco editor following the app theme, the `DynamicOptionsField` no-flash fix, the shared `Spinner`, GFM tables, and the user-menu popover bound - land their `@checkstack/ui` bump in the UI/perf changesets where `@checkstack/ui` is already minored.)

  This is a beta patch.

- 9dcc848: Fix the external/published-install dev loop and scaffolded-plugin first-boot (the #251 published-tarball integration lane).

  Backend:

  - `CHECKSTACK_DEV_AUTH=true` now actually takes effect for plugin APIs: dev auth is registered as a FACTORY (not a plain instance) so `ServiceRegistry.get()` reaches it instead of resolving the real auth factory first - previously every plugin API request under dev auth 401ed.
  - `CHECKSTACK_DEV_AUTH=true` no longer fatally crashes boot: dev-auth passes through real S2S tokens in `authenticate()` and mints a real plugin-scoped service token in `getCredentials()`, registered per plugin so each carries its own id - so boot-time backend-to-backend calls (e.g. `notification.registerSubscriptionSpec`) are accepted. A `PORT` env override is added to the backend entry point.
  - A dev-loaded plugin's Drizzle migrations now run on boot: `loadPlugins` accepts an optional `manualPluginPaths` map and the dev path supplies `CHECKSTACK_DEV_PLUGIN_PATH` so the plugin's `drizzle/` migrations run (previously manual plugins booted with no tables).

  dev-server:

  - The Vite frontend dev server now starts from a published install: `@checkstack/frontend` is resolved from a candidate list (the plugin first, then dev-server's own install), a `checkstack.bundle`-referenced `-frontend` sibling is picked up by scanning sibling dirs, and resolution failures yield a clean `undefined`/`Error` instead of Bun's non-`Error` throw (which had surfaced as "An error occurred").
  - The dev shell is now styled from a published install: `@checkstack/frontend` moves `tailwindcss`, `autoprefixer`, and `tailwindcss-animate` to dependencies and exports a `./tailwind-preset` subpath; the dev server assembles the PostCSS chain from that preset + autoprefixer and injects the plugin-under-dev's source globs into Tailwind's `content` (so a plugin author's custom utility classes compile), degrading gracefully if the toolchain can't be loaded. (`@checkstack/frontend` now declares an `exports` field, a BREAKING change for any consumer importing an undeclared subpath; nothing in the platform imports it as a module, and a `./*` passthrough preserves filesystem-style subpath access. The `@checkstack/frontend` minor bump for this lands in the version-alignment / frontend-bundle-perf changesets.)
  - `--help` output corrected from the stale `checkstack-scripts dev` to `checkstack-dev`, with a note that the binary ships in `@checkstack/dev-server`.

  scripts (scaffold):

  - The standalone backend template now ships a generated `drizzle/0000_init` migration creating the example `items` table, and `drizzle.config.ts` `out` points at `./drizzle` (the folder the loader reads), so a scaffolded plugin serves its API on first `bun install && bun run dev` instead of 500ing with "relation \"items\" does not exist".
  - The `common` template's `definePluginMetadata({ pluginId })` now renders the bare base name (not `<base>-common`), matching the backend's `checkstack.pluginId` and `/api/<pluginId>/*` route, fixing "Plugin metadata not found in registry".

  This is a beta patch.

- 9dcc848: Input-validation and error-mapping hardening found by a fuzzing pass against the built container.

  - backend: a Postgres driver error caused by bad client input no longer surfaces as a `500`. The `/api` and `/rest` dispatchers now map the relevant SQLSTATE classes to the correct status - `22P02`/`22003`/`22001`/`22007` (malformed/out-of-range/over-long/bad-date value), `23502`/`23503`/`23514` (missing/dangling/check-failed) to `400`, and `23505` (unique violation) to `409` - and log them at `warn` (client mistake), not `error`. The client-facing message is generic so column/constraint names are never leaked; genuine unknown faults still log at `error` and 500. Previously a `where id = $1` with a non-uuid `$1` (or an over-long string, or a foreign-key miss in `addSystemToGroup`) reached the driver and 500'd, making routine probing look like a server outage and burying real 500s.
  - slo-common: **fixes a stored cluster-wide DoS.** `windowDays` was accepted up to `2^53`, but the SLO engine derives window boundaries with `Date(now - windowDays * 86_400_000)` - a large value overflows past the max representable `Date` and yields `Invalid Date`. That objective committed fine, then every subsequent read of the system's objectives threw `RangeError: Invalid time value` during serialization (a 500 readable by anyone with SLO read access, on any pod). `windowDays` is now bounded to 1..3650 days at the contract, the GitOps `kind: SLO` spec, and the update path via a single shared `SloWindowDaysSchema`, so the poison row can never be created.
  - slo-common + healthcheck-common: SLO `getDailySnapshots` and the healthcheck history endpoints (`getHistory`, `getDetailedHistory`, `getAggregatedHistory`, `getDetailedAggregatedHistory`, `getRunsForAnalysis`) declared their `startDate`/`endDate` params as `z.date()`, which a `/rest/...` string param can never satisfy - so those endpoints 400'd on the entire REST surface. They now use `z.coerce.date()`, accepting both the REST string shape and the native RPC `Date`.
  - healthcheck-common: `intervalSeconds` was `z.number().min(1)` with no `.int()` and no upper bound, so a fractional or out-of-range value reached the DB and failed at insert (the column is a 32-bit int). It is now `.int().min(1).max(2_592_000)` (1 second .. 30 days), applied to both create and update (the update schema is the create partial).
  - catalog-common: system/group/environment names were bare `z.string()` (environment was `.min(1)` only), so empty, whitespace-only, and 100KB+ names reached the DB - the huge ones surfaced as 500s when parameter binding blew up. Names are now `trim().min(1).max(200)` via a shared schema.

    **BREAKING:** `getSystemContacts` is now `userType: "authenticated"` (was `"public"`). System contacts carry PII (user id, name, email); the public read leaked them to anonymous status-page visitors. Anonymous callers now receive `401` for this one endpoint; the system detail page already renders "No contacts assigned" for anonymous viewers, so the UI degrades gracefully. All other catalog reads remain public.

  - catalog-frontend: the system detail page skips the `getSystemContacts` request entirely for anonymous viewers (it would now `401`) and falls back to the empty state.

  This is a beta release: the breaking contact-visibility change ships as a minor bump per the beta versioning policy, not a major.

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
  - @checkstack/auth-common@0.8.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/signal-backend@0.3.0
  - @checkstack/common@0.13.0
  - @checkstack/cache-api@0.3.9
  - @checkstack/queue-api@0.3.9
  - @checkstack/api-docs-common@0.1.16
  - @checkstack/pluginmanager-common@0.2.5
  - @checkstack/signal-common@0.2.6

## 0.15.0

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

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/cache-api@0.3.8
  - @checkstack/queue-api@0.3.8
  - @checkstack/signal-backend@0.2.12

## 0.14.0

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

## 0.13.0

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

## 0.12.0

### Minor Changes

- 270ef29: Fix automation provider actions and `secretEnv` script actions throwing in production.

  The automation dispatch engine resolved provider-action dependencies (the integration connection store, the secret resolver) through a `getService` that was a throwing stub, so Jira / Teams / Webex actions and `secretEnv` script actions threw at execute time in production. The whole dispatch test suite stubbed `getService`, so the break was invisible.

  Root cause: the plugin `env` exposed `registerService` but no resolver, so the dispatch path (the only context that resolves arbitrary cross-plugin refs outside an RPC handler) had nothing real to call.

  Changes:

  - `@checkstack/backend-api`: add `getService<S>(ref: ServiceRef<S>): Promise<S>` to the plugin `env` (`BackendPluginRegistry`). It resolves a service registered by any plugin through the real `ServiceRegistry` using the calling plugin's identity, and throws a clear error if the ref is not registered (never silently `undefined`). **NEW PLUGIN-AUTHOR CONTRACT**: `env.getService` is now available to resolve arbitrary cross-plugin service refs at init / afterPluginsReady time.
  - `@checkstack/backend`: implement `env.getService` in both the plugin loader and the runtime single-plugin registration path, backed by `ServiceRegistry.get(ref, { pluginId })`.
  - `@checkstack/automation-backend`: wire the dispatch `getService` to `env.getService` (was a throwing stub). This also activates run-wide provider-credential masking, because resolving the connection store / secret resolver now flows through the run's masking interceptor.

  Also fixes a test-only seam where the `core/backend` test preload registered a no-op `registerRouter`, silently disabling oRPC router registration across the suite.

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/cache-api@0.3.7
  - @checkstack/queue-api@0.3.7
  - @checkstack/signal-backend@0.2.11

## 0.11.0

### Minor Changes

- 6d52276: feat(automation): expose `trigger.actor` so automations can filter on who/what caused an event

  Every platform event now carries an **actor** - the user, application (API
  client), service (backend-to-backend), or `system` (background /
  unauthenticated) that caused it - and the automation engine surfaces it to
  automations as `trigger.actor`. This lets a trigger filter gate on the
  origin of the event it reacts to:

  ```text
  {{ trigger.actor.type == "system" }}      # auto-created by the platform
  {{ trigger.actor.type == "user" }}         # a human
  {{ trigger.actor.id == "app-deploybot" }}  # a specific application
  ```

  `trigger.actor` is available on **every** trigger - it is injected by the
  platform, not declared per trigger - and editor autocomplete + Run Script
  context types include `trigger.actor.{type,id,name}`.

  How it works:

  - **`@checkstack/common`** adds the canonical `Actor` type / `ActorSchema`
    and `SYSTEM_ACTOR`.
  - **`@checkstack/backend-api`** adds `resolveActor(user)` and a
    `HookEventMeta` envelope. The hook listener / `onHook` signature gains an
    optional second `meta` argument (additive, backward compatible).
  - **`@checkstack/backend`** wraps emitted hooks in an envelope so the actor
    travels with the payload through the distributed queue, unwrapping it
    before delivery. The RPC emit path captures the authenticated caller;
    background emits default to the system actor. Raw/legacy queue data is
    treated as a system-actor payload, so delivery stays backward compatible.
  - **`@checkstack/automation-backend`** threads the actor into the dispatch
    scope (`trigger.actor`), available to trigger filters, top-level
    conditions, and all run templates, and persisted in the run's scope
    snapshot. Manual runs are attributed to the invoking user.
  - **`@checkstack/automation-common`** / **`@checkstack/automation-frontend`**
    expose `trigger.actor` in the editor variable scope and the generated
    Run Script `context.trigger.actor` types.

  No database migration and no per-trigger schema changes: the actor rides as
  event-envelope metadata and in the run scope snapshot.

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/api-docs-common@0.1.15
  - @checkstack/auth-common@0.7.2
  - @checkstack/pluginmanager-common@0.2.4
  - @checkstack/signal-backend@0.2.10
  - @checkstack/signal-common@0.2.5
  - @checkstack/cache-api@0.3.6
  - @checkstack/queue-api@0.3.6

## 0.10.4

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/cache-api@0.3.5
- @checkstack/queue-api@0.3.5
- @checkstack/signal-backend@0.2.9

## 0.10.3

### Patch Changes

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

- f23f3c9: Phase 9 of the v1 polishing plan: tighten the plugin loader's boot-time
  hook policy and backfill notification-router test coverage.

  `@checkstack/backend` adopts an explicit per-hook policy for the two
  boot-time hooks the plugin loader emits. `pluginInitialized` now
  **halts the boot** if a subscriber throws — a failing subscriber here
  means a downstream never wired itself against the freshly initialised
  plugin, and continuing past that would leave the platform serving
  traffic in a half-wired state. `accessRulesRegistered` keeps its
  log-and-continue behaviour but escalates to `error` level and emits a
  summary count if any subscriber failed; boot-blocking this hook would
  let one misbehaving plugin DOS every other plugin on the same
  instance. The policy is documented inline at each emit site and in a
  new `docs/src/content/docs/backend/plugin-hook-policy.md` page.
  **BREAKING CHANGE**: subscribers to `pluginInitialized` that
  previously threw silently (logged and swallowed) now halt platform
  boot. Audit subscribers and ensure they handle their own internal
  errors before throwing.

  `@checkstack/notification-backend` ships a real
  `core/notification-backend/src/router.test.ts` covering the dispatch
  fan-out (`notifyForSubscription`: zero subscribers, multi-recipient
  insert, `excludeUserIds`, plus NOT_FOUND/FORBIDDEN guard rails), the
  canonical paginated read on `getNotifications` (envelope shape,
  `unreadOnly` filter propagation, null→undefined column mapping), the
  service-only `createGroup` upsert behaviour (happy path + idempotent
  re-create), and the multi-strategy `sendTransactional` path with a
  focused fallback-style assertion: when one strategy throws, the
  dispatch loop continues to the next and surfaces the failure as a
  per-strategy `success: false` row instead of short-circuiting. No
  runtime changes to the notification router.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/api-docs-common@0.1.14
  - @checkstack/auth-common@0.7.1
  - @checkstack/pluginmanager-common@0.2.3
  - @checkstack/signal-backend@0.2.8
  - @checkstack/signal-common@0.2.4
  - @checkstack/cache-api@0.3.4
  - @checkstack/queue-api@0.3.4

## 0.10.2

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
  - @checkstack/cache-api@0.3.3
  - @checkstack/queue-api@0.3.3
  - @checkstack/signal-backend@0.2.7

## 0.10.1

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

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/cache-api@0.3.2
  - @checkstack/queue-api@0.3.2
  - @checkstack/signal-backend@0.2.6

## 0.10.0

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

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/auth-common@0.7.0
  - @checkstack/api-docs-common@0.1.13
  - @checkstack/backend-api@0.15.2
  - @checkstack/pluginmanager-common@0.2.2
  - @checkstack/signal-backend@0.2.5
  - @checkstack/signal-common@0.2.3
  - @checkstack/cache-api@0.3.1
  - @checkstack/queue-api@0.3.1

## 0.9.1

### Patch Changes

- aa89bc5: Replace the bespoke `registerInfrastructureTab()` registry with a standard
  slot-extension contract (`InfrastructureTabsSlot` from
  `@checkstack/infrastructure-common`). Plugins now contribute infrastructure
  tabs via `createSlotExtension`, depending only on the slot owner.

  The slot system in `@checkstack/frontend-api` gains a second type parameter
  on `createSlot<TContext, TMetadata>` so extensions can declare typed static
  metadata at registration time (label, icon, access rules, ordering for the
  infrastructure tab bar). A new `useSlotExtensions(slot)` hook returns typed
  extensions and subscribes to plugin lifecycle changes.

  Each tab body now stacks a **Runtime** sub-section (live state, read-only)
  on top of a **Configuration** sub-section (settings, gated by `canUpdate`).

  **Queue runtime panel.** Surfaces aggregated counts (pending / processing /
  completed / failed) plus three sub-tabs of recent jobs: **Active**, **Recent
  failed** (with the failure message), and **Recent completed** (with
  duration). Job payloads are deliberately not surfaced — they may carry
  secrets and need a separate manage-access gate to be shown.

  To support this, `Queue<T>` gains a required `listJobs(opts)` method
  returning `JobSummary[]` (no payloads), and `QueueStats` gains a
  `scope: "instance" | "cluster"` field. The in-memory queue keeps rolling
  ring buffers (200 entries) for completed/failed history and tracks active
  jobs by id; BullMQ uses native `getJobs`. `QueueManager.listJobs` aggregates
  across queues and sorts (most-recent-first for terminal states, FIFO for
  active/waiting/delayed).

  **Cache runtime panel.** Lists the top N entries by size (or by recency) so
  operators can debug a cache filling up. Values are deliberately omitted —
  PII / secret risk. Backends opt in via an optional `listEntries?` method on
  `CacheProvider`; non-supporting backends return `{ supported: false }` and
  the UI renders a "not supported by this backend" hint. The in-memory cache
  implements it using its existing per-entry byte tracking.

  `CacheStats` also gains `scope: "instance" | "cluster"`.

  **Multi-instance scope warning.** A new `<InstanceScopeBanner>` component in
  `@checkstack/ui` renders a yellow banner above any runtime panel whose
  backend reports `scope: "instance"` — i.e. in-memory queue or cache running
  in a horizontally scaled deployment. The banner explains the metrics are
  local to the responding replica and recommends switching to a clustered
  backend (Redis-backed queue / cache) for cluster-wide visibility.

  **Bug fix — stable cache provider proxy.** `CacheManagerImpl.getProvider()`
  now returns a single stable proxy that delegates to whatever provider is
  currently active. Previously, consumers of `createCachedScope` (and any
  direct `cacheManager.getProvider()` caller) captured the active provider
  reference at plugin-init time. After any `setActiveBackend` call — including
  saving the same memory config in the new Cache tab, which reconstructs the
  in-memory cache — those scopes wrote to an orphaned old provider while the
  runtime panel read stats from the new (empty) one, making the runtime panel
  appear to report 0 keys. With the proxy, all consumers share a single stable
  identity and writes always land in the active provider.

  **Bytes tracking on the in-memory cache.** `InMemoryCache.getStats().sizeBytes`
  now returns a running approximation (UTF-8 bytes of the key plus
  `v8.serialize(value).byteLength`, with a JSON fallback) that's kept in sync
  across all eviction paths. Treat the number as a sanity gauge; it doesn't
  include `Map` per-entry overhead.

  **Pagination.** Both `Queue<T>.listJobs` and `CacheProvider.listEntries?`
  are offset-paginated. Inputs gain an `offset: number`; outputs change to
  `{ items, total: number | null, hasMore: boolean }`. `total` is nullable
  so backends that can't compute it cheaply still paginate via `hasMore`.
  The UI uses the existing `<Pagination>` component with a 25-row default
  page size. `QueueManager.listJobs` aggregates by over-fetching
  `[0, offset+limit)` per queue, merge-sorting, then slicing the window —
  optimal for the single-queue case, acceptable for the multi-queue case
  within the UI's reasonable page-depth bounds. BullMQ uses native offset
  ranges via `getJobs(types, start, end)` plus `getJobCounts` for `total`.

  **Pending tab.** The Queue runtime panel exposes a virtual `"pending"`
  state (waiting ∪ delayed, FIFO). It's now the default sub-tab, since
  "what's queued up?" is the most common question. Per-row state is shown
  when viewing the combined list.

  **Recurring schedules visible under Pending.** Cron- and interval-based
  recurring jobs (e.g. healthchecks) are surfaced under Pending/Delayed
  between fires, with a `nextRunAt` countdown column and a "(recurring)"
  label. `JobSummary` gains optional `nextRunAt: Date` and `recurring:
boolean` fields. The in-memory queue synthesises these rows from its
  `recurringJobs` registry; BullMQ already materialises the next fire of
  each scheduler as a delayed job and we now surface its trigger time and
  the `repeatJobKey`-derived `recurring` flag.

  **Bug fix — drop hook emits with no listeners.** `EventBus.emit` no
  longer enqueues a job when zero listeners (distributed or instance-local)
  are registered for the hook. Previously, hooks like
  `core.plugin.initialized` — emitted on every plugin init but subscribed
  to by nothing in the core repo — accumulated one waiting job per emit
  forever. The in-memory queue's `processNext` short-circuits when there
  are zero consumer groups, so its post-loop cleanup never ran for these
  orphaned jobs. The fix drops the emit at the source and logs a debug
  line. Note: in distributed deployments using a Redis-backed queue, this
  means a subscriber on another replica won't receive an event if no
  replica that emits it has a local listener. Plugins needing cross-process
  delivery must register their listener on every replica that should
  receive the hook.

  **Breaking notes (treated as minor under beta semantics)**:

  - `@checkstack/infrastructure-common` removes `registerInfrastructureTab`
    and `getInfrastructureTabs`; former callers must register an extension
    into `InfrastructureTabsSlot`.
  - `@checkstack/queue-api`'s `Queue<T>` interface requires the new
    `listJobs(opts)` method returning `ListJobsResult` (paginated). Both
    bundled queue backends (memory, BullMQ) are updated; out-of-tree
    implementations will need to add it.
  - `QueueStats` and `CacheStats` add a required `scope` field.
  - `CacheProvider.listEntries?` (when implemented) now returns
    `ListEntriesResult` instead of `CacheEntrySummary[]`.
  - `JobState` adds a `"pending"` variant.

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/api-docs-common@0.1.12
  - @checkstack/auth-common@0.6.6
  - @checkstack/backend-api@0.15.1
  - @checkstack/pluginmanager-common@0.2.1
  - @checkstack/signal-backend@0.2.4
  - @checkstack/signal-common@0.2.2

## 0.9.0

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
  - @checkstack/auth-common@0.6.5
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/drizzle-helper@0.0.5
  - @checkstack/pluginmanager-common@0.2.0
  - @checkstack/queue-api@0.2.18
  - @checkstack/signal-backend@0.2.3
  - @checkstack/api-docs-common@0.1.11
  - @checkstack/cache-api@0.2.4
  - @checkstack/signal-common@0.2.1

## 0.8.2

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

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/cache-api@0.2.3
  - @checkstack/queue-api@0.2.17
  - @checkstack/signal-backend@0.2.2
  - @checkstack/api-docs-common@0.1.10
  - @checkstack/auth-common@0.6.4
  - @checkstack/common@0.7.0
  - @checkstack/drizzle-helper@0.0.4
  - @checkstack/signal-common@0.2.0

## 0.8.1

### Patch Changes

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

## 0.8.0

### Minor Changes

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

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-api@0.2.2
  - @checkstack/queue-api@0.2.16
  - @checkstack/signal-backend@0.2.1

## 0.7.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/signal-backend@0.2.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/cache-api@0.2.1
  - @checkstack/queue-api@0.2.15

## 0.7.0

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

- 8d1ef12: ## Per-entity caching with single-flight + safe invalidation across the dashboard hot paths

  ### `@checkstack/cache-api`

  - **Breaking** for backend implementors: `CacheProvider` now requires `deleteByPrefix(prefix: string): Promise<number>` for family-level invalidation. The in-memory provider implements it; downstream providers (Redis, etc.) must add it before upgrading.
  - `createScopedCache` forwards `deleteByPrefix` and keeps prefixes scoped to the calling plugin.

  ### `@checkstack/cache-utils` (new package)

  High-level read-through caching helpers built on `CacheProvider`:

  - `createCachedScope({ cacheManager, pluginId })` returns a scope with `wrap`, `wrapMany`, `invalidate`, and `invalidatePrefix`.
  - **Single-flight**: concurrent cache misses for the same key share one loader.
  - **Per-entity bulk caching** via `wrapMany` so list/bulk RPCs cache by id rather than by the full input shape — overlapping callers share entries and invalidation stays exact.
  - **Race-safe invalidation** via per-key epoch counters: a loader started before a mutation cannot repopulate the cache with stale data after the mutation invalidates it. The mutation invariant is `db.write → cache.invalidate (await) → signals.emit`.
  - Cache failures fall through to the loader so a cache outage cannot break reads.

  ### `@checkstack/backend`

  - The internal null `CacheProvider` (used when no cache backend is configured) now implements the new `deleteByPrefix` method as a no-op. Patch bump only — no behavior change for existing callers.

  ### `@checkstack/healthcheck-backend`

  - `getSystemHealthStatus` and `getBulkSystemHealthStatus` now read through a per-system cache (`healthcheck:status:<systemId>`), eliminating N database queries per dashboard refresh for unchanged systems.
  - Mutation paths (configuration CRUD, system associations, satellite ingest, queue-driven check runs, system/satellite removal hooks) invalidate affected keys before broadcasting their signals so frontend refetches always observe fresh data.

  ### `@checkstack/incident-backend`

  - `listIncidents`, `getIncident`, `getIncidentsForSystem`, and `getBulkIncidentsForSystems` now read through a scoped cache:
    - per-incident at `incident:<id>`
    - per-system at `system:<systemId>`
    - per-filter-shape at `list:<stable-stringify(filters)>` for the few list shapes the dashboard polls
  - Mutations (`createIncident`, `updateIncident`, `addUpdate`, `resolveIncident`, `deleteIncident`) invalidate the incident, every affected system, and every cached list before broadcasting `INCIDENT_UPDATED`.
  - The catalog `systemDeleted` cleanup hook drops that system's cached entries.

  ### `@checkstack/maintenance-backend`

  - `listMaintenances`, `getMaintenance`, `getMaintenancesForSystem`, and `getBulkMaintenancesForSystems` use the same per-entity / per-system / per-filter-shape pattern as incidents.
  - Mutations (`createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`, `deleteMaintenance`) invalidate before broadcasting `MAINTENANCE_UPDATED`.

  ### `@checkstack/catalog-backend`

  - Topology reads (`getEntities`, `getSystems`, `getSystem`, `getGroups`, `getSystemGroupIds`) cache under the `entity:` family (25s TTL).
  - Views (`getViews`) and per-system contacts (`getSystemContacts`) cache in their own families.
  - System / group / membership mutations drop the entire `entity:` family (every reader joins the same tables); view and contact mutations drop only their respective scopes.

  ### `@checkstack/slo-backend`

  - `listObjectives`, `getObjective`, `getObjectivesForSystem`, and `getBulkObjectivesForSystems` cache results including the expensive `engine.computeStatus` output.
  - Per-entity caching for the bulk handler so dashboards with overlapping system sets share entries.
  - Mutations (`createObjective`, `updateObjective`, `deleteObjective`) invalidate before broadcasting `SLO_STATUS_CHANGED`.

  ### `@checkstack/anomaly-backend`

  - New `router-cache.ts` adds a cache scope distinct from the existing detector baseline cache, keyed by stable filter hash.
  - `getAnomalies` and `getAnomalyBaselines` cache through this scope (15s TTL).
  - The detector invalidates the router cache before broadcasting `ANOMALY_STATE_CHANGED` on every state transition (suspicious/anomaly/recovered).
  - Config mutations also invalidate.

  ### `@checkstack/notification-backend`

  - `getUnreadCount`, `getNotifications`, and `getSubscriptions` cache per-user.
  - `markAsRead`, `deleteNotification`, `notifyUsers`, and `notifyGroups` invalidate every affected user's cache before sending realtime signals to that user.
  - `subscribe` and `unsubscribe` invalidate the user's subscription cache.

  ### `@checkstack/announcement-backend`

  - `getActiveAnnouncements` caches per-user (or anonymous) and per-`includeDismissed` flag (45s TTL — admin-driven, slowly changing).
  - `listAllAnnouncements` caches under a single key.
  - `dismissAnnouncement` only drops that user's cache; `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` drop every user's cache before broadcasting `ANNOUNCEMENT_UPDATED`.
  - The auth `userDeleted` cleanup hook drops that user's cached entries.

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/api-docs-common@0.1.10
  - @checkstack/auth-common@0.6.3
  - @checkstack/signal-backend@0.1.20
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.6.6

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-common@0.6.2

## 0.6.5

### Patch Changes

- 35a91e5: Fix truncated static file responses in production container

  Hono's `c.body()` wasn't fully consuming Bun's `ReadableStream` from `file.stream()`, causing truncated responses (e.g. 129B instead of 1098B for the favicon). Switched to reading the file as `ArrayBuffer` before passing to `c.body()`, ensuring the full content is delivered.

## 0.6.4

### Patch Changes

- a713e0f: Fix static file Content-Length header stripped by Hono middleware

  Hono's CORS middleware wraps raw `Response` objects and strips Bun's auto-generated headers. Switched to using `c.body()` + `c.header()` so Content-Type and Content-Length survive the middleware pipeline. Extracted a shared `serveFile` helper for all static file routes.

## 0.6.3

### Patch Changes

- 3da7582: Fix favicon not loading in production container and add NotFound page

  - **Backend**: Fix static file serving so root-level files like `/favicon.svg` are served from the dist directory before the SPA fallback catches them
  - **UI**: Add `NotFound` component with stacked-checkmark logo, physics-inspired falling "4" animation, and low-power device fallback
  - **Frontend**: Add catch-all `*` route to display the NotFound page for unmatched routes, and add the Checkstack logo to the navbar
  - **Favicon**: Redesign with stacked checkmarks in the brand purple/indigo palette

## 0.6.2

### Patch Changes

- 53a64c1: Fix Docker build by whitelisting LICENSE.md in .dockerignore
- 53a64c1: Update license to Elastic License with revised terms (copyright 2026). The license is now bundled inside both the main and satellite container images.

## 0.6.1

### Patch Changes

- e111f4a: Update license to Elastic License with revised terms (copyright 2026). The license is now bundled inside both the main and satellite container images.

## 0.6.0

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
  - @checkstack/backend-api@0.12.0
  - @checkstack/queue-api@0.2.13
  - @checkstack/signal-backend@0.1.19

## 0.5.3

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
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/api-docs-common@0.1.9
  - @checkstack/auth-common@0.6.1
  - @checkstack/signal-backend@0.1.18
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.5.2

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/queue-api@0.2.11
  - @checkstack/signal-backend@0.1.17

## 0.5.1

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/queue-api@0.2.10
- @checkstack/signal-backend@0.1.16

## 0.5.0

### Minor Changes

- 3589199: Add About page with platform information, license, contact details, and version information

  - New `about-common` package with plugin metadata
  - New `about-frontend` package with the About page and user menu item
  - New `/api/about` backend endpoint exposing core version and loaded plugin versions
  - Accessible via "About Checkstack" in the user menu dropdown

## 0.4.17

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/queue-api@0.2.9
  - @checkstack/signal-backend@0.1.15

## 0.4.16

### Patch Changes

- c0c0ed2: Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.
- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/auth-common@0.6.0
  - @checkstack/queue-api@0.2.8
  - @checkstack/signal-backend@0.1.14

## 0.4.15

### Patch Changes

- 4d59cc7: Prune devDependencies and development-only source folders (like `core/scripts` and `test-utils-*`) from the production Docker image to reduce size and improve security.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
  - @checkstack/api-docs-common@0.1.8
  - @checkstack/auth-common@0.5.7
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/drizzle-helper@0.0.4
  - @checkstack/queue-api@0.2.7
  - @checkstack/signal-backend@0.1.13
  - @checkstack/signal-common@0.1.8

## 0.4.14

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
  - @checkstack/auth-common@0.5.6
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/queue-api@0.2.6
  - @checkstack/signal-backend@0.1.12
  - @checkstack/api-docs-common@0.1.7
  - @checkstack/signal-common@0.1.7

## 0.4.13

### Patch Changes

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

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/queue-api@0.2.5
  - @checkstack/signal-backend@0.1.11

## 0.4.12

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/queue-api@0.2.4
  - @checkstack/signal-backend@0.1.10

## 0.4.11

### Patch Changes

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

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/api-docs-common@0.1.6
  - @checkstack/auth-common@0.5.5
  - @checkstack/signal-backend@0.1.9
  - @checkstack/signal-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.4.10

### Patch Changes

- f8ce585: Improved RPC error logging to include full stack traces for procedure errors. Previously, errors inside RPC handlers (such as database table not found errors) resulted in silent 500 responses. Now these errors are logged with detailed information to the backend console for easier debugging.

## 0.4.9

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/api-docs-common@0.1.5
  - @checkstack/auth-common@0.5.4
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/drizzle-helper@0.0.3
  - @checkstack/queue-api@0.2.2
  - @checkstack/signal-backend@0.1.8
  - @checkstack/signal-common@0.1.5

## 0.4.8

### Patch Changes

- dd16be7: Fix plugin schema isolation: create schema before migrations run

  Previously, schemas were only created when `coreServices.database` was resolved (after migrations), causing tables to be created in the `public` schema instead of plugin-specific schemas. Now schemas are created immediately before migrations run.

  Also removed the `public` fallback from migration search_path to make errors more visible if schema creation fails.

## 0.4.7

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/api-docs-common@0.1.4
  - @checkstack/auth-common@0.5.3
  - @checkstack/backend-api@0.5.1
  - @checkstack/signal-backend@0.1.7
  - @checkstack/signal-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.4.6

### Patch Changes

- 66a3963: Update plugin loader to use SafeDatabase type

  - Updated `PluginLoaderDeps.db` type from `NodePgDatabase` to `SafeDatabase`
  - Added type cast for drizzle `migrate()` function which still requires `NodePgDatabase`

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/backend-api@0.5.0
  - @checkstack/signal-backend@0.1.6

## 0.4.5

### Patch Changes

- 8a87cd4: Added startup validation for unregistered access rules

  The backend now throws an error at startup if a procedure contract references an access rule that isn't registered with the plugin system. This prevents silent runtime failures.

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/auth-common@0.5.2
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/queue-api@0.1.3
  - @checkstack/signal-backend@0.1.5
  - @checkstack/api-docs-common@0.1.3
  - @checkstack/signal-common@0.1.3

## 0.4.4

### Patch Changes

- 18fa8e3: Add notification suppression toggle for maintenance windows

  **New Feature:** When creating or editing a maintenance window, you can now enable "Suppress health notifications" to prevent health status change notifications from being sent for affected systems while the maintenance is active (in_progress status). This is useful for planned downtime where health alerts are expected and would otherwise create noise.

  **Changes:**

  - Added `suppressNotifications` field to maintenance schema
  - Added new service-to-service API `hasActiveMaintenanceWithSuppression`
  - Healthcheck queue executor now checks for suppression before sending notifications
  - MaintenanceEditor UI includes new toggle checkbox

  **Bug Fix:** Fixed migration system to correctly set PostgreSQL search_path when running plugin migrations. Previously, migrations could fail with "relation does not exist" errors because the schema context wasn't properly set.

- db9b37c: Fixed 500 errors on healthcheck `getHistory` and `getDetailedHistory` endpoints caused by the scoped database proxy not handling Drizzle's `$count()` utility method.

  **Root Cause:** The `$count()` method returns a Promise directly (not a query builder), bypassing the chain-replay mechanism used for schema isolation. This caused queries to run without the proper `search_path`, resulting in database errors.

  **Changes:**

  - Added explicit `$count` method handling in `scoped-db.ts` to wrap count operations in transactions with proper schema isolation
  - Wrapped `$count` return values with `Number()` in healthcheck service to handle BigInt serialization

## 0.4.3

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/queue-api@0.1.2
  - @checkstack/signal-backend@0.1.4
  - @checkstack/api-docs-common@0.1.2
  - @checkstack/auth-common@0.5.1
  - @checkstack/signal-common@0.1.2

## 0.4.2

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/auth-common@0.5.0
  - @checkstack/queue-api@0.1.1
  - @checkstack/signal-backend@0.1.3

## 0.4.1

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-common@0.4.0

## 0.4.0

### Minor Changes

- 180be38: # Queue Lag Warning

  Added a queue lag warning system that displays alerts when pending jobs exceed configurable thresholds.

  ## Features

  - **Backend Stats API**: New `getStats`, `getLagStatus`, and `updateLagThresholds` RPC endpoints
  - **Signal-based Updates**: `QUEUE_LAG_CHANGED` signal for real-time frontend updates
  - **Aggregated Stats**: `QueueManager.getAggregatedStats()` sums stats across all queues
  - **Configurable Thresholds**: Warning (default 100) and Critical (default 500) thresholds stored in config
  - **Dashboard Integration**: Queue lag alert displayed on main Dashboard (access-gated)
  - **Queue Settings Page**: Lag alert and Performance Tuning guidance card with concurrency tips

  ## UI Changes

  - Queue lag alert banner appears on Dashboard and Queue Settings when pending jobs exceed thresholds
  - New "Performance Tuning" card with concurrency settings guidance and bottleneck indicators

- 747206a: ### Schema-Scoped Database: Improved Builder Detection and Security

  **Features:**

  - Implemented `entityKind`-based detection of Drizzle query builders, replacing the hardcoded method name list. This automatically handles new Drizzle methods that use existing builder types.
  - Added `ScopedDatabase<TSchema>` type that excludes the relational query API (`db.query.*`) at compile-time, providing better developer experience for plugin authors.

  **Security:**

  - Blocked access to `db.query.*` (relational query API) in schema-scoped databases because it bypasses schema isolation. Plugins must use the standard query builder API (`db.select().from(table)`) instead.
  - Runtime error with helpful message is thrown if `db.query` is accessed, guiding developers to the correct API.

  **Documentation:**

  - Added comprehensive internal documentation explaining the chain-recording approach, why transactions are required for `SET LOCAL`, and how the proxy works.

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/auth-common@0.3.0
  - @checkstack/api-docs-common@0.1.1
  - @checkstack/signal-backend@0.1.2
  - @checkstack/signal-common@0.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6
  - @checkstack/backend-api@0.3.1
  - @checkstack/signal-backend@0.1.1

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

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/api-docs-common@0.1.0
  - @checkstack/auth-common@0.2.0
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/signal-backend@0.1.0
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

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/auth-common@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/queue-api@0.0.4
  - @checkstack/signal-backend@0.0.4
  - @checkstack/api-docs-common@0.0.4
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
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/signal-backend@0.0.3
  - @checkstack/api-docs-common@0.0.3
  - @checkstack/auth-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/api-docs-common@0.0.2
  - @checkstack/auth-common@0.0.2
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/drizzle-helper@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/signal-backend@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.1.4

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/auth-common@0.2.1
  - @checkstack/queue-api@1.0.1
  - @checkstack/signal-backend@0.1.1
  - @checkstack/api-docs-common@0.0.3
  - @checkstack/signal-common@0.1.1

## 0.1.3

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-common@0.2.0

## 0.1.2

### Patch Changes

- 0f8cc7d: Add runtime configuration API for Docker deployments

  - Backend: Add `/api/config` endpoint serving `BASE_URL` at runtime
  - Backend: Update CORS to use `BASE_URL` and auto-allow Vite dev server
  - Backend: `INTERNAL_URL` now defaults to `localhost:3000` (no BASE_URL fallback)
  - Frontend API: Add `RuntimeConfigProvider` context for runtime config
  - Frontend: Use `RuntimeConfigProvider` from `frontend-api`
  - Auth Frontend: Add `useAuthClient()` hook using runtime config

## 0.1.1

### Patch Changes

- f0bdec2: Fixed CI test failures by implementing proper module mocking infrastructure:
  - Added test-preload.ts with comprehensive mocks for db, logger, and core-services
  - Added skipDiscovery option to loadPlugins() for test isolation
  - Configured bunfig.toml preload for workspace-wide test setup

## 0.1.0

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

### Patch Changes

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

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/auth-common@0.1.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/signal-backend@0.1.0
  - @checkstack/api-docs-common@0.0.2
