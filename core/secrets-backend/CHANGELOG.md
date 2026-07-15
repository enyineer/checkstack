# @checkstack/secrets-backend

## 0.3.8

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/backend-api@0.34.0
  - @checkstack/common@0.23.0
  - @checkstack/command-backend@0.2.26
  - @checkstack/secrets-common@0.3.3

## 0.3.7

### Patch Changes

- Updated dependencies [d00e099]
  - @checkstack/backend-api@0.33.0
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/secrets-common@0.3.2

## 0.3.6

### Patch Changes

- @checkstack/backend-api@0.32.1
- @checkstack/command-backend@0.2.24

## 0.3.5

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/command-backend@0.2.23

## 0.3.4

### Patch Changes

- 43e4484: Kill the redundant active-backend-id read N+1 in secret run resolution.
  Behavior unchanged; performance-only: the same env vars and masking context are
  produced for a run, only the number of active-backend-id config reads drops from
  N (one per distinct secret name) to 1.

  - The internal `SecretStore` interface gains an optional
    `resolveMany(names: string[]): Promise<Map<string, string>>` batch path
    (the single `resolve` stays for back-compat and single-secret callers).
  - The active-backend store (`createActiveBackendStore`) implements
    `resolveMany`: it resolves the active backend id ONCE for the whole batch and
    then fetches each distinct name through that single backend, de-duping names
    and throwing the same `Secret not found: NAME` on any absent value. The
    per-name backend fetch is inherent; the removed redundancy is the per-name
    active-backend-id config read.
  - `SecretResolverService.resolveForRun` now collects the distinct secret names
    (as before) and resolves them via one `resolveMany` call instead of a per-name
    `resolve` loop. Stores without a batch path fall back to looping `resolve`,
    so behavior is identical for every caller.

  State & scale: the active backend id still resolves from the shared config
  store, so every pod returns the same answer; no process-local or duplicated
  state is introduced.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/backend-api@0.31.1
  - @checkstack/command-backend@0.2.22

## 0.3.3

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/command-backend@0.2.21
  - @checkstack/secrets-common@0.3.2

## 0.3.2

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/command-backend@0.2.20

## 0.3.1

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/command-backend@0.2.19
  - @checkstack/secrets-common@0.3.1

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
  - @checkstack/backend-api@0.29.0
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/command-backend@0.2.18

## 0.2.17

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/command-backend@0.2.17

## 0.2.16

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/command-backend@0.2.16

## 0.2.15

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/command-backend@0.2.15
  - @checkstack/secrets-common@0.2.8

## 0.2.14

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/backend-api@0.26.1
  - @checkstack/command-backend@0.2.14
  - @checkstack/secrets-common@0.2.7

## 0.2.13

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/secrets-common@0.2.6
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0

## 0.2.12

### Patch Changes

- 8cad340: Widen Cmd+K command-palette coverage to every top-level sidebar destination.

  The command palette previously only surfaced commands from a handful of plugins,
  so large feature areas were silently unreachable from search. Each of these
  plugins now registers a "navigate to <feature>" command per top-level route via
  `registerSearchProvider`, so every sidebar destination they own is reachable
  from Cmd+K (entity search can come later):

  - dependency: "Dependency Map"
  - status-page: "Status pages"
  - satellite: "Satellites"
  - gitops: "GitOps", "Kind Registry"
  - secrets: "Secrets"
  - notification: "Notification Settings"
  - script-packages: "Script Packages", "Script Sandbox"

  Each command reuses the plugin's own route helper (`resolveRoute`) for its href
  and carries the same access rule that gates its sidebar nav entry, so palette
  visibility matches sidebar visibility. The notification command carries no
  access rule, matching its authenticated-only nav entry.

- 8cad340: refactor: replace `env as unknown as EnvStash` double casts with module-scoped holders

  The `init()` -> `afterPluginsReady()` bridging that stashed setup closures and
  service handles as ad-hoc mutable properties on the framework `env` object via a
  double cast (`env as unknown as EnvStash`) is replaced with typed module- or
  register-scoped `let` holders, mirroring the existing pattern in
  `healthcheck-backend` (`storedEmitHook`). No behavior or DB change; the holders
  are pod-local setup state (never queryable current state), so they remain
  scale-correct. This removes an unsafe, copy-paste-prone idiom from five core
  plugins.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/secrets-common@0.2.5

