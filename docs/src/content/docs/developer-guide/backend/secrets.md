---
title: "Secrets platform"
description: "How Checkstack manages secrets centrally with pluggable backends, resolves them for runs, and masks their values out of every user-facing output."
---

The Secrets platform is the central, plugin-agnostic home for secrets. Secrets are created and managed in one place, stored by a pluggable backend (a local AES-256-GCM store by default), referenced from descriptors and configs via `${{ secrets.NAME }}`, and resolved on demand by any plugin through a service reference. No endpoint ever returns a secret value to a browser, and a Jenkins-style masking layer redacts known secret values out of any output before it is persisted or returned.

This page is the canonical contract for the platform. It covers the backend extension point, `${{ secrets.NAME }}` / `x-secret` resolution, the `secretEnv` env-mapping with least-privilege injection, the masking guarantee (and its documented limit), satellite just-in-time delivery, the Vault backend, internal secrets, and the test-panel behavior.

> [!NOTE]
> Satellite-direct-Vault (a satellite reading Vault itself for core-unreachable topologies) is a deferred follow-up; core-mediated delivery is the default and already routes through whichever backend is active, including Vault.

## Packages

- `@checkstack/secrets-common` - schemas (`secretNameSchema`, the `${{ secrets.NAME }}` template, the secret metadata DTO, the secret to env mapping, the backend-config DTOs), the oRPC contract, the `secrets.read` / `secrets.manage` access rules, the `secrets.changed` hook id, and the pure masking utilities (`maskSecrets`, `maskSecretsDeep`, `maskScriptRunOutput`).
- `@checkstack/secrets-backend` - the `SecretBackend` extension point, the backend registry, the promoted schema-driven resolver (`resolveSecretsBySchema`), the cross-plugin `secretResolverRef` / `secretAdminRef` / `internalSecretsRef` services, the run-scoped `SecretMaskingContext`, the `secrets.changed` hook, the active-backend selection (persisted via `ConfigService`), and the RPC router.
- `@checkstack/secrets-backend-local` - the default backend: AES-256-GCM values in the `secrets` table. Owns the table (promoted from gitops).
- `@checkstack/secrets-backend-vault` - the HashiCorp Vault backend (optional / opt-in). Owns a name → KV v2 path index table.
- `@checkstack/secrets-frontend` - the admin Settings page (create / rotate / delete, backend selection + Vault config, values write-only).

## Backend extension point

A secret backend implements `SecretBackend` and registers with `secretBackendExtensionPoint` (mirrors the script-packages blob-store pattern):

```ts
interface SecretBackend {
  readonly id: string;
  get(input: { name: string }): Promise<string | undefined>;
  set?(input: {
    name: string;
    value: string;
    description?: string;
    createdBy?: string;
  }): Promise<void>;
  delete?(input: { name: string }): Promise<void>;
  list(): Promise<SecretMetadata[]>; // metadata only, NEVER values
}
```

The active backend is config-selected (persisted via `ConfigService`, set in Settings → Secrets); the local backend is the default when no external backend is configured. Read-through backends (e.g. Vault) implement `get` / `list` plus the optional `test` / `configure` / `getConfigMeta`. Switching the active backend re-routes resolution dynamically (see `createActiveBackendStore`).

## Vault backend

`@checkstack/secrets-backend-vault` is an optional, opt-in `SecretBackend` against HashiCorp Vault. Install the plugin and select `vault` as the active backend.

- **Auth:** token, AppRole (`role_id` + `secret_id`), and OIDC/JWT (`role` + JWT) are all supported. The client logs in once, caches the session until the lease TTL (capped), and re-logs in on expiry.
- **Reads:** `get(name)` maps the name via the backend's own `secret_index` table (name to a KV v2 path + key), reads `<mount>/data/<path>`, and returns the chosen key. `list()` returns the index metadata only, NEVER values. Vault is read-through (no `set` / `delete`); secrets are authored in Vault and indexed here.
- **Caching:** resolved values are cached in memory with a capped TTL so rotated values are re-read; the cache is cleared on config change. Nothing is persisted to disk.
- **`testBackend`** validates auth/connectivity and returns status only.

