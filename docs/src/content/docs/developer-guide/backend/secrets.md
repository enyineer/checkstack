---
title: "Secrets platform"
description: "How Checkstack manages secrets centrally with pluggable backends, resolves them for runs, and masks their values out of every user-facing output."
---

The Secrets platform is the central, plugin-agnostic home for secrets. Secrets are created and managed in one place, stored by a pluggable backend (a local AES-256-GCM store by default), referenced from descriptors and configs via `${{ secrets.NAME }}`, and resolved on demand by any plugin through a service reference. No endpoint ever returns a secret value to a browser, and a Jenkins-style masking layer redacts known secret values out of any output before it is persisted or returned.

> [!NOTE]
> This page documents Phase 1: the core plugin, the local backend, the resolver service, and the masking seam. Env-var injection into runs, satellite just-in-time delivery, and the Vault backend land in later phases.

## Packages

- `@checkstack/secrets-common` - schemas (`secretNameSchema`, the `${{ secrets.NAME }}` template, the secret metadata DTO, the secret to env mapping), the oRPC contract, the `secrets.read` / `secrets.manage` access rules, the `secrets.changed` hook id, and the pure masking utilities (`maskSecrets`, `maskSecretsDeep`, `maskScriptRunOutput`).
- `@checkstack/secrets-backend` - the `SecretBackend` extension point, the backend registry, the promoted schema-driven resolver (`resolveSecretsBySchema`), the cross-plugin `secretResolverRef` / `secretAdminRef` services, the run-scoped `SecretMaskingContext`, the `secrets.changed` hook, and the RPC router.
- `@checkstack/secrets-backend-local` - the default backend: AES-256-GCM values in the `secrets` table. Owns the table (promoted from gitops).
- `@checkstack/secrets-frontend` - the admin Settings page (create / rotate / delete, values write-only).

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

The active backend is config-selected; the local backend is the default when no external backend is configured. Read-through backends (e.g. Vault, a later phase) implement only `get` / `list`.

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
