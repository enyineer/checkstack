/**
 * Built-in actions shipped by automation-backend itself.
 *
 * Two actions, intentionally minimal:
 *
 *   - `log` — write a single line to the run logger. No artifact, no
 *     external delivery. The cheapest "I want to see something happened
 *     here" primitive, useful inside `choose`/`parallel` branches as a
 *     no-op placeholder until the operator wires the real action.
 *
 *   - `notify_user` — send a transactional notification to a specific
 *     user via the existing service-mode `NotificationApi.sendTransactional`
 *     RPC. Same delivery path as the integration plugin's
 *     `notification.send`; this one ships in the core automation
 *     catalog so an operator gets a built-in "notify a user" action
 *     even on a minimal install where the notification integration
 *     plugin hasn't been added.
 */
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import { NotificationApi } from "@checkstack/notification-common";

import type { ActionDefinition } from "./action-types";

// ─── log ───────────────────────────────────────────────────────────────

const logConfigSchema = z.object({
  message: z.string().min(1).describe("Message to write to the run log"),
  level: z
    .enum(["debug", "info", "warn", "error"])
    .default("info")
    .describe("Log level — surfaces with the same severity in the run-detail UI"),
});

export type LogConfig = z.infer<typeof logConfigSchema>;

export const logAction: ActionDefinition<LogConfig, undefined> = {
  id: "log",
  displayName: "Log Message",
  description: "Write a single line to the automation run's log",
  category: "Built-in",
  icon: "FileText",
  config: new Versioned({ version: 1, schema: logConfigSchema }),
  execute: async ({ config, logger }) => {
    logger[config.level](`[automation.log] ${config.message}`);
    return { success: true };
  },
};

// ─── notify_user ───────────────────────────────────────────────────────

const notifyUserConfigSchema = z.object({
  userId: z.string().min(1).describe("Target user to notify"),
  title: z.string().min(1).describe("Notification title"),
  body: z.string().min(1).describe("Notification body (supports markdown)"),
  importance: z
    .enum(["info", "warning", "critical"])
    .optional()
    .describe("Severity; defaults to 'info'"),
});

export type NotifyUserConfig = z.infer<typeof notifyUserConfigSchema>;

const notifyUserArtifactSchema = z.object({
  userId: z.string(),
  deliveredCount: z.number(),
  results: z.array(
    z.object({
      strategyId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
  ),
});

export type NotifyUserArtifact = z.infer<typeof notifyUserArtifactSchema>;

export const notifyUserArtifactType = {
  id: "notify_user_result",
  displayName: "Notify User Result",
  description:
    "Per-strategy outcome from a built-in `notify_user` automation action",
  schema: notifyUserArtifactSchema,
} as const;

/**
 * `notify_user` - send a transactional notification to a specific user.
 *
 * Calls `NotificationApi.sendTransactional` through the run's `rpcClient`,
 * which authenticates as the automation's `runAs` service account. The service
 * account therefore needs the `notification.send` access rule; without it the
 * call is refused exactly like any under-privileged caller (no god mode).
 */
export const notifyUserAction: ActionDefinition<
  NotifyUserConfig,
  NotifyUserArtifact
> = {
  id: "notify_user",
  displayName: "Notify User",
  description: "Send a transactional notification to a specific user",
  category: "Built-in",
  icon: "BellRing",
  config: new Versioned({ version: 1, schema: notifyUserConfigSchema }),
  produces: "automation.notify_user_result",
  execute: async ({ config, logger, rpcClient }) => {
    const notificationClient = rpcClient.forPlugin(NotificationApi);
    try {
      const result = await notificationClient.sendTransactional({
        userId: config.userId,
        notification: {
          title: config.title,
          body: config.body,
          importance: config.importance,
        },
      });
      logger.info(
        `notify_user → ${config.userId} (${result.deliveredCount} delivered)`,
      );
      return {
        success: result.deliveredCount > 0,
        externalId: config.userId,
        artifact: {
          userId: config.userId,
          deliveredCount: result.deliveredCount,
          results: result.results,
        },
      };
    } catch (error) {
      const message = extractErrorMessage(error);
      logger.error(`notify_user failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
