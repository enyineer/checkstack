import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  ConfigService,
  VersionedConfig,
  ConfigMigration,
  encrypt,
  decrypt,
  isEncrypted,
  isSecretSchema,
} from "@checkmate/backend-api";
import { pluginConfigs } from "../schema";
import { ConfigMigrationRunner } from "./config-migration-runner";

/**
 * Implementation of ConfigService.
 * Provides plugin-scoped configuration management with automatic secret handling.
 */
export class ConfigServiceImpl implements ConfigService {
  private readonly migrationRunner = new ConfigMigrationRunner();

  constructor(
    private readonly pluginId: string,
    private readonly db: NodePgDatabase<Record<string, unknown>>
  ) {}

  /**
   * Recursively encrypt secret fields in a config object.
   */
  private encryptSecrets(
    schema: z.ZodTypeAny,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    if (!("shape" in schema)) return data;

    const objectSchema = schema as z.ZodObject<z.ZodRawShape>;
    const result: Record<string, unknown> = { ...data };

    for (const [key, fieldSchema] of Object.entries(objectSchema.shape)) {
      const value = data[key];

      if (isSecretSchema(fieldSchema as z.ZodTypeAny)) {
        // Encrypt secret field (only if not already encrypted)
        if (
          typeof value === "string" &&
          value.trim() !== "" &&
          !isEncrypted(value)
        ) {
          result[key] = encrypt(value);
        }
      } else if (
        typeof value === "object" &&
        value !== null &&
        fieldSchema instanceof z.ZodObject
      ) {
        // Recursively handle nested objects
        result[key] = this.encryptSecrets(
          fieldSchema,
          value as Record<string, unknown>
        );
      } else if (
        typeof value === "object" &&
        value !== null &&
        fieldSchema instanceof z.ZodArray &&
        Array.isArray(value) &&
        fieldSchema.element instanceof z.ZodObject
      ) {
        // Handle arrays of objects
        result[key] = value.map((item) =>
          this.encryptSecrets(fieldSchema.element as z.ZodTypeAny, item)
        );
      }
    }

    return result;
  }

  /**
   * Recursively decrypt secret fields in a config object.
   */
  private decryptSecrets(
    schema: z.ZodTypeAny,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    if (!("shape" in schema)) return data;

    const objectSchema = schema as z.ZodObject<z.ZodRawShape>;
    const result: Record<string, unknown> = { ...data };

    for (const [key, fieldSchema] of Object.entries(objectSchema.shape)) {
      const value = data[key];

      if (isSecretSchema(fieldSchema as z.ZodTypeAny)) {
        // Decrypt secret field
        if (typeof value === "string" && isEncrypted(value)) {
          try {
            result[key] = decrypt(value);
          } catch (error) {
            console.error(`Failed to decrypt secret for key ${key}:`, error);
            result[key] = value; // Preserve encrypted value if decryption fails
          }
        }
      } else if (
        typeof value === "object" &&
        value !== null &&
        fieldSchema instanceof z.ZodObject
      ) {
        // Recursively handle nested objects
        result[key] = this.decryptSecrets(
          fieldSchema,
          value as Record<string, unknown>
        );
      } else if (
        typeof value === "object" &&
        value !== null &&
        fieldSchema instanceof z.ZodArray &&
        Array.isArray(value) &&
        fieldSchema.element instanceof z.ZodObject
      ) {
        // Handle arrays of objects
        result[key] = value.map((item) =>
          this.decryptSecrets(fieldSchema.element as z.ZodTypeAny, item)
        );
      }
    }

    return result;
  }

  /**
   * Remove secret fields from a config object.
   */
  private redactSecrets(
    schema: z.ZodTypeAny,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    if (!("shape" in schema)) return data;

    const objectSchema = schema as z.ZodObject<z.ZodRawShape>;
    const result: Record<string, unknown> = { ...data };

    for (const [key, fieldSchema] of Object.entries(objectSchema.shape)) {
      if (isSecretSchema(fieldSchema as z.ZodTypeAny)) {
        // Remove secret fields entirely
        delete result[key];
      }
    }

    return result;
  }

