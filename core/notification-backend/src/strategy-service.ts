/**
 * Strategy Service
 *
 * Manages notification strategy configuration (admin) and user preferences (per-user).
 * Uses ConfigService for automatic secret encryption on OAuth tokens.
 */

import { z } from "zod";
import {
  configBoolean,
  configString,
  type ConfigService,
} from "@checkstack/backend-api";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { NotificationStrategyRegistry } from "@checkstack/backend-api";
import type * as schema from "./schema";

// Config ID patterns (module-level for lint compliance)
const strategyConfigId = (strategyId: string): string =>
  `strategy.${strategyId}.config`;
const strategyLayoutConfigId = (strategyId: string): string =>
  `strategy.${strategyId}.layoutConfig`;
const strategyMetaId = (strategyId: string): string =>
  `strategy.${strategyId}.meta`;
const userPreferenceId = (userId: string, strategyId: string): string =>
  `user-pref.${userId}.${strategyId}`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User Preference Schema (with secret-branded tokens)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Schema for user notification preferences stored via ConfigService.
 * Tokens are marked with x-secret for automatic encryption.
 */
export const UserPreferenceConfigSchema = z.object({
  /** Whether user has enabled this channel */
  enabled: configBoolean({}).default(true),
  /** User's strategy-specific config (validated via strategy.userConfig) */
  userConfig: z.record(z.string(), z.unknown()).optional(),
  /** External user ID from OAuth linking (e.g., Slack user ID) */
  externalId: configString({}).optional(),
  /** Encrypted access token for OAuth strategies */
  accessToken: configString({ "x-secret": true })
    .describe("Access token")
    .optional(),
  /** Encrypted refresh token for OAuth strategies */
  refreshToken: configString({ "x-secret": true })
    .describe("Refresh token")
    .optional(),
  /** Token expiration timestamp (ISO string) */
  tokenExpiresAt: configString({}).optional(),
  /** When the external account was linked (ISO string) */
  linkedAt: configString({}).optional(),
});

export type UserPreferenceConfig = z.infer<typeof UserPreferenceConfigSchema>;

const USER_PREFERENCE_VERSION = 1;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Strategy Config Schema (admin settings)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Meta-config for strategy enabled state (follows auth strategy pattern).
 */
export const StrategyMetaConfigSchema = z.object({
  enabled: z.boolean().default(false),
});

export type StrategyMetaConfig = z.infer<typeof StrategyMetaConfigSchema>;

const STRATEGY_META_VERSION = 1;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Service Interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface StrategyServiceDeps {
  db: SafeDatabase<typeof schema>;
  configService: ConfigService;
  strategyRegistry: NotificationStrategyRegistry;
}

export interface StrategyService {
  // ─────────────────────────────────────────────────────────────────────────
  // Admin Strategy Management
  // ─────────────────────────────────────────────────────────────────────────

  /** Get meta-config (enabled state) for a strategy */
  getStrategyMeta(strategyId: string): Promise<StrategyMetaConfig>;

  /** Update meta-config (enabled state) for a strategy */
  setStrategyMeta(strategyId: string, meta: StrategyMetaConfig): Promise<void>;

  /** Get strategy config (parsed via strategy's Versioned config) */
  getStrategyConfig<T>(strategyId: string): Promise<T | undefined>;

  /** Get strategy config redacted (for frontend - secrets stripped) */
  getStrategyConfigRedacted<T>(
    strategyId: string
  ): Promise<Partial<T> | undefined>;

  /** Set strategy config (stored via ConfigService) */
  setStrategyConfig<T>(strategyId: string, config: T): Promise<void>;

  /** Get layout config (parsed via strategy's layoutConfig schema) */
  getLayoutConfig<T>(strategyId: string): Promise<T | undefined>;

  /** Get layout config redacted (for frontend - secrets stripped) */
  getLayoutConfigRedacted<T>(
    strategyId: string
  ): Promise<Partial<T> | undefined>;

