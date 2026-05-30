---
"@checkstack/backend-api": minor
"@checkstack/script-packages-backend": minor
"@checkstack/automation-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/healthcheck-script-backend": minor
---

Activate npm packages in script execution: thread the managed
`resolutionRoot` into every user-script call site so an allowlisted package
can actually be `import`ed.

- `@checkstack/backend-api`: the ESM runner now always writes a per-run
  `bunfig.toml` with `[install] auto = "disable"` and runs with that dir as
  CWD. Without this Bun silently auto-installs any imported package from the
  registry (verified), defeating the allowlist; with it, imports resolve
  only against the reconciled `current/node_modules` (when a `resolutionRoot`
  is set) and otherwise fail fast.
- `@checkstack/script-packages-backend`: `resolveResolutionRoot` /
  `resolveResolutionRootFromStore` / `resolveResolutionRootForHost` decide a
  host's resolution-root status (`none` / `ready` / `notReady`) from the
  local `<store>/current`.
- `run_script` (integration-script-backend), the inline-script collector
  (healthcheck-script-backend, core + satellite), and the in-UI `testScript`
  / `testCollectorScript` endpoints all resolve the root per run and pass it
  to the runner; `run_script` surfaces a clear "npm packages not ready"
  error when configured-but-unsynced. Shell paths are unaffected (no module
  resolution).

An opt-in end-to-end test (`CHECKSTACK_E2E_NETWORK=1`) proves an allowlisted
package imports successfully through the real `run_script` action execute
path, with non-network degradation tests running always.
