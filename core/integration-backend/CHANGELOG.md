# @checkstack/integration-backend

## 0.7.2

### Patch Changes

- Updated dependencies [390d9cf]
  - @checkstack/backend-api@0.30.0
  - @checkstack/command-backend@0.2.20
  - @checkstack/secrets-backend@0.3.2

## 0.7.1

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/backend-api@0.29.1
  - @checkstack/command-backend@0.2.19
  - @checkstack/integration-common@0.9.7
  - @checkstack/queue-api@0.3.18
  - @checkstack/secrets-backend@0.3.1
  - @checkstack/secrets-common@0.3.1
  - @checkstack/signal-common@0.2.16

## 0.7.0

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
  - @checkstack/secrets-backend@0.3.0
  - @checkstack/secrets-common@0.3.0
  - @checkstack/common@0.20.0
  - @checkstack/command-backend@0.2.18
  - @checkstack/integration-common@0.9.6
  - @checkstack/queue-api@0.3.17
  - @checkstack/signal-common@0.2.15

## 0.6.10

### Patch Changes

- Updated dependencies [e819276]
  - @checkstack/backend-api@0.28.0
  - @checkstack/command-backend@0.2.17
  - @checkstack/secrets-backend@0.2.17

## 0.6.9

### Patch Changes

- @checkstack/backend-api@0.27.1
- @checkstack/command-backend@0.2.16
- @checkstack/secrets-backend@0.2.16

## 0.6.8

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/command-backend@0.2.15
  - @checkstack/integration-common@0.9.5
  - @checkstack/queue-api@0.3.16
  - @checkstack/secrets-backend@0.2.15
  - @checkstack/secrets-common@0.2.8
  - @checkstack/signal-common@0.2.14

## 0.6.7

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0
  - @checkstack/backend-api@0.26.1
  - @checkstack/command-backend@0.2.14
  - @checkstack/integration-common@0.9.4
  - @checkstack/queue-api@0.3.15
  - @checkstack/secrets-backend@0.2.14
  - @checkstack/secrets-common@0.2.7
  - @checkstack/signal-common@0.2.13

## 0.6.6

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/backend-api@0.26.0
  - @checkstack/integration-common@0.9.3
  - @checkstack/secrets-common@0.2.6
  - @checkstack/signal-common@0.2.12
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0
  - @checkstack/queue-api@0.3.14
  - @checkstack/secrets-backend@0.2.13

## 0.6.5

### Patch Changes

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
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/secrets-backend@0.2.12
  - @checkstack/backend-api@0.25.0
  - @checkstack/common@0.17.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/integration-common@0.9.2
  - @checkstack/queue-api@0.3.14
  - @checkstack/secrets-common@0.2.5
  - @checkstack/signal-common@0.2.11

## 0.6.4

### Patch Changes

- Updated dependencies [2ec8f64]
  - @checkstack/backend-api@0.24.1
  - @checkstack/secrets-backend@0.2.11
  - @checkstack/command-backend@0.2.11

## 0.6.3

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/command-backend@0.2.10
  - @checkstack/secrets-backend@0.2.10

## 0.6.2

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/secrets-backend@0.2.9
  - @checkstack/command-backend@0.2.9
  - @checkstack/integration-common@0.9.1
  - @checkstack/queue-api@0.3.13
  - @checkstack/secrets-common@0.2.4
  - @checkstack/signal-common@0.2.10

## 0.6.1

### Patch Changes

- 4134ed9: Bound integration option-resolution with a timeout so an unreachable or hung
  integration can no longer wedge a chat turn (stuck "Thinking") or an automation
  editor field. The Jira client's REST calls now carry a 10s request timeout
  (matching the Teams/Webex actions, which already did), and the
  provider-agnostic `resolveOptions` path races every provider resolver against a
  12s ceiling so any provider that hangs fails with a clear error instead of
  blocking indefinitely.
