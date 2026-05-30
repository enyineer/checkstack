---
"@checkstack/satellite-backend": minor
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-common": minor
---

Core-side satellite script-package distribution.

- `satellite-backend`: the WS handler now carries the desired script-package
  lockfile hash in `authenticated` / `config_updated` payloads (the durable
  backstop), exposes `pushRefreshScriptPackagesToAll` (wired to the
  `script-packages.changed` broadcast hook in `mode: "broadcast"`, so each
  core instance fans the refresh out to its own connected satellites), and
  persists `script_package_sync_state` reports from satellites.
- `script-packages-*`: new `reportSatelliteSyncState` RPC + store method so
  satellite-backend can record per-satellite reconcile state for the admin
  UI. Satellites pull blobs from core via the existing `getManifest` /
  `downloadBlob` endpoints, never the registry.