  async set<T>(
    configId: string,
    schema: z.ZodType<T>,
    version: number,
    data: T,
    _migrations?: ConfigMigration<unknown, unknown>[]
  ): Promise<void> {
    // Get existing config if any
    const existing = await this.db
      .select()
      .from(pluginConfigs)
      .where(
        and(
          eq(pluginConfigs.pluginId, this.pluginId),
          eq(pluginConfigs.configId, configId)
        )
      )
      .limit(1);

    const existingVersionedConfig = existing[0]?.data as
      | VersionedConfig<Record<string, unknown>>
      | undefined;

    // Merge with existing secrets (preserve unchanged secrets)
    let processedData = data as Record<string, unknown>;
    if (existingVersionedConfig && "shape" in schema) {
      const objectSchema = schema as z.ZodObject<z.ZodRawShape>;
      const result: Record<string, unknown> = { ...processedData };

      for (const [key, fieldSchema] of Object.entries(objectSchema.shape)) {
        if (isSecretSchema(fieldSchema as z.ZodTypeAny)) {
          const newValue = processedData[key];

          if (typeof newValue === "string" && newValue.trim() !== "") {
            // New secret value provided - will be encrypted below
          } else if (existingVersionedConfig.data[key]) {
            // Preserve existing encrypted value
            result[key] = existingVersionedConfig.data[key];
          }
        }
      }

      processedData = result;
    }

    // Encrypt secrets
    const encryptedData = this.encryptSecrets(schema, processedData);

    // Create versioned config
    const versionedConfig: VersionedConfig<Record<string, unknown>> = {
      version,
      pluginId: this.pluginId,
      data: encryptedData,
    };

    // Upsert to database
    await this.db
      .insert(pluginConfigs)
      .values({
        pluginId: this.pluginId,
        configId,
        data: versionedConfig as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pluginConfigs.pluginId, pluginConfigs.configId],
        set: {
          data: versionedConfig as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });
  }

  async get<T>(
    configId: string,
    schema: z.ZodType<T>,
    version: number,
    migrations?: ConfigMigration<unknown, unknown>[]
  ): Promise<T | undefined> {
    const result = await this.db
      .select()
      .from(pluginConfigs)
      .where(
        and(
          eq(pluginConfigs.pluginId, this.pluginId),
          eq(pluginConfigs.configId, configId)
        )
      )
      .limit(1);

    if (result.length === 0) return undefined;

    let versionedConfig = result[0].data as VersionedConfig<
      Record<string, unknown>
    >;

    // Run migrations if needed
    if (migrations && versionedConfig.version !== version) {
      versionedConfig = (await this.migrationRunner.migrate(
        versionedConfig as VersionedConfig,
        version,
        migrations
      )) as VersionedConfig<Record<string, unknown>>;
    }

    // Decrypt secrets
    const decryptedData = this.decryptSecrets(schema, versionedConfig.data);

    // Validate with schema
    return schema.parse(decryptedData);
  }

  async getRedacted<T>(
    configId: string,
    schema: z.ZodType<T>,
    version: number,
    migrations?: ConfigMigration<unknown, unknown>[]
  ): Promise<Partial<T> | undefined> {
    const result = await this.db
      .select()
      .from(pluginConfigs)
      .where(
        and(
          eq(pluginConfigs.pluginId, this.pluginId),
          eq(pluginConfigs.configId, configId)
        )
      )
      .limit(1);

    if (result.length === 0) return undefined;

    let versionedConfig = result[0].data as VersionedConfig<
      Record<string, unknown>
    >;

    // Run migrations if needed
    if (migrations && versionedConfig.version !== version) {
      versionedConfig = (await this.migrationRunner.migrate(
        versionedConfig as VersionedConfig,
        version,
        migrations
      )) as VersionedConfig<Record<string, unknown>>;
    }

    // Redact secrets (don't decrypt)
    const redactedData = this.redactSecrets(schema, versionedConfig.data);

    return redactedData as Partial<T>;
  }

  async delete(configId: string): Promise<void> {
    await this.db
      .delete(pluginConfigs)
      .where(
        and(
          eq(pluginConfigs.pluginId, this.pluginId),
          eq(pluginConfigs.configId, configId)
        )
      );
  }

  async list(): Promise<string[]> {
    const results = await this.db
      .select({ configId: pluginConfigs.configId })
      .from(pluginConfigs)
      .where(eq(pluginConfigs.pluginId, this.pluginId));

    return results.map((r) => r.configId);
  }
}
