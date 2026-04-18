import crypto from "node:crypto";

/**
 * Master encryption key from environment variable.
 * Should be 32 bytes (64 hex characters) for AES-256.
 */
const getMasterKey = (): Buffer => {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY environment variable is required for secret encryption"
    );
  }

  // Convert hex string to buffer
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex characters)"
    );
  }

  return keyBuffer;
};

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns base64-encoded string in format: iv:authTag:ciphertext
 */
export const encrypt = (plaintext: string): string => {
  const key = getMasterKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();


  return `${iv.toString("base64")}:${authTag.toString(
    "base64"
  )}:${encrypted.toString("base64")}`;
};

/**
 * Decrypts an encrypted string.
 * Expects base64-encoded format: iv:authTag:ciphertext
 */
export const decrypt = (encrypted: string): string => {
  const key = getMasterKey();

  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

/**
 * Checks if a value appears to be encrypted.
 * Encrypted values follow the format: base64:base64:base64
 */
export const isEncrypted = (value: string): boolean => {
  const parts = value.split(":");
  if (parts.length !== 3) return false;

  // Check if all parts are valid base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return parts.every((part) => base64Regex.test(part));
};
