---
title: "Setting Up Secret Encryption"
description: "Checkstack automatically encrypts sensitive configuration data (like OAuth client secrets, API keys, database passwords) using AES-256-GCM encryption before storing them in the database."
---

Checkstack automatically encrypts sensitive configuration data (like OAuth client secrets, API keys, database passwords) using AES-256-GCM encryption before storing them in the database.

> [!NOTE]
> This page covers the AES-256-GCM encryption used for `x-secret` config fields (integration connections, the Vault auth credential, the local secret backend). For named secrets referenced via `${{ secrets.NAME }}`, backend selection (local or Vault), and the masking guarantee, see the [Secrets platform](/checkstack/developer-guide/backend/secrets/) reference.

## Required Setup

You **must** set an `ENCRYPTION_MASTER_KEY` environment variable before using any features that store secrets.

### Generate a New Key

```bash
# Generate a secure random 32-byte key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Add to .env

Copy the generated key and add it to your `.env` file:

```bash
ENCRYPTION_MASTER_KEY=<your-generated-key-here>
```

**IMPORTANT:**
- The key MUST be exactly 64 hexadecimal characters (32 bytes)
- Do NOT commit this key to version control
- Use different keys for development, staging, and production
- Keep this key secure - if you lose it, encrypted secrets cannot be recovered

### What Gets Encrypted?

Any configuration field marked with `configString({ "x-secret": true })` in the Zod schema will be automatically encrypted, including:
- OAuth client secrets (GitHub, Google, etc.)
- API keys and tokens
- Database passwords in connection strings
- SMTP passwords
- Any other sensitive credentials

### How It Works

1. **On Save**: Secrets are automatically encrypted before being stored in the database
2. **On Load**: Secrets are automatically decrypted when retrieved for use
3. **For Frontend**: Secrets are redacted (completely removed) before being sent to the frontend

### Decryption Failures Fail Loud

If a stored secret cannot be decrypted with any configured key (a wrong key, a missing key after rotation, or tampered ciphertext), the read fails closed:

- The whole config read throws a typed `DecryptionError` instead of returning a usable-looking value.
- The failure is logged at error level with the config key and plugin id, but never the secret value or the ciphertext.

This is deliberate. The platform never silently substitutes ciphertext for the real secret, so a broken key is surfaced to you immediately rather than letting a downstream consumer use ciphertext as if it were the secret.

### Security Features

- ✅ **AES-256-GCM** encryption (authenticated encryption)
- ✅ **Unique IV per encryption** (prevents pattern analysis)  
- ✅ **Authentication tag verification** (detects tampering)
- ✅ **Automatic encryption/decryption** (transparent to application code)
- ✅ **Secrets never exposed to frontend** (redacted before sending)

### Troubleshooting

**Error: "ENCRYPTION_MASTER_KEY environment variable is required"**

- You haven't set the `ENCRYPTION_MASTER_KEY` in your `.env` file
- Solution: Generate a key and add it to `.env` as shown above

**Error: "ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex characters)"**

- Your key is not the correct length
- Solution: Generate a new key using the command above (it will be the correct length)

### Key Rotation

Rotation is non-breaking: single-key setups (only `ENCRYPTION_MASTER_KEY` set) keep working unchanged, and the stored ciphertext format does not change.

During rotation you keep the OLD key available for decryption while NEW secrets are encrypted with the NEW key.

- `ENCRYPTION_MASTER_KEY` is the PRIMARY key. It is used to encrypt every new secret.
- `ENCRYPTION_MASTER_KEY_PREVIOUS` is an optional, ordered, comma-separated list of PREVIOUS keys used only for decryption fallback.

On read, the platform trial-decrypts with the primary key first, then each previous key in order. A value is reported as undecryptable only when every configured key fails.

```env
# After rotating: the new key is primary, the old key is kept for decryption.
ENCRYPTION_MASTER_KEY=<new-64-hex-key>
ENCRYPTION_MASTER_KEY_PREVIOUS=<old-64-hex-key>
```

Each previous key must also be exactly 64 hex characters. You can list more than one (for example `key_b,key_a`) if you have rotated several times; they are tried left to right.

#### Rotate your encryption key

1. Generate a new key:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Set the new key as `ENCRYPTION_MASTER_KEY` and move the current key into `ENCRYPTION_MASTER_KEY_PREVIOUS`. Restart the backend. Existing secrets keep decrypting via the previous key; new secrets use the new key.

3. Re-encrypt all stored secrets onto the new primary key:

   ```bash
   ENCRYPTION_MASTER_KEY=<new-key> \
   ENCRYPTION_MASTER_KEY_PREVIOUS=<old-key> \
   DATABASE_URL=postgres://... \
   bun run --filter @checkstack/backend reencrypt-secrets
   ```

   The command reports how many rows it scanned, re-encrypted, skipped, and failed for each store.

4. When the command reports zero failures, remove `ENCRYPTION_MASTER_KEY_PREVIOUS` (or drop the old key from the list) and restart the backend.

> [!IMPORTANT]
> Do NOT drop the old key while the re-encrypt command still reports failures. A failure means at least one value could not be decrypted with any configured key, and dropping the key would make those values permanently unrecoverable.

#### What the re-encrypt command covers

- The local secret backend (`secrets` table).
- Config-service `x-secret` fields stored in `plugin_configs` (every structurally-encrypted value in the stored JSON).

It does NOT cover secrets held in external backends such as HashiCorp Vault. Those are not encrypted with this key, so rotate them through the external backend's own mechanism.
