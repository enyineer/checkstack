import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  createStrategyService,
  type StrategyService,
} from "./strategy-service";
import type {
  ConfigService,
  NotificationStrategyRegistry,
  RegisteredNotificationStrategy,
} from "@checkmate-monitor/backend-api";
import { Versioned } from "@checkmate-monitor/backend-api";
import { z } from "zod";

/**
 * Unit tests for StrategyService.
 *
 * Tests cover:
 * - Admin strategy meta-config (enabled state)
 * - Admin strategy config management
 * - User preference management (with redacted methods)
 * - OAuth token storage and retrieval
 */

// Mock ConfigService implementation (using unknown casts for test flexibility)
function createMockConfigService(): ConfigService & {
  storage: Map<string, { data: unknown; version: number }>;
} {
  const storage = new Map<string, { data: unknown; version: number }>();

  return {
    storage,
    async set(_configId, _schema, version, data) {
      storage.set(_configId, { data, version });
    },
    get: (async (configId: string) => {
      const stored = storage.get(configId);
      return stored?.data;
    }) as ConfigService["get"],
    getRedacted: (async (configId: string) => {
      const stored = storage.get(configId);
      if (!stored) return undefined;

      // Strip fields branded as secret (accessToken, refreshToken)
      const data = stored.data as Record<string, unknown>;
      const redacted = { ...data };
      delete redacted.accessToken;
      delete redacted.refreshToken;
      return redacted;
    }) as ConfigService["getRedacted"],
    async delete(configId) {
      storage.delete(configId);
    },
    async list() {
      return [...storage.keys()];
    },
  };
}

// Mock strategy for testing
const testStrategyConfig = new Versioned({
  version: 1,
  schema: z.object({
    smtpHost: z.string(),
    smtpPort: z.number(),
  }),
});

const testUserConfig = new Versioned({
  version: 1,
  schema: z.object({
    phoneNumber: z.string(),
  }),
});

function createMockRegistry(): NotificationStrategyRegistry & {
  strategies: Map<string, RegisteredNotificationStrategy<unknown, unknown>>;
} {
  const strategies = new Map<
    string,
    RegisteredNotificationStrategy<unknown, unknown>
  >();

  // Add test strategy
  strategies.set("test-plugin.smtp", {
    id: "smtp",
    qualifiedId: "test-plugin.smtp",
    ownerPluginId: "test-plugin",
    permissionId: "test-plugin.strategy.smtp.use",
    displayName: "SMTP Email",
    description: "Send emails via SMTP",
    contactResolution: { type: "auth-email" },
    config: testStrategyConfig,
    send: async () => ({ success: true }),
  } as RegisteredNotificationStrategy<unknown, unknown>);

  strategies.set("test-plugin.sms", {
    id: "sms",
    qualifiedId: "test-plugin.sms",
    ownerPluginId: "test-plugin",
    permissionId: "test-plugin.strategy.sms.use",
    displayName: "SMS",
    description: "Send SMS messages",
    contactResolution: { type: "user-config", field: "phoneNumber" },
    config: testStrategyConfig,
    userConfig: testUserConfig,
    send: async () => ({ success: true }),
  } as RegisteredNotificationStrategy<unknown, unknown>);

  return {
    strategies,
    register: mock(() => {}),
    getStrategy: (id) => strategies.get(id),
    getStrategies: () => [...strategies.values()],
    getStrategiesForUser: () => [...strategies.values()],
  };
}

// Mock database (not used since we're using ConfigService)
const mockDb = {} as Parameters<typeof createStrategyService>[0]["db"];

