---
title: "Secrets platform"
description: "How Checkstack manages secrets centrally with pluggable backends, resolves them for runs, and masks their values out of every user-facing output."
---

The Secrets platform is the central, plugin-agnostic home for secrets. Secrets are created and managed in one place, stored by a pluggable backend (a local AES-256-GCM store by default), referenced from descriptors and configs via `${{ secrets.NAME }}`, and resolved on demand by any plugin through a service reference. No endpoint ever returns a secret value to a browser, and a Jenkins-style masking layer redacts known secret values out of any output before it is persisted or returned.

> [!NOTE]
> This page documents Phases 1 to 4: the core plugin, the local backend, the resolver service, the masking layer, secret to env-var injection for scripts (central and satellite), just-in-time satellite delivery, and the HashiCorp Vault backend. Satellite-direct-Vault (a satellite reading Vault itself for core-unreachable topologies) is deferred to a follow-up; core-mediated delivery is the default.

## Packages

- `@checkstack/secrets-common` - schemas (`secretNameSchema`, the `${{ secrets.NAME }}` template, the secret metadata DTO, the secret to env mapping, the backend-config DTOs), the oRPC contract, the `secrets.read` / `secrets.manage` access rules, the `secrets.changed` hook id, and the pure masking utilities (`maskSecrets`, `maskSecretsDeep`, `maskScriptRunOutput`).
- `@checkstack/secrets-backend` - the `SecretBackend` extension point, the backend registry, the promoted schema-driven resolver (`resolveSecretsBySchema`), the cross-plugin `secretResolverRef` / `secretAdminRef` services, the run-scoped `SecretMaskingContext`, the `secrets.changed` hook, the active-backend selection (persisted via `ConfigService`), and the RPC router.
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
- **Reads:** `get(name)` maps the name via the backend's own `secret_index` table (name → KV v2 path + key), reads `<mount>/data/<path>`, and returns the chosen key. `list()` returns the index metadata only — NEVER values. Vault is read-through (no `set` / `delete`); secrets are authored in Vault and indexed here.
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

At execution the action resolves ONLY the declared secrets via `secretResolverRef.resolveForRun({ secretEnv })`, which returns the concrete env map plus a run-scoped `SecretMaskingContext`. The resolved values are injected into the runner env for that run only (the ESM runner gained a per-run `env` option; the shell runner already had one) and are never persisted. The script reads them as `process.env.ENV_NAME` (TypeScript) or `$ENV_NAME` (shell). A referenced secret that cannot resolve fails the run with a clear error rather than running without it. Decision 5: there is no ambient access; only the named secrets are resolved and injected.

The automation `run_script` / `run_shell` actions implement this on the central backend. Healthcheck collectors carry the `secretEnv` field too; they are resolved + injected both when a check runs centrally (the queue executor) and when it runs on a satellite (see below).

## Satellite just-in-time delivery

Healthcheck collectors run on satellites, which must NEVER persist a secret to disk, and a secret must NEVER ride the (persisted) assignment payload. So secrets are delivered per-run over the existing authenticated WebSocket channel, request/reply (mirrors the script-package manifest/blob precedent):

1. Just before a satellite runs a collector that declares a `secretEnv`, it sends `request_run_secrets { requestId, configId, collectorId, runId }`.
2. Core reads the collector's declared `secretEnv` from that satellite's OWN persisted assignment (the satellite does not choose which secrets), resolves ONLY those refs via `resolveForRun`, and replies with `run_secrets { requestId, env }` (or `{ requestId, error }`).
3. The satellite injects `env` into the run's runner env, holds it in memory keyed to the run, runs, and drops it on completion. It is never written to disk.

If delivery fails or a required secret can't resolve, the collector run errors clearly ("required secret not available on this satellite") rather than running without it.

Source-side masking is applied on the satellite: the collector runs `maskSecrets` over its `stdout` / `stderr` / `result` / `error` using the run's delivered values BEFORE the result leaves the satellite, so a secret is redacted at the source even if the result is logged downstream. (Satellite-direct-Vault — a satellite resolving from Vault itself using its own identity, for core-unreachable topologies — is deferred to a follow-up; core-mediated delivery works for Vault today since the resolver simply reads through the active backend.)

## Test panel: placeholders + overrides

The in-UI test panel (`testScript` / `testCollectorScript`) NEVER resolves real secret values (decision 4). For each declared `secretEnv` entry it injects a named placeholder (`__SECRET_<NAME>__`), or a user-supplied per-secret override value when the operator wants a realistic run. Override values are user-supplied (they stay client-side until sent as an explicit test input) and are masked out of the test result, so even an override can't round-trip to the surface unmasked. The shared `buildTestSecretEnv` helper (in `@checkstack/secrets-common`) builds the test env + the override mask set.

## No value ever crosses to a browser

The RPC contract exposes only metadata:

- `listSecrets` returns `SecretMetadata` (`id`, `name`, `description`, `hasValue`, `backend`, timestamps) - never the value.
- `listSecretNames` returns names only (for editor autocomplete + the env-mapping UI).
- `setSecret` is write-only (create or rotate); `deleteSecret` removes by name.
- `getBackendConfig` returns the active backend id + available ids.

There is no `getSecret` / `resolveSecret` on the browser-facing contract. Resolution to values is the service-only `secretResolverRef`.

## Universal masking (the leak guarantee)

`maskSecrets({ text, values })` replaces every literal occurrence of each known secret value with `****`, skipping trivially short values (under 4 chars) to avoid over-masking. A run-scoped `SecretMaskingContext` holds only the run's resolved values (least privilege), and `maskScriptRunOutput` applies redaction to a run's `result` / `stdout` / `stderr` / `error` at the output boundary before it is persisted or returned. This is wired into the automation `run_script` / `run_shell` actions and the in-UI test panel, so even a script that echoes a secret it was given is redacted.

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

## Migration from GitOps

The legacy GitOps `secrets` table is promoted into the local backend's table without loss: a guarded, idempotent migration copies existing rows (skipping name conflicts) and leaves the gitops table in place. GitOps switches to resolving and managing secrets through the platform's service refs, so there is a single source of truth.
