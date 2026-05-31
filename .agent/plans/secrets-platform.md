# Secrets platform — core secret management + external backends (Vault) + universal masking

> **Status:** planned (design locked 2026-05-30, not started)
> **Branch:** TBD (off the merged `integration/automation+script-editor`, or `main` once that lands)
> **Original ask:** promote the existing GitOps "Secrets" into a first-class core plugin where secrets are managed centrally, can be backed by an external manager (Vault) over OIDC/AppRole/token, are mappable to env vars, resolvable from satellites, and **cannot leak** — including masking secret values out of any user-facing output (Jenkins-style), even user-script logs.

Self-contained handoff. A future session should pick up from here without prior chat context.

---

## 1. Locked decisions (from design Q&A)

1. **Consolidate, don't fork.** Migrate BOTH existing secret stores onto the new plugin so the platform is consistent:
   - the GitOps `secrets` table + `secret-resolver.ts` (`${{ secrets.NAME }}`, `x-secret`, `resolveSecretsBySchema`) — promoted out of `gitops-backend`;
   - the integration `connection-store` (Jira/Teams/etc. credentials) — re-homed onto the secrets backend.
   `gitops-backend` and `integration-backend` become *consumers* via a service ref. The script-packages registry-auth token (built in the script-editor feature) also moves onto it.
2. **Pluggable backend extension point** (mirror `blobStoreExtensionPoint`): `secretBackendExtensionPoint` + a `SecretBackend` interface. Built-ins: `secrets-backend-local` (default — the existing AES-256-GCM table in `core/backend-api/src/encryption.ts`) and `secrets-backend-vault` (HashiCorp Vault). **Vault auth: OIDC + AppRole + token** all supported.
3. **Satellite availability — core-mediated JIT push (primary).** Core resolves the run's allowlisted secrets and delivers them to the satellite *for that run* over the existing encrypted WS channel; the satellite injects them into the run's execution env (memory-only, dropped after the run), never persisting to disk. A satellite-direct-Vault mode is an optional backend config for core-unreachable topologies. Secrets MUST be available before the run executes (a check/script that references a secret blocks/fails clearly if delivery failed — never runs with a missing secret silently).
4. **Test panel — placeholders by default, with user-set overrides.** The in-UI script test (`testScript` / `testCollectorScript`) does NOT resolve real secret values; it injects named placeholders. Users MAY set per-secret custom override values in the test panel for a realistic run. Real production values never flow to the test surface.
5. **Per-consumer least-privilege allowlist.** A consumer (a script action, a collector, an automation) explicitly declares which secrets it needs (secret→env mapping); only those are resolved and injected for its runs. No ambient access to the whole secret set.
6. **Universal masking (Jenkins-style) — non-negotiable.** Any value returned to a user or the frontend is scanned for known secret values and redacted (`****` / `[secret:NAME]`) at the output boundary. This includes user-script stdout/stderr/return values, automation run step result payloads, healthcheck collector outputs, run-detail pages, and the test panel. Platform-side leak prevention is guaranteed; a script echoing a secret it was *given* is masked too (the value is replaced wherever it appears in returned text). Documented limit: encoded/transformed forms of a secret (base64, hashed, split) cannot be masked — only literal occurrences.

---

## 2. Current-state facts (verified in repo)

- **GitOps secrets** (`core/gitops-backend/src/`): `secrets` table (`id, name unique, encryptedValue (iv:authTag:ciphertext AES-256-GCM), description, createdBy, timestamps`); `secret-resolver.ts` exposes `SecretStore { resolve(name): Promise<string> }` + `resolveSecretsBySchema({ value, schema, secretStore })` which resolves `${{ secrets.NAME }}` ONLY in `x-secret`-annotated fields and returns `warnings` for templates found in non-secret fields. The store is constructed inline at `gitops-backend/src/index.ts:106` — **internal, not a cross-plugin service.**
- **Secret template/name schemas** in `core/gitops-common/src/secret-field.ts`: `SECRET_NAME_REGEX`, `secretNameSchema`, `secretTemplateSchema` (`${{ secrets.NAME }}`), `collectSecretNames()`.
- **Shared crypto:** `core/backend-api/src/encryption.ts` — AES-256-GCM `encrypt`/`decrypt`.
- **connection-store** (`core/integration-backend/src/connection-store.ts`): a second, parallel credential store built on `ConfigService`, keyed per integration provider; `getConnectionWithCredentials` returns decrypted creds, `listConnections` returns redacted.
- **Satellites** (`core/satellite-common/src/protocol.ts`): receive collector `config` via the assignment payload + a `token`; **no secret-resolution path today.** Healthcheck collector scripts run on satellites (`healthcheck-script-backend`), so this is the surface that needs JIT secret delivery.
- **Script runner** (`core/backend-api/src/esm-script-runner.ts`): scrubs env to `SAFE_ENV_VARS`, writes per-run `bunfig.toml` `auto="disable"`, runs in a per-run dir. Secret injection must be an explicit, run-scoped addition to the env — never a widening of `SAFE_ENV_VARS`.

