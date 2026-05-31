---
"@checkstack/satellite": minor
"@checkstack/satellite-common": minor
"@checkstack/satellite-backend": minor
---

Satellite-side script-package reconciliation over the WS channel.

- `satellite-common`: WS request/reply messages for pulling the manifest +
  blobs from core (`request_script_package_manifest` /
  `request_script_package_blob` -> `script_package_manifest` /
  `script_package_blob`).
- `satellite-backend`: the WS handler answers those requests from the
  script-packages store (satellites pull from core, never the registry).
- `@checkstack/satellite`: the client gains request/reply plumbing + a
  `SatelliteScriptPackages` manager that reuses the Phase 2 reconciler
  (`reconcileToHash` + `createReconcileFsDeps`) over the WS transport. It
  reconciles on a `refresh_script_packages` push and on the
  assignment-carried hash (startup / reconnect backstop), pulls only missing
  blobs (delta), materializes via `bun install --offline`, atomically flips
  `current`, reports sync state back, and degrades cleanly (error state, no
  stale tree, no registry access) when a blob can't be fetched. Reconciles
  are serialized + coalesced + idempotent.
