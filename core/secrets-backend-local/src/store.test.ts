// AES-256 needs a 32-byte (64 hex char) key. Set before importing the
// encryption module so module-eval-time encrypt() calls succeed.
process.env.ENCRYPTION_MASTER_KEY = "11".repeat(32);

import { describe, it, expect } from "bun:test";
import { encrypt, decrypt } from "@checkstack/backend-api";
import { toSecretMetadata, LOCAL_SECRET_BACKEND_ID } from "./store";
import type * as schema from "./schema";

describe("local backend encryption round-trip", () => {
  it("encrypts then decrypts a value back to the original", () => {
    const value = "gh_aBcDeF123456-with-special/chars=&";
    const stored = encrypt(value);
    expect(stored).not.toContain(value);
    expect(decrypt(stored)).toBe(value);
  });

  it("produces a different ciphertext per encrypt (random IV)", () => {
    const a = encrypt("same-plaintext-value");
    const b = encrypt("same-plaintext-value");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same-plaintext-value");
    expect(decrypt(b)).toBe("same-plaintext-value");
  });
});

describe("toSecretMetadata (no-value-leak guarantee)", () => {
  const baseRow: typeof schema.secrets.$inferSelect = {
    id: "id-1",
    name: "api_key",
    encryptedValue: encrypt("supersecretvalue"),
    description: "An API key",
    createdBy: "user-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  };

  it("exposes metadata + hasValue but never the value", () => {
    const meta = toSecretMetadata(baseRow);
    expect(meta.name).toBe("api_key");
    expect(meta.hasValue).toBe(true);
    expect(meta.backend).toBe(LOCAL_SECRET_BACKEND_ID);
    // The serialized DTO must not contain the value or the ciphertext.
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("supersecretvalue");
    expect(serialized).not.toContain(baseRow.encryptedValue);
    // The metadata shape has no `value` / `encryptedValue` keys.
    expect("value" in meta).toBe(false);
    expect("encryptedValue" in meta).toBe(false);
  });

  it("reports hasValue=false for an empty stored value", () => {
    const meta = toSecretMetadata({ ...baseRow, encryptedValue: "" });
    expect(meta.hasValue).toBe(false);
  });
});
