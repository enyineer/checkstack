import { describe, it, expect, beforeAll } from "bun:test";
import { z } from "zod";
import { secret, isSecretSchema } from "@checkmate-monitor/backend-api";
import { encrypt, decrypt, isEncrypted } from "@checkmate-monitor/backend-api";

describe("Secret Detection", () => {
  it("should detect direct secret fields", () => {
    const schema = secret();
    expect(isSecretSchema(schema)).toBe(true);
  });

  it("should detect optional secret fields", () => {
    const schema = secret().optional();
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
    const encrypted = encrypt("secret");

    expect(isEncrypted(plaintext)).toBe(false);
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("should handle special characters in secrets", () => {
    const specialChars = "p@ssw0rd!#$%^&*(){}[]|\\:;\"'<>?,./~`";
    const encrypted = encrypt(specialChars);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(specialChars);
  });

  it("should handle unicode in secrets", () => {
    const unicode = "密码🔐🔑";
    const encrypted = encrypt(unicode);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(unicode);
  });
});

describe("Config Service Secret Handling", () => {
  beforeAll(() => {
    // Set test encryption key
    process.env.ENCRYPTION_MASTER_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  // Helper function to create a custom mock DB with proper capturing
  function createTestMockDb({
    onInsert,
    onSelect,
  }: {
    onInsert?: (data: any) => void;
    onSelect?: () => any[];
  }) {
    const mockDb = {
      insert: () => ({
        values: (data: any) => {
          if (onInsert) onInsert(data);
          return {
            onConflictDoUpdate: () => Promise.resolve(),
            returning: () => Promise.resolve([]),
          };
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(onSelect ? onSelect() : []),
          }),
        }),
      }),
    };
    return mockDb as any;
  }

  it("should encrypt secrets when saving configuration", async () => {
    const { ConfigServiceImpl } = await import("./config-service");

    let capturedData: any;
    const mockDb = createTestMockDb({
      onInsert: (data) => {
        capturedData = data;
      },
      onSelect: () => [],
    });

    const configService = new ConfigServiceImpl("test-plugin", mockDb);

    const schema = z.object({
      apiKey: secret(),
      endpoint: z.string(),
    });

    const testData = {
      apiKey: "my-secret-api-key",
      endpoint: "https://api.example.com",
    };

    await configService.set("test-config", schema, 1, testData);

    // Verify the data was captured
    expect(capturedData).toBeDefined();
    expect(capturedData.pluginId).toBe("test-plugin");
    expect(capturedData.configId).toBe("test-config");

    // Verify that the secret is encrypted
    const versionedConfig = capturedData.data;
    expect(versionedConfig.version).toBe(1);
    expect(versionedConfig.data.apiKey).not.toBe("my-secret-api-key");
    expect(isEncrypted(versionedConfig.data.apiKey)).toBe(true);

    // Verify that non-secret fields are not encrypted
    expect(versionedConfig.data.endpoint).toBe("https://api.example.com");
  });

  it("should decrypt secrets when loading configuration", async () => {
    const { ConfigServiceImpl } = await import("./config-service");

    const schema = z.object({
      apiKey: secret(),
      endpoint: z.string(),
    });

    const encryptedApiKey = encrypt("my-secret-api-key");

    const mockDb = createTestMockDb({
      onSelect: () => [
        {
          pluginId: "test-plugin",
          configId: "test-config",
          data: {
            version: 1,
            pluginId: "test-plugin",
            data: {
              apiKey: encryptedApiKey,
              endpoint: "https://api.example.com",
            },
          },
        },
      ],
    });

    const configService = new ConfigServiceImpl("test-plugin", mockDb);
    const result = await configService.get("test-config", schema, 1);

    expect(result).toBeDefined();
    expect(result!.apiKey as string).toBe("my-secret-api-key");
    expect(result!.endpoint).toBe("https://api.example.com");
  });

  it("should redact secrets when getting redacted configuration", async () => {
    const { ConfigServiceImpl } = await import("./config-service");

    const schema = z.object({
      apiKey: secret(),
      endpoint: z.string(),
    });

    const encryptedApiKey = encrypt("my-secret-api-key");

    const mockDb = createTestMockDb({
      onSelect: () => [
        {
          pluginId: "test-plugin",
          configId: "test-config",
          data: {
            version: 1,
            pluginId: "test-plugin",
            data: {
              apiKey: encryptedApiKey,
              endpoint: "https://api.example.com",
            },
          },
        },
      ],
    });

    const configService = new ConfigServiceImpl("test-plugin", mockDb);
    const result = await configService.getRedacted("test-config", schema, 1);

    expect(result).toBeDefined();
    // Secret field should be removed
    expect(result!.apiKey).toBeUndefined();
    // Non-secret field should be present
    expect(result!.endpoint).toBe("https://api.example.com");
  });

  it("should handle optional secret fields that are not provided", async () => {
    const { ConfigServiceImpl } = await import("./config-service");

    let capturedData: any;
    const mockDb = createTestMockDb({
      onInsert: (data) => {
        capturedData = data;
      },
      onSelect: () => [],
    });

    const configService = new ConfigServiceImpl("test-plugin", mockDb);

    const schema = z.object({
      apiKey: secret().optional(),
      endpoint: z.string(),
    });

    const testData = {
      endpoint: "https://api.example.com",
    };

    await configService.set("test-config", schema, 1, testData);

    // Verify the data was captured
    expect(capturedData).toBeDefined();

    // Verify that the optional secret field is not present
    const versionedConfig = capturedData.data;
    expect(versionedConfig.data.apiKey).toBeUndefined();
    expect(versionedConfig.data.endpoint).toBe("https://api.example.com");
  });

  it("should preserve existing secrets when new value is empty", async () => {
    const { ConfigServiceImpl } = await import("./config-service");

    const schema = z.object({
      apiKey: secret(),
      endpoint: z.string(),
    });

    const existingEncryptedKey = encrypt("existing-secret");

    let capturedData: any;
    const mockDb = createTestMockDb({
      onInsert: (data) => {
        capturedData = data;
      },
      onSelect: () => [
        {
          pluginId: "test-plugin",
          configId: "test-config",
          data: {
            version: 1,
            pluginId: "test-plugin",
            data: {
              apiKey: existingEncryptedKey,
              endpoint: "https://api.example.com",
            },
          },
        },
      ],
    });

    const configService = new ConfigServiceImpl("test-plugin", mockDb);

    // Update with whitespace-only secret (should preserve existing)
    // Using whitespace because completely omitting the field would fail schema validation
    const updatedData = {
      apiKey: " ", // Whitespace should be trimmed and treated as empty
      endpoint: "https://api.updated.com",
    } as any;

    await configService.set("test-config", schema, 1, updatedData);

    // Verify the data was captured
    expect(capturedData).toBeDefined();

    // Verify that the existing encrypted secret is preserved
    const versionedConfig = capturedData.data;
    expect(versionedConfig.data.apiKey).toBe(existingEncryptedKey);
    expect(versionedConfig.data.endpoint).toBe("https://api.updated.com");
  });

  it("should handle nested objects with secrets", async () => {
    const { ConfigServiceImpl } = await import("./config-service");

    let capturedData: any;
    let selectCallCount = 0;
    const mockDb = {
      insert: () => ({
        values: (data: any) => {
          capturedData = data;
          return {
            onConflictDoUpdate: () => Promise.resolve(),
            returning: () => Promise.resolve([]),
          };
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              selectCallCount++;
              if (selectCallCount === 1) {
                // First call during set() - no existing config
                return Promise.resolve([]);
              } else {
                // Second call during get() - return saved config
                return Promise.resolve([
                  {
                    pluginId: "test-plugin",
                    configId: "test-config",
                    data: capturedData.data,
                  },
                ]);
              }
            },
          }),
        }),
      }),
    };

    const configService = new ConfigServiceImpl("test-plugin", mockDb as any);

    const schema = z.object({
      database: z.object({
        host: z.string(),
        password: secret(),
      }),
      endpoint: z.string(),
    });

    const testData = {
      database: {
        host: "localhost",
        password: "super-secret-password",
      },
      endpoint: "https://api.example.com",
    };

    await configService.set("test-config", schema, 1, testData);

    // Verify the data was captured
    expect(capturedData).toBeDefined();

    // Verify that the nested secret is encrypted
    const versionedConfig = capturedData.data;
    expect(versionedConfig.data.database.host).toBe("localhost");
    expect(versionedConfig.data.database.password).not.toBe(
      "super-secret-password"
    );
    expect(isEncrypted(versionedConfig.data.database.password)).toBe(true);
    expect(versionedConfig.data.endpoint).toBe("https://api.example.com");

    // Test decryption of nested secrets
    const result = await configService.get("test-config", schema, 1);

    expect(result).toBeDefined();
    expect(result!.database.host).toBe("localhost");
    expect(result!.database.password as string).toBe("super-secret-password");
    expect(result!.endpoint).toBe("https://api.example.com");
  });
});
