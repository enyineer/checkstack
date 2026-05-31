---
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-frontend": minor
---

Add garbage collection for script packages, reclaiming both shared blob storage and per-host disk.

Two things accumulated and were never reclaimed; both are now collected with provably-safe guards (referenced-set + grace + lock / active-run protection - when in doubt, retain).

- **Blob GC (Postgres / S3 reclamation).** A new `gcBlobs` RPC (manage-gated) plus a daily scheduled job prune content-addressed blobs no longer referenced by any retained lockfile manifest (the current desired hash plus the previous N, default 1, for rollback / in-flight reconciles). Candidates are only deleted after a grace window (default 24h, keyed on `created_at`), each blob's bytes are removed from its recorded backend before its index row, and the pass holds the installer-election advisory lock so it is mutually exclusive with installs and storage migrations. The settings UI surfaces last-run and total-reclaimed figures and a "Run cleanup now" action. The installer now records each successful manifest in a new `script_package_lockfile_history` table so the retained set is computable; GC state lives in `script_package_blob_gc_state`.
- **Tree GC (per-host disk).** After a successful symlink flip, each host (core pod or satellite) sweeps its `trees/<lockfileHash>/` dirs, deleting non-current trees older than a grace window (default 1h). `current`'s target is never deleted. Active-run safety uses a conservative mtime-keyed grace window chosen to exceed the longest run timeout, since runs are throwaway subprocesses with no robust cross-process refcount - a tree only becomes eligible once no live run could still be pinned to it.

Adds the `gcBlobs` / `getBlobGcState` RPCs, the `BlobGcSummary` / `BlobGcState` schemas, and two new Drizzle tables (`script_package_lockfile_history`, `script_package_blob_gc_state`).