describe("StrategyService", () => {
  let configService: ReturnType<typeof createMockConfigService>;
  let registry: ReturnType<typeof createMockRegistry>;
  let strategyService: StrategyService;

  beforeEach(() => {
    configService = createMockConfigService();
    registry = createMockRegistry();
    strategyService = createStrategyService({
      db: mockDb,
      configService,
      strategyRegistry: registry,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Strategy Meta-Config (Admin)
  // ─────────────────────────────────────────────────────────────────────────

  describe("getStrategyMeta", () => {
    it("returns default disabled state when no config exists", async () => {
      const meta = await strategyService.getStrategyMeta("test-plugin.smtp");
      expect(meta.enabled).toBe(false);
    });

    it("returns stored enabled state", async () => {
      await strategyService.setStrategyMeta("test-plugin.smtp", {
        enabled: true,
      });

      const meta = await strategyService.getStrategyMeta("test-plugin.smtp");
      expect(meta.enabled).toBe(true);
    });
  });

  describe("setStrategyMeta", () => {
    it("stores enabled state", async () => {
      await strategyService.setStrategyMeta("test-plugin.smtp", {
        enabled: true,
      });

      const stored = configService.storage.get(
        "strategy.test-plugin.smtp.meta"
      );
      expect(stored?.data).toEqual({ enabled: true });
    });

    it("can toggle enabled state", async () => {
      await strategyService.setStrategyMeta("test-plugin.smtp", {
        enabled: true,
      });
      await strategyService.setStrategyMeta("test-plugin.smtp", {
        enabled: false,
      });

      const meta = await strategyService.getStrategyMeta("test-plugin.smtp");
      expect(meta.enabled).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // User Preferences
  // ─────────────────────────────────────────────────────────────────────────

  describe("getUserPreference", () => {
    it("returns undefined when no preference exists", async () => {
      const pref = await strategyService.getUserPreference(
        "user-123",
        "test-plugin.smtp"
      );
      expect(pref).toBeUndefined();
    });

    it("returns stored preference", async () => {
      await strategyService.setUserPreference("user-123", "test-plugin.smtp", {
        enabled: true,
      });

      const pref = await strategyService.getUserPreference(
        "user-123",
        "test-plugin.smtp"
      );
      expect(pref?.enabled).toBe(true);
    });
  });

  describe("setUserPreference", () => {
    it("stores user preference", async () => {
      await strategyService.setUserPreference("user-123", "test-plugin.sms", {
        enabled: true,
        userConfig: { phoneNumber: "+1234567890" },
      });

      const pref = await strategyService.getUserPreference(
        "user-123",
        "test-plugin.sms"
      );
      expect(pref?.userConfig).toEqual({ phoneNumber: "+1234567890" });
    });

    it("merges with existing preference", async () => {
      await strategyService.setUserPreference("user-123", "test-plugin.smtp", {
        enabled: true,
      });
      await strategyService.setUserPreference("user-123", "test-plugin.smtp", {
        userConfig: { setting: "value" },
      });

      const pref = await strategyService.getUserPreference(
        "user-123",
        "test-plugin.smtp"
      );
      expect(pref?.enabled).toBe(true);
      expect(pref?.userConfig).toEqual({ setting: "value" });
    });
  });

  describe("getUserPreferenceRedacted", () => {
    it("returns preference without secret fields", async () => {
      // Store preference with tokens
      configService.storage.set("user-pref.user-123.test-plugin.smtp", {
        data: {
          enabled: true,
          accessToken: "secret-token",
          refreshToken: "secret-refresh",
          externalId: "ext-123",
        },
        version: 1,
      });

      const pref = await strategyService.getUserPreferenceRedacted(
        "user-123",
        "test-plugin.smtp"
      );

      expect(pref?.enabled).toBe(true);
      expect(pref?.externalId).toBe("ext-123");
      expect(pref?.accessToken).toBeUndefined();
      expect(pref?.refreshToken).toBeUndefined();
    });
  });

  describe("getAllUserPreferences", () => {
    it("returns all preferences for a user", async () => {
      await strategyService.setUserPreference("user-123", "test-plugin.smtp", {
        enabled: true,
      });
      await strategyService.setUserPreference("user-123", "test-plugin.sms", {
        enabled: false,
      });

      const prefs = await strategyService.getAllUserPreferences("user-123");

      expect(prefs.length).toBe(2);
      expect(prefs.map((p) => p.strategyId).sort()).toEqual([
        "test-plugin.sms",
        "test-plugin.smtp",
      ]);
    });
  });

  describe("deleteUserPreferences", () => {
    it("deletes all preferences for a user", async () => {
      await strategyService.setUserPreference("user-123", "test-plugin.smtp", {
        enabled: true,
      });
      await strategyService.setUserPreference("user-123", "test-plugin.sms", {
        enabled: true,
      });

      await strategyService.deleteUserPreferences("user-123");

      const prefs = await strategyService.getAllUserPreferences("user-123");
      expect(prefs.length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // OAuth Token Storage
  // ─────────────────────────────────────────────────────────────────────────

  describe("storeOAuthTokens", () => {
    it("stores OAuth tokens with preference", async () => {
      const expiresAt = new Date("2025-01-01T00:00:00Z");

      await strategyService.storeOAuthTokens({
        userId: "user-123",
        strategyId: "test-plugin.slack",
        externalId: "U123ABC",
        accessToken: "xoxb-access-token",
        refreshToken: "xoxb-refresh-token",
        expiresAt,
      });

      const pref = await strategyService.getUserPreference(
        "user-123",
        "test-plugin.slack"
      );

      expect(pref?.enabled).toBe(true);
      expect(pref?.externalId).toBe("U123ABC");
      // Cast to string to bypass secret branding in test assertions
      expect(String(pref?.accessToken)).toBe("xoxb-access-token");
      expect(String(pref?.refreshToken)).toBe("xoxb-refresh-token");
      expect(pref?.linkedAt).toBeDefined();
    });
  });

  describe("getOAuthTokens", () => {
    it("returns decrypted tokens for internal use", async () => {
      await strategyService.storeOAuthTokens({
        userId: "user-123",
        strategyId: "test-plugin.slack",
        externalId: "U123ABC",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: new Date("2025-01-01T00:00:00Z"),
      });

      const tokens = await strategyService.getOAuthTokens(
        "user-123",
        "test-plugin.slack"
      );

      expect(tokens?.externalId).toBe("U123ABC");
      expect(tokens?.accessToken).toBe("access-token");
      expect(tokens?.refreshToken).toBe("refresh-token");
      expect(tokens?.expiresAt).toBeInstanceOf(Date);
    });

    it("returns undefined when no tokens exist", async () => {
      const tokens = await strategyService.getOAuthTokens(
        "user-123",
        "test-plugin.slack"
      );
      expect(tokens).toBeUndefined();
    });
  });

  describe("clearOAuthTokens", () => {
    it("clears OAuth tokens while preserving other preference data", async () => {
      await strategyService.storeOAuthTokens({
        userId: "user-123",
        strategyId: "test-plugin.slack",
        externalId: "U123ABC",
        accessToken: "access-token",
      });

      await strategyService.clearOAuthTokens("user-123", "test-plugin.slack");

      const tokens = await strategyService.getOAuthTokens(
        "user-123",
        "test-plugin.slack"
      );
      expect(tokens).toBeUndefined();

      // Preference should still exist but without tokens
      const pref = await strategyService.getUserPreference(
        "user-123",
        "test-plugin.slack"
      );
      expect(pref?.enabled).toBe(true);
      expect(pref?.accessToken).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Strategy Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  describe("deleteStrategyConfig", () => {
    it("deletes admin config for a strategy", async () => {
      // Set config first
      await strategyService.setStrategyConfig("test-plugin.smtp", {
        smtpHost: "mail.example.com",
        smtpPort: 587,
      });

      await strategyService.deleteStrategyConfig("test-plugin.smtp");

      const config = await strategyService.getStrategyConfig(
        "test-plugin.smtp"
      );
      expect(config).toBeUndefined();
    });
  });

  describe("deleteAllStrategyConfigs", () => {
    it("deletes both meta and config for a strategy", async () => {
      // Set meta and config
      await strategyService.setStrategyMeta("test-plugin.smtp", {
        enabled: true,
      });
      await strategyService.setStrategyConfig("test-plugin.smtp", {
        smtpHost: "mail.example.com",
        smtpPort: 587,
      });

      await strategyService.deleteAllStrategyConfigs("test-plugin.smtp");

      const meta = await strategyService.getStrategyMeta("test-plugin.smtp");
      const config = await strategyService.getStrategyConfig(
        "test-plugin.smtp"
      );

      expect(meta.enabled).toBe(false); // Default when not found
      expect(config).toBeUndefined();
    });
  });

  describe("deleteAllUserPreferencesForStrategy", () => {
    it("deletes all user preferences for a specific strategy", async () => {
      // Set preferences for multiple users for the same strategy
      await strategyService.setUserPreference("user-1", "test-plugin.smtp", {
        enabled: true,
      });
      await strategyService.setUserPreference("user-2", "test-plugin.smtp", {
        enabled: false,
      });
      await strategyService.setUserPreference("user-3", "test-plugin.smtp", {
        enabled: true,
      });

      // Also set a preference for a different strategy (should not be deleted)
      await strategyService.setUserPreference("user-1", "test-plugin.sms", {
        enabled: true,
      });

      await strategyService.deleteAllUserPreferencesForStrategy(
        "test-plugin.smtp"
      );

      // All smtp preferences should be deleted
      const pref1 = await strategyService.getUserPreference(
        "user-1",
        "test-plugin.smtp"
      );
      const pref2 = await strategyService.getUserPreference(
        "user-2",
        "test-plugin.smtp"
      );
      const pref3 = await strategyService.getUserPreference(
        "user-3",
        "test-plugin.smtp"
      );
      expect(pref1).toBeUndefined();
      expect(pref2).toBeUndefined();
      expect(pref3).toBeUndefined();

      // SMS preference should still exist
      const smsPref = await strategyService.getUserPreference(
        "user-1",
        "test-plugin.sms"
      );
      expect(smsPref?.enabled).toBe(true);
    });
  });
});
