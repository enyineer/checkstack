import { z } from "zod";
import type { Migration } from "./config-versioning";
import type { IconName } from "@checkstack/common";

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

  /**
   * Icon name in PascalCase. A lucide icon (e.g. 'Mail') or a vendored brand
   * icon (e.g. 'Github') - see `IconName` / `DynamicIcon`.
   */
  icon?: IconName;

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

  /**
   * Defines how the frontend should interact with this strategy during login.
   * If not provided, it defaults to 'oauth' for non-credential strategies.
   */
  clientFlow?: AuthClientFlow;
}

/**
 * Defines the interaction pattern for the frontend during login.
 */
export type AuthClientFlow =
  | { type: "oauth" } // Standard Better-Auth social flow
  | { type: "redirect"; target: string } // Redirects user to a custom URL
  | {
      type: "form";
      target: string;
      fields: Array<{
        name: string;
        label: string;
        type: "text" | "password";
        placeholder?: string;
      }>;
    } // Custom credential collection form
  | { type: "credential" }; // Native internal credential flow (internal only)

/**
 * Registry for authentication strategies.
 * Allows plugins to register custom auth strategies.
 */
export interface AuthStrategyRegistry {
  register(strategy: AuthStrategy<unknown>): void;
  getStrategy(id: string): AuthStrategy<unknown> | undefined;
  getStrategies(): AuthStrategy<unknown>[];
}
