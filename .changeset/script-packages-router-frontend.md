---
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-frontend": minor
---

Wire up the script-packages RPC router, admin UI, and editor IntelliSense.

- `script-packages-backend`: the oRPC router implementing the full
  contract (allowlist CRUD, registry config with encrypted write-only auth
  token, `installNow` via the elected installer, size cap, storage backend
  selection, install state, `getManifest` / `downloadBlob` for reconcilers,
  and `listPackageTypes`), the `installNow` controller (election, size-cap
  enforcement, `script-packages.changed` emit, blocked during migration),
  the `.d.ts` rollup, the singleton config stores, and the full plugin
  wiring (broadcast-hook reconcile + startup backstop).
- `script-packages-common`: admin route for the settings page.
- `script-packages-frontend`: the Settings -> Script Packages admin page
  (allowlist, install state + size, registry/storage summary, satellite
  sync) and the `useScriptPackageTypes()` hook.
- `automation-frontend` / `healthcheck-frontend`: merge installed-package
  `.d.ts` into the script-editor `typeDefinitions` so `import` from an
  allowlisted package autocompletes in every script field.
