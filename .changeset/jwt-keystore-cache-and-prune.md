---
"@checkstack/backend": minor
---

perf(auth): cache JWT keys per-pod, lock rotation, and prune orphaned keys

The keystore hit the database on every request: `getPublicJWKS()` on every token
verification and `getSigningKey()` on every service-to-service token mint - the
two highest-call-count queries in production (~1.6M calls each). It also grew the
`jwt_keys` table without bound: `revoked_at` was never set, rotation expired only
the single observed active key, and rotation held no lock - so multi-pod races
left keys with `expires_at = NULL` that could never be pruned and were returned on
every JWKS read (hundreds of rows per call, still climbing).

The keystore now:

- Caches the JWKS (60 s TTL) and the signing key (5 min TTL) per pod, with
  single-flight refresh so a TTL expiry cannot stampede the DB. `verify` forces a
  one-time JWKS refresh when a token's `kid` is absent from the cached set, so a
  key freshly rotated on another pod is never spuriously rejected.
- Rotates under a cross-pod advisory lock, double-checked so a pod that lost the
  race adopts the winner's key instead of minting a duplicate.
- Expires EVERY currently-active key on rotation (not just one), so keys orphaned
  by earlier races get a grace expiry and are reclaimed by cleanup - self-healing
  the accumulated `jwt_keys` growth over the next rotation cycle.

Behavior is unchanged for callers; the effect is far fewer DB round-trips on the
hot auth path and a `jwt_keys` table that stops growing.