---

## 3. Architecture

### Packages
- `core/secrets-common` — zod schemas (`SecretName`, `SecretRef` `${{ secrets.NAME }}`, secret metadata, backend config, env-mapping `{ ENV_NAME: "${{ secrets.NAME }}" }`), oRPC contract, `secrets.manage` permission, plugin-metadata, the `secrets.changed` hook id.
- `core/secrets-backend` — the resolver service + `secretBackendExtensionPoint` + `SecretBackend` interface; `secretResolverRef` (cross-plugin service); the masking registry/util; satellite JIT-delivery producer; RPC router. Owns the `secrets` table (migrated from gitops).
- `core/secrets-backend-local` — default `SecretBackend` (AES-256-GCM table). Always available.
- `core/secrets-backend-vault` — Vault `SecretBackend` (OIDC / AppRole / token auth; KV v2 read; lease/TTL-aware caching).
- `core/secrets-frontend` — admin **Settings → Secrets** page (manage secrets, choose backend, configure Vault connection; values write-only, never displayed — only `hasValue` + metadata).

### `SecretBackend` interface (extension point)
```ts
interface SecretBackend {
  get(name: string): Promise<string | undefined>;   // resolve a single secret value
  set?(name: string, value: string): Promise<void>; // local backend only; Vault is read-through
  delete?(name: string): Promise<void>;
  list(): Promise<SecretMetadata[]>;                 // names + metadata, NEVER values
  readonly id: string;
}
```
Active backend is config-selected (mirrors the script-packages blob-store selection). Local is default when Vault isn't configured.

### Resolution service (`secretResolverRef`)
Wraps the promoted `resolveSecretsBySchema` so any plugin resolves `${{ secrets.NAME }}` in `x-secret` fields on demand, against the active backend, with per-request caching. `gitops-backend` switches its inline store to this ref.

### Env-var mapping + script integration
- A consumer config carries an explicit `secretEnv` allowlist: `{ API_TOKEN: "${{ secrets.jira_token }}", ... }` (validated by `secrets-common`).
- At execution, the resolver resolves only those refs; the runner injects them into the run env (in addition to `SAFE_ENV_VARS`), memory-only, for that run. Shell scripts read `$API_TOKEN`; TS scripts read `process.env.API_TOKEN` (or a typed helper).
- Resolved values for the run are registered with the **masking layer** (see below) for that run's lifetime.

### Universal masking layer (the Jenkins-style guarantee)
- `maskSecrets({ text, values })` replaces every literal occurrence of each known secret value with `****` (configurable token). Skips trivially-short values (e.g. < 4 chars) to avoid over-masking.
- A run-scoped `SecretMaskingContext` holds the resolved values for the current run. Applied at EVERY output boundary BEFORE persist/return:
  - script-runner captured stdout/stderr/result (automation `run_script`/`run_shell`, healthcheck collectors);
  - automation `automation_run_steps.result_payload` and run logs;
  - the in-UI test panel result;
  - any RPC/DTO that returns script output.
- Because masking is by-value and run-scoped, it also catches a user script that echoes a secret it was given. Documented limit: only literal occurrences (not base64/hashed/split forms).
- The set of values a context holds is the consumer's allowlisted secrets only (least-privilege + avoids masking unrelated coincidental strings).

### Satellite JIT delivery (no-leak)
- New WS messages in `satellite-common/protocol.ts`: a per-run `DeliverRunSecrets { runId, env: Record<string,string> }` (resolved by core just-in-time) pushed before the run executes; the satellite holds it in memory keyed by runId, injects into the run env, and drops it on run completion. Never written to disk; never in the assignment payload (which is persisted).
- Satellite-side masking: the same `maskSecrets` runs on the satellite over the collector output before the result is sent back, using the run's delivered values, so secrets are masked at the source (defense in depth — core masks again on receipt with the same values).
- If delivery fails or a referenced secret is unresolved, the run errors clearly ("required secret not available on this satellite") rather than running without it.
- Optional satellite-direct-Vault mode: the satellite resolves from Vault itself using its own OIDC/AppRole identity (config), for core-unreachable topologies.

---