## 0.2.11

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1

## 0.2.10

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0

## 0.2.9

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/secrets-common@0.2.4

## 0.2.8

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/backend-api@0.22.0

## 0.2.7

### Patch Changes

- @checkstack/backend-api@0.21.7

## 0.2.6

### Patch Changes

- @checkstack/backend-api@0.21.6

## 0.2.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/secrets-common@0.2.3

## 0.2.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4

## 0.2.3

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/secrets-common@0.2.2

## 0.2.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/secrets-common@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/secrets-common@0.2.1

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/common@0.13.0
  - @checkstack/secrets-common@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0

## 0.1.0

### Minor Changes

- 270ef29: Fix suspend/resume durability + complete the run-wide secret-masking guarantee.

  A panel review confirmed several defects in the automation dispatch engine's suspend/resume durability and in the run-wide masking choke point. These survived because the unit suite stubbed the seam under test; the fixes ship with tests that exercise the real suspend / sweep / resume paths.

  Suspend/resume durability:

  - **Stalled sweeper no longer re-runs intentional waits.** `findStalledRunIds` now joins `automation_runs` and returns only `status = 'running'` runs, and suspend-finalisation no longer clobbers the run's `lastActionPath` checkpoint to `null`. Previously any wait longer than the stale window (>60s) was re-walked from the top every sweep cycle, re-firing pre-wait side effects and leaking wait locks. The wait-aware sweeps now also run before the stalled-run sweep.
  - **Stalled recovery refuses a run holding a live wait lock.** `recoverStalledRun` now only recovers a genuinely-`running` run with no wait lock; a crash-mid-wait recovery is left to the wait/resume paths instead of re-walking from the top and creating a duplicate lock + duplicate delay job.
  - **Cancelled runs can no longer resurrect.** `resumeRun` guards on `status === 'waiting'` (mirroring `checkWaitUntil`) and drops any stale lock for a non-waiting run, so `wakeWaitingRuns` / delay-expiry / a racing queue job can't wake a cancelled or terminal run. `cancelActiveRuns` (restart mode) now deletes the cancelled runs' wait locks + run-state in the same operation.
  - **Concurrency check-then-create is serialized.** The `mode` check + `createRun` now run under a transaction-scoped advisory lock keyed on `(automationId, scope)`, so two concurrent fires can't both pass a `single`-mode "no active run" check and double-run.

  Masking guarantee (now genuinely covers scope + artifacts):

  - **The run-wide masking choke point now also masks the durable scope snapshot and produced artifacts.** The `RunSecretRegistry` is threaded into `RunStateStore.upsert` (masks `scopeSnapshot`) and `ArtifactStore.record` (masks `data`) so a resolved connection credential threaded into `scope.variables` or surfaced into an artifact is redacted before persist - and therefore cannot reach a read-only user via `getRunScopeForReplay`. **GUARANTEE CHANGE**: run-wide masking now covers step output, run error, scope snapshot, and artifact data for every action.
  - **`testConnection` / `testProviderConnection` mask provider errors.** These RPCs run outside a dispatch run, so they build a per-call mask set from the resolved/submitted connection config and run any provider error through it before returning, so a provider error echoing a token can't cross back to the browser.
  - **Short secrets surface a warning.** `setSecret` now warns when a value is shorter than `MIN_MASKABLE_LENGTH` (4) that it cannot be auto-redacted (the threshold is intentionally not lowered).

  Internal:

  - `@checkstack/backend-api`: `withXactLock`'s `fn` now receives the transaction handle `tx` so a critical section can run on the locked connection; the doc clarifies why running on the pool inside the lock window is still safe. The incident dedup caller's comment is corrected accordingly. `RunStore` gains `findWaitLocksByRun`.