> [!IMPORTANT]
> **Bootstrapping the Vault auth credential (the chicken/egg).** The Vault auth secret (token / AppRole `secret_id` / OIDC JWT) cannot live in Vault. It is stored as an `x-secret` field in the Vault backend's own `ConfigService` config, so it is encrypted at rest with the platform AES-GCM master key (env-provided, `ENCRYPTION_MASTER_KEY`) and stripped by `getRedacted`. It is write-only over the API (`setBackendConfig`), never returned in any DTO, and never logged.

## Resolving secrets from another plugin

Consumer plugins inject `secretResolverRef` and resolve `${{ secrets.NAME }}` in `x-secret`-annotated fields on demand:

```ts
import { secretResolverRef } from "@checkstack/secrets-backend";

env.registerInit({
  deps: { secretResolver: secretResolverRef },
  init: async ({ secretResolver }) => {
    const { resolved, warnings } = await secretResolver.resolveBySchema({
      value,
      schema,
    });
  },
});
```

`secretResolverRef` is service-typed and backend-only. Its `resolveSecret`, `resolveBySchema`, and `resolveForRun` methods return values and MUST NOT be exposed to a browser. GitOps consumes this ref instead of reading its own table.

To manage secrets from another plugin (single source of truth), inject `secretAdminRef` (`list` / `setSecret` / `deleteSecret`); it operates against the active backend and emits `secrets.changed`.

## Secret to env-var injection for scripts

A script-running consumer declares a least-privilege `secretEnv` allowlist on its config (validated by `secretEnvMappingSchema`):

```ts
import { secretEnvMappingSchema } from "@checkstack/secrets-common";
import { withConfigMeta } from "@checkstack/backend-api";

const config = z.object({
  script: z.string(),
  // { ENV_NAME: "${{ secrets.NAME }}" }. `x-secret-env` makes the editor
  // render the secret -> env mapping picker with name autocomplete.
  secretEnv: withConfigMeta(secretEnvMappingSchema, { "x-secret-env": true })
    .optional(),
});
```

The canonical (stored and serialized) form of each mapping value is the `${{ secrets.NAME }}` template, which the UI picker shows and writes by secret name. As a forgiving input, `secretEnvMappingSchema` also accepts a **bare secret name** as a value (e.g. authored via YAML shorthand `secretEnv: { API_TOKEN: jira_token }`, or legacy data) and normalizes it to the canonical `${{ secrets.NAME }}` template on parse - so downstream resolution, placeholder building, and masking (which parse the template) keep working unchanged. Only a pure secret reference (a whole-value or inline `${{ secrets.NAME }}` template) or a pure bare secret name is accepted; a value that is neither is rejected. The bare-name display tolerance lives in the UI's `parseSecretName` too, so the picker shows the same name for both forms.

At execution the action resolves ONLY the declared secrets via `secretResolverRef.resolveForRun({ secretEnv })`, which returns the concrete env map plus a run-scoped `SecretMaskingContext`. The resolved values are injected into the runner env for that run only (the ESM runner gained a per-run `env` option; the shell runner already had one) and are never persisted. The script reads them as `process.env.ENV_NAME` (TypeScript) or `$ENV_NAME` (shell). A referenced secret that cannot resolve fails the run with a clear error rather than running without it. Decision 5: there is no ambient access; only the named secrets are resolved and injected.

The automation `run_script` / `run_shell` actions implement this on the central backend. Healthcheck collectors carry the `secretEnv` field too; they are resolved + injected both when a check runs centrally (the queue executor) and when it runs on a satellite (see below).

## Satellite just-in-time delivery

Healthcheck collectors run on satellites, which must NEVER persist a secret to disk, and a secret must NEVER ride the (persisted) assignment payload. So secrets are delivered per-run over the existing authenticated WebSocket channel, request/reply (mirrors the script-package manifest/blob precedent):

