---
"@checkstack/backend-api": minor
"@checkstack/backend": minor
---

Encryption key rotation support plus fail-loud secret decryption.

Non-breaking: existing single-key (`ENCRYPTION_MASTER_KEY` only) setups keep
working unchanged. The ciphertext format (`iv:authTag:ciphertext`, AES-256-GCM)
is unchanged - no key-id prefix - so old values stay decodable.

- **Multi-key decryption for rotation.** `decrypt()` now trial-decrypts with the
  primary `ENCRYPTION_MASTER_KEY` first, then each key in the optional
  comma-separated `ENCRYPTION_MASTER_KEY_PREVIOUS` list, in order. Only when ALL
  configured keys fail the GCM tag does it raise the hard error. New encryption
  always uses the primary key. Every key is validated (32-byte hex) with zod;
  key material is never logged.
- **Fail-loud, fail-closed decrypt in `ConfigService`.** Previously a failed
  decrypt silently substituted the raw CIPHERTEXT in place of the plaintext
  secret, so downstream consumers used ciphertext as the secret and operators
  never learned decryption broke. Now the failure is surfaced via the structured
  `Logger` at error level (with the config key and plugin, never the secret or
  ciphertext) and a typed `DecryptionError` is thrown, failing the whole config
  read so the operator sees it. A new exported `DecryptionError` type lets
  callers detect this.
- **Re-encryption tooling.** New `bun run --filter @checkstack/backend
  reencrypt-secrets` command (and reusable `reencryptAllSecrets` helper) walks
  the local secret backend `secrets` table and config-service `x-secret` fields
  in `plugin_configs`, decrypts each value with whichever configured key
  authenticates, and re-encrypts it onto the current primary key. After running
  it with zero failures, the operator can safely drop the demoted key from
  `ENCRYPTION_MASTER_KEY_PREVIOUS`. External backends (e.g. Vault) are out of
  scope - rotate those through their own mechanism.

No schema change. State note: all encrypted state lives in shared Postgres
(`secrets`, `plugin_configs`); reads return the same answer on every pod because
key resolution and trial-decryption are pure functions of the env-configured
keys and the stored ciphertext.
