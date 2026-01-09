import { z } from "zod";
import type { Migration } from "./config-versioning";
import type { LucideIconName } from "@checkmate-monitor/common";

/**
 * Migration chain for auth strategy configurations.
 */
export type AuthStrategyMigrationChain<_T> = Migration<unknown, unknown>[];

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

  /** Lucide icon name in PascalCase (e.g., 'Github', 'Chrome', 'Mail') */
  icon?: LucideIconName;

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

  /**
   * Markdown instructions shown when admins configure the strategy settings.
   * Displayed in the StrategyConfigCard before the configuration form.
   */
  adminInstructions?: string;
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