  /** Set layout config (stored via ConfigService) */
  setLayoutConfig<T>(strategyId: string, config: T): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // User Preferences
  // ─────────────────────────────────────────────────────────────────────────

  /** Get user's preference for a specific strategy (internal use - includes decrypted tokens) */
  getUserPreference(
    userId: string,
    strategyId: string
  ): Promise<UserPreferenceConfig | undefined>;

  /** Get user's preference redacted (for frontend - secrets stripped) */
  getUserPreferenceRedacted(
    userId: string,
    strategyId: string
  ): Promise<Partial<UserPreferenceConfig> | undefined>;

  /** Set/update user's preference for a specific strategy */
  setUserPreference(
    userId: string,
    strategyId: string,
    preference: Partial<UserPreferenceConfig>
  ): Promise<void>;

  /** Get all preferences for a user redacted (for frontend - secrets stripped) */
  getAllUserPreferencesRedacted(userId: string): Promise<
    Array<{
      strategyId: string;
      preference: Partial<UserPreferenceConfig>;
    }>
  >;

  /** Get all preferences for a user (includes decrypted tokens - internal use) */
  getAllUserPreferences(userId: string): Promise<
    Array<{
      strategyId: string;
      preference: UserPreferenceConfig;
    }>
  >;

  /** Delete all preferences for a user (for cleanup on user deletion) */
  deleteUserPreferences(userId: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // OAuth Token Storage
  // ─────────────────────────────────────────────────────────────────────────

  /** Store OAuth tokens for a user+strategy (encrypted via ConfigService) */
  storeOAuthTokens(params: {
    userId: string;
    strategyId: string;
    externalId: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }): Promise<void>;

  /** Clear OAuth tokens for a user+strategy */
  clearOAuthTokens(userId: string, strategyId: string): Promise<void>;

  /** Get decrypted OAuth tokens for sending notifications */
  getOAuthTokens(
    userId: string,
    strategyId: string
  ): Promise<
    | {
        externalId: string;
        accessToken: string;
        refreshToken?: string;
        expiresAt?: Date;
      }
    | undefined
  >;

  // ─────────────────────────────────────────────────────────────────────────
  // Strategy Cleanup (for strategy removal/unregistration)
  // ─────────────────────────────────────────────────────────────────────────

  /** Delete admin config for a specific strategy */
  deleteStrategyConfig(strategyId: string): Promise<void>;

  /** Delete all configs (meta + config) for a strategy - used when unregistering */
  deleteAllStrategyConfigs(strategyId: string): Promise<void>;

  /** Delete all user preferences for a specific strategy - used when removing strategy */
  deleteAllUserPreferencesForStrategy(strategyId: string): Promise<void>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Service Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a StrategyService instance.
 */
export function createStrategyService(
  deps: StrategyServiceDeps
): StrategyService {
  const { configService, strategyRegistry } = deps;

  return {
    // ─────────────────────────────────────────────────────────────────────────
    // Admin Strategy Management
    // ─────────────────────────────────────────────────────────────────────────

    async getStrategyMeta(strategyId: string): Promise<StrategyMetaConfig> {
      const meta = await configService.get(
        strategyMetaId(strategyId),
        StrategyMetaConfigSchema,
        STRATEGY_META_VERSION
      );
      return meta ?? { enabled: false };
    },

    async setStrategyMeta(
      strategyId: string,
      meta: StrategyMetaConfig
    ): Promise<void> {
      await configService.set(
        strategyMetaId(strategyId),
        StrategyMetaConfigSchema,
        STRATEGY_META_VERSION,
        meta
      );
    },

    async getStrategyConfig<T>(strategyId: string): Promise<T | undefined> {
      const strategy = strategyRegistry.getStrategy(strategyId);
      if (!strategy) return undefined;

      const versioned = strategy.config;
      const config = await configService.get(
        strategyConfigId(strategyId),
        versioned.schema,
        versioned.version,
        versioned.migrations
      );
      return config as T | undefined;
    },

    async getStrategyConfigRedacted<T>(
      strategyId: string
    ): Promise<Partial<T> | undefined> {
      const strategy = strategyRegistry.getStrategy(strategyId);
      if (!strategy) return undefined;

      const versioned = strategy.config;
      const config = await configService.getRedacted(
        strategyConfigId(strategyId),
        versioned.schema,
        versioned.version,
        versioned.migrations
      );
      return config as Partial<T> | undefined;
    },

    async setStrategyConfig<T>(strategyId: string, config: T): Promise<void> {
      const strategy = strategyRegistry.getStrategy(strategyId);
      if (!strategy) {
        throw new Error(`Strategy not found: ${strategyId}`);
      }

      const versioned = strategy.config;
      await configService.set(
        strategyConfigId(strategyId),
        versioned.schema,
        versioned.version,
        config,
        versioned.migrations
      );
    },

    async getLayoutConfig<T>(strategyId: string): Promise<T | undefined> {
      const strategy = strategyRegistry.getStrategy(strategyId);
      if (!strategy?.layoutConfig) return undefined;

      const versioned = strategy.layoutConfig;
      const config = await configService.get(
        strategyLayoutConfigId(strategyId),
        versioned.schema,
        versioned.version,
        versioned.migrations
      );
      return config as T | undefined;
    },

    async getLayoutConfigRedacted<T>(
      strategyId: string
    ): Promise<Partial<T> | undefined> {
      const strategy = strategyRegistry.getStrategy(strategyId);
      if (!strategy?.layoutConfig) return undefined;

      const versioned = strategy.layoutConfig;
      const config = await configService.getRedacted(
        strategyLayoutConfigId(strategyId),
        versioned.schema,
        versioned.version,
        versioned.migrations
      );
      return config as Partial<T> | undefined;
    },

    async setLayoutConfig<T>(strategyId: string, config: T): Promise<void> {
      const strategy = strategyRegistry.getStrategy(strategyId);
      if (!strategy?.layoutConfig) {
        throw new Error(
          `Strategy ${strategyId} does not support layout configuration`
        );
      }

      const versioned = strategy.layoutConfig;
      await configService.set(
        strategyLayoutConfigId(strategyId),
        versioned.schema,
        versioned.version,
        config,
        versioned.migrations
      );
    },

    // ─────────────────────────────────────────────────────────────────────────
    // User Preferences
    // ─────────────────────────────────────────────────────────────────────────

    async getUserPreference(
      userId: string,
      strategyId: string
    ): Promise<UserPreferenceConfig | undefined> {
      return configService.get(
        userPreferenceId(userId, strategyId),
        UserPreferenceConfigSchema,
        USER_PREFERENCE_VERSION
      );
    },

    async getUserPreferenceRedacted(
      userId: string,
      strategyId: string
    ): Promise<Partial<UserPreferenceConfig> | undefined> {
      return configService.getRedacted(
        userPreferenceId(userId, strategyId),
        UserPreferenceConfigSchema,
        USER_PREFERENCE_VERSION
      );
    },

    async setUserPreference(
      userId: string,
      strategyId: string,
      preference: Partial<UserPreferenceConfig>
    ): Promise<void> {
      const existing = await this.getUserPreference(userId, strategyId);
      const merged: UserPreferenceConfig = {
        enabled: true,
        ...existing,
        ...preference,
      };

      await configService.set(
        userPreferenceId(userId, strategyId),
        UserPreferenceConfigSchema,
        USER_PREFERENCE_VERSION,
        merged
      );
    },

    async getAllUserPreferences(userId: string): Promise<
      Array<{
        strategyId: string;
        preference: UserPreferenceConfig;
      }>
    > {
      // List all config IDs and filter for user preferences
      const allIds = await configService.list();
      const prefix = `user-pref.${userId}.`;
      const userPrefIds = allIds.filter((id) => id.startsWith(prefix));

      const results: Array<{
        strategyId: string;
        preference: UserPreferenceConfig;
      }> = [];

      for (const id of userPrefIds) {
        const strategyId = id.slice(prefix.length);
        const pref = await configService.get(
          id,
          UserPreferenceConfigSchema,
          USER_PREFERENCE_VERSION
        );
        if (pref) {
          results.push({ strategyId, preference: pref });
        }
      }

      return results;
    },

    async getAllUserPreferencesRedacted(userId: string): Promise<
      Array<{
        strategyId: string;
        preference: Partial<UserPreferenceConfig>;
      }>
    > {
      // List all config IDs and filter for user preferences
      const allIds = await configService.list();
      const prefix = `user-pref.${userId}.`;
      const userPrefIds = allIds.filter((id) => id.startsWith(prefix));

      const results: Array<{
        strategyId: string;
        preference: Partial<UserPreferenceConfig>;
      }> = [];

      for (const id of userPrefIds) {
        const strategyId = id.slice(prefix.length);
        const pref = await configService.getRedacted(
          id,
          UserPreferenceConfigSchema,
          USER_PREFERENCE_VERSION
        );
        if (pref) {
          results.push({ strategyId, preference: pref });
        }
      }

      return results;
    },

    async deleteUserPreferences(userId: string): Promise<void> {
      const allIds = await configService.list();
      const prefix = `user-pref.${userId}.`;
      const userPrefIds = allIds.filter((id) => id.startsWith(prefix));

      for (const id of userPrefIds) {
        await configService.delete(id);
      }
      // Note: Legacy userNotificationPreferences table is deprecated
      // Cleanup of that table can be done as a separate migration task
    },

    // ─────────────────────────────────────────────────────────────────────────
    // OAuth Token Storage
    // ─────────────────────────────────────────────────────────────────────────

    async storeOAuthTokens(params: {
      userId: string;
      strategyId: string;
      externalId: string;
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
    }): Promise<void> {
      await this.setUserPreference(params.userId, params.strategyId, {
        enabled: true,
        externalId: params.externalId,
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        tokenExpiresAt: params.expiresAt?.toISOString(),
        linkedAt: new Date().toISOString(),
      });
    },

    async clearOAuthTokens(userId: string, strategyId: string): Promise<void> {
      const existing = await this.getUserPreference(userId, strategyId);
      if (existing) {
        await this.setUserPreference(userId, strategyId, {
          ...existing,
          externalId: undefined,
          accessToken: undefined,
          refreshToken: undefined,
          tokenExpiresAt: undefined,
          linkedAt: undefined,
        });
      }
    },

    async getOAuthTokens(
      userId: string,
      strategyId: string
    ): Promise<
      | {
          externalId: string;
          accessToken: string;
          refreshToken?: string;
          expiresAt?: Date;
        }
      | undefined
    > {
      const pref = await this.getUserPreference(userId, strategyId);
      if (!pref?.externalId || !pref?.accessToken) {
        return undefined;
      }

      return {
        externalId: pref.externalId,
        accessToken: pref.accessToken,
        refreshToken: pref.refreshToken,
        expiresAt: pref.tokenExpiresAt
          ? new Date(pref.tokenExpiresAt)
          : undefined,
      };
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Strategy Cleanup (for strategy removal/unregistration)
    // ─────────────────────────────────────────────────────────────────────────

    async deleteStrategyConfig(strategyId: string): Promise<void> {
      await configService.delete(strategyConfigId(strategyId));
    },

    async deleteAllStrategyConfigs(strategyId: string): Promise<void> {
      // Delete meta-config (enabled state)
      await configService.delete(strategyMetaId(strategyId));
      // Delete strategy config
      await configService.delete(strategyConfigId(strategyId));
    },

    async deleteAllUserPreferencesForStrategy(
      strategyId: string
    ): Promise<void> {
      const allIds = await configService.list();
      // User preference IDs are: user-pref.{userId}.{strategyId}
      const suffix = `.${strategyId}`;
      const prefIdsForStrategy = allIds.filter(
        (id) => id.startsWith("user-pref.") && id.endsWith(suffix)
      );

      for (const id of prefIdsForStrategy) {
        await configService.delete(id);
      }
    },
  };
}
