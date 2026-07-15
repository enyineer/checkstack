# @checkstack/scripts

## 0.7.6

### Patch Changes

- Updated dependencies [6c8b36b]
  - @checkstack/common@0.23.0

## 0.7.5

### Patch Changes

- 56af572: Pin `@module-federation/vite` (1.16.15) and `@module-federation/runtime`
  (2.7.0) exactly in the host, matching the already-pinned plugin frontend
  template. This repo's Renovate policy only runs automerged lock-file
  maintenance within the hand-curated `package.json` ranges - a caret range on
  the Module Federation packages meant a broken upstream release (like 1.17.1)
  could ride into the single maintenance PR once past the release-age cooldown,
  fail CI there, and block every other security update until untangled. MF is
  the host<->remote ABI surface, so host and scaffold template must move
  together: a new lockstep guard test fails whenever one pin is bumped without
  the other. Resolved versions are unchanged (the lockfile already held these);
  future MF bumps are now deliberate edits gated by the full CI, including the
  external-plugin lifecycle test.
- 56af572: Pin `@module-federation/vite` to 1.16.15 in the scaffolded plugin frontend
  template. The template's `^1.16` range floats to the newest release at
  install time (a scaffolded workspace has no lockfile and, unlike this repo,
  no minimum-release-age cooldown), and upstream 1.17.1 - published 80 minutes
  before it broke CI - regressed named-export detection for `import: false`
  shared subpaths (`@checkstack/ui/code-editor`), failing every scaffolded
  frontend build with MISSING_EXPORT "CodeEditor". Verified against the full
  external-plugin lifecycle: 1.16.15/1.16.16/1.17.0 pass, 1.17.1 fails. The
  exact pin makes scaffolded builds deterministic; bump it deliberately once
  upstream ships a fix (Renovate does not manage the `.hbs` templates).
  - @checkstack/common@0.22.0

## 0.7.4

### Patch Changes

- 05827f8: Install dependencies from the lockfile before starting the dev instance in the
  developer cockpit. Selecting "1 Dev" now runs `bun install --frozen-lockfile`
  with streamed progress before booting deps + backend + frontend, so pulling a
  Renovate lock-file refresh no longer leaves you running against a stale
  `node_modules`. The PR-preview flow (option 2) already installs its own merged
  worktree, so it is unchanged.
  - @checkstack/common@0.22.0

## 0.7.3

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0

## 0.7.2

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0

## 0.7.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0

## 0.7.0

### Minor Changes

- f146fe6: Add the developer cockpit (`bun run dev`), an opentui-based terminal UI that
  hosts the existing dev-run instance plus a new PR-preview flow.

  PR preview merges one or more selected open PRs into a throwaway worktree, copies
  the dev database into an ephemeral snapshot, and boots the merged app on random
  free ports as a namespaced SECONDARY instance (`CHECKSTACK_INSTANCE_NAMESPACE`),
  running alongside the normal dev instance without colliding on ports, database,
  or shared redis. Nothing user-visible is suppressed - notifications,
  integrations, AI and probes all run in the preview.

  - Interactive: `bun run dev` opens on a home screen and auto-starts NOTHING;
    `1` starts/opens dev, `2` opens the PR-preview view (multi-select PRs), `s`
    stops the current instance without quitting the cockpit, `q` quits. Selecting
    text auto-copies it to the system clipboard.
  - Non-interactive (agent-facing): `bun run preview:prs --prs 380,381`
    (`--fresh` to re-snapshot, `--wipe` to drop the copy).
  - The preview instance boots against an isolated `CHECKSTACK_DATA_DIR` seeded
    from the dev instance's script-package store, so its startup reconcile reuses
    the already-built trees instead of a cold offline install.
  - When an instance's frontend is up, the cockpit auto-opens its served URL in
    the default browser (dev and preview alike), taken from vite's `Local:` banner
    so it matches the actual port; it opens once and does not reopen on reload.
  - Generated-file merge conflicts (docs-index, sdk, lockfile) auto-resolve by
    regeneration; hand-authored conflicts stop and are reported.
  - Each instance (dev and preview) has a full supervision panel: a process
    sidebar with status dots and unread-alert badges, a scrollable per-process log
    (Tab/Arrows to switch, Up/Down/PgUp/PgDn to scroll), a pinned alerts panel,
    `r` to restart the focused process, and a teardown overlay on quit.
  - Swaps the renderer from ink to `@opentui/core` / `@opentui/react` (prebuilt
    native renderer, no Zig toolchain needed) and REMOVES the previous ink dev
    runner and its component kit - the cockpit is now the sole `bun run dev`.

  The dev supervisor now supports per-process `env` overrides and injected process
  defs (used by the preview instance), and `core/frontend`'s vite dev proxy target
  is overridable via `CHECKSTACK_DEV_BACKEND_URL` (dev-only; inert by default).

