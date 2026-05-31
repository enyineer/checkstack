---
"@checkstack/secrets-common": minor
"@checkstack/secrets-backend": minor
"@checkstack/secrets-frontend": minor
---

Hide secret write controls when the active backend is read-through.

When a read-through backend (e.g. Vault) was active, the Secrets admin page still showed the "Add a secret", Rotate, and Delete controls even though the backend correctly rejects writes (`set` / `delete` are intentionally unimplemented), so every attempt errored.

The active backend now reports a capability flag and the UI gates its write affordances on it instead of any hardcoded backend id, so other read-through backends are handled the same way.

Changes:

- `@checkstack/secrets-common`: add a `writable: boolean` field to `BackendConfigDto` (returned by `getBackendConfig`). It carries no sensitive data - a capability boolean only.
- `@checkstack/secrets-backend`: populate `writable` in the `getBackendConfig` handler by inspecting the resolved active backend (true only when it implements both `set` and `delete`; `false` for read-through backends or an unresolved active id). Exposes a small `isBackendWritable` helper.
- `@checkstack/secrets-frontend`: hide the create form, per-row Rotate / Delete buttons, and adjust the empty-state and helper text when the active backend is not writable, plus show a short "read-through" explainer. The local backend stays fully writable.

State & scale: `writable` is derived on read from the resolved active backend's capabilities (durable config selects the backend), so every pod computes the same answer; no new state is introduced.
