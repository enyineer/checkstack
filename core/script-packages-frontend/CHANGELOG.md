# @checkstack/script-packages-frontend

## 0.3.7

### Patch Changes

- @checkstack/sdk@0.103.1

## 0.3.6

### Patch Changes

- @checkstack/sdk@0.101.1

## 0.3.5

### Patch Changes

- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/frontend-api@0.9.0
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/script-packages-common@0.3.3
  - @checkstack/sdk@0.100.1
  - @checkstack/signal-frontend@0.2.4

## 0.3.4

### Patch Changes

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
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/common@0.14.1
  - @checkstack/script-packages-common@0.3.2
  - @checkstack/sdk@0.98.1

## 0.3.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/script-packages-common@0.3.2
  - @checkstack/sdk@0.97.0
  - @checkstack/signal-frontend@0.2.2

## 0.3.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/script-packages-common@0.3.2
  - @checkstack/sdk@0.96.1
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/frontend-api@0.7.1
  - @checkstack/script-packages-common@0.3.1
  - @checkstack/sdk@0.95.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.3.0

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

- 9dcc848: Add scheduled vulnerability auditing for Script Packages.

  A daily recurring job runs `bun audit --json` against the installed script-packages tree, persists advisories to new plugin-owned Postgres tables (`script_package_audit_advisory` keyed by lockfile hash + advisory id, plus a `script_package_audit_state` singleton last-run summary), and notifies every holder of `script-packages.manage` when a new or severity-escalated advisory appears. All severities are recorded; notifications fire on medium/high/critical, with a stable per-advisory key + a durable `notified` flag suppressing repeat-notify on an unchanged set. The pass is single-flight across the cluster via the existing installer advisory lock (mutually exclusive with installs, storage migrations, and blob GC) and reuses the installer's scratch / `.npmrc` / registry setup, reporting purely from the lockfile. New `getAuditState` and `auditNow` RPCs (gated by `script-packages.manage`), a `SCRIPT_PACKAGES_AUDIT_COMPLETED` signal, and a "Vulnerability audit" section in the settings page with an "Audit now" button that live-refreshes on completion.

  State and scale: audit results are the cluster-wide source of truth in Postgres (not the pod-local node_modules tree), so any pod returns the same advisories regardless of which pod ran the audit.

  This is a beta minor.

