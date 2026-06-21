import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import crypto from "node:crypto";
import { encrypt, decrypt, isEncrypted, DecryptionError } from "./encryption";

// A fixed, valid 32-byte master key for the test process.
const TEST_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

beforeAll(() => {
  process.env.ENCRYPTION_MASTER_KEY = TEST_KEY;
});

afterEach(() => {
  // Restore the default single-key setup so tests are independent.
  process.env.ENCRYPTION_MASTER_KEY = TEST_KEY;
  delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;
});

describe("encryption (AES-256-GCM)", () => {
  it("round-trips a plaintext value", () => {
    const plaintext = "super-secret-token-🔐";
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces a UNIQUE nonce/IV for every encryption of the same plaintext", () => {
    const plaintext = "same-input";
    const ivs = new Set<string>();
    const ciphertexts = new Set<string>();

    for (let i = 0; i < 200; i++) {
      const out = encrypt(plaintext);
      const [iv, , ciphertext] = out.split(":");
      ivs.add(iv);
      ciphertexts.add(ciphertext);
      // Every IV must decode to exactly 12 bytes.
      expect(Buffer.from(iv, "base64").length).toBe(12);
    }

    // No IV may ever repeat — reuse under the same key breaks GCM.
    expect(ivs.size).toBe(200);
    // Distinct IVs => distinct ciphertexts for identical plaintext.
    expect(ciphertexts.size).toBe(200);
  });

  it("emits a full 16-byte (128-bit) GCM auth tag", () => {
    const [, authTag] = encrypt("x").split(":");
    expect(Buffer.from(authTag, "base64").length).toBe(16);
  });

  it("rejects a tampered ciphertext (auth tag verification fails)", () => {
    const encrypted = encrypt("integrity-protected");
    const [iv, authTag, ciphertext] = encrypted.split(":");

    // Flip a byte in the ciphertext.
    const ctBuf = Buffer.from(ciphertext, "base64");
    ctBuf[0] = ctBuf[0] ^ 0xff;
    const tampered = `${iv}:${authTag}:${ctBuf.toString("base64")}`;

    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const encrypted = encrypt("integrity-protected");
    const [iv, authTag, ciphertext] = encrypted.split(":");

    const tagBuf = Buffer.from(authTag, "base64");
    tagBuf[0] = tagBuf[0] ^ 0xff;
    const tampered = `${iv}:${tagBuf.toString("base64")}:${ciphertext}`;

    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects a value with a short (truncated) auth tag", () => {
    const encrypted = encrypt("v");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    // Truncate the tag to 8 bytes — GCM would accept it, we must not.
    const shortTag = Buffer.from(authTag, "base64").subarray(0, 8);
    const bad = `${iv}:${shortTag.toString("base64")}:${ciphertext}`;
    expect(() => decrypt(bad)).toThrow(/auth tag length/);
  });

  it("rejects a value with a wrong-length IV", () => {
    const encrypted = encrypt("v");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const shortIv = Buffer.from(iv, "base64").subarray(0, 8);
    const bad = `${shortIv.toString("base64")}:${authTag}:${ciphertext}`;
    expect(() => decrypt(bad)).toThrow(/IV length/);
  });

  it("fails to decrypt with a different key", () => {
    const encrypted = encrypt("bound-to-key");
    const original = process.env.ENCRYPTION_MASTER_KEY;
    try {
      process.env.ENCRYPTION_MASTER_KEY = crypto
        .randomBytes(32)
        .toString("hex");
      expect(() => decrypt(encrypted)).toThrow();
    } finally {
      process.env.ENCRYPTION_MASTER_KEY = original;
    }
  });

  it("rejects malformed formats", () => {
    expect(() => decrypt("not-encrypted")).toThrow("Invalid encrypted format");
    expect(() => decrypt("only:two")).toThrow("Invalid encrypted format");
  });

  it("throws a typed DecryptionError (not a bare Error) on failure", () => {
    expect(() => decrypt("not-encrypted")).toThrow(DecryptionError);
  });
});

