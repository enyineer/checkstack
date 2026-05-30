---
"@checkstack/script-packages-backend": minor
---

Add the script-packages backend package skeleton: Drizzle data model
(allowlist, registry config, install state, size cap, content-addressed
blob index, storage config, per-satellite sync state) + initial
migration, the `blobStoreExtensionPoint` + `BlobStore` interface and a
blob-store registry (with dual-backend read fallback for storage
migration), the `CHECKSTACK_DATA_DIR` package-store path resolver, and
the plugin registration that wires the extension point + access rules.
