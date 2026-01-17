import { describe, expect, test } from "bun:test";

/**
 * Notification Group ID Format Tests
 *
 * These tests ensure the correct format for notification group IDs.
 * The format must match what the backend creates:
 * - Format: `{pluginId}.{entityType}.{entityId}`
 * - Example: `catalog.group.855f7a1f-7287-4650-abf3-f91117e3bde1`
 *
 * Regression test for: Dashboard subscription failures due to incorrect
 * group ID format (was using colon separator and missing entity type prefix).
 */

const CATALOG_PLUGIN_ID = "catalog";

/**
 * Constructs the full notification group ID for a catalog group.
 * Must match the format created by catalog-backend notification group creation.
 */
export const getCatalogGroupNotificationId = (groupId: string) =>
  `${CATALOG_PLUGIN_ID}.group.${groupId}`;

/**
 * Constructs the full notification group ID for a catalog system.
 * Must match the format created by catalog-backend notification group creation.
 */
export const getCatalogSystemNotificationId = (systemId: string) =>
  `${CATALOG_PLUGIN_ID}.system.${systemId}`;

describe("Notification Group ID Format", () => {
  describe("getCatalogGroupNotificationId", () => {
    test("uses dot separators, not colons", () => {
      const groupId = "test-uuid";
      const result = getCatalogGroupNotificationId(groupId);

      // Must use dots, not colons
      expect(result).not.toContain(":");
      expect(result).toBe("catalog.group.test-uuid");
    });

    test("includes 'group' type prefix", () => {
      const groupId = "855f7a1f-7287-4650-abf3-f91117e3bde1";
      const result = getCatalogGroupNotificationId(groupId);

      // Must include the entity type
      expect(result).toContain(".group.");
      expect(result).toBe("catalog.group.855f7a1f-7287-4650-abf3-f91117e3bde1");
    });

    test("follows {pluginId}.{entityType}.{entityId} format", () => {
      const groupId = "my-group-id";
      const result = getCatalogGroupNotificationId(groupId);

      const parts = result.split(".");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("catalog"); // pluginId
      expect(parts[1]).toBe("group"); // entityType
      expect(parts[2]).toBe("my-group-id"); // entityId
    });
  });

  describe("getCatalogSystemNotificationId", () => {
    test("uses dot separators, not colons", () => {
      const systemId = "test-uuid";
      const result = getCatalogSystemNotificationId(systemId);

      // Must use dots, not colons
      expect(result).not.toContain(":");
      expect(result).toBe("catalog.system.test-uuid");
    });

    test("includes 'system' type prefix", () => {
      const systemId = "855f7a1f-7287-4650-abf3-f91117e3bde1";
      const result = getCatalogSystemNotificationId(systemId);

      // Must include the entity type
      expect(result).toContain(".system.");
      expect(result).toBe(
        "catalog.system.855f7a1f-7287-4650-abf3-f91117e3bde1",
      );
    });

    test("follows {pluginId}.{entityType}.{entityId} format", () => {
      const systemId = "my-system-id";
      const result = getCatalogSystemNotificationId(systemId);

      const parts = result.split(".");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("catalog"); // pluginId
      expect(parts[1]).toBe("system"); // entityType
      expect(parts[2]).toBe("my-system-id"); // entityId
    });
  });

  describe("Format consistency between group and system", () => {
    test("both use same separator and structure", () => {
      const id = "test-id";
      const groupResult = getCatalogGroupNotificationId(id);
      const systemResult = getCatalogSystemNotificationId(id);

      // Same plugin prefix
      expect(groupResult.startsWith("catalog.")).toBe(true);
      expect(systemResult.startsWith("catalog.")).toBe(true);

      // Same structure (3 parts)
      expect(groupResult.split(".")).toHaveLength(3);
      expect(systemResult.split(".")).toHaveLength(3);

      // Different entity types
      expect(groupResult).toContain(".group.");
      expect(systemResult).toContain(".system.");
    });
  });
});
