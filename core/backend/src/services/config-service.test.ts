import { describe, it, expect, beforeAll } from "bun:test";
import { z } from "zod";
import {
  configString,
  isSecretSchema,
  DecryptionError,
  type Logger,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { encrypt, decrypt, isEncrypted } from "@checkstack/backend-api";
import { ConfigServiceImpl } from "./config-service";

describe("Secret Detection", () => {
  it("should detect direct secret fields", () => {
    const schema = configString({ "x-secret": true });
    expect(isSecretSchema(schema)).toBe(true);
  });

  it("should detect optional secret fields", () => {
    const schema = configString({ "x-secret": true }).optional();
    expect(isSecretSchema(schema)).toBe(true);
  });

  it("should not detect regular string fields", () => {
    const schema = z.string();
    expect(isSecretSchema(schema)).toBe(false);
  });

  it("should not detect optional regular string fields", () => {
    const schema = z.string().optional();
    expect(isSecretSchema(schema)).toBe(false);
  });
});

describe("Encryption and Decryption", () => {
  beforeAll(() => {
    // Set a test encryption key (32 bytes = 64 hex chars)
    process.env.ENCRYPTION_MASTER_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("should encrypt and decrypt a secret value", () => {
    const plaintext = "my-secret-value";
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertexts for the same plaintext", () => {
    const plaintext = "same-secret";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    // Different IVs should produce different ciphertexts
    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to the same value
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it("should correctly identify encrypted vs plaintext values", () => {
    const plaintext = "not-encrypted";
    const encrypted = encrypt(plaintext);

    expect(isEncrypted(plaintext)).toBe(false);
    expect(isEncrypted(encrypted)).toBe(true);
  });
});

/**
 * Captures structured logger calls so we can assert the fail-loud decrypt path
 * logs context but NEVER the ciphertext or secret value.
 */
interface CapturedLog {
  level: "info" | "error" | "warn" | "debug";
  message: string;
  args: unknown[];
}

const makeCapturingLogger = (sink: CapturedLog[]): Logger => {
  const push =
    (level: CapturedLog["level"]) =>
    (message: string, ...args: unknown[]) => {
      sink.push({ level, message, args });
    };
  return {
    info: push("info"),
    error: push("error"),
    warn: push("warn"),
    debug: push("debug"),
  };
};

/**
 * Minimal db mock whose select chain resolves to a single stored row. Only the
 * `select().from().where().limit()` path `get()` uses is implemented.
 */
const makeReadOnlyDb = (
  storedRow: { data: unknown } | undefined
): SafeDatabase<Record<string, unknown>> => {
  const chain = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit() {
      return Promise.resolve(storedRow ? [storedRow] : []);
    },
  };
  // The mock implements only the read surface ConfigService.get() touches; the
  // unused write/delete methods are never called in this test, so we model just
  // the read chain. Cast is unavoidable for a partial test double of a wide
  // interface, and is confined to test code.
  return { select: () => chain } as unknown as SafeDatabase<
    Record<string, unknown>
  >;
};

describe("ConfigService fail-loud decrypt (no ciphertext substitution)", () => {
  const TEST_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const OTHER_KEY = "abababababababababababababababababababababababababababababababab";

  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = TEST_KEY;
  });

  const schema = z.object({
    apiKey: configString({ "x-secret": true }),
  });

  it("throws a typed DecryptionError and surfaces via logger, never substituting ciphertext", async () => {
    // Encrypt under a DIFFERENT, now-unconfigured key so decrypt fails closed.
    const original = process.env.ENCRYPTION_MASTER_KEY;
    process.env.ENCRYPTION_MASTER_KEY = OTHER_KEY;
    const ciphertext = encrypt("super-secret-value");
    process.env.ENCRYPTION_MASTER_KEY = original;
    delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;

    const storedRow = {
      data: { version: 1, pluginId: "p1", data: { apiKey: ciphertext } },
    };
    const logs: CapturedLog[] = [];
    const service = new ConfigServiceImpl(
      "p1",
      makeReadOnlyDb(storedRow),
      makeCapturingLogger(logs)
    );

    // Fail CLOSED: the whole read throws a typed error.
    await expect(service.get("c1", schema, 1)).rejects.toBeInstanceOf(
      DecryptionError
    );

    // Surfaced via the structured logger at error level with context.
    const errorLog = logs.find((l) => l.level === "error");
    expect(errorLog).toBeDefined();
    expect(errorLog?.message).toContain("Failed to decrypt secret");

    // NEVER log the ciphertext or the plaintext secret value.
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(ciphertext);
    expect(serialized).not.toContain("super-secret-value");
  });

  it("decrypts normally and does NOT substitute ciphertext when the key matches", async () => {
    const ciphertext = encrypt("readable-secret");
    const storedRow = {
      data: { version: 1, pluginId: "p1", data: { apiKey: ciphertext } },
    };
    const logs: CapturedLog[] = [];
    const service = new ConfigServiceImpl(
      "p1",
      makeReadOnlyDb(storedRow),
      makeCapturingLogger(logs)
    );

    const result = await service.get("c1", schema, 1);
    expect(result?.apiKey).toBe("readable-secret");
    // The returned value must be the PLAINTEXT, never the ciphertext.
    expect(result?.apiKey).not.toBe(ciphertext);
    expect(logs.find((l) => l.level === "error")).toBeUndefined();
  });
});