- d9f4654: Make the `bun run create` plugin scaffold RLAC-aware. A newly generated plugin's
  `*-common/access.ts` now exports a `<plugin>ResourceTypes` constant derived from
  the SAME noun the access rule uses (`accessPair("item", ...)` +
  `resourceType(pluginMetadata, "item")`), so the frontend capability type cannot
  drift from the middleware's grant key. The contract and frontend templates carry
  inline guidance on team-scoping (which `instanceAccess` mode to use) and the
  required `manageCapability`, pointing at `.claude/rules/rlac.md` and
  `bun run check:manage-capabilities`.

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0

## 0.6.5

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0

## 0.6.4

### Patch Changes

- 2e20792: Add a `preview` mode to the dev TUI

  `bun run preview` starts the dev TUI with the frontend serving its production
  build (`vite preview`) instead of the dev server, so you can trace real
  first-paint behavior on a throttled network. Backend and docker deps run as in
  `dev`.

  - @checkstack/common@0.17.0

## 0.6.3

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0

## 0.6.2

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/common@0.16.0

## 0.6.1

### Patch Changes

- 56e7c75: Pass the now-required `pluginId` option to `accessPair()` in the common plugin
  template (`access.ts.hbs`). After `accessPair()` gained a required third
  argument (fully-qualified access rules), scaffolded plugins no longer
  typechecked out of the box. The template now supplies `{ pluginId }` (the
  plugin base name), so freshly scaffolded common/backend/frontend plugins pass
  typecheck again.
- Updated dependencies [56e7c75]
  - @checkstack/common@0.15.0

## 0.6.0

### Minor Changes

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

### Patch Changes

- @checkstack/common@0.14.1

## 0.5.0

### Minor Changes

- 968c12f: Make installed (runtime) frontend plugins actually load, via Module Federation 2.0. Previously a packed external plugin's frontend could not run: the host only shared React/router with runtime plugins, and there was no working way to share the framework/UI singletons (hand-rolled import-map externalisation hit an unsolvable rolldown CJS-interop wall).

  - **Host (`@checkstack/frontend`)** now uses `@module-federation/vite` as an MF host and loads runtime plugins through the MF runtime (`registerRemotes` + `loadRemote`) instead of a raw `import()`. The shared set (react, react-dom, react-router-dom, @tanstack/react-query, @checkstack/frontend-api) is owned by the host; plugins reuse those exact instances via the share scope. The old hand-rolled vendor build + import map are removed.
  - **`@checkstack/ui`** is bundled per consumer (tree-shaken); its Theme / Toast / Performance React contexts are unified across the host and bundled-in-plugin copies via a registered (globalThis-keyed) context, so a plugin's `useTheme`/`useToast`/`usePerformance` resolve to the host's providers. The ONE exception is the Monaco / VS Code **CodeEditor**, now exposed as the `@checkstack/ui/code-editor` subpath and shared as an MF singleton: the host owns the single editor instance (and builds its `?worker&url` workers), and plugins reuse it. A plugin can now render `<CodeEditor>` (directly or via `ScriptTestPanel` / template/JSON fields) without bundling Monaco.
  - **Scaffold + pack (`@checkstack/scripts`)** build frontend plugins as MF remotes (`vite build` with the federation plugin, exposing `./plugin`, manifest enabled, DTS disabled). The CodeEditor is shared with `import: false` so the plugin is a consume-only participant - it never bundles a local fallback of the editor, keeping the heavy `@codingame/*` / `monaco-languageclient` / `vscode` subtree out of the plugin entirely (so no `vscode` alias or ES-worker config is needed in the plugin build). `plugin-pack` builds frontend packages with `NODE_ENV=production` (the MF plugin skips the remote under `NODE_ENV=test`) and ships only `dist/`. The scaffolded route now declares a `nav` entry so it appears in the sidebar.
  - **Backend (`@checkstack/backend`)** serves a plugin's MF assets under its (possibly scoped) package name (`/assets/plugins/@scope/name/*`), with correct content types, and the SPA catch-all defers those paths so the federation manifest/remoteEntry are not shadowed by `index.html`.

  Verified end-to-end by the external-plugin install E2E (scaffold → pack → install via the Plugin Manager UI → frontend + backend + co-loaded core plugins all work).

