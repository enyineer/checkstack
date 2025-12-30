import { z } from "zod";
import type { ConfigMigration } from "./config-versioning";

/**
 * WeakSet to track which schemas are secrets.
 * Using WeakSet avoids memory leaks and doesn't rely on fragile internal APIs.
 */
const secretSchemas = new WeakSet<z.ZodTypeAny>();

/**
 * Custom Zod type for secret fields.
 * Uses branded type for TypeScript + WeakSet for runtime detection.
 */
export const secret = () => {
  const schema = z.string().brand<"secret">();
  secretSchemas.add(schema);
  return schema;
};

export type Secret = z.infer<ReturnType<typeof secret>>;

/**
 * Runtime check for secret-branded schemas.
 * Automatically unwraps ZodOptional to check the inner schema.
 */
export function isSecretSchema(schema: z.ZodTypeAny): boolean {
  let unwrappedSchema = schema;

  // Unwrap ZodOptional to check the inner schema
  if (unwrappedSchema instanceof z.ZodOptional) {
    unwrappedSchema = unwrappedSchema.unwrap() as z.ZodTypeAny;
  }

  return secretSchemas.has(unwrappedSchema);
}

/**
 * Migration chain for auth strategy configurations.
 */
export type AuthStrategyMigrationChain<_T> = ConfigMigration<
  unknown,
  unknown
>[];

/**
 * Defines an authentication strategy for better-auth integration.
 * Strategies provide configuration schemas for OAuth providers and other auth methods.
 */
export interface AuthStrategy<Config = unknown> {
  /** Unique identifier for the strategy (e.g., "github", "google") */
  id: string;

  /** Display name shown in UI */
  displayName: string;

  /** Optional description of the strategy */
  description?: string;

  /** Lucide icon name (e.g., "github", "chrome", "mail") */
  icon?: string;

  /** Current version of the configuration schema */
  configVersion: number;

  /** Zod validation schema for the strategy-specific config */
  configSchema: z.ZodType<Config>;

  /** Optional migrations for backward compatibility */
  migrations?: AuthStrategyMigrationChain<Config>;

  /**
   * Whether this strategy requires manual user registration via a signup form.
   * - `true` for strategies like credentials where users explicitly register
   * - `false` for strategies like social providers or LDAP where users are auto-registered on first login
   */
  requiresManualRegistration: boolean;
}

/**
 * Registry for authentication strategies.
 * Allows plugins to register custom auth strategies.
 */
export interface AuthStrategyRegistry {
  register(strategy: AuthStrategy<unknown>): void;
  getStrategy(id: string): AuthStrategy<unknown> | undefined;
  getStrategies(): AuthStrategy<unknown>[];
}
