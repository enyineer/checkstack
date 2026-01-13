import { accessPair, type AccessRule } from "@checkstack/common";

/**
 * Access rules for the BullMQ Queue plugin.
 * Uses the same permission IDs as before for backward compatibility.
 */
export const queueBullmqAccess = accessPair("queue-bullmq", {
  read: "View BullMQ queue configuration and statistics",
  manage: "Modify BullMQ queue configuration",
});

/**
 * All access rules for registration with the plugin system.
 */
export const queueBullmqAccessRules: AccessRule[] = [
  queueBullmqAccess.read,
  queueBullmqAccess.manage,
];
