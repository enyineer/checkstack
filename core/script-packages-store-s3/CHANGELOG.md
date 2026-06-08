# @checkstack/script-packages-store-s3

## 0.2.12

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/backend-api@0.22.0
  - @checkstack/script-packages-backend@0.3.10

## 0.2.11

### Patch Changes

- @checkstack/script-packages-backend@0.3.9
- @checkstack/backend-api@0.21.7

## 0.2.10

### Patch Changes

- @checkstack/script-packages-backend@0.3.8

## 0.2.9

### Patch Changes

- @checkstack/backend-api@0.21.6
- @checkstack/script-packages-backend@0.3.7

## 0.2.8

### Patch Changes

- @checkstack/script-packages-backend@0.3.6

## 0.2.7

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/script-packages-backend@0.3.5

## 0.2.6

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/script-packages-backend@0.3.4

## 0.2.5

### Patch Changes

- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/script-packages-backend@0.3.3

## 0.2.4

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/backend-api@0.21.2
  - @checkstack/script-packages-backend@0.3.2

## 0.2.3

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/script-packages-backend@0.3.1

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

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
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
