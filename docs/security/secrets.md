---
---
# Setting Up Secret Encryption

Checkmate automatically encrypts sensitive configuration data (like OAuth client secrets, API keys, database passwords) using AES-256-GCM encryption before storing them in the database.

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

Any configuration field marked with `secret()` in the Zod schema will be automatically encrypted, including:
- OAuth client secrets (GitHub, Google, etc.)
- API keys and tokens
- Database passwords in connection strings
- SMTP passwords
- Any other sensitive credentials

### How It Works

1. **On Save**: Secrets are automatically encrypted before being stored in the database
2. **On Load**: Secrets are automatically decrypted when retrieved for use
3. **For Frontend**: Secrets are redacted (completely removed) before being sent to the frontend

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

If you need to rotate your encryption key:

1. Generate a new key
2. Decrypt all secrets with the old key
3. Update `ENCRYPTION_MASTER_KEY` with the new key
4. Re-encrypt all secrets with the new key

**Note**: There is currently no automated key rotation tool. This is a manual process.