1. Just before a satellite runs a collector that declares a `secretEnv`, it sends `request_run_secrets { requestId, configId, collectorId, runId }`.
2. Core reads the collector's declared `secretEnv` from that satellite's OWN persisted assignment (the satellite does not choose which secrets), resolves ONLY those refs via `resolveForRun`, and replies with `run_secrets { requestId, env }` (or `{ requestId, error }`).
3. The satellite injects `env` into the run's runner env, holds it in memory keyed to the run, runs, and drops it on completion. It is never written to disk.

If delivery fails or a required secret can't resolve, the collector run errors clearly ("required secret not available on this satellite") rather than running without it.

Source-side masking is applied on the satellite: the collector runs `maskSecrets` over its `stdout` / `stderr` / `result` / `error` using the run's delivered values BEFORE the result leaves the satellite, so a secret is redacted at the source even if the result is logged downstream. (Satellite-direct-Vault, a satellite resolving from Vault itself using its own identity for core-unreachable topologies, is deferred to a follow-up; core-mediated delivery works for Vault today since the resolver simply reads through the active backend.)

## Test panel: placeholders + overrides

The in-UI test panel (`testScript` / `testCollectorScript`) NEVER resolves real secret values (decision 4). For each declared `secretEnv` entry it injects a named placeholder (`__SECRET_<NAME>__`), or a user-supplied per-secret override value when the operator wants a realistic run. Override values are user-supplied (they stay client-side until sent as an explicit test input) and are masked out of the test result, so even an override can't round-trip to the surface unmasked. The shared `buildTestSecretEnv` helper (in `@checkstack/secrets-common`) builds the test env + the override mask set.

The shared `ScriptTestPanel` (in `@checkstack/ui`) wires this end to end. The DynamicForm `ScriptTestRenderer` callback receives the value of the SIBLING `x-secret-env` field - located by the annotation, not by a hard-coded field name - so a testable script field forwards the action's declared mapping to the panel without any feature-specific code. The panel derives the distinct referenced secret names (`distinctSecretNames`), renders one optional override input per name, and builds the `secretOverrides` payload (`buildSecretOverrides`, dropping blank or unreferenced drafts) that the owning page sends to `testScript`. With no override, the script sees `process.env.<ENV_NAME> === "__SECRET_<NAME>__"`; with an override, it sees the typed value, masked from the output. Health-check collectors have no `x-secret-env` field in their config, so their test panel shows no override UI.

## No value ever crosses to a browser

The RPC contract exposes only metadata:

- `listSecrets` returns `SecretMetadata` (`id`, `name`, `description`, `hasValue`, `backend`, timestamps) - never the value. Internal secrets (see below) are excluded.
- `listSecretNames` returns names only (for editor autocomplete + the env-mapping UI).
- `setSecret` is write-only (create or rotate); `deleteSecret` removes by name.
- `getBackendConfig` returns the active backend id, the available ids, a `writable` capability boolean, and (for Vault) the connection metadata with `hasCredential` - never the credential. `writable` is `true` only when the active backend implements both `set` and `delete` (the local backend); read-through backends (Vault) report `false`, and the admin UI hides its create / rotate / delete controls accordingly instead of inviting writes that always fail.
- `setBackendConfig` accepts the Vault credential as write-only input (stored encrypted, never returned); `testBackend` returns connectivity/auth status only.

There is no `getSecret` / `resolveSecret` on the browser-facing contract. Resolution to values is the service-only `secretResolverRef` / `internalSecretsRef`.

## Universal masking (the leak guarantee)

`maskSecrets({ text, values })` replaces every literal occurrence of each known secret value with `****`, skipping trivially short values (under 4 chars) to avoid over-masking. A run-scoped `SecretMaskingContext` holds only the run's resolved values (least privilege), and `maskScriptRunOutput` applies redaction to a run's `result` / `stdout` / `stderr` / `error` at the output boundary before it is persisted or returned. This is wired into the automation `run_script` / `run_shell` actions and the in-UI test panel, so even a script that echoes a secret it was given is redacted.

