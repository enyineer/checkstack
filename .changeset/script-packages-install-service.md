---
"@checkstack/script-packages-backend": minor
---

Add the install/resolve service for script packages: deterministic
lockfile-manifest hashing (content-addressed, order-independent),
generated store `package.json` builder, `.npmrc` renderer (auth token
write-only, never logged), `bun.lock` parser (name/version/integrity
extraction), the elected-installer Postgres advisory lock (pattern copied
from automation-backend) + singleton install-state store, the
`performInstall` orchestration (resolve -> delta-publish blobs to the
active store -> record manifest/hash/size), and the admin-configurable
size-cap guardrail (warn 150MB / block 300MB).

Empirically verified: `bun install --offline` reconstructs `node_modules`
from a pre-seeded Bun cache with zero network access (the delta-sync model
the reconciler builds on). Hardlink-vs-copy is filesystem-dependent and
does not affect correctness.
