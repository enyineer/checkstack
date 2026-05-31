---
"@checkstack/script-packages-backend": patch
"@checkstack/script-packages-store-postgres": patch
---

Harden the script-package blob byte boundary against a raw `ArrayBuffer`.

Blob bytes can reach the content-hash and storage codecs as a raw `ArrayBuffer` (e.g. from an S3/HTTP transport's `arrayBuffer()`), and Node/Bun's `crypto.Hash.update()` rejects a bare `ArrayBuffer` ("The 'data' argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received an instance of ArrayBuffer"), which would fail a real-package install with `status=error`. `blobSha256` / `verifyBlobSha256` (script-packages-backend) and `encodeBlob` (script-packages-store-postgres) now normalize `ArrayBuffer` to a `Uint8Array` view at the boundary before hashing/encoding. A view over the same bytes hashes and encodes identically, so existing content hashes and stored blobs are unchanged. Adds regression tests feeding an `ArrayBuffer` through both the hash and the Postgres codec.
