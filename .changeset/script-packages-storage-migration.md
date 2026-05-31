---
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-frontend": minor
---

Add storage-backend migration for script packages.

- `migrateStorage({ target })` copies every blob from the active backend to
  the target, verifies each copy byte-for-byte (read back + SHA-256 compare),
  flips the per-blob `backend` only after a verified copy, then atomically
  switches the active backend. Resumable from a partial state (the work set
  is re-derived from the index), aborts cleanly on an integrity mismatch
  (active backend untouched), and supports optional source GC. Built on the
  Phase 2 dual-backend read fallback, so reads keep working mid-migration.
- Migration and `installNow` are mutually exclusive via the installer
  advisory lock; `setStorageBackend` is refused while a migration runs.
- New `listStorageBackends` RPC + admin UI: a storage-backend card with a
  target selector, "Migrate" action, and live progress / completion / error
  state.
