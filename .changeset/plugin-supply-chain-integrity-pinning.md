---
"@checkstack/backend": minor
---

Fail-closed plugin supply-chain integrity pinning.

Plugin installers now verify downloaded artifacts and pin them so later reloads
can detect tampering. This closes a gap where tarballs were installed with no
integrity verification at all.

- **npm**: the downloaded tarball is verified against the registry's
  `dist.integrity` (SHA-512 SRI) and refused on mismatch. When only the legacy
  `dist.shasum` (SHA-1) is available it is used with a logged warning; when no
  integrity material is present at all the install is refused (fail-closed). The
  registry metadata is now parsed with a zod schema rather than trusted blindly.
- **GitHub release**: when the asset exposes a `digest` (`sha256:<hex>`) the
  bytes are verified against it (fail-closed on mismatch); the computed SHA-256
  is always recorded. Release metadata is parsed with zod.
- **All sources**: the canonical SHA-256 of the installed tarball is persisted
  to a new nullable `plugins.installed_digest` column and re-verified whenever a
  pod re-hydrates the plugin from `plugin_artifacts`. A mismatch refuses to load
  that plugin without crashing boot; a missing digest (legacy install) is
  backfilled and the plugin loads.

This is non-breaking: the `installed_digest` column is nullable, so existing
installed plugins without a recorded digest keep working and get pinned on their
next reload. The digest lives in shared Postgres, so it reads the same on every
pod.

Note: this is integrity pinning, not author trust. Cryptographic signature
verification against a trust store is deliberately deferred to a future layer.