### Patch Changes

- @checkstack/common@0.14.1

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0

## 0.4.0

### Minor Changes

- 9dcc848: Cut initial-load JS: lazy plugin contributions, a hardened lazy-by-default contribution contract, on-demand Monaco, and a lighter icon/chart load.

  - Lazy plugin route pages: each plugin's route `element` references a `React.lazy`-wrapped page rendered inside a shared `<Suspense>` boundary. Plugins still register synchronously, so nav, slots, commands, API factories, and `foreignSignals` are available on first paint. This moves ~37 route-page chunks (~600 KB) out of the entry; the entry chunk drops from ~2.4 MB to ~190 KB. Auth flow pages stay eager. The `@checkstack/scripts` scaffold template generates lazy route pages too.
  - Hardened contribution contract (BREAKING, frontend plugin contract): plugins declare contributions lazily and let the framework own code-splitting, Suspense, and per-plugin error isolation. Routes use `load: () => import("./Page").then((m) => ({ default: m.Page }))` instead of `element: <Page />` (`element` is still accepted for the rare page that must paint without a chunk fetch; provide exactly one). Slot extensions accept either an eager `component` or a lazy `load`; new `getLazyContribution` + `ExtensionComponent` exports from `@checkstack/frontend-api` render either kind. This also fixes runtime-installed plugins: `ExtensionSlot` subscribes to the plugin registry, and the API registry rebuilds when the plugin set changes (`getPlugins()` returns an immutable snapshot via `useSyncExternalStore`). A per-plugin error boundary contains a bad contribution.
  - On-demand Monaco: the `@checkstack/ui` barrel no longer pulls the `@codingame/*` / `monaco-languageclient` stack into the initial load. `CodeEditor` lazy-loads its Monaco-backed editor behind `React.lazy` + Suspense, `validateTypeScriptSources` imports the editor API via in-body `await import(...)`, and the "vscode services ready" signal moved to a Monaco-free module. The ~10 MB editor body loads only when a `CodeEditor` mounts. A `react-vendor` `manualChunks` split was added for stable vendor caching.
  - lucide-react 1.x + lighter icons/charts (BREAKING for icon consumers): lucide-react unified from three drifting ranges to `^1.17.0`. lucide v1 removed brand icons, so the GitHub/GitLab marks are vendored in `@checkstack/ui` (`GithubIcon`, `GitlabIcon`, `brandIcons`); a new `IconName` type (`LucideIconName | BrandIconName`) in `@checkstack/common` is canonical, accepted by `AuthStrategy.icon` and the card components, so data-driven brand names keep working. `DynamicIcon` no longer eagerly imports lucide's ~1600-icon map (~1 MB) - it lives in a `React.lazy` `iconRegistry` chunk fetched on first data-driven render, while statically named-imported icons tree-shake normally. The recharts-backed health-check charts (~300 KB) and the `HealthCheckSystemOverview` drawer leave the initial load.

  BREAKING CHANGES:

  - Frontend plugin contract: routes/slot contributions are lazy-by-default (`load` instead of `element`/eager elements) as described above.
  - Any external consumer importing a brand icon from `lucide-react` (e.g. `import { Github } from "lucide-react"`) must switch to the vendored `@checkstack/ui` brand icons or a custom SVG.

  This is a beta minor.

