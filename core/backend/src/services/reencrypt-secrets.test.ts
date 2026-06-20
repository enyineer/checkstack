// AES-256 needs a 32-byte (64 hex char) key. Set before importing the
// encryption module so module-eval-time encrypt() calls succeed.
process.env.ENCRYPTION_MASTER_KEY = "11".repeat(32);

import { describe, it, expect, afterEach } from "bun:test";
import { encrypt, decrypt } from "@checkstack/backend-api";
import {
  reencryptAllSecrets,
  type PluginConfigRow,
  type ReencryptStore,
  type SecretValueRow,
} from "./reencrypt-secrets";

const OLD_KEY = "11".repeat(32);
const NEW_KEY = "22".repeat(32);

afterEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = OLD_KEY;
  delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;
});

/** In-memory store mock recording writes, so we never touch a DB. */
const makeStore = ({
  secretRows = [],
  configRows = [],
}: {
  secretRows?: SecretValueRow[];
  configRows?: PluginConfigRow[];
}): {
  store: ReencryptStore;
  secrets: Map<string, string>;
  configs: Map<string, unknown>;
} => {
  const secrets = new Map(secretRows.map((r) => [r.id, r.encryptedValue]));
  const configs = new Map(
    configRows.map((r) => [`${r.pluginId}/${r.configId}`, r.data])
  );
  return {
    secrets,
    configs,
    store: {
      async listSecretRows() {
        return [...secrets.entries()].map(([id, encryptedValue]) => ({
          id,
          encryptedValue,
        }));
      },
      async updateSecretValue({ id, encryptedValue }) {
        secrets.set(id, encryptedValue);
      },
      async listPluginConfigRows() {
        return configRows.map((r) => ({
          pluginId: r.pluginId,
          configId: r.configId,
          data: configs.get(`${r.pluginId}/${r.configId}`),
        }));
      },
      async updatePluginConfigData({ pluginId, configId, data }) {
        configs.set(`${pluginId}/${configId}`, data);
      },
    },
  };
};

/** Decrypt as if ONLY the new primary key were configured (no fallback). */
const decryptWithNewKeyOnly = (ciphertext: string): string => {
  const previous = process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;
  const primary = process.env.ENCRYPTION_MASTER_KEY;
  process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
  delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;
  try {
    // decrypt() reads the key env vars on every call, so toggling the env is
    // enough - no module re-import needed.
    return decrypt(ciphertext);
  } finally {
    process.env.ENCRYPTION_MASTER_KEY = primary;
    if (previous === undefined) {
      delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;
    } else {
      process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = previous;
    }
  }
};

describe("reencryptAllSecrets", () => {
  it("re-encrypts an OLD-key value so it decrypts under ONLY the new primary", async () => {
    // 1. Encrypt under the old key.
    process.env.ENCRYPTION_MASTER_KEY = OLD_KEY;
    const oldCiphertext = encrypt("local-secret-value");

    // 2. Rotate: new primary, old key demoted to previous list.
    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = OLD_KEY;

    const { store, secrets } = makeStore({
      secretRows: [{ id: "s1", encryptedValue: oldCiphertext }],
    });

    const result = await reencryptAllSecrets({ store });

    expect(result.secrets.scanned).toBe(1);
    expect(result.secrets.reencrypted).toBe(1);
    expect(result.secrets.failed).toEqual([]);

    const rotated = secrets.get("s1");
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(oldCiphertext);
    // The decisive assertion: decryptable with ONLY the new primary now.
    expect(decryptWithNewKeyOnly(rotated as string)).toBe("local-secret-value");
  });

  it("re-encrypts nested x-secret fields in plugin_configs JSON", async () => {
    process.env.ENCRYPTION_MASTER_KEY = OLD_KEY;
    const secretA = encrypt("client-secret");
    const secretB = encrypt("token-in-array");

    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = OLD_KEY;

    const data = {
      version: 1,
      pluginId: "p1",
      data: {
        plainField: "not-a-secret",
        clientSecret: secretA,
        nested: { items: [{ token: secretB }] },
      },
    };

    const { store, configs } = makeStore({
      configRows: [{ pluginId: "p1", configId: "c1", data }],
    });

    const result = await reencryptAllSecrets({ store });

    expect(result.pluginConfigs.scanned).toBe(1);
    expect(result.pluginConfigs.reencrypted).toBe(1);
    expect(result.pluginConfigs.failed).toEqual([]);

    const updated = configs.get("p1/c1") as typeof data;
    // Plaintext untouched.
    expect(updated.data.plainField).toBe("not-a-secret");
    // Both ciphertexts rotated and decryptable under ONLY the new primary.
    expect(decryptWithNewKeyOnly(updated.data.clientSecret as string)).toBe(
      "client-secret"
    );
    const arr = updated.data.nested.items as Array<{ token: string }>;
    expect(decryptWithNewKeyOnly(arr[0].token)).toBe("token-in-array");
  });

  it("skips rows with no ciphertext and reports rows that fail all keys", async () => {
    process.env.ENCRYPTION_MASTER_KEY = OLD_KEY;
    const decryptable = encrypt("ok");

    // A value encrypted under a key that is NOT configured after rotation.
    process.env.ENCRYPTION_MASTER_KEY = "99".repeat(32);
    const orphan = encrypt("orphan");

    process.env.ENCRYPTION_MASTER_KEY = NEW_KEY;
    process.env.ENCRYPTION_MASTER_KEY_PREVIOUS = OLD_KEY;

    const { store } = makeStore({
      secretRows: [
        { id: "ok", encryptedValue: decryptable },
        { id: "plain", encryptedValue: "" },
        { id: "orphan", encryptedValue: orphan },
      ],
    });

    const result = await reencryptAllSecrets({ store });

    expect(result.secrets.reencrypted).toBe(1);
    expect(result.secrets.skipped).toBe(1);
    expect(result.secrets.failed).toEqual(["orphan"]);
  });
});