### Run-wide masking at the persistence choke point

Source-side masking covers script and collector output, but a run also writes step `result_payload` / `error_message` and a run-level `error_message` for EVERY action (provider calls, `log`, etc.), and a provider HTTP error could embed a resolved connection credential. So the automation dispatch run accumulates every secret value it resolves into a run-scoped registry (`RunSecretRegistry`): the engine wraps each run's `getService` so resolving the secret resolver or the connection store registers the resolved values (least-privilege, in memory only, dropped when the run goes terminal). The run-state store then masks step + run output with these values BEFORE persisting, so every downstream read / DTO / run-detail page is masked by construction. This is the run-wide net; the script / satellite-collector source-side masking stays as defense in depth.

The choke point covers EVERY persisted run surface, not just step / run output. The same `RunSecretRegistry` is threaded into the **run-state scope snapshot** (`RunStateStore.upsert` masks `scopeSnapshot` before write) and into **produced artifacts** (`ArtifactStore.record` masks `data` before insert). This matters because the replay endpoint `getRunScopeForReplay` (gated only on `automationAccess.read`) reads the persisted `scope_snapshot` and `automation_artifacts` rows back verbatim - so a resolved credential threaded into `scope.variables` or surfaced into an artifact would otherwise reach a read-only user unmasked. Masking happens at persist time on purpose: the registry is in-memory and gone by replay time, so the persisted row is the only place the guarantee can be enforced.

The masking guarantee therefore now genuinely covers, for every action: step `result_payload` / `error_message`, the run-level `error_message`, the durable **scope snapshot**, and produced **artifact data** - all masked by construction before they can be read or replayed.

The integration `testConnection` / `testProviderConnection` RPCs sit outside a dispatch run (no `RunSecretRegistry`), so they build a per-call mask set from the resolved/submitted connection config's string leaves and run any provider error through `maskSecrets` before returning - a provider error that echoes a token can't cross back to the browser unmasked.

```ts
import { maskSecrets } from "@checkstack/secrets-common";

const safe = maskSecrets({
  text: "Authorization: Bearer gh_realToken123",
  values: ["gh_realToken123"],
});
// => "Authorization: Bearer ****"
```

> [!IMPORTANT]
> Masking is by literal occurrence only. Encoded or transformed forms of a secret (base64, hashed, split across lines) cannot be detected. Scripts must not transform-then-print a secret they were given.

> [!WARNING]
> Values shorter than `MIN_MASKABLE_LENGTH` (4 characters) are NOT auto-redacted - masking such a short value would over-mask coincidental substrings of normal output. `setSecret` logs a warning when given a too-short value so the operator knows it won't be scrubbed from logs / errors. The threshold is intentionally not lowered.

## Internal (platform-managed) secrets

Some secrets back a specific feature rather than being user-managed named secrets. These use `internalSecretsRef` (get/set/delete) and are:

- stored under the reserved `__internal__:` name prefix, so the user-facing Secrets UI (`listSecrets` / `listSecretNames`) never shows them and they aren't `${{ secrets.NAME }}`-referenceable;
- ALWAYS kept on the local (always-writable, AES-GCM) backend, never the active external backend. Vault is read-through with no `set`, so routing internal writes through the active backend would break when Vault is selected.

The script-package registry auth token is stored this way. The `script_package_registry_config.authSecretRef` column holds a stable marker (the internal secret name) once the token lives in the platform; a one-time, idempotent, parity-verified migration moves any legacy inline ciphertext into the internal store and only rewrites the column after the platform copy reads back identically (so the legacy value is never dropped prematurely). Resolution falls back to decrypting legacy ciphertext until the migration runs.

## The three secret mechanisms (choose deliberately)