## 4. Data model (Drizzle, `secrets-backend`)
- `secrets(id pk, name unique, backend, encrypted_value /* local only; null for vault */, vault_path /* vault only */, description, created_by, created_at, updated_at)` — promoted from gitops + a `backend` discriminator + optional vault locator.
- `secret_backend_config(id pk /* singleton */, active_backend, vault_config jsonb /* address, auth method (oidc|approle|token), mount, role, … secrets via secret_ref bootstrapping */, updated_at)`.
- Connection-store data migrates into `secrets` (or a `secret_connections` companion) under the consolidation in §5.

## 5. Migration (consistency — decision 1)
- **GitOps secrets → secrets-backend:** move the `secrets` table ownership; `gitops-backend` reads via `secretResolverRef`. Idempotent table move (rename schema owner / copy rows), provenance preserved.
- **connection-store → secrets-backend:** each provider connection's credential fields become secrets (or a typed connection record on the secrets backend); `integration-backend` resolves via the ref. Redaction semantics preserved (`listConnections` still returns redacted). Phase this carefully — connection-store is load-bearing for live integrations.
- **script-packages registry token → secrets-backend:** the AES-GCM token we built becomes a secret ref.

## 6. RPC contract
- `secrets.manage`-gated: `listSecrets` (metadata only, never values), `setSecret`/`deleteSecret` (local backend), `getBackendConfig`/`setBackendConfig` (+ Vault config; Vault auth creds themselves stored as bootstrap secrets, never returned), `testBackend`.
- Authoring/runtime-gated (service): `resolveForRun({ refs })` (internal, returns resolved env for a run — service-only, never exposed to the browser), `listSecretNames` (names only, for the editor `${{ secrets.* }}` autocomplete + the secretEnv mapping UI).
- **No endpoint ever returns a secret VALUE to a browser client.** Test-panel overrides are user-supplied values that stay client-side until sent as an explicit test input.

## 7. Phasing
1. **Phase 1 — core plugin + local backend + resolver service + masking layer.** Packages, `secretBackendExtensionPoint`, local backend (promote gitops table), `secretResolverRef`, the masking util + run-scoped context wired into the central script runner + automation run output + test panel. `gitops-backend` switches to the ref. Admin Secrets UI (manage + names). Migrate gitops secrets.
2. **Phase 2 — script/healthcheck env mapping + central execution.** `secretEnv` allowlist on script/collector configs; resolve + inject + mask on the central backend. Test-panel placeholders + user overrides.
3. **Phase 3 — satellite JIT delivery.** `DeliverRunSecrets` WS message, satellite memory-only injection + source-side masking, graceful failure, optional satellite-direct-Vault.
4. **Phase 4 — Vault backend.** `secrets-backend-vault` (OIDC/AppRole/token, KV v2, lease/TTL caching), backend selection + config UI, `testBackend`.
5. **Phase 5 — connection-store + script-packages-token consolidation onto secrets.** The riskiest migration; behind the others so live integrations aren't disturbed until the platform is proven.
6. **Phase 6 — docs + changesets + hardening** (masking edge-case tests, leak tests asserting no value crosses any DTO/log).

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Secret leaks into UI / logs / script output | Run-scoped masking layer applied at every output boundary (Jenkins-style by-value redaction), incl. user-script stdout. Leak tests in CI. |
| Secret value returned by an API | No endpoint returns values; DTOs expose `hasValue`/metadata only; `resolveForRun` is service-only. |
| Satellite persists a secret | JIT push, memory-only keyed by runId, dropped on completion; never in the persisted assignment payload; never on disk. |
| Vault unreachable | Local backend default; Vault read-through with TTL cache; clear run-time error when a required secret can't resolve (never run silently without it). |
| Test panel leaks production values | Placeholders by default; user-supplied overrides only; real values never sent to the test surface. |
| Over-broad masking corrupts output | Per-run least-privilege value set + skip trivially-short values. |
| Connection-store migration breaks live integrations | Phased last (Phase 5), behind a proven platform; redaction + resolution parity tests before cutover. |
| Encoded/transformed secret forms evade masking | Documented limit; recommend scripts not transform-then-print secrets. |

## 9. Cross-cutting (repo rules)
- TDD (`bun test`), no `any`, no `eslint-disable`, zod 4. `typecheck:references:generate` after dep changes. Changesets (minor, beta; `BREAKING CHANGES:` where contracts move). Docs under `docs/src/content/docs/` in the same phase. Storybook story for any new `@checkstack/ui` component. No em-dashes.

## 10. Open items to confirm during implementation
- Exact table-ownership move for the gitops `secrets` table (schema migration that doesn't drop data).
- Vault config bootstrapping (the Vault auth creds are themselves secrets — chicken/egg; likely env/ops-provided at boot, not stored in the secret table).
- Whether connection-store becomes plain secrets or a typed connection record on the secrets backend.
- Masking token format (`****` vs `[secret:NAME]`) and min-length threshold.
