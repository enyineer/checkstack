---
"@checkstack/backend-api": minor
"@checkstack/auth-backend": minor
"@checkstack/satellite-backend": patch
---

fix(security): crypto + auth depth hardening (at-rest encryption, brute-force scale, token timing)

Three concrete defects found and fixed during the deferred crypto + auth depth audit:

- **At-rest encryption (`@checkstack/backend-api`)**: AES-256-GCM decrypt now
  rejects values whose IV is not exactly 12 bytes or whose auth tag is not the
  full 16 bytes (128-bit). GCM accepts truncated tags, which weaken forgery
  resistance; the encryptor only ever emits full tags, so short tags now hard-
  error instead of being silently accepted. `isEncrypted` is also tightened to
  require the exact decoded IV/tag lengths, not just a loose
  `base64:base64:base64` shape, so a plaintext secret that merely resembles the
  shape can no longer be misclassified as "already encrypted" and stored in
  plaintext. The unique-nonce and tamper-rejection guarantees are now covered by
  regression tests.

- **Brute-force protection scale bug (`@checkstack/auth-backend`)**: better-auth's
  built-in rate limiter (sign-in, password reset) defaulted to per-pod in-memory
  storage. With N replicas behind one database that multiplied the effective
  limit by N (state-and-scale §14.5). The limiter is now backed by a shared
  `better_auth_rate_limit` Postgres table via a `customStorage` adapter, so the
  counter is global across all pods. Adds a new append-only migration for the
  table. No behaviour change in local dev (limiter stays off when not in
  production); no configuration required.

- **Satellite token timing oracle (`@checkstack/satellite-backend`)**:
  `validateToken` previously skipped the bcrypt verify when the `clientId` did
  not exist, leaking client-ID existence via response timing. It now always
  verifies the supplied token (against a decoy hash when the row is missing) so
  the missing-clientId path costs the same as the wrong-token path.

Audited and found clean (no change needed): the better-auth cookie/session/CSRF
posture (`httpOnly`, `sameSite=lax`, `Secure` derived from the https `BASE_URL`,
single trusted origin, fresh session on internal trusted-login), and
token/secret logging hygiene across the auth, satellite, and secrets paths (no
secret material is logged).