A secret rides a plugin config in exactly ONE of three ways. Picking the wrong one is the single most common source of duplicated secret code, so choose by the question **"who reads this config, and where?"**

| Mechanism | Declared with | At rest the field holds | Resolved by | Use when |
| --- | --- | --- | --- | --- |
| **ConfigService encryption** | `configString({ "x-secret": true })` on a `ConfigService`-stored schema | the value, AES-GCM encrypted IN PLACE | `ConfigService.get` (decrypts); `getRedacted` strips it | only the OWNING backend ever reads the config (auth providers, notification / queue / cache backends, the Vault backend's own auth credential) |
| **Reference** | `configString({ "x-secret": true })` holding `${{ secrets.NAME }}` | a pointer to a platform-managed named secret | `secretResolverRef` against the ACTIVE backend (local or Vault) | the value should live in the central Secrets store / Vault and be shared and rotated independently (`secretEnv` env-mapping is this) |
| **Extraction channel** | `configSecret({ id })` | an OPAQUE marker; the value moves to an internal secret keyed by `id` | the shared `ConfigSecretChannel` (`internalSecretsRef`, or a reference through `secretResolverRef`) | the config is RELAYED (to a satellite), PROJECTED (to AI tools), or DIFFED (gitops), so inline ciphertext would leak or break (health-check strategy / collector credentials, integration connection credentials) |

The deciding question for extraction-vs-encryption is **"does anything other than the owning backend read this config?"** If the config is relayed, projected, or diffed, inline ciphertext is wrong, so EXTRACT. If only the owning backend decrypts it in place, ConfigService encryption is simpler and correct. Never re-implement extraction inside a plugin; bind the shared channel (below).

> [!IMPORTANT]
> `configString({ "x-secret": true })` and `configSecret({ id })` are NOT interchangeable. The first is mechanisms 1 and 2 (encrypt-in-place or `${{ secrets.* }}` reference). The second is mechanism 3 (extraction). Boot validation (`validateSecretIds`) rejects an `x-secret` field on an extraction-channel schema that lacks an `id`, so a health-check strategy / collector or integration provider MUST use `configSecret`.

## Config-secret extraction channel (`configSecret`)

The extraction channel is ONE shared, domain-agnostic service, `ConfigSecretChannel` in `@checkstack/secrets-backend`. Health-checks and integrations both BIND it to their own scope; neither re-implements the walk.

### The primitive

Declare an extraction-channel secret with `configSecret({ id })` (from `@checkstack/backend-api`). The `id` is a STABLE identifier that keys the internal secret independently of the field name or position, so renaming or reordering a field never orphans its value:

```ts
import { configSecret } from "@checkstack/backend-api";

const strategyConfig = z.object({
  host: z.string(),
  // Extracted into an internal secret keyed by "password"; the stored config
  // keeps only a marker. `id` must be non-empty and unique within the schema.
  password: configSecret({ id: "password" }).optional(),
});
```

The `id` MUST be non-empty, unique within a schema, and NOT nested inside a `z.array` (the internal-secret key has no element index, so array elements would collapse onto one stored value). `validateSecretIds({ schema, label })` enforces all three at plugin registration, so a misconfigured schema fails boot rather than mis-keying at run time.

### Binding the channel to a scope

A `ConfigSecretChannel` is `{ markerPrefix, keyParts(secretId) => string[] }`. The plugin supplies the marker prefix and the internal-secret key layout for its scope; the shared service does the rest:

```ts
import { extractScopeSecrets, inflateScopeSecrets } from "@checkstack/secrets-backend";

const channel = {
  markerPrefix: "__connref__:",
  keyParts: (secretId) => ["connection", providerId, connectionId, secretId],
};
// Write path: extract inline values into internal secrets, leave markers.
const { config: stored } = await extractScopeSecrets({ channel, schema, config, internalSecrets });
// Run path: inflate markers / references back to values.
const { config: live } = await inflateScopeSecrets({ channel, schema, config: stored, internalSecrets, secretResolver });
```

The shared service also provides `collectScopeSecretValues` (the `path -> value` map a satellite reply ships), `redactSecretFields` / `mergeSecretFields` / `listPopulatedSecretKeys` (read-path masking + editor merge), and the lifecycle pair `deleteScopeSecrets` / `pruneScopeSecrets`.

> [!CAUTION]
> Extract and inflate key the internal secret by the SCHEMA leaf's `id` (`getSecretId`), NEVER by an id parsed out of the marker string stored in the config. A forged marker in a stored config therefore cannot make the channel read another scope's secret.

### Lifecycle: never orphan

A stored marker is the ONLY index into its internal secret, so every write path that can drop a marker MUST clean up the value it pointed at:

- **Delete** the whole scope (delete a connection / configuration): call `deleteScopeSecrets` on the stored config BEFORE removing it, so its markers are scanned and the internal secrets deleted.
- **Update** a scope: call `pruneScopeSecrets(oldConfig, newConfig)` after re-extracting, so a secret whose field switched to a `${{ secrets.* }}` reference or was cleared is removed. A marker whose exact key still appears in the new config is kept (an in-place rotation reuses the same stable key).

Both are schema-free (they scan markers by prefix) and idempotent, so they clean up even when the owning plugin is uninstalled.

### Just-in-time delivery to satellites

Health-check configs run on satellites, which must never persist a secret. The satellite relays only the marker / reference; just before a run it asks core (`request_config_secrets`), core resolves the scope's `x-secret` fields with `collectScopeSecretValues` and replies with a `path -> value` map, and the satellite applies it onto an in-memory config copy. It then fails CLOSED: if any marker or `${{ secrets.* }}` reference survives resolution, the run is refused rather than probing with a bogus credential. The detection is schema-free (it catches a secret nested in a Zod union that a schema walk would miss) and skips the `secretEnv` key, whose `${{ secrets.* }}` templates belong to the separate run-secrets channel and legitimately survive.

## Connection credentials through the unified channel

Integration connection credentials are one BINDING of the extraction channel above. The provider's `connectionSchema` marks each credential field with `configSecret({ id })` (id equal to the flat field name), and the connection store binds the channel to the `["connection", providerId, connectionId, secretId]` key under the `__connref__:` marker prefix. There are two entry forms:

- **Reference form:** the field holds a `${{ secrets.NAME }}` template, resolved through the ACTIVE backend (local or Vault) via `secretResolverRef`. This is the "credential originates from Vault" capability.
- **Inline form:** an operator-typed value is extracted into an internal secret on the local backend, and the stored config keeps only an internal-reference marker. It resolves via `internalSecretsRef`.

`getConnectionWithCredentials` inflates both forms; `listConnections` / `getConnection` stay redacted (a reference shows the reference, an inline shows the redacted marker, never resolved plaintext). The `ConnectionStore` public API is unchanged, and `createConnection` / `updateConnection` return the redacted preview (never echo submitted credentials). `deleteConnection` deletes the extracted internal secrets before removing the config, and `updateConnection` prunes any orphaned by the change, so an inline credential never outlives its connection.

A one-time, idempotent, parity-verified, REVERSIBLE migration (run in `afterPluginsReady`, once every provider's `connectionSchema` is registered) walks each existing connection, backs up its raw config to a backup `ConfigService` entry, extracts inline `x-secret` values into internal secrets, and rewrites the stored config to the reference form. It only rewrites a connection after inflating the rewritten config back and confirming it resolves to the SAME values as the original, so no live connection breaks and no value is dropped before its platform copy is proven identical. Connections already in reference form are skipped.

## Migration from GitOps

The legacy GitOps `secrets` table is promoted into the local backend's table without loss: a guarded, idempotent migration copies existing rows (skipping name conflicts) and leaves the gitops table in place. GitOps switches to resolving and managing secrets through the platform's service refs, so there is a single source of truth.