describe("encryption key rotation (multi-key decrypt)", () => {
  const OLD_KEY = "11".repeat(32);
  const NEW_KEY = "22".repeat(32);

  it("decrypts a value encrypted under a PREVIOUS key after primary rotation", () => {
    // Encrypt under the old key (acting as the current primary).
    process.env.ENCRYPTION_MASTER_KEY = OLD_KEY;
    const ciphertext = encrypt("rotated-secret");

    // Rotate: new primary, old key demoted to the previous list.
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = OLD_KEY;

    // The new primary cannot authenticate it, but the previous key can.
    expect(decrypt(ciphertext)).toBe("rotated-secret");
  });

  it("tries previous keys IN ORDER and succeeds on a later one", () => {
    const KEY_A = "33".repeat(32);
    const KEY_B = "44".repeat(32);

    process.env.ENCRYPTION_MASTER_KEY = KEY_B;
    const ciphertext = encrypt("multi-previous");

    // Primary NEW_KEY fails, first previous KEY_A fails, second previous KEY_B works.
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = `${KEY_A},${KEY_B}`;

    expect(decrypt(ciphertext)).toBe("multi-previous");
  });

  it("prefers the PRIMARY key when it can decrypt (no previous fallback needed)", () => {
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    const ciphertext = encrypt("primary-value");
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = OLD_KEY;
    expect(decrypt(ciphertext)).toBe("primary-value");
  });

  it("raises DecryptionError only when ALL configured keys fail", () => {
    process.env.ENCRYPTION_MASTER_KEY = OLD_KEY;
    const ciphertext = encrypt("orphaned-secret");

    // Neither the new primary nor the configured previous key matches.
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = "55".repeat(32);

    expect(() => decrypt(ciphertext)).toThrow(DecryptionError);
    expect(() => decrypt(ciphertext)).toThrow(/all configured keys/);
  });

  it("tolerates empty entries in the previous-key list", () => {
    process.env.ENCRYPTION_MASTER_KEY = OLD_KEY;
    const ciphertext = encrypt("trailing-comma");
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = `${OLD_KEY}, ,`;
    expect(decrypt(ciphertext)).toBe("trailing-comma");
  });

  it("rejects an invalid previous key (length) instead of silently ignoring it", () => {
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = "deadbeef";
    expect(() => decrypt(encrypt("x"))).toThrow(/ENCRYPTION_MASTER_KEY_PREVIOUS/);
  });

  it("encrypt always uses the PRIMARY key (old single-key ciphertext stays decodable)", () => {
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    const ciphertext = encrypt("new-primary-encryption");
    // A pure single-key setup with only the new key must decode it.
    delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;
    expect(decrypt(ciphertext)).toBe("new-primary-encryption");
  });
});

describe("isEncrypted", () => {
  it("recognises real encrypted values", () => {
    expect(isEncrypted(encrypt("hello"))).toBe(true);
  });

  it("rejects plaintext", () => {
    expect(isEncrypted("plaintext")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });

  it("does NOT treat a colon-shaped plaintext token as encrypted", () => {
    // A secret that merely resembles iv:tag:ct in shape but whose decoded
    // lengths are wrong must NOT be classified as encrypted — otherwise
    // ConfigService would store it in PLAINTEXT.
    expect(isEncrypted("aGVsbG8=:d29ybGQ=:Zm9vYmFy")).toBe(false);
    expect(isEncrypted("user:pass:token")).toBe(false);
  });

  it("rejects three-part values with wrong IV length", () => {
    const real = encrypt("v");
    const [, authTag, ciphertext] = real.split(":");
    const shortIv = Buffer.from("short").toString("base64");
    expect(isEncrypted(`${shortIv}:${authTag}:${ciphertext}`)).toBe(false);
  });
});
