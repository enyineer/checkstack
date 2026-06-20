import { decrypt, encrypt, isEncrypted } from "@checkstack/backend-api";

/**
 * Operator tooling to re-encrypt every stored at-rest secret onto the CURRENT
 * primary `ENCRYPTION_MASTER_KEY`.
 *
 * ## Why this exists
 *
 * Key rotation is non-breaking at READ time: `decrypt()` trial-decrypts with the
 * primary key, then each `ENCRYPTION_MASTER_KEY_PREVIOUS` key. But as long as a
 * value is still encrypted under an OLD key you can never DROP that old key.
 * This routine walks the stored ciphertext, decrypts it (using whichever
 * configured key authenticates) and re-encrypts it with the primary key, so
 * afterwards the operator can safely remove the demoted key from the previous
 * list.
 *
 * ## What is covered
 *
 * - The local secret backend (`secrets` table) - the `encryptedValue` column.
 * - Config-service `x-secret` fields (`plugin_configs` table) - every string
 *   value anywhere in the stored JSON that is structurally an
 *   `iv:authTag:ciphertext` value (detected with the strict {@link isEncrypted}
 *   check). This is schema-agnostic on purpose: the walker has no access to each
 *   plugin's Zod schema, but `isEncrypted()` only matches genuine ciphertext, so
 *   re-encrypting exactly those values is safe and never mangles plaintext.
 *
 * ## What is NOT covered
 *
 * - Secrets held in EXTERNAL backends (e.g. HashiCorp Vault). Those are not
 *   encrypted by this module's key at all - rotate them through the backend's
 *   own mechanism.
 * - Any other plugin-owned table that stores ciphertext outside the two stores
 *   above. None exist today; if one is added, extend this walker.
 *
 * ## Safety
 *
 * - Pure of I/O: the walk logic here only transforms strings via
 *   {@link decrypt}/{@link encrypt}. Storage access is injected so it is fully
 *   unit-testable with a mock. It never logs key material, ciphertext, or
 *   plaintext.
 * - A value that fails to decrypt under ALL configured keys propagates the
 *   `DecryptionError` from {@link decrypt}; the caller decides whether to abort
 *   or continue, and the row is reported as failed.
 */

/** A re-encryptable secret row from the local `secrets` table. */
export interface SecretValueRow {
  id: string;
  encryptedValue: string;
}

/** A re-encryptable config row from the `plugin_configs` table. */
export interface PluginConfigRow {
  pluginId: string;
  configId: string;
  data: unknown;
}

/** Storage operations the walker needs. Injected so it is mockable in tests. */
export interface ReencryptStore {
  listSecretRows(): Promise<SecretValueRow[]>;
  updateSecretValue(args: { id: string; encryptedValue: string }): Promise<void>;
  listPluginConfigRows(): Promise<PluginConfigRow[]>;
  updatePluginConfigData(args: {
    pluginId: string;
    configId: string;
    data: unknown;
  }): Promise<void>;
}

/** Per-store tally of what the walk touched. */
export interface ReencryptCounts {
  /** Rows scanned. */
  scanned: number;
  /** Rows that had at least one ciphertext re-encrypted onto the primary key. */
  reencrypted: number;
  /** Rows skipped because they held no (or empty) ciphertext. */
  skipped: number;
  /**
   * Identifiers of rows whose ciphertext could not be decrypted with ANY
   * configured key. These are surfaced, never silently passed through.
   */
  failed: string[];
}

export interface ReencryptResult {
  secrets: ReencryptCounts;
  pluginConfigs: ReencryptCounts;
}

/** Re-encrypt one ciphertext string onto the primary key. */
const rotateValue = (value: string): string => encrypt(decrypt(value));

/**
 * Recursively walk a JSON value and re-encrypt every string that is structurally
 * an encrypted value. Returns the transformed value plus whether anything
 * changed and any decrypt failures (by JSON path) encountered.
 */
const rotateJsonValue = (
  value: unknown,
  path: string
): { value: unknown; changed: boolean; failures: string[] } => {
  if (typeof value === "string") {
    if (!isEncrypted(value)) return { value, changed: false, failures: [] };
    try {
      return { value: rotateValue(value), changed: true, failures: [] };
    } catch {
      return { value, changed: false, failures: [path || "(root)"] };
    }
  }

  if (Array.isArray(value)) {
    let changed = false;
    const failures: string[] = [];
    const next = value.map((item, index) => {
      const r = rotateJsonValue(item, `${path}[${index}]`);
      if (r.changed) changed = true;
      failures.push(...r.failures);
      return r.value;
    });
    return { value: changed ? next : value, changed, failures };
  }

  if (value !== null && typeof value === "object") {
    let changed = false;
    const failures: string[] = [];
    const entries = Object.entries(value);
    const next: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      const r = rotateJsonValue(item, path ? `${path}.${key}` : key);
      if (r.changed) changed = true;
      failures.push(...r.failures);
      next[key] = r.value;
    }
    return { value: changed ? next : value, changed, failures };
  }

  return { value, changed: false, failures: [] };
};

/**
 * Re-encrypt every stored secret onto the current primary key. Storage access
 * is injected via {@link ReencryptStore} so this is unit-testable without a DB.
 */
export const reencryptAllSecrets = async ({
  store,
}: {
  store: ReencryptStore;
}): Promise<ReencryptResult> => {
  // --- Local secret backend (`secrets` table) ---
  const secretRows = await store.listSecretRows();
  const secrets: ReencryptCounts = {
    scanned: secretRows.length,
    reencrypted: 0,
    skipped: 0,
    failed: [],
  };
  for (const row of secretRows) {
    if (!row.encryptedValue || !isEncrypted(row.encryptedValue)) {
      secrets.skipped += 1;
      continue;
    }
    try {
      const encryptedValue = rotateValue(row.encryptedValue);
      await store.updateSecretValue({ id: row.id, encryptedValue });
      secrets.reencrypted += 1;
    } catch {
      secrets.failed.push(row.id);
    }
  }

  // --- Config-service `x-secret` fields (`plugin_configs` table) ---
  const configRows = await store.listPluginConfigRows();
  const pluginConfigs: ReencryptCounts = {
    scanned: configRows.length,
    reencrypted: 0,
    skipped: 0,
    failed: [],
  };
  for (const row of configRows) {
    const { value, changed, failures } = rotateJsonValue(row.data, "");
    const rowKey = `${row.pluginId}/${row.configId}`;
    if (failures.length > 0) {
      pluginConfigs.failed.push(rowKey);
    }
    if (changed) {
      await store.updatePluginConfigData({
        pluginId: row.pluginId,
        configId: row.configId,
        data: value,
      });
      pluginConfigs.reencrypted += 1;
    } else if (failures.length === 0) {
      pluginConfigs.skipped += 1;
    }
  }

  return { secrets, pluginConfigs };
};
