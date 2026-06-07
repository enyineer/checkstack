import { accessPair, type AccessRule } from "@checkstack/common";

/**
 * Access rules for the BullMQ Queue plugin.
 * Uses the same permission IDs as before for backward compatibility.
 */
export const queueBullmqAccess = accessPair(
  "queue-bullmq",
  {
    read: { description: "View BullMQ queue configuration and statistics" },
    manage: { description: "Modify BullMQ queue configuration" },
  },
  // Must match the backend plugin id (queue-bullmq-backend) that registers these.
  { pluginId: "queue-bullmq" },
);

/**
 * All access rules for registration with the plugin system.
 */
export const queueBullmqAccessRules: AccessRule[] = [
  queueBullmqAccess.read,
  queueBullmqAccess.manage,
];
