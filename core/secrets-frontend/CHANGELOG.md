# @checkstack/secrets-frontend

## 0.2.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/frontend-api@0.7.1
  - @checkstack/secrets-common@0.2.1
  - @checkstack/ui@1.13.1

## 0.2.0

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
  - @checkstack/ui@1.13.0
  - @checkstack/common@0.13.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/secrets-common@0.2.0

## 0.1.0

### Minor Changes

- 270ef29: Add the Secrets platform (Phase 1): a central, plugin-agnostic secret manager with a pluggable backend extension point, a cross-plugin resolver service, and a universal Jenkins-style masking layer.

  - New packages: `secrets-common` (schemas, contract, `secrets.read`/`secrets.manage`, masking utils), `secrets-backend` (`SecretBackend` extension point, `secretResolverRef`/`secretAdminRef` services, run-scoped masking context, RPC router), `secrets-backend-local` (default AES-256-GCM backend, owns the `secrets` table promoted from gitops), `secrets-frontend` (admin Settings page).
  - Resolution machinery (`resolveSecretsBySchema`, `SecretStore`, `${{ secrets.NAME }}` / `x-secret`) is promoted out of `gitops-backend` into `secrets-backend`. GitOps now resolves and manages secrets through the platform's service refs (single source of truth); its secret table is migrated without loss.
  - Universal masking seam wired at the central script-output boundaries: automation `run_script` / `run_shell` artifacts and the in-UI test panel redact run-scoped secret values from `result`/`stdout`/`stderr`/`error` before persist/return. Phase 1 resolves no run-scoped secrets yet, so masking is a no-op until Phase 2; the seam guarantees the boundary exists.
  - No endpoint returns a secret value to a browser: DTOs expose only name/metadata/`hasValue`.

  BREAKING CHANGES: `gitops-backend` now depends on `secrets-backend` and resolves/manages secrets through it. The `secrets` table is owned by `secrets-backend-local`; the gitops `secrets` table is retained as a migration source but is no longer the source of truth.

- 270ef29: Secrets platform Phase 2: secret -> env-var mapping with central resolve, inject, and mask.

  - Script consumers declare a least-privilege `secretEnv` allowlist
    (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The automation `run_script` /
    `run_shell` actions resolve ONLY the declared secrets via
    `secretResolverRef.resolveForRun`, inject them into the runner env for
    that run (memory-only; the ESM runner gained a per-run `env` option), and
    mask their values out of stdout/stderr/result/error via the run-scoped
    masking context. A missing required secret fails the run clearly. No
    ambient secret access.
  - Test panel: `testScript` / `testCollectorScript` inject named
    `__SECRET_<NAME>__` placeholders by default, or user-supplied per-secret
    overrides; real production values are never resolved in the test path,
    and overrides are masked out of the result.
  - Healthcheck collectors carry the `secretEnv` field for authoring +
    the test panel; runtime injection on satellites lands in Phase 3.
  - Editor UX: a new `@checkstack/ui` `SecretEnvEditor` renders `x-secret-env`
    record fields with `${{ secrets.* }}` name autocomplete (from
    `listSecretNames`), wired into the automation action editor and the
    healthcheck collector editor. New `withConfigMeta` helper +
    `x-secret-env` config-meta key in `@checkstack/backend-api`.

- 270ef29: Secrets platform Phase 4: HashiCorp Vault backend + backend selection.

  - New `@checkstack/secrets-backend-vault`: a read-through `SecretBackend`
    against Vault. Token, AppRole, and OIDC/JWT auth (session cached to the
    lease TTL, capped); KV v2 reads mapped via the backend's own
    `secret_index` table (name → path/key); read-through value cache with a
    capped TTL (rotated values re-read). `list()` returns metadata only,
    never values. Minimal typed HTTP client (no extra dependency), injectable
    fetch for testing.
  - Backend selection: the active backend is persisted via `ConfigService`
    and switchable in Settings → Secrets; switching re-routes resolution.
    New `setBackendConfig` / `testBackend` RPCs (manage-gated, status-only)
    and `getBackendConfig` now returns Vault connection metadata
    (`hasCredential`, never the credential). `SecretBackend` gains optional
    `test` / `configure` / `getConfigMeta`.
  - The Vault auth credential is stored as an `x-secret` config field
    (encrypted at rest with the AES-GCM master key, redacted on read) —
    bootstrapping it WITHOUT putting it in Vault. It is write-only over the
    API and never logged.
  - Admin UI: backend selector + Vault connection form + "Test connection".

  Satellite-direct-Vault (a satellite reading Vault itself) is deferred to a
  follow-up; core-mediated delivery already routes through the Vault backend.

- b995afb: Hide secret write controls when the active backend is read-through.

  When a read-through backend (e.g. Vault) was active, the Secrets admin page still showed the "Add a secret", Rotate, and Delete controls even though the backend correctly rejects writes (`set` / `delete` are intentionally unimplemented), so every attempt errored.

  The active backend now reports a capability flag and the UI gates its write affordances on it instead of any hardcoded backend id, so other read-through backends are handled the same way.

  Changes:

  - `@checkstack/secrets-common`: add a `writable: boolean` field to `BackendConfigDto` (returned by `getBackendConfig`). It carries no sensitive data - a capability boolean only.
  - `@checkstack/secrets-backend`: populate `writable` in the `getBackendConfig` handler by inspecting the resolved active backend (true only when it implements both `set` and `delete`; `false` for read-through backends or an unresolved active id). Exposes a small `isBackendWritable` helper.
  - `@checkstack/secrets-frontend`: hide the create form, per-row Rotate / Delete buttons, and adjust the empty-state and helper text when the active backend is not writable, plus show a short "read-through" explainer. The local backend stays fully writable.

  State & scale: `writable` is derived on read from the resolved active backend's capabilities (durable config selects the backend), so every pod computes the same answer; no new state is introduced.

### Patch Changes

- b995afb: Tidy the user menu: move "Script packages" and "Secrets" into the **Configuration** group (the now-empty **Administration** group is gone), and display the user-menu groups in alphabetical order instead of a hardcoded canonical order.
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
  - @checkstack/ui@1.12.0
  - @checkstack/secrets-common@0.1.0
