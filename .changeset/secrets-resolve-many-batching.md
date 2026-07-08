---
"@checkstack/secrets-backend": patch
---

Kill the redundant active-backend-id read N+1 in secret run resolution.
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
