---
"@checkstack/backend-api": minor
"@checkstack/script-packages-backend": minor
---

Add the per-host script-package reconciler and the runner resolution root.

- `@checkstack/backend-api`: `EsmScriptRunOptions.resolutionRoot` - when
  set, the per-run temp dir is created inside it so module resolution walks
  up to `<resolutionRoot>/node_modules` and user scripts can `import`
  managed npm packages. Defaults to today's `os.tmpdir()` behavior when
  unset (backward-compatible; isolation unchanged - the subprocess still
  only sees `SAFE_ENV_VARS`).
- `@checkstack/script-packages-backend`: content-addressed cache archive
  (tar+gzip per package), pure delta diff (`computeMissingBlobs`), atomic
  `current` symlink swap, the host reconciler (`reconcileToHash` -
  idempotent: pull only missing blobs, materialize a versioned tree via
  `bun install --offline`, atomically flip `current`), the concrete fs/Bun
  adapter, the central install resolver, and the `script-packages.changed`
  broadcast hook. An opt-in end-to-end test
  (`CHECKSTACK_E2E_NETWORK=1`) proves resolve -> publish -> cold reconcile
  (no registry) -> offline materialize -> import.