- 9dcc848: Add a standalone plugin scaffolder and extract a monorepo-decoupled scaffolding engine.

  A new published package `create-checkstack-plugin` bootstraps a complete, standalone Checkstack plugin workspace (a `common` contract package, a `backend` implementing it, and a `frontend` consuming it) outside the monorepo, so `bun create checkstack-plugin <dir>` / `bunx create-checkstack-plugin <dir>` produce a repo where `bun install && bun run dev` works on first boot. It generates a local Bun workspace (private root `package.json`, root tsconfig, self-contained eslint config, `.gitignore`, quickstart README, changeset config), `git init`s the result (opt out with `--no-git`), and resolves concrete published `@checkstack/*` versions via `npm view` against the registry's `latest` dist-tag (overridable with `--version-tag` / `--registry` / `CHECKSTACK_SCAFFOLD_REGISTRY`); each `@checkstack/*` dep is resolved independently (versions are 0.x and not lockstepped), while the local trio siblings stay `workspace:*`. Sensible defaults: synthetic dev auth, a single local Postgres, one `items` table with CRUD at `/api/<pluginId>/*`, and one frontend list page. `create-checkstack-plugin` declares `@checkstack/scripts` as a runtime production dependency (by design - it imports the scaffolding engine from `@checkstack/scripts`'s published `src/`).

  `@checkstack/scripts`: the plugin-scaffolding logic is extracted into a reusable `scaffold/` engine (`scaffoldPlugin`, `refreshMonorepoReferences`, `resolveTargetDir`) parameterized by a `ScaffoldMode` (`monorepo` | `standalone`) instead of reading `process.cwd()`. The `workspace:*`-to-concrete rewrite is extracted into `rewriteWorkspaceVersions` with an injectable `VersionResolver` seam (now async, `Promise<string | undefined>`) so the standalone resolver resolves each dependency from the registry concurrently; `plugin-pack` and the in-monorepo `create` command are updated and behave identically. New exports: `scaffoldStandaloneRoot`, a scope-aware `scoped` Handlebars helper + `packageScope` template field (defaults to `checkstack`), and a `./scaffold` subpath export. The scaffolded backend template emits `checkstack.bundle`. No breaking change for existing consumers; the in-monorepo `create` output is unchanged.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

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

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/common@0.13.0

## 0.3.4

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0

## 0.3.3

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

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0

## 0.3.2

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0

## 0.3.1

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0

## 0.3.0

### Minor Changes

- e90aba5: Split the dev server out of `@checkstack/scripts` into a new
  `@checkstack/dev-server` package.

  **Why**: Previously `@checkstack/scripts` declared `@checkstack/backend`,
  `@checkstack/frontend`, `@checkstack/ui`, `vite`, and
  `@vitejs/plugin-react` as runtime dependencies so the bundled `dev`
  command could spawn a local Checkstack. That made `bunx
@checkstack/scripts plugin-pack` (and any other CLI usage) resolve the
  platform's full transitive dep graph from npm — which broke the
  `Version Packages` release run when one of those transitives
  (`@checkstack/cache-api@0.1.0`) hadn't been published yet, blocking
  plugin-pack validation for 40 plugins.

  **What changed**:

  - New package `@checkstack/dev-server` with the bin `checkstack-dev`. It
    owns the dev loop (backend spawn, Vite, file watcher) and is meant to
    be installed as a `devDependency` in plugin repos.
  - `@checkstack/backend` and `@checkstack/frontend` are _optional_ peer
    dependencies of dev-server; plugin authors only declare the one
    matching their plugin type.
  - `@checkstack/scripts` runtime deps slimmed to `@checkstack/common`,
    `tar`, `inquirer`, `handlebars`. The `dev` command was removed from
    the CLI (it had not shipped to users yet).
  - Plugin scaffolding templates now produce `dev` scripts that call
    `checkstack-dev` directly and add `@checkstack/dev-server` plus the
    matching platform package as devDependencies.
  - Documentation updated to reflect the new dev-loop entry point.

  Both bumps are minor since the project is in beta — the removed `dev`
  command and dropped transitive deps would normally be a major bump.

### Patch Changes

- @checkstack/common@0.8.0

## 0.2.0

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
- Updated dependencies [50e5f5f]
  - @checkstack/backend@0.9.0
  - @checkstack/frontend@0.5.0
  - @checkstack/common@0.8.0
  - @checkstack/ui@1.7.1
  - @checkstack/frontend-api@0.4.2

## 0.1.2

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.

## 0.1.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

## 0.1.0

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

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