- 9dcc848: Layered OS-level script sandbox, secure and fail-closed by default (epic #247).

  Script and shell health checks and the `run_shell` / `run_script` automation actions now run inside a layered OS-level sandbox by default. The sandbox lives in `core/backend-api/src/script-sandbox/` (the single source of truth) and is enforced inside the shared runners, so it applies wherever a job runs.

  Layers:

  - Resource caps (CPU / memory / PID / FD / file-size, via `prlimit` on capable Linux; ESM JS-heap cap via `--max-old-space-size`; portable wall-clock timeout) and an OOM-safe streaming output cap.
  - Privilege drop via a NON-ROOT supervisor model: the shipped images run the supervisor as non-root uid `65532`, so every sandboxed script inherits non-root and can never be host-root; filesystem + network confinement is delivered by ROOTLESS `bwrap`/`nsjail` via unprivileged user namespaces. `enforced.privilege` is truthful (true only when the child cannot run as host-root). Runners no longer pass `uid`/`gid` to `Bun.spawn` (a silent no-op and a forward-compat hazard).
  - Filesystem isolation (`scratch-only` / `scratch-plus-ro`) confining the child to its per-run scratch dir over a read-only base; the interpreter path is RO-bound so the runtime execs, and `TMPDIR` is pinned to the in-namespace tmpfs.
  - Network egress control: `deny` (routeless loopback-only netns), `allowlist` (real plumbed egress via macvlan OR rootless slirp4netns + an in-kernel nftables filter), and an always-on metadata / link-local block (`169.254.0.0/16`, `fe80::/10`, `fc00::/7`). No-blackhole invariant: `enforced.network` is never true when egress is actually severed or unfiltered; unpluggable egress degrades to surfaced host net.
  - Per-run fork-bomb containment via RLIMIT*NPROC inside the fresh per-run user+PID namespace; a centralized forbidden-env denylist (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD*_`, `NODE*OPTIONS`, `BUN*_`, caller `PATH` overrides).
  - A validated tuned seccomp profile (`deploy/seccomp/checkstack-userns.json`) and a live `clone(CLONE_NEWUSER|CLONE_NEWNET)` capability probe (not the static sysctl), shipped by default in both Dockerfiles, `docker-compose.yml`, and `deploy/k8s/checkstack-sandbox.yaml`.

  Global policy and operator surface:

  - The global sandbox policy lives in ONE durable row owned by `script-packages` (its `ConfigService` row in shared `plugin_configs`). A single process-wide provider serves every runner; the two script plugins no longer register competing providers. A dedicated admin-only `script-sandbox.manage` permission gates both reading and writing the policy. New `getSandboxPolicy` / `setSandboxPolicy` endpoints and a Settings -> Script Sandbox admin UI (`enabled`, `onUnavailable`, network/filesystem/privilege modes, allow list, metadata block, resource caps). The startup capability/readiness log is emitted in-process by `script-packages-backend` (no fragile init-order RPC self-loop), and on a host that cannot enforce a layer a one-time startup warning explains the two local-dev paths (Docker, or set the global policy to `degrade`).
  - Satellite relay: the WS protocol carries the resolved policy in the `authenticated` message and a `sandbox_policy` push-on-change; a satellite caches the last relayed policy and resolves every run through it.

  BREAKING CHANGES (platform in BETA, shipped as minor):

  - Scripts run sandboxed by default. The shipped global default is FAIL-CLOSED (`onUnavailable: "fail"`): when a requested layer cannot be enforced the run is REFUSED (clean `exitCode: -1`, never an unsandboxed spawn) rather than silently degrading. Deployments on hosts that cannot enforce a layer (no bubblewrap, user namespaces blocked, no `/proc` unmask) must run the official images with the documented runtime flags (the bundled seccomp profile + `systempaths=unconfined`, or k8s `procMount: Unmasked`), or set the global policy to `degrade`. On macOS / restricted containers the strong layers degrade to the portable subset and are surfaced per run.
  - Default network posture is deny-egress (`allowlist` with an empty allow list, which resolves to the routeless `deny` path). Scripts calling external endpoints fail until those destinations are allowlisted in the global default. The always-on metadata / link-local block applies even under looser modes.
  - The per-action / per-check `sandbox` config override and the transport `ScriptRequest.sandbox` field are removed; policy is global-only, so an automation/check author can no longer weaken the sandbox on their own item. Stored configs carrying a stray `sandbox` key are tolerated (stripped on parse).
  - The shared runners' `run()` no longer accepts a `sandbox` option; callers rely on the global policy provider.
  - A satellite fails closed (most restrictive profile) until it receives the first relayed policy; a relay-read failure or an older core keeps it fail-closed. A relay failure can never loosen a satellite's sandbox.

  State and scale: the global policy is a single durable Postgres row read identically on every pod. Capability detection is per-process, deterministic from the host kernel, and surfaced per run via the `EffectiveSandbox` report (a Linux pod and a macOS satellite may legitimately differ). `CHECKSTACK_SANDBOX_UID/GID` and macvlan addressing are genuinely per-host infrastructure, surfaced per run, not the queryable policy. The satellite's policy cache is satellite-local transport state. No new pod-local current-state.

  This is a beta minor.

- 9dcc848: Add the auto-generated, version-pinned `@checkstack/sdk` package + codegen, and serve its types live to the in-app editor.

  - A new committed workspace package `@checkstack/sdk`, generated from the platform's source of truth by `scripts/generate-sdk.ts` (`generate:sdk` / `generate:sdk:check`): a fully-typed oRPC client (`createCheckstackClient`) over the REST surface with one `InferClient` per plugin contract, real script-authoring helpers (`@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration`) whose runtime body is the same identity function the in-app runner injects, per-subpath `.d.ts` under the package `exports` map, and an editor-only ambient bundle. A `generate:sdk:check` CI guard fails when the committed SDK files drift from a fresh generation. The `@checkstack/sdk` version is stamped from `@checkstack/release` and MUST NOT appear in a changeset (a guard enforces this); the `@checkstack/release` bump here advances the release version so the generated SDK can be published later. The generated client also normalizes its base URL without a backtracking-prone regex, closing a CodeQL `js/polynomial-redos` finding.
  - Live editor type injection: a new version-keyed route `GET /api/script-packages/sdk-types/:releaseVersion` (raw handler in `@checkstack/script-packages-backend`) serves the generated SDK editor bundle with `Cache-Control: private, max-age=1y, immutable`; the pure path-build/parse module lives in `@checkstack/script-packages-common`, shared by backend and frontend. A mismatched version returns `409` so the editor refetches and never serves stale types after an upgrade. The frontend `useSdkTypeInjection` hook fetches the bundle once per session and mounts it into Monaco via `addExtraLib`. Schema-narrowed `context.config` / `context.event.payload` editor types stay local; the package-resolving module declarations come from the one published `@checkstack/sdk` source.

  BREAKING CHANGES: the script-authoring import surface moves from the bare `@checkstack/healthcheck` / `@checkstack/integration` virtual modules to the `@checkstack/sdk/healthcheck` / `@checkstack/sdk/integration` subpaths of the published `@checkstack/sdk` package. The old bare-name imports no longer resolve (an old import now errors in the editor, surfacing the migration). Existing scripts must update the module specifier:

      - import { defineHealthCheck } from "@checkstack/healthcheck";
      + import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

      - import { defineIntegration } from "@checkstack/integration";
      + import { defineIntegration } from "@checkstack/sdk/integration";

  The helper names and their runtime behaviour are unchanged - only the module specifier moves. The global (no-import) helper form continues to work unchanged.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

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
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/common@0.13.0
  - @checkstack/script-packages-common@0.3.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/signal-frontend@0.2.0
  - @checkstack/sdk@0.93.1

## 0.2.0

### Minor Changes

- b995afb: Fix two Script Packages bugs: empty-allowlist installs and read-only Advanced settings.

  - Install now: clicking "Install now" with no enabled packages no longer fails with ENOENT and an `error` install state. With an empty dependency set `bun install` writes no `bun.lock`, so the central resolver previously threw reading it. The resolver now short-circuits an empty (or all-disabled) allowlist to an empty resolved set, ending the install in `ready` at 0.0 MB with the deterministic empty-lockfile hash. No subprocess or registry call is made in that case.
  - Advanced settings: the registry URL, "ignore install scripts" toggle, write-only auth token, size guardrail thresholds, and active storage backend are now editable in the Script Packages settings page (previously read-only displays) and wired to the existing `setRegistryConfig` / `setSizeCapConfig` / `setStorageBackend` mutations. The auth-token field is write-only: a blank field leaves the stored token untouched, and a "Clear token" action removes it. The destructive blob-migration flow is unchanged.

  No schema or RPC contract changes.

- 270ef29: Declutter the Script Packages settings page with progressive disclosure.

  The page stacked five always-open cards. The common case now stays prominent - install state plus the allowed-packages allowlist - and the advanced configuration (registry & storage summary, storage backend, satellite sync) moves into a collapsed-by-default accordion. The destructive storage-migration trigger is now guarded by a confirmation modal so it is never a single stray click.

- 270ef29: Add garbage collection for script packages, reclaiming both shared blob storage and per-host disk.

  Two things accumulated and were never reclaimed; both are now collected with provably-safe guards (referenced-set + grace + lock / active-run protection - when in doubt, retain).

  - **Blob GC (Postgres / S3 reclamation).** A new `gcBlobs` RPC (manage-gated) plus a daily scheduled job prune content-addressed blobs no longer referenced by any retained lockfile manifest (the current desired hash plus the previous N, default 1, for rollback / in-flight reconciles). Candidates are only deleted after a grace window (default 24h, keyed on `created_at`), each blob's bytes are removed from its recorded backend before its index row, and the pass holds the installer-election advisory lock so it is mutually exclusive with installs and storage migrations. The settings UI surfaces last-run and total-reclaimed figures and a "Run cleanup now" action. The installer now records each successful manifest in a new `script_package_lockfile_history` table so the retained set is computable; GC state lives in `script_package_blob_gc_state`.
  - **Tree GC (per-host disk).** After a successful symlink flip, each host (core pod or satellite) sweeps its `trees/<lockfileHash>/` dirs, deleting non-current trees older than a grace window (default 1h). `current`'s target is never deleted. Active-run safety uses a conservative mtime-keyed grace window chosen to exceed the longest run timeout, since runs are throwaway subprocesses with no robust cross-process refcount - a tree only becomes eligible once no live run could still be pinned to it.

  Adds the `gcBlobs` / `getBlobGcState` RPCs, the `BlobGcSummary` / `BlobGcState` schemas, and two new Drizzle tables (`script_package_lockfile_history`, `script_package_blob_gc_state`).

- b995afb: Autocomplete the import specifier itself in script editors.

  Lazy type acquisition only loads a package's types once its name is already in the buffer, so while you were still typing the import specifier (`import {} from "lod"`) there were no suggestions - the lazy-ATA catch-22. Script editors now suggest installed package names directly in import-specifier position; selecting one (e.g. `lodash`) inserts the name, and the existing ATA loop then loads its `@types/lodash` closure so members complete.

  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `importablePackages?: string[]` prop and a dedicated Monaco completion provider (registered once per `typescript`/`javascript` language, scoped to the editor's model, disposed on unmount). It fires ONLY when the cursor is inside an import/require module-specifier string - detected by a new pure, unit-tested helper `importSpecifierCompletionContext(lineUpToCursor)` that handles `from "…"`, bare `import "…"`, `require("…")`, and dynamic `import("…")`, returns the partial specifier + the replace range, and returns null once the string is closed or outside an import. Items are `kind: Module`, insert the bare name without touching the quotes, and coexist with (do not replace) the TS worker's own completions. Trigger characters: `"`, `'`, and `/` (for scoped subpaths); manual invoke (Ctrl+Space) also works. A new pure helper `importablePackageNames` filters a raw manifest name list (excludes `@types/*`, dedupes, sorts).
  - `@checkstack/script-packages-frontend`: `useScriptPackageTypeAcquisition()` now also returns `importablePackages`, derived from the installed manifest (what is actually resolvable at runtime) with `@types/*` companions excluded - you import `lodash`, never `@types/lodash` (the `@types` package still backs the closure types).
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: pass `importablePackages` into `DynamicForm` alongside the existing `acquireTypes` wiring, so both the Run Script action editor and healthcheck collector editors get import-name completion.

  The completion list is plugin-agnostic in `@checkstack/ui` (the names are injected); it never fires outside import-string positions, so normal completions are unaffected.

- b995afb: Fix package IntelliSense in script editors: lazy Automatic Type Acquisition (ATA) with proper `@types/*` resolution.

  Script editors (automation "Run Script (TypeScript)" and healthcheck collectors) now provide real autocomplete for installed npm packages. Importing a package whose types live in DefinitelyTyped - e.g. `import { debounce } from "lodash"` (lodash ships no own types; `@types/lodash` does) - now yields member completions. Previously no package completions appeared at all.

  Root cause: the old rollup wrapped each package's raw, multi-file `.d.ts` (with `export =`, `export as namespace`, and triple-slash `/// <reference path>` chains) inside a single `declare module "<name>" { ... }`, which the TypeScript worker silently rejected, and it truncated large type sets (lodash is ~866 KB across ~700 files) at a 256 KB cap.

  The fix registers the REAL declaration files at their `node_modules/...` virtual paths and lets TypeScript's own NodeJs + `@types` resolution do the work:

  - `@checkstack/script-packages-backend`: replaced `rollupPackageTypes` with a tree-driven closure extractor (`resolvePackageTypeClosure`). Given a bare specifier, it resolves against the materialized tree - own types via `package.json` `types`/`typings`/`exports` (bundled-types packages like `zod`/`dayjs`), the `@types/<mangled>` companion when it exists (`lodash` -> `@types/lodash`, scoped `@babel/core` -> `@types/babel__core`), or both, or neither (graceful empty, never a throw). It follows `/// <reference path|types>` and relative imports, includes each package's `package.json`, leaves every file UNWRAPPED, and surfaces a `truncated` flag instead of silently capping. Served from a new raw, HTTP-cacheable route `GET /api/script-packages/types/:lockfileHash/:specifier` (`Cache-Control: private, max-age=1y, immutable`), auth-gated by `script-packages.read`.
  - `@checkstack/script-packages-common`: **BREAKING** - replaced the `listPackageTypes` RPC procedure and `PackageTypesSchema { name, version, dts }` with `PackageTypeClosureSchema` (a `{ path, content }` file-map plus `hasOwnTypes`/`hasAtTypes`/`notFound`/`truncated`) served over the cacheable HTTP route. Added a shared `buildTypeAcquisitionPath`/`parseTypeAcquisitionPath` path contract.
  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `acquireTypes` resolver + `acquireResetKey`. On debounced buffer change it parses bare `import`/`require` specifiers (pure, unit-tested) and lazily fetches + registers each NEW package's closure via `addExtraLib` at `file:///node_modules/...`, deduped by a shared acquired-set that resets when the install hash changes. Compiler options set `moduleResolution: NodeJs`, `baseUrl: "file:///"`, and `typeRoots` so a bare import resolves to its `@types` companion. The `context` ambient global keeps working unchanged.
  - `@checkstack/script-packages-frontend`: replaced the old `useScriptPackageTypes` (which concatenated the broken `dts`) with `useScriptPackageTypeAcquisition()`, returning the `acquireTypes` resolver (targets the cacheable route, zod-validates the response) and the current `lockfileHash` as `acquireResetKey`.
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: wired the resolver into the Run Script and collector editors.

  State & scale: the type closure is derived on read from the materialized package tree (no new durable state). The editor's acquired-set is pod-local UI bookkeeping; the route is keyed by the cluster-wide `lockfileHash`, so the browser HTTP cache is correct across pods and only refetches after a new install changes the hash.

- b995afb: Add live, backend-proxied npm package-name autocomplete and version lookup to the Script Packages "Allowed packages" form.

  The package-name field now searches the configured registry as you type (debounced). The version field suggests the package's published versions newest-first, defaulting to the registry's `latest` dist-tag while staying free-typeable for an exact manual pin. Picking a package now auto-fills its version (from the search hit, then upgraded to `latest`) instead of clearing the field, and the version dropdown stays open so a version is actually selectable.

  This is fully backend-proxied so it reuses the SAME configured registry + auth the install path uses: the registry can be private with a server-side-only auth token (the client only ever sees `hasAuthToken`), and browsers can't reach arbitrary registries due to CORS.

  - `@checkstack/script-packages-common`: two new `manage`-gated query procedures - `searchPackages` (input `{ text }`, output `{ items: [{ name, version?, description? }] }`) and `getPackageVersions` (input `{ name }`, output `{ versions, distTags? }`). Output `version`/`versions` are relaxed to plain strings so valid-but-unusual registry versions surface as suggestions; strict `PackageVersionSchema` validation still applies on `addPackage`.
  - `@checkstack/script-packages-backend`: new `registry-client` (fetch-based, AbortController timeout, size cap, zod-validated registry responses, scoped-registry selection, tolerant semver-descending sort, a best-effort pod-local read cache that is never a source of truth, and errors that never leak the auth token). Search results use the registry's own relevance ranking from `-/v1/search`. The registry + token resolution used by the install path is factored into a shared `resolveRegistryRequestConfig` helper reused by both the new RPC handlers and the installer.
  - `@checkstack/script-packages-frontend`: the package and version inputs become live comboboxes (Popover + Input) with inline pinned-version validation before "Add" is enabled. Selecting a suggestion routes through a dedicated `onSelect(hit)` callback (separate from manual-typing `onValueChange`) so a pick auto-fills the version instead of clearing it; the popover dismissable layer ignores interactions originating on the anchor input, fixing the version dropdown that previously opened then immediately closed. The version-autofill decision logic is extracted into a pure, unit-tested helper.

  State & scale: the registry-client TTL cache is an explicitly non-authoritative, pod-local best-effort read cache (search/version lookups are non-authoritative reads); a cache miss on another pod simply re-fetches, so pod-local divergence is harmless. No new durable state of record is introduced.

- 270ef29: Wire up the script-packages RPC router, admin UI, and editor IntelliSense.

  - `script-packages-backend`: the oRPC router implementing the full
    contract (allowlist CRUD, registry config with encrypted write-only auth
    token, `installNow` via the elected installer, size cap, storage backend
    selection, install state, `getManifest` / `downloadBlob` for reconcilers,
    and `listPackageTypes`), the `installNow` controller (election, size-cap
    enforcement, `script-packages.changed` emit, blocked during migration),
    the `.d.ts` rollup, the singleton config stores, and the full plugin
    wiring (broadcast-hook reconcile + startup backstop).
  - `script-packages-common`: admin route for the settings page.
  - `script-packages-frontend`: the Settings -> Script Packages admin page
    (allowlist, install state + size, registry/storage summary, satellite
    sync) and the `useScriptPackageTypes()` hook.
  - `automation-frontend` / `healthcheck-frontend`: merge installed-package
    `.d.ts` into the script-editor `typeDefinitions` so `import` from an
    allowlisted package autocompletes in every script field.

- 270ef29: Add storage-backend migration for script packages.

  - `migrateStorage({ target })` copies every blob from the active backend to
    the target, verifies each copy byte-for-byte (read back + SHA-256 compare),
    flips the per-blob `backend` only after a verified copy, then atomically
    switches the active backend. Resumable from a partial state (the work set
    is re-derived from the index), aborts cleanly on an integrity mismatch
    (active backend untouched), and supports optional source GC. Built on the
    Phase 2 dual-backend read fallback, so reads keep working mid-migration.
  - Migration and `installNow` are mutually exclusive via the installer
    advisory lock; `setStorageBackend` is refused while a migration runs.
  - New `listStorageBackends` RPC + admin UI: a storage-backend card with a
    target selector, "Migrate" action, and live progress / completion / error
    state.

### Patch Changes

- b995afb: Improve the automation Run Script secret → env mapping editor and script IntelliSense.

  - **Searchable secret picker with existence validation.** The secret → env mapping editor (`SecretEnvEditor`) now uses a searchable, keyboard-navigable combobox (modeled on `VariablePicker` / `PackageNameCombobox`, `isLowPower`-aware) populated from the secrets plugin's `listSecretNames`, replacing the plain `<input>` + `<datalist>`. A free-typed name still round-trips (a secret may be created later). When a row references a name that the loaded list does not contain, the row shows a non-blocking warning (red border + message); save is not prevented. The existence check lives in a pure, unit-tested `unknownSecretNames` helper.
  - **Clearer field description.** The `secretEnv` field descriptions on the `run_script` / `run_shell` actions no longer show the stored `${{ secrets.NAME }}` template (which is confusing in a UI that takes a bare name); they now describe the actual UI behavior and how the value is injected (`process.env.<ENV_NAME>` / `$<ENV_NAME>`) and masked.
  - **`process.env.<ENV_NAME>` autocomplete.** Declared `secretEnv` env-var names now autocomplete under `process.env.` in the Run Script (TypeScript) Monaco editor and are typed `string`, via an ambient `NodeJS.ProcessEnv` augmentation merged into the editor type definitions. New pure, unit-tested generators `generateSecretEnvTypes` and `secretEnvEnvNames` (exported from `@checkstack/automation-frontend`) drive this; the augmentation coexists with `@types/node`'s existing index signature.
  - **Shared combobox-interaction helper.** The "opens-then-immediately-closes" popover guard (`comboboxAnchorProps` / `isAnchorInteraction`) is promoted from `@checkstack/script-packages-frontend` into `@checkstack/ui` so the new secret picker and the existing package/version comboboxes share one implementation; the package comboboxes now import it from `@checkstack/ui` and the local copy is removed.

- b995afb: Tidy the user menu: move "Script packages" and "Secrets" into the **Configuration** group (the now-empty **Administration** group is gone), and display the user-menu groups in alphabetical order instead of a hardcoded canonical order.
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
  - @checkstack/ui@1.12.0
  - @checkstack/script-packages-common@0.2.0
