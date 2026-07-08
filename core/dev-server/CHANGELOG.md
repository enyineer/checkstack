# @checkstack/dev-server

## 2.2.8

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0

## 2.2.7

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0

## 2.2.6

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0

## 2.2.5

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0

## 2.2.4

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0

## 2.2.3

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0

## 2.2.2

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/common@0.16.0

## 2.2.1

### Patch Changes

- Updated dependencies [56e7c75]
  - @checkstack/common@0.15.0

## 2.2.0

### Minor Changes

- ed251b6: Make `@checkstack/ui`'s Monaco `CodeEditor` render in standalone `bun run dev`, and consolidate the Monaco editor Vite settings into one shared helper so they can't drift.

  - **Shared config (now in `@checkstack/ui`).** `@checkstack/ui` exports a `monacoViteConfig` helper (`@checkstack/ui/src/vite-monaco`) with the editor's Vite settings - `worker.format: "es"` and the `vscode` resolve alias (so `require("vscode")` doesn't leak into the browser). `@checkstack/ui` owns `CodeEditor` and the editor dependencies, so all three consumers now share one source: the app's `vite.config.ts`, `@checkstack/dev-server`, and `@checkstack/ui`'s own Storybook config (each previously hand-rolled its own copy).
  - **Pre-built workers (dev server).** In a standalone plugin, `@checkstack/ui` is a _pre-bundled npm dependency_, and Vite's dependency optimizer can't process the Monaco language workers it imports via `?worker&url` - the dev server used to crash (and serving `@checkstack/ui` as source instead broke the CJS/ESM interop of its other deps). The dev server now pre-builds the three Monaco workers (editor / TypeScript / JSON) into static ES-module bundles, serves them, and redirects the `?worker&url` imports to them via `resolve.alias` (which applies during pre-bundling). `@checkstack/ui` stays pre-bundled and the workers resolve, so the editor renders. Builds are content-addressed and cached under `node_modules/.cache/checkstack-dev-monaco` (concurrency-safe atomic promotion), so only the first run after a dependency change pays the build cost. React is deduped so the editor's hooks share the dev shell's React instance.

### Patch Changes

- @checkstack/common@0.14.1

## 2.1.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1

## 2.1.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0

## 2.1.0

### Minor Changes

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

## 2.0.0

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0
  - @checkstack/backend@0.11.0
  - @checkstack/frontend@0.6.6

## 1.0.2

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend@0.10.3
  - @checkstack/frontend@0.6.4

## 1.0.1

### Patch Changes

- b627562: Bump direct and transitive dependencies to clear MEDIUM-severity advisories
  that Trivy now surfaces alongside CRITICAL/HIGH.

  Direct version bumps in package.json:

  - `@checkstack/catalog-backend`, `@checkstack/gitops-backend`,
    `@checkstack/healthcheck-frontend`: `uuid` `^13.0.0` → `^14.0.0`
    (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6). Also
    dropped the now-redundant `@types/uuid` devDependency — uuid 14 ships
    its own types and the npm `@types/uuid` package is a stub.
  - `@checkstack/gitops-backend`: `yaml` `^2.7.0` → `^2.8.3`
    (GHSA-48c2-rrv3-qjmp, stack overflow on deeply nested collections).
  - `@checkstack/dev-server`: `vite` `^5.4.0` → `^8.0.12`
    (GHSA-4w7w-66w2-5vf9, path traversal in optimized-deps `.map` handling)
    and `@vitejs/plugin-react` `^4.3.4` → `^6.0.1` to stay inside the new
    vite peer range.

  Root `overrides` / `resolutions` to bypass transitive pins that block the
  walk:

  - `dompurify` `^3.4.3` — `monaco-editor@0.55.1` pins `dompurify@3.2.7`
    exactly, so the only way to pick up the eight DOMPurify XSS / prototype
    pollution advisories (GHSA-v2wj-7wpq-c8vv et al.) is an override.
    Affects `@checkstack/ui`, which is the only consumer of monaco.
  - `uuid` `^14.0.0` — also forces `bullmq`'s nested `uuid@11.1.0`
    (vulnerable per GHSA-w5hq-g745-h8pq) to the patched line. Affects
    `@checkstack/queue-bullmq-backend`.
  - `yaml` `^2.9.0` — covers transitive resolutions that would otherwise
    pin pre-2.8.3 yaml.

  The CI image scan (`.github/workflows/pr-checks.yml`) and the local
  `bun run audit:*` helper now include `MEDIUM` alongside `CRITICAL,HIGH`,
  so future MEDIUM regressions fail the pipeline. The production Dockerfile
  also strips vendored `test/`, `tests/`, `__tests__/`, `benchmark/`,
  `benchmarks/`, `example/` and `examples/` folders from `node_modules`
  before the runtime stage — those tarball artefacts ship their own
  nested `package.json` (`benchmark`, `tedious-benchmarks`, etc.) which
  Trivy was scanning as if they were real packages.

  - @checkstack/frontend@0.6.1

## 1.0.0

### Patch Changes

- Updated dependencies [7c97b43]
- Updated dependencies [9016526]
  - @checkstack/frontend@0.6.0
  - @checkstack/backend@0.10.0
  - @checkstack/common@0.10.0

## 0.2.1

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/backend@0.9.1
  - @checkstack/frontend@0.5.1

## 0.2.0

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

- @checkstack/backend@0.9.0
- @checkstack/common@0.8.0
- @checkstack/frontend@0.5.0