- Updated dependencies [6005271]
  - @checkstack/backend-api@0.22.0
  - @checkstack/command-backend@0.2.8
  - @checkstack/secrets-backend@0.2.8

## 0.6.0

### Minor Changes

- ebef442: feat(ai): let the assistant resolve dynamic integration-action field values

  Integration action fields like Jira `create_issue`'s `projectKey`, `issueTypeId`,
  and `priorityId` are not free-form - their valid values come from the connected
  system (the editor renders them as cascading dropdowns via `x-options-resolver`).
  The AI assistant had no way to fetch those values, so it guessed, and propose-time
  validation never checked them - a fabricated `projectKey` only failed at runtime.

  - **New user-callable `integration.resolveConnectionOptions` RPC** (the non-admin
    counterpart of `getConnectionOptions`, mirroring `listConnectionSummaries`), so
    automation authors and the assistant can resolve a field's options without
    `integration.manage`. Returns option labels/values only.
  - **New `automation.resolveActionOptions` AI tool**: resolves a field's valid
    values live from the connection, the same source the editor dropdown uses. It
    is provider-agnostic (reads the field's resolver and `x-depends-on` from the
    action's own schema) and dependency-aware - for a cascade like `issueTypeId`
    (depends on `projectKey`), the model resolves the parent first and passes it in
    `dependencies`.
  - **Propose-time options validation**: `automation.propose` now checks every
    literal dynamic-option value against the live options for its connection
    (sourcing each field's dependency values from the same config so cascades
    resolve), flagging values the connection does not offer with guidance to call
    `automation.resolveActionOptions`. Templated values and fields with
    templated/absent dependencies are skipped; a resolver lookup failure is skipped
    rather than blocking, so transient provider flakiness never gates a proposal.

  - **Automation editor works for non-admins**: the editor's option-resolver
    bridge now calls the user-callable `listConnectionSummaries` /
    `resolveConnectionOptions` instead of the admin-gated `listConnections` /
    `getConnectionOptions`, so an automation author without `integration.manage`
    gets working connection pickers and cascading dropdowns instead of empty/
    forbidden ones.

  The resolver lookup and the dependency handling are factored into reusable
  helpers that work for any provider's `x-options-resolver` fields.

- ebef442: feat(automation): gate integration actions on the runAs service account's permissions

  **BREAKING.** Integration automation actions resolve credentials through a
  trusted service rather than the bounded `runAs` client, so they previously
  bypassed the runAs least-privilege model entirely: anyone able to author an
  automation could create Jira tickets, send Teams/Webex messages, etc. on any
  configured connection, with a zero-permission service account. This closes that
  gap.

  - **Actions declare `requiredAccessRules`** and the dispatch engine enforces
    them against the resolved `runAs` principal BEFORE the action runs (failing
    the step if missing) - the authorization point integration actions lacked.
  - **Each integration plugin defines per-action access rules**, e.g.
    `integration-jira.create_issue.manage` / `search_issues.read` /
    `transition_issue.manage` / `add_comment.manage`,
    `integration-teams.post_message.manage`,
    `integration-webex.post_message.manage`.
  - **`automation.propose` checks the same up front**, surfacing a per-action
    missing-permission error on the review card; `listActions` now exposes each
    action's `requiredAccessRules`, and `getBindableApplications` now returns each
    app's effective `accessRules`.
  - **New `integration.read` rule** gates `listConnectionSummaries` /
    `resolveConnectionOptions` (previously open to any authenticated user), so
    discovering connections and resolving their field options requires a grant.
  - **The AI assistant picks a capable runAs up front.**
    `automation.listServiceAccounts` now returns each account's `accessRules` and
    `automation.getCapabilitySchema` returns each action's `requiredAccessRules`,
    so the model selects a service account whose permissions cover the actions it
    uses instead of proposing and being rejected. When the operator did not name a
    runAs and more than one account qualifies, it ASKS which to use rather than
    choosing the automation's identity itself; when none has the needed rules it
    says which rule(s) to grant.

  **Migration:** existing automations whose service account does not hold the new
  rules will fail at the gated action until an admin grants the matching rule(s)
  to the service account's role (e.g. add `integration-jira.create_issue.manage`).
  Admin (`*`) service accounts are unaffected. Grant `integration.read` to roles
  that author integration-using automations so the editor's connection pickers and
  dropdowns keep working for non-admins.

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/integration-common@0.9.0
  - @checkstack/secrets-backend@0.2.7
  - @checkstack/backend-api@0.21.7
  - @checkstack/command-backend@0.2.7

## 0.5.0

### Minor Changes

- c4bebbb: feat(integration): add user-callable listConnectionSummaries

  `listConnections` is admin-gated (`integration.manage`) because it returns the
  redacted config preview. Automation authors are not necessarily integration
  admins, so they could not discover which `connectionId` to wire into an
  integration action.

  Add `listConnectionSummaries({ providerId })`, callable by any authenticated
  principal, returning name-only `{ id, providerId, name }` (no config, no
  secrets). The automation `listConnections` discovery tool and the propose-time
  `connectionId` validation now use it, so a non-admin automation author gets real
  connection ids (and real validation) instead of an empty/soft-degraded result.

### Patch Changes

- Updated dependencies [c4bebbb]
  - @checkstack/integration-common@0.8.0

## 0.4.6

### Patch Changes

- @checkstack/backend-api@0.21.6
- @checkstack/command-backend@0.2.6
- @checkstack/secrets-backend@0.2.6

## 0.4.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/integration-common@0.7.3
  - @checkstack/secrets-common@0.2.3
  - @checkstack/secrets-backend@0.2.5
  - @checkstack/command-backend@0.2.5
  - @checkstack/queue-api@0.3.12
  - @checkstack/signal-common@0.2.9

## 0.4.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/command-backend@0.2.4
  - @checkstack/secrets-backend@0.2.4

## 0.4.3

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/command-backend@0.2.3
- @checkstack/common@0.14.1
- @checkstack/integration-common@0.7.2
- @checkstack/queue-api@0.3.11
- @checkstack/secrets-backend@0.2.3
- @checkstack/secrets-common@0.2.2
- @checkstack/signal-common@0.2.8

## 0.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/command-backend@0.2.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/queue-api@0.3.11
  - @checkstack/secrets-backend@0.2.2
  - @checkstack/secrets-common@0.2.2
  - @checkstack/signal-common@0.2.8

## 0.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/queue-api@0.3.10
  - @checkstack/command-backend@0.2.1
  - @checkstack/integration-common@0.7.1
  - @checkstack/secrets-backend@0.2.1
  - @checkstack/secrets-common@0.2.1
  - @checkstack/signal-common@0.2.7

## 0.4.0

### Minor Changes

- 9dcc848: Harden config-versioning so stored configs always migrate-then-validate and broken migration chains fail fast at boot.

  - `@checkstack/backend-api` `Versioned<T>` gains `parseAssumingV1` (migrate-from-v1 then validate leniently, runtime path), `parseStrictAssumingV1` (migrate then validate strictly, editor path), and `validateMigrationChainFromV1()`. A standalone pure helper `assertMigrationChainFromV1({ version, migrations })` is the single shared implementation behind the constructor guard and `validateMigrationChainFromV1`.
  - `Versioned` now validates its own v1 -> `version` chain in the constructor, which runs at module import / plugin registration. A new `no-restricted-syntax` ESLint rule bans calling `parse` / `safeParse` / `parseAsync` / `strict` directly on a `Versioned`'s `.schema` member.
  - Auth strategy migration chains are validated at the `betterAuthExtensionPoint.addStrategy` chokepoint (`@checkstack/auth-backend`).
  - Automation action AND trigger configs migrate-then-validate (lenient at dispatch, strict in the editor validator, recursing into `choose`/`parallel`/`repeat`/`sequence` blocks). The `run_script` / `run_shell` action configs bump to `version: 2` dropping the removed `sandbox` key, fixing the editor's `Unrecognized key: sandbox` error.
  - Anomaly read path now validates: `getAnomalyConfig` / `getAnomalyAssignmentConfig` run stored records through `Versioned.parseRecord`; `PartialAnomalySettingsSchema` moved to `@checkstack/anomaly-common`. Notification ConfigService reads thread the migrations argument, and per-strategy `userConfig` is migrate-then-validated before `send()`.
  - gitops-apply migrate-then-validates authored health-check config; integration connection validation routes through `safeValidate`. The latent HTTP health-check `result` schema (at `version: 3` with no migrations) now ships a pass-through v1 -> v2 -> v3 chain.

  BREAKING CHANGES (fail-fast at boot, intended):

  - Any `Versioned` config with `version > 1` and an incomplete or non-contiguous migration chain now throws at construction (boot) instead of failing lazily on first read. This covers every `Versioned` instance repo-wide, including future plugin types. Out-of-tree plugins shipping such a config must add the missing migration step(s); all in-repo strategies already have complete chains.
  - An auth strategy declaring `configVersion > 1` without a complete chain throws at registration.
  - A trigger's per-automation config is now a versioned `config: Versioned<TConfig>` instead of a bare `configSchema?`. Plugins registering triggers with `configSchema:` must wrap it: `config: new Versioned({ version: 1, schema })`. The underlying schema stays reachable via `config.schema`; triggers without per-automation config are unaffected.

  State and scale: all affected reads resolve from shared Postgres / in-process registries, so every pod sees the same migrated answer. No new framework-owned current-state store.

  This is a beta minor.

- 9dcc848: Surface integration connection validation errors inline, and fix blank secrets clearing stored credentials on edit.

  `@checkstack/ui` `DynamicForm` gains opt-in, backward-compatible props plus pure DOM-free helpers:

  - `showInlineErrors` (default `false`): renders a concise per-field error under each touched required field; the `onValidChange` validity boolean derives from the same per-field error map.
  - `fieldErrors`: an externally-supplied `{ [fieldPath]: message }` map (dot-joined for nested fields) for surfacing SERVER validation inline; nested paths flag their parent.
  - `keepExistingSecretFields`: in EDIT mode, lists `x-secret` keys already stored server-side - a blank input means "keep existing" and is treated as VALID (CREATE mode omits it). New exported helpers: `deriveClientFieldErrors`, `deriveServerFieldErrors`, `parseServerValidationData`, `omitKeepExistingSecrets`, `listSecretFieldKeys`. `DynamicForm` also no longer shows a required (`*`) marker on the child fields of an OPTIONAL nested object while that object is empty (e.g. the OpenAI-compatible `spendCap`); required nested objects are unchanged.

  `@checkstack/integration-backend`: connection-config validation failures attach the structured zod issues to `ORPCError.data` under a `CONFIG_VALIDATION` discriminator; the human-readable message is unchanged.

  `@checkstack/integration-frontend` `ProviderConnectionsPage`: validation failures appear inline on the offending fields (the toast remains a fallback); Create/Save stays disabled while invalid; on edit a blank `x-secret` field is treated as "keep existing" (no required error, omitted from the update so the stored secret is not cleared).

  BREAKING CHANGES: none. The new `DynamicForm` props are optional and default to previous behavior.

  This is a beta minor.

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
  - @checkstack/command-backend@0.2.0
  - @checkstack/integration-common@0.7.0
  - @checkstack/secrets-backend@0.2.0
  - @checkstack/secrets-common@0.2.0
  - @checkstack/queue-api@0.3.9
  - @checkstack/signal-common@0.2.6

## 0.3.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/secrets-backend@0.1.1
  - @checkstack/command-backend@0.1.33
  - @checkstack/queue-api@0.3.8

## 0.3.0

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

### Patch Changes

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
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/secrets-backend@0.1.0
  - @checkstack/secrets-common@0.1.0
  - @checkstack/command-backend@0.1.32
  - @checkstack/queue-api@0.3.7

## 0.2.0

### Minor Changes

- 41c77f4: feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

  **BREAKING CHANGES** (platform is in BETA — no major bump):

  - `IntegrationProvider` no longer carries `config` (subscription
    config) or `deliver`. The interface now models a connection provider
    only: connection schema + `getConnectionOptions` + `testConnection`.
  - The legacy subscription / delivery-log / event endpoints
    (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
    `listEventTypes`, …) are removed from `integrationContract`.
  - `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
    `integrationEventExtensionPoint` are deleted. Plugins that
    previously called `integrationEvents.registerEvent(...)` now
    register their hooks as automation triggers via
    `automationTriggerExtensionPoint.registerTrigger(...)`.
  - Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
    the integration plugin's only remaining UI is connection
    management. Subscription management lives under `/automation/...`.
  - `webhook_subscriptions` and `delivery_logs` tables stay in the
    database for one release as a safety net (no code reads or writes
    them), and will be dropped in a follow-up migration.

  **New**:

  - `jira.create_issue`, `teams.post_message`, `webex.post_message`,
    `webhook.send`, `integration-script.run_shell`, and
    `integration-script.run_script` actions registered against the
    Automation Platform with matching `*.message`, `*.delivery`,
    `shell.result`, and `script.result` artifact types. The script
    plugin exposes **two** actions — `run_shell` runs bash via the
    shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
    runs an ESM module in a Bun subprocess via `EsmScriptRunner`
    (Monaco `typescript` editor + `defineIntegration` helper) — to
    preserve the legacy provider split. `jira.create_issue` keeps the
    dynamic field-mapping dropdown (driven by
    `JIRA_RESOLVERS.FIELD_OPTIONS`).
  - One-time data migration runs on boot in
    `automation-backend.afterPluginsReady`. It reads
    `webhook_subscriptions` via a new service RPC
    `IntegrationApi.listLegacySubscriptions`, translates each row into
    a single-trigger / single-action automation (marked with
    `managed_by = "migrated-subscription:<id>"`), and is idempotent
    across restarts.
  - Failed translations are recorded in a new
    `automation_migration_failures` table and surfaced via
    `AutomationApi.listMigrationFailures` /
    `acknowledgeMigrationFailure` so admins can review and re-create
    failed entries by hand.

### Patch Changes

- 41c77f4: feat(jira): register Jira automation actions + `jira.issue` artifact type

  Adds three Jira actions to the Automation platform:

  - `jira.create_issue` — produces the new `jira.issue` artifact type
    (`issueKey`, `projectKey`, `issueUrl`, `id`, `status?`)
  - `jira.transition_issue` — consumes `jira.issue` (or accepts an
    explicit `issueKey`), idempotent against already-applied transitions
  - `jira.add_comment` — consumes `jira.issue` (or accepts an explicit
    `issueKey`)

  Extends the Jira client with `getTransitions`, `getIssueStatus`,
  `transitionIssue` (handles 204 No Content, comment in ADF for Cloud /
  plain text for Data Center), and `addComment`. Adds a new
  `JIRA_RESOLVERS.TRANSITION_OPTIONS` cascading dropdown driven by
  `connectionId` + `issueKey`. `@checkstack/integration-backend` now
  re-exports the `ConnectionStore` interface so action plugins can take
  it as a typed dep.

- Updated dependencies [41c77f4]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/integration-common@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/command-backend@0.1.31
  - @checkstack/signal-common@0.2.5
  - @checkstack/queue-api@0.3.6

## 0.1.30

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/command-backend@0.1.30
- @checkstack/queue-api@0.3.5

## 0.1.29

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

- f23f3c9: Sweep every paginated `*-common` contract onto the canonical
  `PaginationInput` / `PaginatedResult` from `@checkstack/common` and
  remove the now-unused legacy exports.

  **BREAKING CHANGE** - `@checkstack/common` drops the deprecated
  `PaginationInputSchema`, `paginatedOutput`, and `PaginatedResponse`
  symbols. Callers must consume `PaginationInput` (input) and
  `PaginatedResult(itemSchema)` (output) instead. The canonical input is
  `{ limit (1-100, default 20), offset (>= 0, default 0) }`; the
  canonical output envelope is
  `{ items, total, limit, offset }`.

  **BREAKING CHANGE** - `@checkstack/notification-common` migrates
  `getNotifications` off the legacy `PaginationInputSchema`
  (`{ limit, offset, unreadOnly }` with output `{ notifications, total }`)
  onto `ListNotificationsInputSchema =
PaginationInput.extend({ unreadOnly })` and
  `PaginatedResult(NotificationSchema)`. The output key changes from
  `notifications` to `items`, and `limit` / `offset` are now echoed on
  the response. The `PaginationInput` type alias previously exported
  from `notification-common` is removed - use `ListNotificationsInput`
  or the canonical `PaginationInput` from `@checkstack/common`.

  **BREAKING CHANGE** - `@checkstack/integration-common` migrates
  `listSubscriptions` (inline `{ page, pageSize, ... }` -> output
  `{ subscriptions, total }`) and `getDeliveryLogs` (via
  `DeliveryLogQueryInputSchema` `{ subscriptionId?, eventType?, status?,
page, pageSize }` -> output `{ logs, total }`) onto the canonical
  `PaginationInput.extend({...})` input and
  `PaginatedResult(itemSchema)` output. External callers must switch
  from `{ page, pageSize }` to `{ limit, offset }` and read response
  items from `data.items` (no more `data.subscriptions` / `data.logs`).

  The matching `*-backend` handlers were updated to consume the new
  input shape (`offset` arithmetic in lieu of `(page - 1) * pageSize`)
  and to echo `limit` / `offset` on the response. The `*-frontend` call
  sites in `NotificationsPage`, `NotificationBell`, `IntegrationsPage`,
  and `DeliveryLogsPage` were updated to send the new input shape and
  read `data.items`.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/command-backend@0.1.29
  - @checkstack/integration-common@0.5.0
  - @checkstack/signal-common@0.2.4
  - @checkstack/queue-api@0.3.4

## 0.1.28

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/command-backend@0.1.28
  - @checkstack/queue-api@0.3.3

## 0.1.27

### Patch Changes

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
  - @checkstack/command-backend@0.1.27
  - @checkstack/queue-api@0.3.2

## 0.1.26

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/integration-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/command-backend@0.1.26
  - @checkstack/signal-common@0.2.3
  - @checkstack/queue-api@0.3.1

## 0.1.25

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/integration-common@0.3.2
  - @checkstack/signal-common@0.2.2

## 0.1.24

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/integration-common@0.3.1
  - @checkstack/queue-api@0.2.18
  - @checkstack/command-backend@0.1.24
  - @checkstack/signal-common@0.2.1

## 0.1.23

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/command-backend@0.1.23
  - @checkstack/queue-api@0.2.17
  - @checkstack/common@0.7.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/signal-common@0.2.0

## 0.1.22

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/command-backend@0.1.22
  - @checkstack/queue-api@0.2.16

## 0.1.21

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/signal-common@0.2.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/queue-api@0.2.15

## 0.1.20

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/command-backend@0.1.20
  - @checkstack/integration-common@0.2.9
  - @checkstack/signal-common@0.1.10
  - @checkstack/queue-api@0.2.14

## 0.1.19

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/command-backend@0.1.19
  - @checkstack/queue-api@0.2.13

## 0.1.18

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
  - @checkstack/command-backend@0.1.18
  - @checkstack/integration-common@0.2.8
  - @checkstack/signal-common@0.1.9
  - @checkstack/queue-api@0.2.12

## 0.1.17

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/command-backend@0.1.17
  - @checkstack/queue-api@0.2.11

## 0.1.16

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/command-backend@0.1.16
- @checkstack/queue-api@0.2.10

## 0.1.15

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/command-backend@0.1.15
  - @checkstack/queue-api@0.2.9

## 0.1.14

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/command-backend@0.1.14
  - @checkstack/queue-api@0.2.8

## 0.1.13

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
  - @checkstack/backend-api@0.8.2
  - @checkstack/command-backend@0.1.13
  - @checkstack/common@0.6.4
  - @checkstack/integration-common@0.2.7
  - @checkstack/queue-api@0.2.7
  - @checkstack/signal-common@0.1.8

## 0.1.12

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
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/command-backend@0.1.12
  - @checkstack/queue-api@0.2.6
  - @checkstack/integration-common@0.2.6
  - @checkstack/signal-common@0.1.7

## 0.1.11

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/command-backend@0.1.11
  - @checkstack/queue-api@0.2.5

## 0.1.10

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/command-backend@0.1.10
  - @checkstack/queue-api@0.2.4

## 0.1.9

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/command-backend@0.1.9
  - @checkstack/integration-common@0.2.5
  - @checkstack/signal-common@0.1.6
  - @checkstack/queue-api@0.2.3

## 0.1.8

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/integration-common@0.2.4
  - @checkstack/queue-api@0.2.2
  - @checkstack/signal-common@0.1.5

## 0.1.7

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/command-backend@0.1.7
  - @checkstack/integration-common@0.2.3
  - @checkstack/signal-common@0.1.4
  - @checkstack/queue-api@0.2.1

## 0.1.6

### Patch Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

- Updated dependencies [2c0822d]
- Updated dependencies [66a3963]
  - @checkstack/queue-api@0.2.0
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/command-backend@0.1.5
  - @checkstack/queue-api@0.1.3
  - @checkstack/integration-common@0.2.2
  - @checkstack/signal-common@0.1.3

## 0.1.4

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/command-backend@0.1.4
  - @checkstack/queue-api@0.1.2
  - @checkstack/integration-common@0.2.1
  - @checkstack/signal-common@0.1.2

## 0.1.3

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/command-backend@0.1.3
  - @checkstack/queue-api@0.1.1

## 0.1.2

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/queue-api@0.1.0
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/integration-common@0.2.0
  - @checkstack/command-backend@0.1.2
  - @checkstack/signal-common@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [9a27800]
  - @checkstack/queue-api@0.0.6
  - @checkstack/backend-api@0.3.1
  - @checkstack/command-backend@0.1.1

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

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-common@0.1.0
  - @checkstack/queue-api@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/queue-api@0.0.4
  - @checkstack/integration-common@0.0.4
  - @checkstack/signal-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/queue-api@0.0.3
  - @checkstack/integration-common@0.0.3
  - @checkstack/signal-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/integration-common@0.0.2
  - @checkstack/queue-api@0.0.2
  - @checkstack/signal-common@0.0.2

## 0.1.0

### Minor Changes

- 4c5aa9e: Fix `IntegrationProvider.testConnection` generic type

  - **Breaking**: `testConnection` now receives `TConnection` (connection config) instead of `TConfig` (subscription config)
  - **Breaking**: `RegisteredIntegrationProvider` now includes `TConnection` generic parameter
  - Removed `testConnection` from webhook provider (providers without `connectionSchema` cannot have `testConnection`)
  - Fixed Jira provider to use `JiraConnectionConfig` directly in `testConnection`

  This aligns the interface with the actual behavior: `testConnection` tests connection credentials, not subscription configuration.

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/queue-api@1.0.1
  - @checkstack/integration-common@0.1.1
  - @checkstack/signal-common@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/queue-api@1.0.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/signal-common@0.1.0
