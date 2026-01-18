import { accessPair, type AccessRule } from "@checkstack/common";

/**
 * Access rules for the In-Memory Queue plugin.
 * Uses the same permission IDs as before for backward compatibility.
 */
export const queueMemoryAccess = accessPair("queue-memory", {
  read: { description: "View in-memory queue configuration and statistics" },
  manage: { description: "Modify in-memory queue configuration" },
});

/**
 * All access rules for registration with the plugin system.
 */
export const queueMemoryAccessRules: AccessRule[] = [
  queueMemoryAccess.read,
  queueMemoryAccess.manage,
];