- 270ef29: Add the Secrets platform (Phase 1): a central, plugin-agnostic secret manager with a pluggable backend extension point, a cross-plugin resolver service, and a universal Jenkins-style masking layer.

  - New packages: `secrets-common` (schemas, contract, `secrets.read`/`secrets.manage`, masking utils), `secrets-backend` (`SecretBackend` extension point, `secretResolverRef`/`secretAdminRef` services, run-scoped masking context, RPC router), `secrets-backend-local` (default AES-256-GCM backend, owns the `secrets` table promoted from gitops), `secrets-frontend` (admin Settings page).
  - Resolution machinery (`resolveSecretsBySchema`, `SecretStore`, `${{ secrets.NAME }}` / `x-secret`) is promoted out of `gitops-backend` into `secrets-backend`. GitOps now resolves and manages secrets through the platform's service refs (single source of truth); its secret table is migrated without loss.
  - Universal masking seam wired at the central script-output boundaries: automation `run_script` / `run_shell` artifacts and the in-UI test panel redact run-scoped secret values from `result`/`stdout`/`stderr`/`error` before persist/return. Phase 1 resolves no run-scoped secrets yet, so masking is a no-op until Phase 2; the seam guarantees the boundary exists.
  - No endpoint returns a secret value to a browser: DTOs expose only name/metadata/`hasValue`.

  BREAKING CHANGES: `gitops-backend` now depends on `secrets-backend` and resolves/manages secrets through it. The `secrets` table is owned by `secrets-backend-local`; the gitops `secrets` table is retained as a migration source but is no longer the source of truth.

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

- 270ef29: Secrets platform Phase 5b: route integration connection credentials through the ONE secrets channel.

  Connection credentials now resolve through the same secrets channel as
  everything else, so a credential can originate from Vault and there is no
  parallel credential-resolution code to drift. Two entry forms, both walked
  by the shared `walkSecretFields` machinery (acting only on the provider
  `connectionSchema`'s `x-secret` fields):

  - Reference form: a `${{ secrets.NAME }}` template resolves through the
    ACTIVE backend (local or Vault) via `secretResolverRef`.
  - Inline form: an operator-typed value is extracted into an internal
    secret on the local backend; the stored config keeps only a reference
    marker, resolved via `internalSecretsRef`.

  The `ConnectionStore` public API is unchanged: `listConnections` /
  `getConnection` stay redacted; `getConnectionWithCredentials` inflates via
  the unified channel. A one-time, idempotent, parity-verified, REVERSIBLE
  migration (backup ConfigService entry per connection; rewrites only after
  the platform copy reads back identically) moves existing inline
  credentials onto the platform without breaking live connections.

  `secrets-backend` exports `walkSecretFields` (the shared schema-walk behind
  `resolveSecretsBySchema`, reused for the migration extract + inflate).

  BREAKING CHANGES: a connection's stored credential fields may now hold a
  `${{ secrets.NAME }}` reference or an internal-reference marker instead of
  an inline value. Resolution is transparent (`getConnectionWithCredentials`
  returns the same plaintext); a legacy inline value still resolves until the
  one-time migration converts it.

- b995afb: Hide secret write controls when the active backend is read-through.

  When a read-through backend (e.g. Vault) was active, the Secrets admin page still showed the "Add a secret", Rotate, and Delete controls even though the backend correctly rejects writes (`set` / `delete` are intentionally unimplemented), so every attempt errored.

  The active backend now reports a capability flag and the UI gates its write affordances on it instead of any hardcoded backend id, so other read-through backends are handled the same way.

  Changes:

  - `@checkstack/secrets-common`: add a `writable: boolean` field to `BackendConfigDto` (returned by `getBackendConfig`). It carries no sensitive data - a capability boolean only.
  - `@checkstack/secrets-backend`: populate `writable` in the `getBackendConfig` handler by inspecting the resolved active backend (true only when it implements both `set` and `delete`; `false` for read-through backends or an unresolved active id). Exposes a small `isBackendWritable` helper.
  - `@checkstack/secrets-frontend`: hide the create form, per-row Rotate / Delete buttons, and adjust the empty-state and helper text when the active backend is not writable, plus show a short "read-through" explainer. The local backend stays fully writable.

  State & scale: `writable` is derived on read from the resolved active backend's capabilities (durable config selects the backend), so every pod computes the same answer; no new state is introduced.

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/secrets-common@0.1.0
