# @checkstack/secrets-common

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0

## 0.2.8

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0

## 0.2.7

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0

## 0.2.6

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

  - @checkstack/common@0.17.0

## 0.2.5

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0

## 0.2.4

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/common@0.16.0

## 0.2.3

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

- Updated dependencies [56e7c75]
  - @checkstack/common@0.15.0

## 0.2.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1

## 0.2.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0

## 0.2.0

### Minor Changes

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/common@0.13.0

## 0.1.0

### Minor Changes

- b995afb: Fix the automation Run Script action's `secretEnv` (secret → env mapping) test wiring and tolerate bare secret names.

  - `@checkstack/ui` `ScriptTestPanel` now accepts the script field's declared `secretEnv` and renders an optional per-secret test-override input. The `ScriptTestRenderer` callback (DynamicForm) receives the SIBLING `x-secret-env` mapping value, located by annotation (not by field name), so a testable script field forwards it to the panel. Previously the test path never sent `secretEnv`, so `buildTestSecretEnv` got `undefined` and `process.env.<env>` was undefined in an in-UI test. Now an override-less test injects `__SECRET_<NAME>__` placeholders, and any operator override is masked from the output. Real secret values are still NEVER resolved in the test path.
  - `@checkstack/automation-frontend` forwards the action's `secretEnv` and the collected overrides to `testScript`.
  - `@checkstack/secrets-common`: the `secretEnv` mapping VALUE now accepts EITHER a `${{ secrets.NAME }}` template OR a bare secret name, normalizing a bare name to the canonical `${{ secrets.NAME }}` template on parse. This is a forgiving / NARROWING input change (more inputs accepted; stored/output form is unchanged and still the template), not a breaking change. Existing data and YAML shorthand like `secretEnv: { secret: SECRET }` now pass config validation instead of failing with "Must contain a ${{ secrets.NAME }} reference". Partial inline interpolation (e.g. `u:${{ secrets.pw }}@host`) keeps working unchanged; values that are neither a secret reference nor a valid secret name are still rejected.
  - `@checkstack/ui` `parseSecretName` tolerates a legacy bare secret name for display so the picker shows the same name for both the template and the bare form.

  The healthcheck collector test panel was checked: its config has no `x-secret-env` field, so it needed no secret wiring (only the `onRun` signature change, which is backward compatible).

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

- 270ef29: Secrets platform Phase 5: internal-secret consolidation (registry token) + connection-credential leak hardening.

  - New `internalSecretsRef`: platform-internal secrets (not user-managed
    named secrets) stored under a reserved `__internal__:` prefix, ALWAYS on
    the local (always-writable, AES-GCM) backend so internal writes never
    break when Vault is the active backend. Excluded from the user-facing
    Secrets list.
  - The script-package registry auth token is consolidated onto
    `internalSecretsRef`. The `authSecretRef` column now holds a stable
    marker; a one-time, idempotent, parity-verified migration moves legacy
    inline ciphertext into the platform and only rewrites the column once the
    platform copy reads back identically (legacy value never dropped early).
    Resolution stays backward-compatible with legacy ciphertext.
  - Integration: `createConnection` / `updateConnection` now return the
    redacted connection preview instead of echoing the submitted credential
    fields back in the response (leak hardening). Non-breaking — the frontend
    refetches the redacted list and ignores the returned preview.

  NOTE: integration connection-credential STORAGE is intentionally NOT
  migrated onto the secrets platform. Connection creds are co-mingled
  secret/non-secret config stored per-provider via `ConfigService` (which
  already uses the same AES-GCM crypto + per-field redaction); splitting them
  out would require per-provider schema-walking and a lossy migration across
  live integrations for no real gain. The `ConnectionStore` API + storage are
  unchanged.

- b995afb: Hide secret write controls when the active backend is read-through.

  When a read-through backend (e.g. Vault) was active, the Secrets admin page still showed the "Add a secret", Rotate, and Delete controls even though the backend correctly rejects writes (`set` / `delete` are intentionally unimplemented), so every attempt errored.

  The active backend now reports a capability flag and the UI gates its write affordances on it instead of any hardcoded backend id, so other read-through backends are handled the same way.

  Changes:

  - `@checkstack/secrets-common`: add a `writable: boolean` field to `BackendConfigDto` (returned by `getBackendConfig`). It carries no sensitive data - a capability boolean only.
  - `@checkstack/secrets-backend`: populate `writable` in the `getBackendConfig` handler by inspecting the resolved active backend (true only when it implements both `set` and `delete`; `false` for read-through backends or an unresolved active id). Exposes a small `isBackendWritable` helper.
  - `@checkstack/secrets-frontend`: hide the create form, per-row Rotate / Delete buttons, and adjust the empty-state and helper text when the active backend is not writable, plus show a short "read-through" explainer. The local backend stays fully writable.

  State & scale: `writable` is derived on read from the resolved active backend's capabilities (durable config selects the backend), so every pod computes the same answer; no new state is introduced.
