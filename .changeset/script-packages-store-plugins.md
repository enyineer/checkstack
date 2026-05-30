---
"@checkstack/script-packages-store-postgres": minor
"@checkstack/script-packages-store-s3": minor
---

Add the two built-in blob-store plugins for script packages.

- `script-packages-store-postgres` (default, zero extra infra): persists
  content-addressed blobs in Postgres as base64 `text` (following the
  existing repo convention for binary columns), registered as the
  `postgres` backend via `blobStoreExtensionPoint`.
- `script-packages-store-s3` (preferred when configured): S3-compatible
  store backed by Bun's native `S3Client` (no AWS SDK). Config from env
  (`endpoint`, `bucket`, `region`, `accessKeyId`, `secretAccessKey`,
  `forcePathStyle`); credentials never touch the DB. Registers the `s3`
  backend only when configured, and reports a partial-config error
  instead of silently falling back.
