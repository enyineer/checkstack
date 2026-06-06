# @checkstack/script-packages-store-postgres

## 0.2.5

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/script-packages-backend@0.3.3
- @checkstack/script-packages-common@0.3.2

## 0.2.4

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/script-packages-backend@0.3.2
  - @checkstack/script-packages-common@0.3.2

## 0.2.3

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/script-packages-backend@0.3.1
  - @checkstack/script-packages-common@0.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/common@0.13.0
  - @checkstack/script-packages-common@0.3.0
  - @checkstack/script-packages-backend@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/script-packages-backend@0.2.1

## 0.2.0

### Minor Changes

- 270ef29: Add the two built-in blob-store plugins for script packages.

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

### Patch Changes

- b995afb: Harden the script-package blob byte boundary against a raw `ArrayBuffer`.

  Blob bytes can reach the content-hash and storage codecs as a raw `ArrayBuffer` (e.g. from an S3/HTTP transport's `arrayBuffer()`), and Node/Bun's `crypto.Hash.update()` rejects a bare `ArrayBuffer` ("The 'data' argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received an instance of ArrayBuffer"), which would fail a real-package install with `status=error`. `blobSha256` / `verifyBlobSha256` (script-packages-backend) and `encodeBlob` (script-packages-store-postgres) now normalize `ArrayBuffer` to a `Uint8Array` view at the boundary before hashing/encoding. A view over the same bytes hashes and encodes identically, so existing content hashes and stored blobs are unchanged. Adds regression tests feeding an `ArrayBuffer` through both the hash and the Postgres codec.

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/script-packages-backend@0.2.0
  - @checkstack/script-packages-common@0.2.0
